import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const TAG_BYTES = 16;

/** A value sealed by SecretBox (`v1.<iv>.<tag>.<data>`). */
export const SEALED_RE = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

const parseKey = (base64Key: string) => {
  const key = Buffer.from(base64Key.trim(), 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  return key;
};

/**
 * AES-256-GCM encryption for secrets stored in the database (integration tokens).
 * Format: `v1.<iv>.<auth tag>.<ciphertext>` (base64url parts). The key comes from the environment.
 *
 * Key rotation (final session part B, SEC-40): values are always encrypted with the current key;
 * decryption also tries the keys in INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS (comma-separated), so a new
 * key can be put in place first and `reencrypt-secrets` moves the stored values to it afterwards
 * (docs/DEPLOYMENT.md "Key rotation").
 */
export class SecretBox {
  private readonly key: Buffer;
  private readonly previous: Buffer[];

  constructor(
    base64Key: string,
    previousKeys: string = process.env.INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS ?? '',
  ) {
    this.key = parseKey(base64Key);
    this.previous = previousKeys
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .map(parseKey);
  }

  /** True when the value can only be opened with a previous key (to be re-encrypted). */
  usesPreviousKey(boxed: string): boolean {
    try {
      this.open(boxed, this.key);
      return false;
    } catch {
      this.decrypt(boxed); // throws when no key opens it
      return true;
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv, tag, data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  /** Throws when the value was tampered with or encrypted with another key. */
  decrypt(boxed: string): string {
    let error: unknown;
    for (const key of [this.key, ...this.previous]) {
      try {
        return this.open(boxed, key);
      } catch (e) {
        error = e;
      }
    }
    throw error;
  }

  private open(boxed: string, key: Buffer): string {
    const [version, iv, tag, data] = boxed.split('.');
    if (version !== 'v1' || !iv || !tag || data === undefined)
      throw new Error('Invalid secret format');
    const authTag = Buffer.from(tag, 'base64url');
    // A full-length tag only: Node otherwise accepts truncated GCM tags (easier forgery).
    if (authTag.length !== TAG_BYTES) throw new Error('Invalid secret format');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
