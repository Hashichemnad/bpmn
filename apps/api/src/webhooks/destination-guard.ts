import { HttpStatus } from '@nestjs/common';
import {
  TEAMS_DEFAULT_HOSTS,
  hostMatches,
  type WebhookKind,
  type WebhookSettings,
} from '@processhub/shared';
import { AppException } from '../common/app-exception';
import { OutboundBlockedError, type OutboundPolicy } from '../common/outbound';

const refuse = (code: string, message: string) =>
  new AppException(HttpStatus.BAD_REQUEST, code, message);

/** Hosts a destination of this kind may use; empty = any public host. */
export function allowedHostsFor(kind: WebhookKind, settings: WebhookSettings): string[] {
  return kind === 'TEAMS'
    ? [...TEAMS_DEFAULT_HOSTS, ...settings.teamsHosts]
    : settings.allowedHosts;
}

/**
 * SSRF rules for outbound destinations (D-174), checked when a destination is saved and again
 * before every delivery:
 * - HTTPS only; plain http and internal addresses only for hosts in OUTBOUND_ALLOWED_HOSTS (test
 *   receivers), never credentials in the URL;
 * - the host must match the allow-list of its kind (Teams: Power Automate hosts by default; generic
 *   webhooks: the optional `integrations.webhooks.allowedHosts`);
 * - every address the name resolves to must be public (no loopback, private, link-local / cloud
 *   metadata, CGNAT, multicast, reserved). The sender connects to the checked address and never
 *   follows redirects.
 */
export async function checkDestination(
  raw: string,
  kind: WebhookKind,
  settings: WebhookSettings,
  policy: OutboundPolicy,
  opts: { resolve?: boolean } = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw refuse('WEBHOOK_URL_INVALID', 'Not a valid URL');
  }
  if (url.username || url.password) throw refuse('WEBHOOK_URL_INVALID', 'No credentials in URLs');
  const host = url.hostname;
  const internalAllowed = policy.allowsHost(host);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && internalAllowed)) {
    throw refuse('HTTPS_URL_REQUIRED', 'Destinations must use HTTPS');
  }
  if (!internalAllowed) {
    const list = allowedHostsFor(kind, settings);
    if (list.length && !list.some((p) => hostMatches(host.replace(/^\[|\]$/g, ''), p))) {
      throw refuse('WEBHOOK_HOST_NOT_ALLOWED', `The host ${host} is not on the allow-list`);
    }
  }
  if (opts.resolve !== false) {
    try {
      await policy.resolve(host);
    } catch (err) {
      if (err instanceof OutboundBlockedError) {
        throw refuse('WEBHOOK_HOST_BLOCKED', 'The host points to an internal address');
      }
      throw refuse('WEBHOOK_HOST_UNRESOLVED', 'The host name could not be resolved');
    }
  }
  return url;
}

/** Scheme, host and path of a URL — the query string of a Teams URL carries its signature. */
export function displayUrl(url: URL): string {
  const path = url.pathname.length > 60 ? `${url.pathname.slice(0, 57)}…` : url.pathname;
  return `${url.protocol}//${url.host}${path}${url.search ? '?…' : ''}`;
}
