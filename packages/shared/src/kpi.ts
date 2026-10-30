import { z } from 'zod';
import type { DepartmentRef, ElementLabelDto, ProcessSummaryDto, UserRef } from './types';
import { isStepNode, processTotals, type BpmnGraph } from './bpmn-graph';
import type { EaRef } from './ea';

/**
 * KPIs (Phase 4.3, module M12 — DECISIONS D-111 – D-114): a `Kpi` table one-to-one with the KPI
 * library objects (links to processes and steps keep working), strategic objectives, periodic
 * measurements with a status from the thresholds, and KPIs calculated from the step attributes.
 */

export const KPI_DIRECTIONS = ['HIGHER_IS_BETTER', 'LOWER_IS_BETTER'] as const;
export type KpiDirection = (typeof KPI_DIRECTIONS)[number];

export const KPI_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;
export type KpiFrequency = (typeof KPI_FREQUENCIES)[number];

export const KPI_DATA_SOURCES = ['MANUAL', 'EXCEL', 'SALESFORCE', 'CALCULATED'] as const;
export type KpiDataSource = (typeof KPI_DATA_SOURCES)[number];

export const KPI_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type KpiStatus = (typeof KPI_STATUSES)[number];

/** Traffic light of a measurement. */
export const KPI_RAG = ['GREEN', 'AMBER', 'RED'] as const;
export type KpiRag = (typeof KPI_RAG)[number];

/** Worst first (badges, colour-by, scorecard roll-up). */
export const RAG_SEVERITY: Record<KpiRag, number> = { GREEN: 0, AMBER: 1, RED: 2 };
export const worstRag = (values: (KpiRag | null | undefined)[]): KpiRag | null =>
  values.reduce<KpiRag | null>(
    (w, v) => (v && (!w || RAG_SEVERITY[v] > RAG_SEVERITY[w]) ? v : w),
    null,
  );

/** Process KPIs calculated from the step attributes of the working model (B2, D-085). */
export const CALCULATED_METRICS = [
  'DURATION_MINUTES',
  'WAITING_MINUTES',
  'COST_PER_EXECUTION',
  'HANDOVERS',
  'AUTOMATION_RATE',
] as const;
export type CalculatedMetric = (typeof CALCULATED_METRICS)[number];

export const KPI_IMPORT_KINDS = ['kpis', 'measurements', 'objectives'] as const;
export type KpiImportKind = (typeof KPI_IMPORT_KINDS)[number];

// ---------- Periods ----------

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER = /^(\d{4})-Q([1-4])$/;
const YEAR = /^(\d{4})$/;

/** Period key of a date: `2026-03` (monthly), `2026-Q1` (quarterly), `2026` (annual). */
export function periodOf(date: Date, frequency: KpiFrequency): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  if (frequency === 'MONTHLY') return `${y}-${String(m).padStart(2, '0')}`;
  if (frequency === 'QUARTERLY') return `${y}-Q${Math.ceil(m / 3)}`;
  return String(y);
}

export function isPeriod(period: string, frequency: KpiFrequency): boolean {
  return (frequency === 'MONTHLY' ? MONTH : frequency === 'QUARTERLY' ? QUARTER : YEAR).test(
    period,
  );
}

/** First day (UTC) of a period. */
export function periodStart(period: string): Date {
  let m = MONTH.exec(period);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  m = QUARTER.exec(period);
  if (m) return new Date(Date.UTC(Number(m[1]), (Number(m[2]) - 1) * 3, 1));
  m = YEAR.exec(period);
  if (m) return new Date(Date.UTC(Number(m[1]), 0, 1));
  throw new Error(`Invalid period ${period}`);
}

/** The period `offset` periods after (negative: before) the given one. */
export function shiftPeriod(period: string, frequency: KpiFrequency, offset: number): string {
  const d = periodStart(period);
  const months = frequency === 'MONTHLY' ? 1 : frequency === 'QUARTERLY' ? 3 : 12;
  return periodOf(
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset * months, 1)),
    frequency,
  );
}

/** The last completed period on a date (the one whose actual value is due). */
export function duePeriod(now: Date, frequency: KpiFrequency): string {
  return shiftPeriod(periodOf(now, frequency), frequency, -1);
}

/** The `count` periods up to and including `last`, oldest first. */
export function periodRange(last: string, frequency: KpiFrequency, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftPeriod(last, frequency, i - count + 1));
}

// ---------- Status ----------

export interface KpiThresholds {
  direction: KpiDirection;
  target: number | null;
  /** Green from this value (default: the target). */
  greenThreshold: number | null;
  /** Red from this value (none: everything short of green is red). */
  redThreshold: number | null;
}

/**
 * Traffic light of an actual value. Higher is better: ≥ green → GREEN, ≤ red → RED, between →
 * AMBER; lower is better mirrored. Without a red threshold, short of green is RED. No target and
 * no green threshold: no status.
 */
export function kpiRag(value: number | null | undefined, t: KpiThresholds): KpiRag | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const green = t.greenThreshold ?? t.target;
  if (green === null) return null;
  const higher = t.direction === 'HIGHER_IS_BETTER';
  if (higher ? value >= green : value <= green) return 'GREEN';
  if (t.redThreshold === null) return 'RED';
  return (higher ? value > t.redThreshold : value < t.redThreshold) ? 'AMBER' : 'RED';
}

/** Thresholds of a period: a per-period target overrides the KPI's own values. */
export function thresholdsFor(
  kpi: KpiThresholds,
  period: string,
  periodTargets: {
    period: string;
    target: number | null;
    greenThreshold: number | null;
    redThreshold: number | null;
  }[],
): KpiThresholds {
  const p = periodTargets.find((x) => x.period === period);
  if (!p) return kpi;
  return {
    direction: kpi.direction,
    target: p.target ?? kpi.target,
    greenThreshold: p.greenThreshold ?? (p.target !== null ? null : kpi.greenThreshold),
    redThreshold: p.redThreshold ?? kpi.redThreshold,
  };
}

// ---------- Calculated process KPIs ----------

export interface CalculatedProcessKpis {
  /** Planned processing time on the main path (minutes); null without times. */
  durationMinutes: number | null;
  waitingMinutes: number | null;
  costPerExecution: number | null;
  /** Changes of lane between consecutive steps of the main path. */
  handovers: number;
  /** System (service / script) steps as a share of all steps, 0–100. */
  automationRate: number | null;
  steps: number;
  mainPath: string[];
}

export function calculatedProcessKpis(graph: BpmnGraph): CalculatedProcessKpis {
  const totals = processTotals(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const path = totals.mainPath.map((id) => byId.get(id)!).filter(Boolean);
  const sum = (k: 'durationMinutes' | 'waitingMinutes' | 'costPerExecution') =>
    path.some((n) => n.attributes[k] !== undefined)
      ? Math.round(path.reduce((t, n) => t + (n.attributes[k] ?? 0), 0) * 100) / 100
      : null;
  let handovers = 0;
  for (let i = 1; i < path.length; i++)
    if (path[i].laneId && path[i - 1].laneId && path[i].laneId !== path[i - 1].laneId) handovers++;
  const steps = graph.nodes.filter((n) => n.type !== 'bpmn:BoundaryEvent' && isStepNode(n));
  return {
    durationMinutes: sum('durationMinutes'),
    waitingMinutes: sum('waitingMinutes'),
    costPerExecution: sum('costPerExecution'),
    handovers,
    automationRate: steps.length
      ? Math.round((steps.filter((s) => s.stepType === 'system').length / steps.length) * 1000) / 10
      : null,
    steps: steps.length,
    mainPath: totals.mainPath,
  };
}

export function calculatedValue(k: CalculatedProcessKpis, metric: CalculatedMetric): number | null {
  switch (metric) {
    case 'DURATION_MINUTES':
      return k.durationMinutes;
    case 'WAITING_MINUTES':
      return k.waitingMinutes;
    case 'COST_PER_EXECUTION':
      return k.costPerExecution;
    case 'HANDOVERS':
      return k.handovers;
    case 'AUTOMATION_RATE':
      return k.automationRate;
  }
}

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
const num = z.number().finite().min(-1e12).max(1e12);
const periodKey = z
  .string()
  .trim()
  .regex(/^\d{4}(-(0[1-9]|1[0-2]|Q[1-4]))?$/, 'INVALID_PERIOD');

function requireName(v: { nameEn?: string; nameAr?: string }, ctx: z.RefinementCtx) {
  if (!v.nameEn && !v.nameAr)
    ctx.addIssue({ code: 'custom', path: ['nameEn'], message: 'NAME_REQUIRED' });
}
function requireOneName(v: { nameEn?: string; nameAr?: string }, ctx: z.RefinementCtx) {
  if (v.nameEn === undefined && v.nameAr === undefined) return;
  requireName(v, ctx);
}

export const periodTargetSchema = z.object({
  period: periodKey,
  target: num.nullable().default(null),
  greenThreshold: num.nullable().default(null),
  redThreshold: num.nullable().default(null),
});
export type PeriodTargetInput = z.infer<typeof periodTargetSchema>;

/** A step (or the whole process: `#process`) the KPI measures. */
export const kpiLinkSchema = z.object({
  processId: id,
  bpmnElementId: z.string().trim().min(1).max(200),
});

const kpiFields = {
  code: trimmed(50).nullable().optional(),
  nameEn: optionalText(300),
  nameAr: optionalText(300),
  /** Definition (stored as the library object's description). */
  descriptionEn: optionalText(5000),
  descriptionAr: optionalText(5000),
  formulaEn: optionalText(3000),
  formulaAr: optionalText(3000),
  unit: optionalText(40),
  direction: z.enum(KPI_DIRECTIONS).optional(),
  frequency: z.enum(KPI_FREQUENCIES).optional(),
  target: num.nullable().optional(),
  greenThreshold: num.nullable().optional(),
  redThreshold: num.nullable().optional(),
  baseline: num.nullable().optional(),
  baselinePeriod: periodKey.nullable().optional(),
  ownerId: id.nullable().optional(),
  departmentId: id.nullable().optional(),
  dataSource: z.enum(KPI_DATA_SOURCES).optional(),
  status: z.enum(KPI_STATUSES).optional(),
  calculatedMetric: z.enum(CALCULATED_METRICS).nullable().optional(),
  /** Process whose working model a calculated KPI reads. */
  calculatedProcessId: id.nullable().optional(),
  periodTargets: z.array(periodTargetSchema).max(120).optional(),
  objectiveIds: ids.optional(),
  capabilityIds: ids.optional(),
  /** Key risk indicator of these risks. */
  riskIds: ids.optional(),
  /** Processes / steps measured (replaces the MEASURES links). */
  links: z.array(kpiLinkSchema).max(200).optional(),
};

function calculated(
  v: {
    dataSource?: KpiDataSource;
    calculatedMetric?: string | null;
    calculatedProcessId?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (v.dataSource === 'CALCULATED' && (!v.calculatedMetric || !v.calculatedProcessId))
    ctx.addIssue({ code: 'custom', path: ['calculatedMetric'], message: 'CALCULATION_REQUIRED' });
}

export const createKpiSchema = z.object(kpiFields).superRefine((v, ctx) => {
  requireName(v, ctx);
  calculated(v, ctx);
});
export type CreateKpiInput = z.infer<typeof createKpiSchema>;
export const updateKpiSchema = z.object(kpiFields).superRefine(requireOneName);
export type UpdateKpiInput = z.infer<typeof updateKpiSchema>;

export const measurementSchema = z.object({
  period: periodKey,
  value: num,
  comment: trimmed(2000).optional().default(''),
});
export type MeasurementInput = z.infer<typeof measurementSchema>;

const objectiveFields = {
  code: trimmed(50).nullable().optional(),
  nameEn: optionalText(300),
  nameAr: optionalText(300),
  descriptionEn: optionalText(5000),
  descriptionAr: optionalText(5000),
  parentId: id.nullable().optional(),
  ownerId: id.nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
};
export const createObjectiveSchema = z.object(objectiveFields).superRefine(requireName);
export type CreateObjectiveInput = z.infer<typeof createObjectiveSchema>;
export const updateObjectiveSchema = z.object(objectiveFields).superRefine(requireOneName);
export type UpdateObjectiveInput = z.infer<typeof updateObjectiveSchema>;

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const kpiListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: trimmed(50).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  q: trimmed(200).optional(),
  status: z.enum(KPI_STATUSES).optional(),
  rag: z.enum(KPI_RAG).optional(),
  departmentId: id.optional(),
  ownerId: id.optional(),
  processId: id.optional(),
  objectiveId: id.optional(),
  dataSource: z.enum(KPI_DATA_SOURCES).optional(),
  /** Only KPIs whose last completed period has no value yet. */
  due: bool,
  /** Status as of this period (default: each KPI's latest measurement). */
  period: periodKey.optional(),
});
export type KpiListQuery = z.infer<typeof kpiListQuerySchema>;

export const kpiExportQuerySchema = z.object({ locale: z.enum(['en', 'ar']).default('en') });
export type KpiExportQuery = z.infer<typeof kpiExportQuerySchema>;

// ---------- DTOs ----------

export interface ObjectiveRef extends EaRef {
  parentId: string | null;
}

export interface KpiRef extends EaRef {
  unit: string;
  frequency: KpiFrequency;
  status: KpiStatus;
}

export interface KpiMeasurementDto {
  id: string;
  period: string;
  periodStart: string;
  value: number;
  comment: string;
  source: KpiDataSource;
  /** Thresholds of that period and the status they give. */
  target: number | null;
  rag: KpiRag | null;
  evidence: { id: string; fileName: string; url: string }[];
  updatedAt: string;
  updatedBy: UserRef | null;
}

export interface KpiLinkDto {
  linkId: string;
  process: Pick<ProcessSummaryDto, 'id' | 'code' | 'nameEn' | 'nameAr' | 'status'>;
  bpmnElementId: string;
  element: ElementLabelDto | null;
}

export interface KpiDto extends KpiRef {
  descriptionEn: string;
  descriptionAr: string;
  formulaEn: string;
  formulaAr: string;
  direction: KpiDirection;
  target: number | null;
  greenThreshold: number | null;
  redThreshold: number | null;
  baseline: number | null;
  baselinePeriod: string | null;
  owner: UserRef | null;
  department: DepartmentRef | null;
  dataSource: KpiDataSource;
  calculatedMetric: CalculatedMetric | null;
  calculatedProcess: Pick<ProcessSummaryDto, 'id' | 'code' | 'nameEn' | 'nameAr'> | null;
  periodTargets: PeriodTargetInput[];
  objectives: ObjectiveRef[];
  capabilities: EaRef[];
  risks: EaRef[];
  /** Latest measurement (or the one of the `period` asked for) and its status. */
  latest: { period: string; value: number; rag: KpiRag | null; target: number | null } | null;
  /** Last up to 12 values, oldest first (sparklines). */
  trend: { period: string; value: number; rag: KpiRag | null }[];
  /** The last completed period has no value yet (manual / Excel KPIs). */
  due: boolean;
  duePeriod: string;
  stepCount: number;
  /** Salesforce (step 5): record id, link, last sync and the fields Salesforce owns. */
  salesforceId: string | null;
  salesforceUrl: string | null;
  lastSyncedAt: string | null;
  lockedFields: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KpiDetailDto {
  item: KpiDto;
  measurements: KpiMeasurementDto[];
  links: KpiLinkDto[];
  /** Calculated KPIs: the current value from the working model. */
  calculatedNow: number | null;
}

export interface ObjectiveDto extends ObjectiveRef {
  descriptionEn: string;
  descriptionAr: string;
  owner: UserRef | null;
  sortOrder: number;
  salesforceId: string | null;
  kpiCount: number;
}

/** KPIs of one process and its steps (process page, modeler panel, badges, colour-by). */
export interface ProcessKpisDto {
  processId: string;
  items: (KpiRef & {
    linkId: string;
    bpmnElementId: string;
    rag: KpiRag | null;
    latest: KpiDto['latest'];
  })[];
  calculated: CalculatedProcessKpis | null;
}

export interface KpiTaskDto {
  kpi: KpiRef;
  period: string;
  overdue: boolean;
}

export interface KpiImportRowIssue {
  row: number;
  column: string;
  code: string;
}

export interface KpiImportReportDto {
  kind: KpiImportKind;
  rows: number;
  created: number;
  updated: number;
  errors: KpiImportRowIssue[];
  imported: boolean;
}

// ---------- Settings (Setting `kpi`) ----------

export const kpiSettingsSchema = z.object({
  /** Show a process's KPIs (latest status) on its Knowledge Portal page (off by default, D-113). */
  showInPortal: z.boolean().default(false),
  /** Remind KPI owners when the value of the last completed period is missing. */
  reminders: z.boolean().default(true),
});
export type KpiSettings = z.infer<typeof kpiSettingsSchema>;
export const DEFAULT_KPI_SETTINGS: KpiSettings = { showInPortal: false, reminders: true };
