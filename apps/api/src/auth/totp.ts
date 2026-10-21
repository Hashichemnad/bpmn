import { createHash, randomInt } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { MFA_RECOVERY_CODE_COUNT, normaliseRecoveryCode } from '@processhub/shared';

/** RFC 6238 parameters understood by every authenticator app (Microsoft, Google, 1Password, …). */
const PERIOD = 30;
const DIGITS = 6;
/** Accept the previous and next 30-second step as well (clock drift). */
const WINDOW = 1;

/** A new random 160-bit secret, base32-encoded. */
export function newTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

function totp(secret: string, issuer = 'ProcessHub', label = 'user') {
  return new OTPAuth.TOTP({
    issuer,
    label,
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

/** `otpauth://totp/...` URI for the QR code. */
export function totpUri(secret: string, issuer: string, account: string): string {
  return totp(secret, issuer, account).toString();
}

/**
 * Checks a 6-digit code. Returns the time step it belongs to, or null when it is wrong or was
 * already used (a step at or before `lastStep` is refused, so a code cannot be replayed).
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastStep: number | null,
  now = Date.now(),
): number | null {
  const delta = totp(secret).validate({ token: code, timestamp: now, window: WINDOW });
  if (delta === null) return null;
  const step = Math.floor(now / 1000 / PERIOD) + delta;
  if (lastStep !== null && step <= lastStep) return null;
  return step;
}

/** Test helper: the code for a given time. */
export function totpCode(secret: string, now = Date.now()): string {
  return totp(secret).generate({ timestamp: now });
}

/** Crockford base32 without I, L, O, U: easy to read aloud and type. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Single-use recovery codes `XXXX-XXXX-XXXX-XXXX` (16 characters = 80 random bits each). */
export function newRecoveryCodes(count = MFA_RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () =>
    normaliseRecoveryCode(Array.from({ length: 16 }, () => ALPHABET[randomInt(32)]).join('')),
  );
}

/** Recovery codes are random (80 bits), so a fast hash is enough; the input is normalised first. */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
}
