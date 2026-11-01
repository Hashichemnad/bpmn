import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/**
 * SSRF protection for connections to addresses an administrator can configure (GitLab / GitHub
 * Enterprise URL, SMTP host). Internal addresses (loopback, private networks, link-local incl. the
 * cloud metadata service, CGNAT, multicast, reserved) are refused unless the host is listed in
 * OUTBOUND_ALLOWED_HOSTS. The address that was checked is the one connected to, so DNS rebinding
 * between the check and the connection is not possible.
 */
export class OutboundBlockedError extends Error {
  constructor(readonly host: string) {
    super(
      `Connections to internal addresses are blocked (${host}). ` +
        'Add the host to OUTBOUND_ALLOWED_HOSTS to allow it.',
    );
  }
}

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  // Unspecified, loopback and the deprecated IPv4-compatible range (::a.b.c.d) — Phase 4.4.
  ['::', 96],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

/** True for addresses that point into internal / special-purpose networks. */
export function isInternalAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  if (family !== 6) return true; // not an IP address: never treated as safe
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return BLOCKED.check(mapped[1], 'ipv4');
  return BLOCKED.check(address, 'ipv6');
}

/** Entries of OUTBOUND_ALLOWED_HOSTS: host names, IP addresses or CIDR ranges. */
export class OutboundPolicy {
  private readonly names = new Set<string>();
  private readonly ranges = new BlockList();

  constructor(entries: string[]) {
    for (const raw of entries) {
      const entry = raw
        .trim()
        .toLowerCase()
        .replace(/^\[|\]$/g, '');
      if (!entry) continue;
      const [ip, prefix] = entry.split('/');
      const family = isIP(ip);
      if (family) {
        const type = family === 4 ? 'ipv4' : 'ipv6';
        if (prefix === undefined) this.ranges.addAddress(ip, type);
        else this.ranges.addSubnet(ip, Number(prefix), type);
      } else {
        this.names.add(entry);
      }
    }
  }

  /** Whether a host (as configured: name or IP address) may be internal. */
  allowsHost(host: string): boolean {
    const bare = host.toLowerCase().replace(/^\[|\]$/g, '');
    return this.names.has(bare) || this.allowsAddress(bare);
  }

  private allowsAddress(address: string): boolean {
    const family = isIP(address);
    return !!family && this.ranges.check(address, family === 4 ? 'ipv4' : 'ipv6');
  }

  /** Throws unless every address is public, or the host / address is explicitly allowed. */
  check(host: string, addresses: string[]): void {
    if (this.allowsHost(host)) return;
    if (!addresses.length) throw new OutboundBlockedError(host);
    for (const a of addresses) {
      if (isInternalAddress(a) && !this.allowsAddress(a)) throw new OutboundBlockedError(host);
    }
  }

  /** Resolves a host and checks it; returns the address to connect to. */
  async resolve(host: string): Promise<{ address: string; family: number }> {
    const bare = host.replace(/^\[|\]$/g, '');
    if (isIP(bare)) {
      this.check(bare, [bare]);
      return { address: bare, family: isIP(bare) };
    }
    const all = await dnsLookup(bare, { all: true, verbatim: true });
    this.check(
      bare,
      all.map((a) => a.address),
    );
    return all[0];
  }

  /** A `lookup` for net/tls/http(s) connections that applies this policy. */
  lookup(): LookupFunction {
    return (hostname, options, callback) => {
      this.resolve(hostname).then(
        (a) =>
          options.all
            ? callback(null, [{ address: a.address, family: a.family }])
            : callback(null, a.address, a.family),
        (err: NodeJS.ErrnoException) => callback(err, '', 0),
      );
    };
  }
}
