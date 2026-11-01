import { API_KEY_PATTERN } from '@processhub/shared';
import { generateApiKey, ipAllowed, keyStatus } from './api-keys.service';
import { createHash } from 'node:crypto';

describe('API keys', () => {
  it('generates keys in the documented format with a SHA-256 hash and a unique id', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const k = generateApiKey();
      const m = API_KEY_PATTERN.exec(k.secret);
      expect(m?.[1]).toBe(k.prefix);
      expect(k.hash).toBe(createHash('sha256').update(k.secret).digest('hex'));
      seen.add(k.prefix);
    }
    expect(seen.size).toBe(200);
  });

  it('matches addresses against IP / CIDR allow-lists (IPv4, IPv6, mapped IPv4)', () => {
    expect(ipAllowed('203.0.113.9', [])).toBe(true);
    expect(ipAllowed(null, ['10.0.0.1'])).toBe(false);
    expect(ipAllowed('10.0.0.1', ['10.0.0.1'])).toBe(true);
    expect(ipAllowed('::ffff:10.0.0.1', ['10.0.0.0/8'])).toBe(true);
    expect(ipAllowed('10.1.2.3', ['192.168.0.0/16'])).toBe(false);
    expect(ipAllowed('2001:db8::5', ['2001:db8::/32'])).toBe(true);
    expect(ipAllowed('2001:db9::5', ['2001:db8::/32'])).toBe(false);
    expect(ipAllowed('not-an-ip', ['0.0.0.0/0'])).toBe(false);
  });

  it('derives the status from revocation and expiry', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(keyStatus({ revokedAt: null, expiresAt: new Date('2027-01-01') }, now)).toBe('ACTIVE');
    expect(keyStatus({ revokedAt: null, expiresAt: new Date('2026-10-01') }, now)).toBe('EXPIRED');
    expect(keyStatus({ revokedAt: now, expiresAt: new Date('2027-01-01') }, now)).toBe('REVOKED');
  });
});
