import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** A new signing secret for a webhook (`whsec_` + 256 random bits). */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

/**
 * Signature of a delivery (D-174): `sha256=` + hex HMAC-SHA256 over `<timestamp>.<raw body>` with the
 * webhook's secret. The timestamp (Unix seconds) is sent in its own header, so receivers can refuse
 * replays older than a few minutes.
 */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** Receiver-side check (documented in WEBHOOKS.md; used by the tests and the e2e receiver). */
export function verifyWebhook(
  secret: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  body: string,
  toleranceSeconds = 300,
  now = Date.now(),
): boolean {
  const ts = Number(timestampHeader);
  if (!Number.isInteger(ts) || !signatureHeader) return false;
  if (Math.abs(now / 1000 - ts) > toleranceSeconds) return false;
  const expected = Buffer.from(signWebhook(secret, ts, body));
  const given = Buffer.from(signatureHeader);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
