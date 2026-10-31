import { z } from 'zod';
import type { UserRef } from './types';

/**
 * Salesforce KPI link (Phase 4.3, D-114 – D-116): a read-only import of the corporate KPI catalogue
 * and its results from the PMS app. Off by default; Super Admin only; ProcessHub never writes to
 * Salesforce. Object and field names come from a mapping saved in Settings (defaults below follow
 * the documented PMS data model and can be changed when a sandbox differs).
 */

export const SALESFORCE_AUTH_FLOWS = ['CLIENT_CREDENTIALS', 'JWT_BEARER'] as const;
export type SalesforceAuthFlow = (typeof SALESFORCE_AUTH_FLOWS)[number];

export const SALESFORCE_SCHEDULES = ['OFF', 'HOURLY', 'DAILY', 'WEEKLY'] as const;
export type SalesforceSchedule = (typeof SALESFORCE_SCHEDULES)[number];

/** Objectives either come from their own object or from the values of a KPI field (picklist). */
export const OBJECTIVE_SOURCES = ['NONE', 'OBJECT', 'KPI_FIELD'] as const;
export type ObjectiveSource = (typeof OBJECTIVE_SOURCES)[number];

/** SOQL identifiers only: an object / field API name, relationship paths with dots. */
const apiName = z
  .string()
  .trim()
  .max(120)
  .regex(/^([A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*)?$/, 'INVALID_API_NAME');
const objectName = z
  .string()
  .trim()
  .max(80)
  .regex(/^([A-Za-z][A-Za-z0-9_]*)?$/, 'INVALID_API_NAME');
const valueMap = z.record(z.string().trim().max(120), z.string().trim().max(40)).default({});

export const salesforceMappingSchema = z.object({
  objectives: z.object({
    source: z.enum(OBJECTIVE_SOURCES).default('KPI_FIELD'),
    /** OBJECT: the objectives object and its fields. */
    object: objectName.default(''),
    code: apiName.default(''),
    nameEn: apiName.default(''),
    nameAr: apiName.default(''),
    descriptionEn: apiName.default(''),
    descriptionAr: apiName.default(''),
  }),
  kpis: z.object({
    object: objectName.default('Org_Kpi_Goal__c'),
    code: apiName.default('Name'),
    nameEn: apiName.default('Proposed_Kpi_Name__c'),
    nameAr: apiName.default(''),
    descriptionEn: apiName.default('Kpi_Description_En__c'),
    descriptionAr: apiName.default('Kpi_Description_Ar__c'),
    unit: apiName.default('Measuring_Unit__c'),
    direction: apiName.default('Measuring_Direction__c'),
    frequency: apiName.default('Measuring_Period__c'),
    target: apiName.default(''),
    status: apiName.default('Status__c'),
    /** OBJECT source: lookup to the objective record; KPI_FIELD source: the field whose value is the objective. */
    objective: apiName.default('Department_Goal__c'),
    directionValues: valueMap,
    frequencyValues: valueMap,
    statusValues: valueMap,
  }),
  results: z.object({
    /** Empty: definitions only, no actual values. */
    object: objectName.default('Org_Kpi_Process__c'),
    /** Path to the KPI record id (relationship paths allowed). */
    kpi: apiName.default('Org_Kpi_Measure__r.Org_Kpi_Goal__c'),
    year: apiName.default('Org_Kpi_Measure__r.Measuring_Year__c'),
    period: apiName.default('Quarter__c'),
    value: apiName.default('Achieve_Value__c'),
    target: apiName.default('Target_Value__c'),
    comment: apiName.default('Notes__c'),
    /** Salesforce period value → Q1…Q4, M01…M12 or YEAR. */
    periodValues: valueMap,
  }),
  processMap: z.object({
    /** Empty: no KPI ↔ process mapping. */
    object: objectName.default(''),
    kpi: apiName.default(''),
    /** Field holding the ProcessHub process code (e.g. S.01.01). */
    processCode: apiName.default(''),
  }),
});
export type SalesforceMapping = z.infer<typeof salesforceMappingSchema>;

export const DEFAULT_SALESFORCE_MAPPING: SalesforceMapping = salesforceMappingSchema.parse({
  objectives: {},
  kpis: {
    directionValues: {
      Increase: 'HIGHER_IS_BETTER',
      Decrease: 'LOWER_IS_BETTER',
      'Higher is better': 'HIGHER_IS_BETTER',
      'Lower is better': 'LOWER_IS_BETTER',
    },
    frequencyValues: {
      Monthly: 'MONTHLY',
      Quarterly: 'QUARTERLY',
      Annual: 'ANNUAL',
      Yearly: 'ANNUAL',
    },
    statusValues: { Active: 'ACTIVE', Inactive: 'RETIRED' },
  },
  results: {
    periodValues: { Q1: 'Q1', Q2: 'Q2', Q3: 'Q3', Q4: 'Q4', 'Full Year': 'YEAR', Annual: 'YEAR' },
  },
  processMap: {},
});

/** https (plain http only reaches hosts in OUTBOUND_ALLOWED_HOSTS — test mocks — see SalesforceHttp). */
const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === '' || /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/.test(v), 'INVALID_URL');

export const salesforceSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** My Domain URL of the org, e.g. https://acme.my.salesforce.com */
  instanceUrl: httpsUrl.default(''),
  /** JWT bearer: login.salesforce.com or test.salesforce.com (the token audience). */
  loginUrl: httpsUrl.default('https://login.salesforce.com'),
  authFlow: z.enum(SALESFORCE_AUTH_FLOWS).default('CLIENT_CREDENTIALS'),
  clientId: z.string().trim().max(300).default(''),
  /** Write-only: a new secret replaces the stored one; empty keeps it. */
  clientSecret: z.string().max(500).optional(),
  /** JWT bearer: the integration user's username. */
  username: z.string().trim().max(200).default(''),
  /** JWT bearer: private key (PEM) of the connected app certificate; write-only. */
  privateKey: z.string().max(10000).optional(),
  apiVersion: z
    .string()
    .trim()
    .regex(/^\d{2}\.\d$/, 'INVALID_VALUE')
    .default('61.0'),
  schedule: z.enum(SALESFORCE_SCHEDULES).default('DAILY'),
  /** Hour (UTC) of the daily / weekly sync. */
  scheduleHour: z.number().int().min(0).max(23).default(2),
  /** Import actual values (results) as well as the definitions. */
  syncValues: z.boolean().default(true),
  mapping: salesforceMappingSchema.default(DEFAULT_SALESFORCE_MAPPING),
});
export type SalesforceSettingsInput = z.infer<typeof salesforceSettingsSchema>;

export interface SalesforceSettingsDto extends Omit<
  SalesforceSettingsInput,
  'clientSecret' | 'privateKey'
> {
  hasClientSecret: boolean;
  hasPrivateKey: boolean;
  /** INTEGRATIONS_ENCRYPTION_KEY is set (secrets can be stored). */
  encryptionReady: boolean;
  lastSync: SalesforceRunDto | null;
}

export interface SalesforceTestResultDto {
  ok: boolean;
  /** Organisation / user the token belongs to. */
  organizationId?: string;
  userName?: string;
  /** Objects of the mapping found in the org (name → found). */
  objects?: Record<string, boolean>;
  error?: string;
}

export interface SalesforceFieldDto {
  name: string;
  label: string;
  type: string;
  /** Lookup target objects. */
  referenceTo: string[];
}

export interface SalesforceChange {
  salesforceId: string;
  code: string | null;
  name: string;
  /** Changed fields → { from, to } (updates only). */
  changes?: Record<string, { from: unknown; to: unknown }>;
}

export interface SalesforcePreviewDto {
  objectives: { create: SalesforceChange[]; update: SalesforceChange[]; unchanged: number };
  kpis: { create: SalesforceChange[]; update: SalesforceChange[]; unchanged: number };
  measurements: { create: number; update: number; unchanged: number; samples: SalesforceChange[] };
  processLinks: { create: number; unknownProcesses: string[] };
  /** Records that could not be mapped (unknown period, KPI not found, …). */
  warnings: { record: string; code: string; detail?: string }[];
}

export const SALESFORCE_RUN_STATUSES = ['RUNNING', 'SUCCESS', 'FAILED'] as const;
export type SalesforceRunStatus = (typeof SALESFORCE_RUN_STATUSES)[number];

export interface SalesforceRunDto {
  id: string;
  trigger: 'MANUAL' | 'SCHEDULED';
  status: SalesforceRunStatus;
  startedAt: string;
  finishedAt: string | null;
  counts: Record<string, number>;
  error: string | null;
  warnings: number;
  user: UserRef | null;
}
