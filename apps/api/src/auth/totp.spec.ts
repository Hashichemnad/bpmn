import {
  hashRecoveryCode,
  newRecoveryCodes,
  newTotpSecret,
  totpCode,
  totpUri,
  verifyTotp,
} from './totp';

describe('TOTP', () => {
  const secret = newTotpSecret();
  const now = Date.UTC(2026, 9, 21, 12, 0, 10);
  const step = Math.floor(now / 30_000);

  it('creates a 160-bit base32 secret', () => {
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('accepts the current code and returns its time step', () => {
    expect(verifyTotp(secret, totpCode(secret, now), null, now)).toBe(step);
  });

  it('tolerates one step of clock drift but not two', () => {
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), null, now)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, now - 90_000), null, now)).toBeNull();
  });

  it('refuses a code that was already used (replay)', () => {
    const code = totpCode(secret, now);
    expect(verifyTotp(secret, code, step, now)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), step, now)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), step, now)).toBe(step + 1);
  });

  it('refuses a wrong code', () => {
    const wrong = String((Number(totpCode(secret, now)) + 1) % 1_000_000).padStart(6, '0');
    expect(verifyTotp(secret, wrong, null, now)).toBeNull();
  });

  it('builds an otpauth URI for the QR code', () => {
    const uri = totpUri(secret, 'ACME Corp', 'a@example.com');
    expect(uri).toMatch(/^otpauth:\/\/totp\/ACME%20Corp:a%40example\.com\?/);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('recovery codes', () => {
  it('generates 10 distinct, well-formed codes', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  });

  it('hashes the normalised code (case and dashes do not matter)', () => {
    const [code] = newRecoveryCodes(1);
    expect(hashRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(hashRecoveryCode(code));
    expect(hashRecoveryCode(code)).toMatch(/^[0-9a-f]{64}$/);
  });
});
