import { z } from 'zod';
import type { DepartmentRef, ElementLabelDto, ProcessSummaryDto, UserRef } from './types';

/**
 * Enterprise architecture (Phase 4.3, module M11 — DECISIONS D-107 – D-110): the application
 * catalogue (one-to-one with the IT system library objects, so step links keep working), interfaces
 * between applications, data objects with their CRUD matrix and the business capability map.
 */

export const APP_TYPES = ['APPLICATION', 'PLATFORM', 'SERVICE', 'DATABASE', 'EXTERNAL'] as const;
export type AppType = (typeof APP_TYPES)[number];

export const APP_HOSTINGS = ['ON_PREMISE', 'CLOUD', 'SAAS'] as const;
export type AppHosting = (typeof APP_HOSTINGS)[number];

export const APP_LIFECYCLES = ['PLANNED', 'ACTIVE', 'PHASING_OUT', 'RETIRED'] as const;
export type AppLifecycle = (typeof APP_LIFECYCLES)[number];

export const CRITICALITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Criticality = (typeof CRITICALITIES)[number];

export const DATA_CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SECRET'] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export const INTERFACE_DIRECTIONS = ['ONE_WAY', 'TWO_WAY'] as const;
export type InterfaceDirection = (typeof INTERFACE_DIRECTIONS)[number];

export const INTERFACE_TECHNOLOGIES = [
  'API',
  'FILE',
  'DB_LINK',
  'MANUAL',
  'MESSAGE_QUEUE',
] as const;
export type InterfaceTechnology = (typeof INTERFACE_TECHNOLOGIES)[number];

export const INTERFACE_FREQUENCIES = [
  'REAL_TIME',
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'ON_DEMAND',
] as const;
export type InterfaceFrequency = (typeof INTERFACE_FREQUENCIES)[number];

export const EA_STATUSES = ['PLANNED', 'ACTIVE', 'RETIRED'] as const;
export type EaStatus = (typeof EA_STATUSES)[number];

export const STRATEGIC_IMPORTANCE = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type StrategicImportance = (typeof STRATEGIC_IMPORTANCE)[number];

export const CAPABILITY_MAX_LEVEL = 3;

/** Excel catalogues (export, template, import with a validation report first). */
export const EA_IMPORT_KINDS = [
  'applications',
  'interfaces',
  'data-objects',
  'capabilities',
] as const;
export type EaImportKind = (typeof EA_IMPORT_KINDS)[number];

/** Applications that need attention: phasing out or retired but still supporting steps. */
export const isEndOfLife = (lifecycle: AppLifecycle) =>
  lifecycle === 'PHASING_OUT' || lifecycle === 'RETIRED';

// ---------- Input schemas ----------

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max)
    .nullable()
    .transform((v) => v ?? '')
    .optional();
const id = z.guid();
const ids = z
  .array(id)
  .max(500)
  .transform((l) => [...new Set(l)]);
const dateField = z
  .string()
  .trim()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'INVALID_DATE')
  .nullable()
  .optional();
const httpUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => /^https?:\/\/[^\s]+$/i.test(v), 'INVALID_URL');
const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

function requireName(v: { nameEn?: string; nameAr?: string }, ctx: z.RefinementCtx) {
  if (!v.nameEn && !v.nameAr)
    ctx.addIssue({ code: 'custom', path: ['nameEn'], message: 'NAME_REQUIRED' });
}
function requireOneName(v: { nameEn?: string; nameAr?: string }, ctx: z.RefinementCtx) {
  if (v.nameEn === undefined && v.nameAr === undefined) return;
  requireName(v, ctx);
}

const named = {
  code: trimmed(50).nullable().optional(),
  nameEn: optionalText(300),
  nameAr: optionalText(300),
  descriptionEn: optionalText(5000),
  descriptionAr: optionalText(5000),
};

const applicationFields = {
  ...named,
  appType: z.enum(APP_TYPES).optional(),
  vendor: optionalText(200),
  version: optionalText(100),
  businessOwnerId: id.nullable().optional(),
  itOwnerId: id.nullable().optional(),
  departmentId: id.nullable().optional(),
  hosting: z.enum(APP_HOSTINGS).optional(),
  /** ISO 3166-1 alpha-2 (e.g. AE); empty clears it. */
  hostingCountry: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2})?$/, 'INVALID_COUNTRY')
    .optional(),
  lifecycle: z.enum(APP_LIFECYCLES).optional(),
  liveFrom: dateField,
  phaseOutFrom: dateField,
  retiredAt: dateField,
  criticality: z.enum(CRITICALITIES).optional(),
  dataClassification: z.enum(DATA_CLASSIFICATIONS).optional(),
  licenceNotes: optionalText(5000),
  url: httpUrl.nullable().optional(),
  capabilityIds: ids.optional(),
};

export const createApplicationSchema = z.object(applicationFields).superRefine(requireName);
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export const updateApplicationSchema = z.object(applicationFields).superRefine(requireOneName);
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

const interfaceFields = {
  ...named,
  sourceId: id.optional(),
  targetId: id.optional(),
  direction: z.enum(INTERFACE_DIRECTIONS).optional(),
  technology: z.enum(INTERFACE_TECHNOLOGIES).optional(),
  frequency: z.enum(INTERFACE_FREQUENCIES).optional(),
  ownerId: id.nullable().optional(),
  status: z.enum(EA_STATUSES).optional(),
  dataObjectIds: ids.optional(),
};

function distinctEnds(v: { sourceId?: string; targetId?: string }, ctx: z.RefinementCtx) {
  if (v.sourceId && v.sourceId === v.targetId)
    ctx.addIssue({ code: 'custom', path: ['targetId'], message: 'SAME_APPLICATION' });
}

/** The name is optional: the list shows "Source → Target" when it is empty. */
export const createInterfaceSchema = z
  .object({ ...interfaceFields, sourceId: id, targetId: id })
  .superRefine(distinctEnds);
export type CreateInterfaceInput = z.infer<typeof createInterfaceSchema>;
export const updateInterfaceSchema = z.object(interfaceFields).superRefine(distinctEnds);
export type UpdateInterfaceInput = z.infer<typeof updateInterfaceSchema>;

export const crudSchema = z.object({
  applicationId: id,
  create: z.boolean().default(false),
  read: z.boolean().default(false),
  update: z.boolean().default(false),
  delete: z.boolean().default(false),
});
export type CrudInput = z.infer<typeof crudSchema>;

const dataObjectFields = {
  code: named.code,
  nameEn: named.nameEn,
  nameAr: named.nameAr,
  definitionEn: optionalText(5000),
  definitionAr: optionalText(5000),
  classification: z.enum(DATA_CLASSIFICATIONS).optional(),
  systemOfRecordId: id.nullable().optional(),
  ownerId: id.nullable().optional(),
  /** Replaces the CRUD matrix row set of this data object. */
  usages: z.array(crudSchema).max(200).optional(),
};
export const createDataObjectSchema = z.object(dataObjectFields).superRefine(requireName);
export type CreateDataObjectInput = z.infer<typeof createDataObjectSchema>;
export const updateDataObjectSchema = z.object(dataObjectFields).superRefine(requireOneName);
export type UpdateDataObjectInput = z.infer<typeof updateDataObjectSchema>;

const capabilityFields = {
  ...named,
  parentId: id.nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  ownerId: id.nullable().optional(),
  importance: z.enum(STRATEGIC_IMPORTANCE).optional(),
  processIds: ids.optional(),
  applicationIds: ids.optional(),
};
export const createCapabilitySchema = z.object(capabilityFields).superRefine(requireName);
export type CreateCapabilityInput = z.infer<typeof createCapabilitySchema>;
export const updateCapabilitySchema = z.object(capabilityFields).superRefine(requireOneName);
export type UpdateCapabilityInput = z.infer<typeof updateCapabilitySchema>;

const listBase = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: trimmed(50).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  q: trimmed(200).optional(),
});

export const applicationListQuerySchema = listBase.extend({
  appType: z.enum(APP_TYPES).optional(),
  lifecycle: z.enum(APP_LIFECYCLES).optional(),
  criticality: z.enum(CRITICALITIES).optional(),
  hosting: z.enum(APP_HOSTINGS).optional(),
  departmentId: id.optional(),
  capabilityId: id.optional(),
  /** Only applications that support at least one step of this process. */
  processId: id.optional(),
  ownerId: id.optional(),
  /** Phasing out or retired, still linked to steps. */
  endOfLifeInUse: bool,
});
export type ApplicationListQuery = z.infer<typeof applicationListQuerySchema>;

export const interfaceListQuerySchema = listBase.extend({
  applicationId: id.optional(),
  technology: z.enum(INTERFACE_TECHNOLOGIES).optional(),
  status: z.enum(EA_STATUSES).optional(),
  dataObjectId: id.optional(),
});
export type InterfaceListQuery = z.infer<typeof interfaceListQuerySchema>;

export const dataObjectListQuerySchema = listBase.extend({
  classification: z.enum(DATA_CLASSIFICATIONS).optional(),
  applicationId: id.optional(),
});
export type DataObjectListQuery = z.infer<typeof dataObjectListQuerySchema>;

export const eaExportQuerySchema = z.object({ locale: z.enum(['en', 'ar']).default('en') });
export type EaExportQuery = z.infer<typeof eaExportQuerySchema>;

export const eaImportQuerySchema = z.object({
  dryRun: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});
export type EaImportQuery = z.infer<typeof eaImportQuerySchema>;

// ---------- DTOs ----------

export interface EaRef {
  id: string;
  code: string | null;
  nameEn: string;
  nameAr: string;
}

export interface ApplicationRef extends EaRef {
  lifecycle: AppLifecycle;
  appType: AppType;
}

export interface ApplicationDto extends ApplicationRef {
  descriptionEn: string;
  descriptionAr: string;
  vendor: string;
  version: string;
  businessOwner: UserRef | null;
  itOwner: UserRef | null;
  department: DepartmentRef | null;
  hosting: AppHosting;
  hostingCountry: string;
  liveFrom: string | null;
  phaseOutFrom: string | null;
  retiredAt: string | null;
  criticality: Criticality;
  dataClassification: DataClassification;
  licenceNotes: string;
  url: string | null;
  /** Steps (and process-level links) in active processes that use the application. */
  stepCount: number;
  interfaceCount: number;
  capabilities: EaRef[];
  createdAt: string;
  updatedAt: string;
}

export interface InterfaceDto extends EaRef {
  descriptionEn: string;
  descriptionAr: string;
  source: ApplicationRef;
  target: ApplicationRef;
  direction: InterfaceDirection;
  technology: InterfaceTechnology;
  frequency: InterfaceFrequency;
  owner: UserRef | null;
  status: EaStatus;
  dataObjects: (EaRef & { classification: DataClassification })[];
  createdAt: string;
  updatedAt: string;
}

export interface CrudDto {
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
}

export interface DataObjectDto extends EaRef {
  definitionEn: string;
  definitionAr: string;
  classification: DataClassification;
  systemOfRecord: ApplicationRef | null;
  owner: UserRef | null;
  usages: (CrudDto & { application: ApplicationRef })[];
  interfaceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityDto extends EaRef {
  descriptionEn: string;
  descriptionAr: string;
  parentId: string | null;
  level: number;
  sortOrder: number;
  owner: UserRef | null;
  importance: StrategicImportance;
  processes: Pick<ProcessSummaryDto, 'id' | 'code' | 'nameEn' | 'nameAr' | 'status'>[];
  applications: ApplicationRef[];
  createdAt: string;
  updatedAt: string;
}

/** A process step (or the whole process: `#process`) that uses an application. */
export interface EaStepDto {
  process: Pick<ProcessSummaryDto, 'id' | 'code' | 'nameEn' | 'nameAr' | 'status'>;
  bpmnElementId: string;
  element: ElementLabelDto | null;
}

export interface ApplicationDetailDto {
  item: ApplicationDto;
  interfaces: InterfaceDto[];
  dataObjects: (EaRef &
    CrudDto & { classification: DataClassification; systemOfRecord: boolean })[];
  steps: EaStepDto[];
}

export interface EaImportRowIssue {
  row: number;
  column: string;
  code: string;
}

export interface EaImportReportDto {
  kind: EaImportKind;
  rows: number;
  created: number;
  updated: number;
  errors: EaImportRowIssue[];
  imported: boolean;
}

/** Builds the parent-before-child order and level of a capability list (cycles are broken). */
export function capabilityDepths(
  items: { id: string; parentId: string | null }[],
): Map<string, number> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const depth = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const item = byId.get(id);
    if (!item || !item.parentId || !byId.has(item.parentId) || seen.has(item.parentId)) {
      depth.set(id, 1);
      return 1;
    }
    seen.add(id);
    const d = visit(item.parentId, seen) + 1;
    depth.set(id, d);
    return d;
  };
  for (const i of items) visit(i.id, new Set());
  return depth;
}

// ---------- Views and traceability (step 2, D-110) ----------

export const CAPABILITY_COLOUR_BY = ['coverage', 'applications', 'lifecycle', 'risk'] as const;
export type CapabilityColourBy = (typeof CAPABILITY_COLOUR_BY)[number];

/** Lifecycle that needs the most attention first (retired > phasing out > planned > active). */
export const LIFECYCLE_SEVERITY: Record<AppLifecycle, number> = {
  ACTIVE: 0,
  PLANNED: 1,
  PHASING_OUT: 2,
  RETIRED: 3,
};

export function worstLifecycle(values: AppLifecycle[]): AppLifecycle | null {
  let worst: AppLifecycle | null = null;
  for (const v of values)
    if (!worst || LIFECYCLE_SEVERITY[v] > LIFECYCLE_SEVERITY[worst]) worst = v;
  return worst;
}

export interface CapabilityMetricsDto {
  /** Processes and applications of the capability and its sub-capabilities. */
  processCount: number;
  applicationCount: number;
  lifecycles: Partial<Record<AppLifecycle, number>>;
  worstLifecycle: AppLifecycle | null;
  /** Highest residual score of active risks on steps of those processes (Risk & Compliance). */
  maxRiskScore: number | null;
  maxRiskBand: string | null;
}

export interface CapabilityMapDto {
  capabilities: (CapabilityDto & { metrics: CapabilityMetricsDto })[];
}

export const landscapeQuerySchema = z.object({
  departmentId: id.optional(),
  capabilityId: id.optional(),
  lifecycle: z.enum(APP_LIFECYCLES).optional(),
  /** Also show applications connected to the filtered ones (one hop). */
  neighbours: bool,
});
export type LandscapeQuery = z.infer<typeof landscapeQuerySchema>;

export interface LandscapeDto {
  nodes: (ApplicationRef & {
    criticality: Criticality;
    department: DepartmentRef | null;
    /** Outside the filter, shown because it is connected to a filtered application. */
    neighbour: boolean;
  })[];
  edges: {
    id: string;
    sourceId: string;
    targetId: string;
    direction: InterfaceDirection;
    technology: InterfaceTechnology;
    status: EaStatus;
    nameEn: string;
    nameAr: string;
    dataObjects: EaRef[];
  }[];
}

export const traceQuerySchema = z.object({
  capabilityId: id.optional(),
  processId: id.optional(),
  applicationId: id.optional(),
  dataObjectId: id.optional(),
  locale: z.enum(['en', 'ar']).default('en'),
});
export type TraceQuery = z.infer<typeof traceQuerySchema>;

export interface TraceGrcRef extends EaRef {
  type: 'RISK' | 'CONTROL';
  /** Risks: residual band key; controls: effectiveness. */
  detail: string | null;
}

/** One row of the traceability chain: capability → process → step → application → data objects. */
export interface TraceRowDto {
  capabilities: EaRef[];
  process: Pick<ProcessSummaryDto, 'id' | 'code' | 'nameEn' | 'nameAr' | 'status'>;
  bpmnElementId: string | null;
  element: ElementLabelDto | null;
  application: ApplicationRef | null;
  dataObjects: (EaRef & CrudDto & { systemOfRecord: boolean })[];
  risks: TraceGrcRef[];
  controls: TraceGrcRef[];
}

/** "If this application is retired": everything that depends on it. */
export interface ImpactDto {
  application: ApplicationRef;
  summary: {
    processes: number;
    steps: number;
    controls: number;
    risks: number;
    interfaces: number;
    dataObjects: number;
    capabilities: number;
  };
  steps: (EaStepDto & { risks: TraceGrcRef[]; controls: TraceGrcRef[] })[];
  /** Controls that run in the application (Control.systemId) or sit on a supported step. */
  controls: (TraceGrcRef & { runsIn: boolean; onSteps: number })[];
  interfaces: InterfaceDto[];
  dataObjects: ApplicationDetailDto['dataObjects'];
  capabilities: EaRef[];
}
