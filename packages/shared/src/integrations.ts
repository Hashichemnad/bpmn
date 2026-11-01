import { z } from 'zod';

/**
 * Phase 4.4 — integrations and exports (D-172 – ): public REST API keys, webhooks, Microsoft Teams
 * channel notifications, reporting feed, exports and scheduled report e-mails.
 */

// ---------- Public API keys ----------

/** Read-only scopes of the public API (`/api/public/v1`). No write scopes exist yet (D-173). */
export const API_SCOPES = [
  'processes:read',
  'pages:read',
  'diagrams:read',
  'objects:read',
  'grc:read',
  'ea:read',
  'kpis:read',
  'workflow:read',
  /** Case-level workflow data incl. names of requesters / assignees (personal data). */
  'workflow:cases:read',
  /** Reporting feed for Power BI / Excel (step 3). */
  'reporting:read',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Scopes pre-selected for a new key: published repository content only. */
export const DEFAULT_API_SCOPES: ApiScope[] = ['processes:read', 'pages:read', 'diagrams:read'];

export const API_KEY_CONTENT = ['PUBLISHED', 'WORKSPACE'] as const;
export type ApiKeyContent = (typeof API_KEY_CONTENT)[number];

/** Header names accepted for the key (`Authorization: Bearer <key>` works too). */
export const API_KEY_HEADER = 'x-api-key';
/** Key format: `phk_<12 character id>_<43 character secret>`; the id is stored for lookup. */
export const API_KEY_PATTERN = /^phk_([A-Za-z0-9]{12})_([A-Za-z0-9_-]{43})$/;

export const API_KEY_DEFAULT_DAYS = 365;
export const API_RATE_LIMIT_DEFAULT = 120;
export const API_RATE_LIMIT_MAX = 2000;

const ipOrCidr = z
  .string()
  .trim()
  .max(64)
  .refine((v) => /^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(v), 'INVALID_IP');

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  ownerId: z.uuid(),
  scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length),
  content: z.enum(API_KEY_CONTENT).default('PUBLISHED'),
  departmentIds: z.array(z.uuid()).max(50).default([]),
  ipAllowList: z.array(ipOrCidr).max(50).default([]),
  rateLimitPerMinute: z
    .number()
    .int()
    .min(1)
    .max(API_RATE_LIMIT_MAX)
    .default(API_RATE_LIMIT_DEFAULT),
  /** ISO date; default one year, never beyond the configured maximum. */
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;

/** Everything but the secret can be changed; scopes / content / filters take effect at once. */
export const apiKeyUpdateSchema = apiKeyCreateSchema.partial();
export type ApiKeyUpdateInput = z.infer<typeof apiKeyUpdateSchema>;

export type ApiKeyStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface ApiKeyDto {
  id: string;
  name: string;
  description: string;
  /** `phk_<id>` — enough to recognise the key, useless without the secret. */
  prefix: string;
  owner: { id: string; nameEn: string; nameAr: string; email: string } | null;
  scopes: ApiScope[];
  content: ApiKeyContent;
  departmentIds: string[];
  ipAllowList: string[];
  rateLimitPerMinute: number;
  expiresAt: string;
  revokedAt: string | null;
  rotatedAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  status: ApiKeyStatus;
  createdAt: string;
  createdBy: { id: string; nameEn: string; nameAr: string } | null;
}

/** Returned once on create / rotate: the only time the full key is visible. */
export interface ApiKeySecretDto {
  key: ApiKeyDto;
  secret: string;
}

export interface ApiKeyUsageEntryDto {
  id: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ip: string | null;
  createdAt: string;
}

export interface ApiKeyUsageDto {
  /** Calls per day (UTC) for the last 30 days, oldest first. */
  days: { day: string; calls: number; errors: number }[];
  /** Calls per endpoint (last 30 days). */
  endpoints: { method: string; path: string; calls: number; errors: number; avgMs: number }[];
  recent: ApiKeyUsageEntryDto[];
}

export const apiKeyUsageQuerySchema = z.object({
  status: z.enum(['all', 'errors']).default('all'),
});
export type ApiKeyUsageQuery = z.infer<typeof apiKeyUsageQuerySchema>;

/** Setting `integrations.api`. */
export const apiSettingsSchema = z.object({
  /** Longest allowed key lifetime in days. */
  maxKeyDays: z.number().int().min(1).max(3650).default(730),
  /** Days the call log is kept. */
  usageRetentionDays: z.number().int().min(7).max(730).default(90),
});
export type ApiSettings = z.infer<typeof apiSettingsSchema>;
export const DEFAULT_API_SETTINGS: ApiSettings = { maxKeyDays: 730, usageRetentionDays: 90 };

// ---------- Public API query parameters ----------

export const PUBLIC_MAX_PAGE_SIZE = 200;

export const publicListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(PUBLIC_MAX_PAGE_SIZE).default(50),
  /** Only items changed after this moment (incremental sync). */
  updatedSince: z.iso.datetime({ offset: true }).optional(),
  q: z.string().trim().max(200).optional(),
});
export type PublicListQuery = z.infer<typeof publicListQuerySchema>;

export interface PublicPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const optionalUuid = z.uuid().optional();
export const publicProcessQuerySchema = publicListQuerySchema.extend({
  category: z.enum(['MANAGEMENT', 'CORE', 'SUPPORT']).optional(),
  departmentId: optionalUuid,
  status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED']).optional(),
});
export const publicPageQuerySchema = publicListQuerySchema.extend({ spaceId: optionalUuid });
export const publicDiagramQuerySchema = publicListQuerySchema.extend({
  type: z.enum(['VALUE_CHAIN', 'ORG_CHART', 'DMN', 'EPC', 'SIPOC']).optional(),
});
export const publicObjectQuerySchema = publicListQuerySchema.extend({
  type: z.enum(['ROLE', 'SYSTEM', 'DOCUMENT', 'TERM']).optional(),
});
export const publicCaseQuerySchema = publicListQuerySchema.extend({
  processId: optionalUuid,
  status: z.enum(['RUNNING', 'COMPLETED', 'CANCELLED', 'WITHDRAWN']).optional(),
});
export const publicBpmnQuerySchema = z.object({
  version: z.coerce.number().int().min(1).max(100000).optional(),
});
export const publicSvgQuerySchema = publicBpmnQuerySchema.extend({
  lang: z.enum(['en', 'ar']).default('en'),
});
export const publicPageContentQuerySchema = z.object({
  format: z.enum(['html', 'text']).default('html'),
});
