import { z } from 'zod';
import { paginationQuerySchema, processCodeSchema, uuidSchema } from '../schemas';
import { PROCESS_CATEGORIES } from '../constants';
import { analysisRequestSchema } from './analysis';
import { heuristicsOptionsSchema } from './heuristics';
import {
  scenarioParamsSchema,
  type ScenarioParams,
  type SimIssue,
  type SimulationResult,
} from './simulation';
import type { DepartmentRef, UserRef } from '../types';
import { DEFAULT_MINING_TIME_ZONE, TIMESTAMP_FORMATS, isValidTimeZone } from './timestamps';
import type { ActivityMatchKind } from './matching';

/**
 * Process mining (Phase 5.1, module M13 — DECISIONS D-128 – ): event logs, import mapping, jobs,
 * activity ↔ step mapping, access and settings.
 */

export const MINING_FILE_FORMATS = ['CSV', 'XLSX', 'XES'] as const;
export type MiningFileFormat = (typeof MINING_FILE_FORMATS)[number];

/** FILE: uploaded; PROCESSHUB: built from reviews; WORKFLOW: live log of an executable process (D-151). */
export const EVENT_LOG_SOURCES = ['FILE', 'PROCESSHUB', 'WORKFLOW'] as const;
export type EventLogSource = (typeof EVENT_LOG_SOURCES)[number];

export const EVENT_LOG_STATUSES = ['DRAFT', 'IMPORTING', 'READY', 'FAILED', 'DELETING'] as const;
export type EventLogStatus = (typeof EVENT_LOG_STATUSES)[number];

export const MINING_JOB_KINDS = [
  'VALIDATE',
  'IMPORT',
  'DELETE',
  'ANALYSE',
  'DISCOVER',
  'CONFORMANCE',
  'KPI',
  'SIMULATE',
] as const;
export type MiningJobKind = (typeof MINING_JOB_KINDS)[number];

export const MINING_JOB_STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED'] as const;
export type MiningJobStatus = (typeof MINING_JOB_STATUSES)[number];

/** Upload limit of an event log file (the server can lower or raise it with MINING_UPLOAD_MAX_MB). */
export const MINING_UPLOAD_MAX_MB = 200;
/** Maximum extra attributes per log (filters, statistics). */
export const MINING_MAX_ATTRIBUTES = 20;
/** Rows shown in the preview. */
export const MINING_PREVIEW_ROWS = 20;

export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;

const column = z.string().trim().min(1).max(200);
const optionalColumn = column.nullable().optional();

/** How the columns of a file become events (also stored as a reusable template). */
export const miningMappingSchema = z
  .object({
    caseColumn: column,
    activityColumn: column,
    /** At least one of start / end; with only one, it is the event time. */
    startColumn: optionalColumn,
    endColumn: optionalColumn,
    resourceColumn: optionalColumn,
    departmentColumn: optionalColumn,
    attributeColumns: z.array(column).max(MINING_MAX_ATTRIBUTES).default([]),
    /** null = detect from the values. */
    timestampFormat: z.enum(TIMESTAMP_FORMATS).nullable().default(null),
    timeZone: z
      .string()
      .trim()
      .max(64)
      .default(DEFAULT_MINING_TIME_ZONE)
      .refine(isValidTimeZone, { message: 'INVALID_TIME_ZONE' }),
    delimiter: z.enum(CSV_DELIMITERS).nullable().default(null),
    /** Excel: worksheet name (default: the first). */
    sheet: z.string().trim().max(100).nullable().default(null),
    /** Replace case ids and resources with pseudonyms at import (D-131). */
    pseudonymise: z.boolean().default(false),
    /** Skip events that repeat case, activity, times and resource. */
    dropDuplicates: z.boolean().default(true),
  })
  .superRefine((m, ctx) => {
    if (!m.startColumn && !m.endColumn)
      ctx.addIssue({ code: 'custom', path: ['endColumn'], message: 'TIMESTAMP_REQUIRED' });
  });
export type MiningMapping = z.infer<typeof miningMappingSchema>;
export type MiningMappingInput = z.input<typeof miningMappingSchema>;

const text = (max: number) => z.string().trim().max(max);

export const createEventLogSchema = z
  .object({
    nameEn: text(200).default(''),
    nameAr: text(200).default(''),
    descriptionEn: text(5000).default(''),
    descriptionAr: text(5000).default(''),
    processId: uuidSchema.nullable().optional(),
    departmentId: uuidSchema.nullable().optional(),
  })
  .refine((v) => !!(v.nameEn || v.nameAr), { path: ['nameEn'], message: 'NAME_REQUIRED' });
export type CreateEventLogInput = z.infer<typeof createEventLogSchema>;

export const updateEventLogSchema = z.object({
  nameEn: text(200).optional(),
  nameAr: text(200).optional(),
  descriptionEn: text(5000).optional(),
  descriptionAr: text(5000).optional(),
  processId: uuidSchema.nullable().optional(),
  departmentId: uuidSchema.nullable().optional(),
  ownerId: uuidSchema.optional(),
});
export type UpdateEventLogInput = z.infer<typeof updateEventLogSchema>;

export const eventLogListQuerySchema = paginationQuerySchema.extend({
  processId: uuidSchema.optional(),
  status: z.enum(EVENT_LOG_STATUSES).optional(),
});
export type EventLogListQuery = z.infer<typeof eventLogListQuerySchema>;

/** "Create log from ProcessHub": governance reviews as cases (D-132). */
export const processHubLogSchema = z.object({
  nameEn: text(200).default(''),
  nameAr: text(200).default(''),
  /** Item kinds to include. */
  itemTypes: z
    .array(z.enum(['PROCESS', 'PAGE', 'DIAGRAM']))
    .min(1)
    .default(['PROCESS', 'PAGE', 'DIAGRAM']),
  from: z.coerce.date().nullable().optional(),
  to: z.coerce.date().nullable().optional(),
  /** Language of the activity names. */
  language: z.enum(['en', 'ar']).default('en'),
  departmentId: uuidSchema.nullable().optional(),
});
export type ProcessHubLogInput = z.infer<typeof processHubLogSchema>;

export const mappingTemplateSchema = z.object({
  name: text(200).min(1),
  format: z.enum(MINING_FILE_FORMATS),
  mapping: miningMappingSchema,
});
export type MappingTemplateInput = z.infer<typeof mappingTemplateSchema>;

export const activityMappingSchema = z.object({
  items: z
    .array(
      z.object({
        activity: z.string().max(500),
        /** BPMN element id of the linked process; null = not part of the model. */
        elementId: z.string().max(200).nullable(),
      }),
    )
    .max(5000),
});
export type ActivityMappingInput = z.infer<typeof activityMappingSchema>;

export const logGrantsSchema = z.object({ userIds: z.array(uuidSchema).max(500) });
export type LogGrantsInput = z.infer<typeof logGrantsSchema>;

export const miningSettingsSchema = z.object({
  /** Delete logs whose last event is older than this many months (null = keep). */
  retentionMonths: z.number().int().min(1).max(240).nullable().default(null),
  /** Mining jobs run at the same time. */
  concurrency: z.number().int().min(1).max(4).default(1),
  /** "Performance" tab on published processes in the Knowledge Portal (D-14x, off by default). */
  portalPerformance: z.boolean().default(false),
  defaultTimeZone: z
    .string()
    .trim()
    .max(64)
    .default(DEFAULT_MINING_TIME_ZONE)
    .refine(isValidTimeZone, { message: 'INVALID_TIME_ZONE' }),
});
export type MiningSettings = z.infer<typeof miningSettingsSchema>;
export const DEFAULT_MINING_SETTINGS: MiningSettings = {
  retentionMonths: null,
  concurrency: 1,
  portalPerformance: false,
  defaultTimeZone: DEFAULT_MINING_TIME_ZONE,
};

// ---------- DTOs ----------

export interface ColumnPreview {
  name: string;
  /** Detected timestamp format of the column (null = not a timestamp). */
  timestampFormat: string | null;
  ambiguous: boolean;
  samples: string[];
}

export interface LogPreviewDto {
  format: MiningFileFormat;
  columns: ColumnPreview[];
  rows: Record<string, string>[];
  /** Detected delimiter (CSV) / sheet names (Excel). */
  delimiter: string | null;
  sheets: string[];
  /** Suggested mapping from column names and values. */
  suggestion: MiningMappingInput;
}

export interface ImportIssueSample {
  row: number;
  column: string;
  value: string;
}

export interface ImportReportDto {
  rows: number;
  events: number;
  cases: number;
  activities: number;
  resources: number;
  missingCase: number;
  missingActivity: number;
  missingTimestamp: number;
  unparsableTimestamp: number;
  startAfterEnd: number;
  duplicates: number;
  /** Events skipped (invalid rows, duplicates when dropped). */
  skipped: number;
  timestampFormat: string | null;
  ambiguousFormat: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  samples: ImportIssueSample[];
  /** Import only: milliseconds spent. */
  durationMs?: number;
}

export interface MiningJobDto {
  id: string;
  kind: MiningJobKind;
  status: MiningJobStatus;
  progress: number;
  message: string;
  logId: string | null;
  scenarioId: string | null;
  result: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface EventLogDto {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  source: EventLogSource;
  status: EventLogStatus;
  process: { id: string; code: string; nameEn: string; nameAr: string } | null;
  owner: UserRef | null;
  department: DepartmentRef | null;
  fileName: string | null;
  fileFormat: MiningFileFormat | null;
  fileSize: number | null;
  mapping: MiningMapping | null;
  timeZone: string;
  pseudonymised: boolean;
  dataVersion: number;
  periodStart: string | null;
  periodEnd: string | null;
  caseCount: number;
  eventCount: number;
  activityCount: number;
  resourceCount: number;
  hasStartTimes: boolean;
  attributeNames: string[];
  importReport: ImportReportDto | null;
  importedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** The current user may change mapping, access, re-import and delete. */
  canManage: boolean;
  /** Last running / queued job of the log. */
  job: MiningJobDto | null;
}

export interface MiningActivityDto {
  name: string;
  eventCount: number;
  caseCount: number;
  elementId: string | null;
  match: ActivityMatchKind | null;
}

export interface MiningStepDto {
  id: string;
  nameEn: string;
  nameAr: string;
  type: string;
}

export interface LogActivitiesDto {
  items: MiningActivityDto[];
  /** Steps of the linked process's working model (empty without a process). */
  steps: MiningStepDto[];
}

export interface MappingTemplateDto {
  id: string;
  name: string;
  format: MiningFileFormat;
  mapping: MiningMapping;
  owner: UserRef | null;
  createdAt: string;
}

export interface LogGrantDto {
  user: UserRef;
  createdAt: string;
}

export interface MiningEventDto {
  caseId: string;
  activity: string;
  startAt: string | null;
  endAt: string;
  resource: string | null;
  department: string | null;
  attributes: Record<string, string>;
}

// ---------- Discovery and analysis (step 2) ----------

/** "Generate BPMN from log": heuristics miner thresholds and the new draft process (D-134). */
export const discoverProcessSchema = z
  .object({
    code: processCodeSchema,
    category: z.enum(PROCESS_CATEGORIES).optional(),
    parentId: uuidSchema.nullable().optional(),
    nameEn: text(200).default(''),
    nameAr: text(200).default(''),
    options: heuristicsOptionsSchema.partial().default({}),
    /** Lanes from the most frequent department (or resource) of each activity. */
    lanes: z.boolean().default(true),
  })
  .refine((v) => !!v.parentId || !!v.category, {
    path: ['category'],
    message: 'CATEGORY_REQUIRED',
  });
export type DiscoverProcessInput = z.infer<typeof discoverProcessSchema>;

export const MINING_EXPORT_KINDS = [
  'variants',
  'bottlenecks',
  'activities',
  'resources',
  'handovers',
] as const;
export type MiningExportKind = (typeof MINING_EXPORT_KINDS)[number];

export const analysisExportSchema = z.object({
  kind: z.enum(MINING_EXPORT_KINDS),
  request: analysisRequestSchema.partial().default({}),
});
export type AnalysisExportInput = z.infer<typeof analysisExportSchema>;

/** Answer of an analysis request: the result, or the job still computing it. */
export interface AnalysisResponse<T> {
  status: 'DONE' | 'RUNNING';
  result: T | null;
  job: MiningJobDto | null;
}

export interface DiscoverResultDto {
  processId: string;
  code: string;
  activities: number;
  arcs: number;
  gateways: number;
  lanes: number;
}

// ---------- Conformance (step 3) ----------

export interface ProcessLogDto {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  caseCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  mappedActivities: number;
}

/** Planned (model) vs measured (log) step times; minutes. */
export interface StepSuggestionDto {
  elementId: string;
  nameEn: string;
  nameAr: string;
  observations: number;
  plannedDuration: number | null;
  measuredDuration: number | null;
  plannedWaiting: number | null;
  measuredWaiting: number | null;
  suggestDuration: boolean;
  suggestWaiting: boolean;
}

export const applySuggestionsSchema = z.object({
  items: z
    .array(
      z.object({
        elementId: z.string().max(200),
        durationMinutes: z.number().min(0).max(1_000_000).nullable().optional(),
        waitingMinutes: z.number().min(0).max(1_000_000).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
  changeNote: z.string().trim().min(1).max(2000),
});
export type ApplySuggestionsInput = z.infer<typeof applySuggestionsSchema>;

// ---------- Simulation (step 4) ----------

export const SIMULATION_SCENARIO_KINDS = ['AS_IS', 'TO_BE'] as const;
export type SimulationScenarioKind = (typeof SIMULATION_SCENARIO_KINDS)[number];

export const createSimulationSchema = z
  .object({
    processId: uuidSchema,
    nameEn: text(200).default(''),
    nameAr: text(200).default(''),
    descriptionEn: text(5000).default(''),
    descriptionAr: text(5000).default(''),
    /** Event log for default branch probabilities and arrivals (optional). */
    logId: uuidSchema.nullable().optional(),
  })
  .refine((v) => !!(v.nameEn || v.nameAr), { path: ['nameEn'], message: 'NAME_REQUIRED' });
export type CreateSimulationInput = z.infer<typeof createSimulationSchema>;

export const updateSimulationSchema = z.object({
  nameEn: text(200).optional(),
  nameAr: text(200).optional(),
  descriptionEn: text(5000).optional(),
  descriptionAr: text(5000).optional(),
});
export type UpdateSimulationInput = z.infer<typeof updateSimulationSchema>;

export const scenarioInputSchema = z.object({
  nameEn: text(200).optional(),
  nameAr: text(200).optional(),
  kind: z.enum(SIMULATION_SCENARIO_KINDS).optional(),
  processVersion: z.number().int().min(1).nullable().optional(),
  params: scenarioParamsSchema.optional(),
  /** Create as a copy of this scenario (parameters), then apply the fields above. */
  copyFrom: uuidSchema.optional(),
});
export type ScenarioInput = z.infer<typeof scenarioInputSchema>;

export const runSimulationSchema = z.object({
  scenarioIds: z.array(uuidSchema).max(10).optional(),
});
export type RunSimulationInput = z.infer<typeof runSimulationSchema>;

export interface ScenarioDto {
  id: string;
  nameEn: string;
  nameAr: string;
  kind: SimulationScenarioKind;
  sortOrder: number;
  processVersion: number | null;
  params: ScenarioParams;
  result: SimulationResult | null;
  /** "v3" or "working" — what the result ran against. */
  resultModel: string | null;
  ranAt: string | null;
  issues: SimIssue[];
  /** The parameters or the model changed after the last run. */
  stale: boolean;
}

export interface SimulationDto {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  process: { id: string; code: string; nameEn: string; nameAr: string };
  logId: string | null;
  owner: UserRef | null;
  createdAt: string;
  updatedAt: string;
  canManage: boolean;
  scenarios: ScenarioDto[];
  /** Model facts for the parameter editor: steps, lanes, gateways with their outgoing flows. */
  model: {
    steps: {
      id: string;
      nameEn: string;
      nameAr: string;
      laneId: string | null;
      durationMinutes: number | null;
      costPerExecution: number | null;
    }[];
    lanes: { id: string; nameEn: string; nameAr: string }[];
    gateways: {
      id: string;
      nameEn: string;
      nameAr: string;
      type: string;
      flows: { id: string; to: string; nameEn: string; nameAr: string }[];
    }[];
    arrivalsPerMonth: number;
    versions: number[];
  };
  /** Running job of the simulation (if any). */
  job: MiningJobDto | null;
}

export interface SimulationListItemDto {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  process: { id: string; code: string; nameEn: string; nameAr: string };
  scenarios: number;
  lastRunAt: string | null;
  updatedAt: string;
}

export interface SimulationDefaultsDto {
  probabilities: Record<string, number>;
  arrivalsPerMonth: number | null;
  logId: string | null;
}

/** AI proposal of a to-be scenario (never applied automatically). */
export interface AiScenarioProposal {
  nameEn: string;
  nameAr: string;
  rationale: string;
  capacities: Record<string, number>;
  durations: Record<string, number>;
}

// ---------- Portal performance tab (step 5) ----------

/** Aggregated performance of a published process for the Knowledge Portal (no case-level data). */
export interface PortalPerformanceDto {
  periodStart: string | null;
  periodEnd: string | null;
  cases: number;
  throughput: { mean: number; median: number; p90: number } | null;
  /** Mean throughput time (ms) and completed cases per week or month. */
  trend: { period: string; completed: number; meanMs: number | null }[];
  granularity: 'week' | 'month';
  /** Share of conforming cases and fitness; null when the log's activities are not mapped. */
  conformance: { conformingShare: number; fitness: number } | null;
}
