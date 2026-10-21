import { z } from 'zod';
import { type PasswordPolicy } from '@processhub/shared';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  COOKIE_SECURE: bool(true),
  CORS_ORIGINS: z.string().default('http://localhost:8080'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  BODY_LIMIT: z.string().default('6mb'),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(10),
  PASSWORD_REQUIRE_UPPER: bool(true),
  PASSWORD_REQUIRE_LOWER: bool(true),
  PASSWORD_REQUIRE_DIGIT: bool(true),
  PASSWORD_REQUIRE_SYMBOL: bool(false),

  RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),

  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().default(9000),
  MINIO_USE_SSL: bool(false),
  MINIO_ACCESS_KEY: z.string().default(''),
  MINIO_SECRET_KEY: z.string().default(''),
  MINIO_BUCKET: z.string().default('processhub'),

  ENABLE_SWAGGER: bool(false),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig extends Env {
  corsOrigins: string[];
  passwordPolicy: PasswordPolicy;
  isProduction: boolean;
}

let cached: AppConfig | undefined;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  const env = parsed.data;
  return {
    ...env,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    isProduction: env.NODE_ENV === 'production',
    passwordPolicy: {
      minLength: env.PASSWORD_MIN_LENGTH,
      requireUpper: env.PASSWORD_REQUIRE_UPPER,
      requireLower: env.PASSWORD_REQUIRE_LOWER,
      requireDigit: env.PASSWORD_REQUIRE_DIGIT,
      requireSymbol: env.PASSWORD_REQUIRE_SYMBOL,
    },
  };
}

export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test helper: forget the cached config so new env vars are picked up. */
export function resetConfigCache(): void {
  cached = undefined;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
