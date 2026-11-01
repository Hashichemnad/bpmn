import { withDeadline } from './deadline';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { OutboundBlockedError, type OutboundPolicy } from './outbound';

export interface SafeFetchOptions {
  policy: OutboundPolicy;
  timeoutMs: number;
  /** Largest response body read (bytes). */
  maxBytes?: number;
}

type FetchInit = {
  method?: string;
  headers?: HeadersInit | Record<string, string>;
  body?: string | URLSearchParams | null;
  signal?: AbortSignal | null;
};

/**
 * A `fetch` replacement for calls to administrator-configured servers (single sign-on identity
 * provider): the SSRF policy applies (internal addresses only when listed in OUTBOUND_ALLOWED_HOSTS,
 * plain http only for those hosts, the checked address is the one connected to), redirects are
 * never followed, and the response size and time are limited.
 */
export function safeFetch(opts: SafeFetchOptions) {
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  return async (input: string | URL, init: FetchInit = {}): Promise<Response> => {
    const target = new URL(String(input));
    if (target.protocol !== 'https:' && !opts.policy.allowsHost(target.hostname)) {
      throw new OutboundBlockedError(target.host);
    }
    // Checked before connecting (an IP literal skips `lookup`); `lookup` pins host names.
    await opts.policy.resolve(target.hostname);
    const body =
      init.body instanceof URLSearchParams ? init.body.toString() : (init.body ?? undefined);
    const headers = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<Response>((resolve, reject) => {
      const req = send(
        target,
        {
          method: init.method ?? 'GET',
          headers: { 'user-agent': 'ProcessHub', ...headers },
          lookup: opts.policy.lookup(),
          timeout: opts.timeoutMs,
          signal: init.signal ?? undefined,
        },
        (res: IncomingMessage) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) req.destroy(new Error('response too large'));
            else chunks.push(c);
          });
          res.on('end', () => {
            const out = new Headers();
            for (const [k, v] of Object.entries(res.headers)) {
              if (v !== undefined) out.set(k, Array.isArray(v) ? v.join(', ') : v);
            }
            const status = res.statusCode ?? 502;
            const noBody = status === 204 || status === 304;
            resolve(new Response(noBody ? null : Buffer.concat(chunks), { status, headers: out }));
          });
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      withDeadline(req, opts.timeoutMs * 3);
      req.on('error', reject);
      req.end(body);
    });
  };
}
