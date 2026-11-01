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

// ---------- Webhooks and Microsoft Teams destinations (D-174, D-176) ----------

/** Events a webhook or Teams destination can subscribe to. */
export const WEBHOOK_EVENTS = [
  'process.published',
  'process.archived',
  'page.published',
  'page.archived',
  'diagram.published',
  'diagram.archived',
  'review.submitted',
  'review.approved',
  'review.rejected',
  'workflow.case.started',
  'workflow.case.completed',
  'workflow.case.overdue',
  'issue.raised',
  'issue.overdue',
  'kpi.red',
  'import.completed',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_KINDS = ['WEBHOOK', 'TEAMS'] as const;
export type WebhookKind = (typeof WEBHOOK_KINDS)[number];

export const TEAMS_LANGUAGES = ['EN', 'AR', 'BOTH'] as const;
export type TeamsLanguage = (typeof TEAMS_LANGUAGES)[number];

/** Signature headers of webhook deliveries (see docs/integrations/WEBHOOKS.md). */
export const WEBHOOK_SIGNATURE_HEADER = 'x-processhub-signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'x-processhub-timestamp';
export const WEBHOOK_EVENT_HEADER = 'x-processhub-event';
export const WEBHOOK_DELIVERY_HEADER = 'x-processhub-delivery';

/** Retry schedule (minutes after the first attempt fails): 1, 5, 15 minutes, 1, 4, 12, 24 hours. */
export const WEBHOOK_RETRY_MINUTES = [1, 5, 15, 60, 240, 720, 1440] as const;
/** A destination is switched off after this many failed attempts in a row (any event). */
export const WEBHOOK_DISABLE_AFTER = 10;

/**
 * Destination URL. The server allows only HTTPS (plain http just for hosts in
 * OUTBOUND_ALLOWED_HOSTS, e.g. a test receiver) and checks the host (SSRF rules, D-174).
 */
const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'WEBHOOK_URL_INVALID');

export const webhookCreateSchema = z.object({
  kind: z.enum(WEBHOOK_KINDS).default('WEBHOOK'),
  name: z.string().trim().min(1).max(120),
  url: httpsUrl,
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
  departmentIds: z.array(z.uuid()).max(50).default([]),
  /** Process-house branch: only events of this process and the processes below it. */
  processBranchId: z.uuid().nullable().default(null),
  language: z.enum(TEAMS_LANGUAGES).default('BOTH'),
  active: z.boolean().default(true),
});
export type WebhookCreateInput = z.infer<typeof webhookCreateSchema>;

/** The URL may be left out on update (it is stored encrypted and never shown again in full). */
export const webhookUpdateSchema = webhookCreateSchema.omit({ kind: true }).partial();
export type WebhookUpdateInput = z.infer<typeof webhookUpdateSchema>;

export type WebhookDeliveryStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'GAVE_UP';

export interface WebhookDto {
  id: string;
  kind: WebhookKind;
  name: string;
  /** Scheme, host and path only (the query string of a Teams URL carries its signature). */
  urlDisplay: string;
  events: WebhookEventType[];
  departmentIds: string[];
  processBranch: { id: string; code: string; nameEn: string; nameAr: string } | null;
  language: TeamsLanguage;
  active: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  consecutiveFailures: number;
  hasSecret: boolean;
  lastDelivery: { status: WebhookDeliveryStatus; at: string; statusCode: number | null } | null;
  createdAt: string;
}

/** Returned on create / new secret of a generic webhook: the signing secret, shown once. */
export interface WebhookSecretDto {
  webhook: WebhookDto;
  secret: string | null;
}

export interface WebhookDeliveryDto {
  id: string;
  eventId: string;
  eventType: WebhookEventType | 'test';
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  responseSnippet: string | null;
  durationMs: number | null;
  test: boolean;
  payload: unknown;
  createdAt: string;
  deliveredAt: string | null;
}

export const webhookDeliveryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'GAVE_UP']).optional(),
});
export type WebhookDeliveryQuery = z.infer<typeof webhookDeliveryQuerySchema>;

/** Setting `integrations.webhooks`. */
export const webhookSettingsSchema = z.object({
  /**
   * Optional allow-list of host names for generic webhooks (exact host or `*.domain`); empty = any
   * public host. Teams destinations always use TEAMS_DEFAULT_HOSTS plus `teamsHosts`.
   */
  allowedHosts: z.array(z.string().trim().toLowerCase().min(1).max(253)).max(100).default([]),
  /** Extra hosts allowed for Teams destinations (e.g. a regional Power Automate host). */
  teamsHosts: z.array(z.string().trim().toLowerCase().min(1).max(253)).max(50).default([]),
  /** Days the delivery log is kept. */
  retentionDays: z.number().int().min(7).max(365).default(30),
});
export type WebhookSettings = z.infer<typeof webhookSettingsSchema>;
export const DEFAULT_WEBHOOK_SETTINGS: WebhookSettings = {
  allowedHosts: [],
  teamsHosts: [],
  retentionDays: 30,
};

/** Hosts of Teams "Workflows" webhooks (Power Automate) allowed by default. */
export const TEAMS_DEFAULT_HOSTS = [
  '*.logic.azure.com',
  '*.environment.api.powerplatform.com',
  '*.webhook.office.com',
] as const;

/** Whether a host matches an entry (`example.com` exactly or `*.example.com` for sub-domains). */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const p = pattern.toLowerCase().trim();
  if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}

/** The common part of every webhook payload (D-174). */
export interface WebhookPayload {
  id: string;
  type: WebhookEventType | 'test';
  /** ISO time the event happened. */
  occurredAt: string;
  entity: {
    type: string;
    id: string;
    code: string | null;
    nameEn: string;
    nameAr: string;
  } | null;
  /** Absolute links back to ProcessHub (workspace / portal) and the public API. */
  links: Record<string, string>;
  /** Small event-specific facts (status, version, outcome …) — never form data or secrets. */
  data: Record<string, string | number | boolean | null>;
}

// ---------- Reporting feed (Power BI / Excel, D-175) ----------

export const REPORTING_TABLES = [
  'processes',
  'reviews',
  'kpis',
  'kpi-measurements',
  'risks',
  'controls',
  'risk-coverage',
  'control-tests',
  'issues',
  'audit-findings',
  'workflow-cases-monthly',
  'workflow-sla',
  'mining-logs',
] as const;
export type ReportingTable = (typeof REPORTING_TABLES)[number];

export const REPORTING_MAX_PAGE_SIZE = 1000;

export const reportingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(REPORTING_MAX_PAGE_SIZE).default(500),
  updatedSince: z.iso.datetime({ offset: true }).optional(),
});
export type ReportingQuery = z.infer<typeof reportingQuerySchema>;
export const reportingTableParamSchema = z.enum(REPORTING_TABLES);

// ---------- Exports: static HTML site, PowerPoint (D-177, D-178) ----------

export const HTML_EXPORT_SCOPES = ['PROCESS', 'BRANCH', 'VALUE_CHAIN', 'SPACE'] as const;
export type HtmlExportScope = (typeof HTML_EXPORT_SCOPES)[number];

export const htmlExportSchema = z.object({
  scope: z.enum(HTML_EXPORT_SCOPES),
  /** Process (PROCESS / BRANCH), value chain diagram (VALUE_CHAIN) or space (SPACE). */
  id: z.uuid(),
  /** Workspace drafts instead of the published versions (users who may see them; watermarked). */
  drafts: z.boolean().default(false),
});
export type HtmlExportInput = z.infer<typeof htmlExportSchema>;

export const PPTX_EXPORT_SCOPES = [
  'PROCESS',
  'VALUE_CHAIN',
  'KPI_SUMMARY',
  'RISK_SUMMARY',
] as const;
export type PptxExportScope = (typeof PPTX_EXPORT_SCOPES)[number];

export const pptxExportSchema = z.object({
  scope: z.enum(PPTX_EXPORT_SCOPES),
  /** Process (PROCESS), value chain diagram (VALUE_CHAIN); optional department for summaries. */
  id: z.uuid().optional(),
  locale: z.enum(['en', 'ar']).default('en'),
  drafts: z.boolean().default(false),
});
export type PptxExportInput = z.infer<typeof pptxExportSchema>;

/** Setting `branding.exportTemplate`: colours of exported slides and offline sites. */
export const exportTemplateSchema = z.object({
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'INVALID_COLOUR')
    .default('#1F4E79'),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'INVALID_COLOUR')
    .default('#B28704'),
  /** Show the logo on every slide (not only the title slide). */
  logoOnEverySlide: z.boolean().default(true),
});
export type ExportTemplate = z.infer<typeof exportTemplateSchema>;
export const DEFAULT_EXPORT_TEMPLATE: ExportTemplate = {
  primaryColor: '#1F4E79',
  accentColor: '#B28704',
  logoOnEverySlide: true,
};
