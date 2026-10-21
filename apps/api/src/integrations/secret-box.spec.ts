import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box';

describe('SecretBox', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips and never stores the plain text', () => {
    const box = new SecretBox(key);
    const sealed = box.encrypt('ghp_secretToken123');
    expect(sealed).not.toContain('ghp_secretToken123');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(box.decrypt(sealed)).toBe('ghp_secretToken123');
    // a fresh IV every time
    expect(box.encrypt('x')).not.toBe(box.encrypt('x'));
  });

  it('detects tampering and wrong keys', () => {
    const box = new SecretBox(key);
    const sealed = box.encrypt('token');
    const parts = sealed.split('.');
    const flipped = Buffer.from(parts[3], 'base64url');
    flipped[0] ^= 1;
    parts[3] = flipped.toString('base64url');
    expect(() => box.decrypt(parts.join('.'))).toThrow();
    expect(() => new SecretBox(randomBytes(32).toString('base64')).decrypt(sealed)).toThrow();
    expect(() => box.decrypt('garbage')).toThrow();
  });

  it('rejects truncated authentication tags', () => {
    const box = new SecretBox(key);
    const parts = box.encrypt('token').split('.');
    parts[2] = Buffer.from(parts[2], 'base64url').subarray(0, 4).toString('base64url');
    expect(() => box.decrypt(parts.join('.'))).toThrow('Invalid secret format');
  });

  it('rejects keys of the wrong size', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow();
  });
});
