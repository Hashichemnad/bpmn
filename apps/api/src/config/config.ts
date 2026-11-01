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
  /** Refresh token (session) lifetime in hours; tokens rotate on every use (D-065). */
  REFRESH_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(2160).default(24),
  /** Absolute session limit in hours from sign-in, whatever the activity (default 7 days). */
  SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(8760).default(168),
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

  /** base64-encoded 32-byte key for AES-256-GCM encryption of integration tokens. */
  INTEGRATIONS_ENCRYPTION_KEY: z
    .string()
    .default('')
    .refine(
      (v) => v === '' || Buffer.from(v, 'base64').length === 32,
      'INTEGRATIONS_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)',
    ),
  /** Timeout for calls to GitHub / GitLab, in milliseconds. */
  GIT_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20000),
  /** Timeout for calls to Salesforce (KPI link), in milliseconds. */
  SALESFORCE_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),

  /** Public URL users open (links in notification emails). */
  APP_URL: z
    .url()
    .default('http://localhost:8080')
    .transform((v) => v.replace(/\/+$/, '')),
  /** How often reminders (review dates, overdue reviews) are checked; 0 turns the scheduler off. */
  SCHEDULER_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(60),
  /** Process mining (Phase 5.1): upload limit of an event log file (MB). */
  MINING_UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(2048).default(200),
  /** Run CPU-heavy mining work (analysis, discovery, simulation) in worker threads (D-128). */
  MINING_WORKERS: bool(true),
  /** Workflow execution (Phase 5.2): how often due timers and jobs are checked, in seconds; 0 = off. */
  WORKFLOW_POLL_SECONDS: z.coerce.number().int().min(0).max(3600).default(15),
  /** Timeout for one SMTP delivery, in milliseconds. */
  SMTP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),
  /** Timeout for one call to the AI provider, in milliseconds (generation can take a while). */
  AI_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(180000),
  /**
   * Hosts the Git and SMTP integrations may reach although they are internal (private network,
   * loopback, ...): comma-separated host names, IP addresses or CIDR ranges. Everything else
   * internal is blocked (SSRF protection). Plain http:// Git URLs are only allowed for these hosts.
   */
  OUTBOUND_ALLOWED_HOSTS: z.string().default(''),
  /**
   * Emergency switch: allow password sign-in for every account even when Settings → Authentication
   * turned it off (e.g. the identity provider is down and the break-glass password is lost).
   */
  AUTH_FORCE_LOCAL_LOGIN: bool(false),
  /** Timeout for calls to the single sign-on identity provider, in milliseconds. */
  SSO_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),
  /**
   * Internal diagram / PDF renderer (Phase 4.4, D-172), e.g. http://renderer:3100. Empty = no
   * server-side diagram images (exports carry a note, PDF reports fall back to a link).
   */
  RENDERER_URL: z
    .string()
    .default('')
    .transform((v) => v.replace(/\/+$/, '')),
  RENDERER_TOKEN: z.string().default(''),
  RENDERER_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig extends Env {
  corsOrigins: string[];
  outboundAllowedHosts: string[];
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
    outboundAllowedHosts: env.OUTBOUND_ALLOWED_HOSTS.split(',')
      .map((h) => h.trim())
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
