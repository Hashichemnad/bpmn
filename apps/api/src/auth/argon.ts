import * as argon2 from 'argon2';

/** OWASP-recommended argon2id parameters (19 MiB, t=2, p=1). */
export const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (password: string) => argon2.hash(password, ARGON_OPTIONS);
