import { z } from 'zod';
import type { DepartmentRef, ElementLabelDto, ProcessSummaryDto, UserRef } from './types';
import { isStepNode, type BpmnGraph } from './bpmn-graph';

/**
 * Risk & Compliance (Phase 4.1, module M10 — DECISIONS D-089 – D-096): risks, controls and
 * requirements in dedicated tables, each one-to-one with a library object (`RepoObject` of type
 * RISK / CONTROL / REQUIREMENT), so links to process steps, badges and "where used" keep working.
 */

export const GRC_OBJECT_TYPES = ['RISK', 'CONTROL', 'REQUIREMENT'] as const;
export type GrcObjectType = (typeof GRC_OBJECT_TYPES)[number];
export const isGrcObjectType = (t: string): t is GrcObjectType =>
  (GRC_OBJECT_TYPES as readonly string[]).includes(t);

/** Lifecycle of a risk, control or requirement. Proposals from process owners start as DRAFT. */
export const GRC_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type GrcStatus = (typeof GRC_STATUSES)[number];

export const RISK_RESPONSES = ['ACCEPT', 'AVOID', 'MITIGATE', 'TRANSFER'] as const;
export type RiskResponse = (typeof RISK_RESPONSES)[number];

export const CONTROL_TYPES = ['PREVENTIVE', 'DETECTIVE', 'CORRECTIVE'] as const;
export type ControlType = (typeof CONTROL_TYPES)[number];

export const CONTROL_NATURES = ['MANUAL', 'AUTOMATED', 'IT_DEPENDENT_MANUAL'] as const;
export type ControlNature = (typeof CONTROL_NATURES)[number];

export const CONTROL_FREQUENCIES = [
  'PER_TRANSACTION',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
  'AD_HOC',
] as const;
export type ControlFrequency = (typeof CONTROL_FREQUENCIES)[number];

export const CONTROL_EFFECTIVENESS = [
  'EFFECTIVE',
  'PARTLY',
  'NOT_EFFECTIVE',
  'NOT_ASSESSED',
] as const;
export type ControlEffectiveness = (typeof CONTROL_EFFECTIVENESS)[number];

/** Requirement hierarchy: source document (law, policy, standard) → section → clause. */
export const REQUIREMENT_LEVELS = ['SOURCE', 'SECTION', 'CLAUSE'] as const;
export type RequirementLevel = (typeof REQUIREMENT_LEVELS)[number];

/** Who sees linked risks and controls on the portal's step details (default OFF). */
export const GRC_PORTAL_VISIBILITY = ['OFF', 'CONTROLS', 'ALL'] as const;
export type GrcPortalVisibility = (typeof GRC_PORTAL_VISIBILITY)[number];

/** Element id of a link to the process as a whole (requirement ↔ process, risk ↔ process). */
export const PROCESS_ELEMENT_ID = '#process';

export const LIKELIHOOD_IMPACT_MIN = 1;
export const LIKELIHOOD_IMPACT_MAX = 5;

/** Most rows of one Excel import. */
export const GRC_IMPORT_MAX_ROWS = 2000;
export const GRC_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

// ---------- Settings: categories, risk matrix, portal ----------

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'INVALID_COLOUR');
const label = z.string().trim().max(60);
const key = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'INVALID_KEY');
const bilingualLabel = z.object({ en: label.min(1), ar: label.min(1) });

export const grcBandSchema = z.object({
  key,
  nameEn: label.min(1),
  nameAr: label.min(1),
  colour: hexColour,
  /** Lowest score (likelihood × impact) in this band; the first band starts at 1. */
  minScore: z.number().int().min(1).max(25),
  /** High / critical bands: flagged on badges and the coverage dashboard. */
  alert: z.boolean(),
});
export type GrcBand = z.infer<typeof grcBandSchema>;

export const grcSettingsSchema = z
  .strictObject({
    categories: z
      .array(z.object({ key, nameEn: label.min(1), nameAr: label.min(1) }))
      .min(1)
      .max(30),
    likelihoodLabels: z.array(bilingualLabel).length(5),
    impactLabels: z.array(bilingualLabel).length(5),
    bands: z.array(grcBandSchema).min(2).max(6),
    portalVisibility: z.enum(GRC_PORTAL_VISIBILITY),
    /** Owners are reminded this many days before a risk or control review is due. */
    reminderDaysBefore: z.number().int().min(0).max(90),
    /**
     * Phase 4.2 (D-098): changes to active risks / controls go through an approval workflow.
     * Off by default; once enabled it applies to the listed types (default: risks and controls).
     * Drafts are never routed. Workflow: the chosen one, else the governance default workflow.
     */
    changeApproval: z.strictObject({
      enabled: z.boolean(),
      types: z.array(z.enum(['RISK', 'CONTROL'])).max(2),
      workflowId: z.guid().nullable(),
    }),
  })
  .superRefine((v, ctx) => {
    const scores = v.bands.map((b) => b.minScore);
    if (scores[0] !== 1)
      ctx.addIssue({ code: 'custom', path: ['bands', 0, 'minScore'], message: 'FIRST_BAND_AT_1' });
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] <= scores[i - 1])
        ctx.addIssue({
          code: 'custom',
          path: ['bands', i, 'minScore'],
          message: 'BANDS_ASCENDING',
        });
    }
    for (const [list, path] of [
      [v.categories.map((c) => c.key), 'categories'],
      [v.bands.map((b) => b.key), 'bands'],
    ] as const) {
      if (new Set(list).size !== list.length)
        ctx.addIssue({ code: 'custom', path: [path], message: 'DUPLICATE_KEY' });
    }
  });
export type GrcSettings = z.infer<typeof grcSettingsSchema>;

export const DEFAULT_GRC_SETTINGS: GrcSettings = {
  categories: [
    { key: 'STRATEGIC', nameEn: 'Strategic', nameAr: 'استراتيجي' },
    { key: 'OPERATIONAL', nameEn: 'Operational', nameAr: 'تشغيلي' },
    { key: 'FINANCIAL', nameEn: 'Financial', nameAr: 'مالي' },
    { key: 'COMPLIANCE', nameEn: 'Compliance', nameAr: 'امتثال' },
    { key: 'IT', nameEn: 'IT', nameAr: 'تقنية المعلومات' },
    { key: 'FRAUD', nameEn: 'Fraud', nameAr: 'احتيال' },
    { key: 'REPUTATIONAL', nameEn: 'Reputational', nameAr: 'السمعة' },
  ],
  likelihoodLabels: [
    { en: 'Rare', ar: 'نادر' },
    { en: 'Unlikely', ar: 'غير مرجح' },
    { en: 'Possible', ar: 'محتمل' },
    { en: 'Likely', ar: 'مرجح' },
    { en: 'Almost certain', ar: 'شبه مؤكد' },
  ],
  impactLabels: [
    { en: 'Insignificant', ar: 'ضئيل' },
    { en: 'Minor', ar: 'طفيف' },
    { en: 'Moderate', ar: 'متوسط' },
    { en: 'Major', ar: 'كبير' },
    { en: 'Severe', ar: 'جسيم' },
  ],
  bands: [
    { key: 'LOW', nameEn: 'Low', nameAr: 'منخفض', colour: '#52c41a', minScore: 1, alert: false },
    {
      key: 'MEDIUM',
      nameEn: 'Medium',
      nameAr: 'متوسط',
      colour: '#fadb14',
      minScore: 5,
      alert: false,
    },
    { key: 'HIGH', nameEn: 'High', nameAr: 'مرتفع', colour: '#fa8c16', minScore: 10, alert: true },
    {
      key: 'CRITICAL',
      nameEn: 'Critical',
      nameAr: 'حرج',
      colour: '#f5222d',
      minScore: 16,
      alert: true,
    },
  ],
  portalVisibility: 'OFF',
  reminderDaysBefore: 14,
  changeApproval: { enabled: false, types: ['RISK', 'CONTROL'], workflowId: null },
};

/** The stored setting, or the defaults when it is missing or invalid. */
export function resolveGrcSettings(value: unknown): GrcSettings {
  if (!value || typeof value !== 'object') return DEFAULT_GRC_SETTINGS;
  const parsed = grcSettingsSchema.safeParse({ ...DEFAULT_GRC_SETTINGS, ...(value as object) });
  return parsed.success ? parsed.data : DEFAULT_GRC_SETTINGS;
}

// ---------- Ratings ----------

/** Likelihood × impact (1–25), or null when either is missing. */
export function riskScore(
  likelihood: number | null | undefined,
  impact: number | null | undefined,
): number | null {
  return likelihood && impact ? likelihood * impact : null;
}

/** The band a score falls in (bands sorted by `minScore`). */
export function ratingBand(score: number | null, bands: GrcBand[]): GrcBand | null {
  if (score === null) return null;
  let found: GrcBand | null = null;
  for (const b of bands) if (score >= b.minScore) found = b;
  return found;
}

export interface RiskRatingInput {
  inherentLikelihood: number;
  inherentImpact: number;
  residualLikelihood: number | null;
  residualImpact: number | null;
}

/** Residual rating; while no residual assessment exists the inherent rating stands. */
export function residualOrInherent(r: RiskRatingInput): { likelihood: number; impact: number } {
  return r.residualLikelihood && r.residualImpact
    ? { likelihood: r.residualLikelihood, impact: r.residualImpact }
    : { likelihood: r.inherentLikelihood, impact: r.inherentImpact };
}

export interface RiskRating {
  inherentScore: number;
  inherentBand: string | null;
  residualScore: number;
  residualBand: string | null;
  /** The residual rating falls in an alert band (high / critical). */
  alert: boolean;
}

export function rateRisk(r: RiskRatingInput, bands: GrcBand[]): RiskRating {
  const inherentScore = r.inherentLikelihood * r.inherentImpact;
  const res = residualOrInherent(r);
  const residualScore = res.likelihood * res.impact;
  const residual = ratingBand(residualScore, bands);
  return {
    inherentScore,
    inherentBand: ratingBand(inherentScore, bands)?.key ?? null,
    residualScore,
    residualBand: residual?.key ?? null,
    alert: !!residual?.alert,
  };
}

/**
 * Residual position "using tested effectiveness" (Phase 4.2, D-103): the residual rating assumes
 * the controls work, so it counts only while at least one active mitigating control has a
 * reviewed test result of effective or partly effective; otherwise the inherent rating stands.
 */
export function testedResidual(
  r: RiskRatingInput,
  controls: { status: GrcStatus; operatingEffectiveness?: ControlEffectiveness | null }[],
): { likelihood: number; impact: number } {
  const tested = controls.some(
    (c) =>
      c.status === 'ACTIVE' &&
      (c.operatingEffectiveness === 'EFFECTIVE' || c.operatingEffectiveness === 'PARTLY'),
  );
  return tested
    ? residualOrInherent(r)
    : { likelihood: r.inherentLikelihood, impact: r.inherentImpact };
}

/** Matrix of counts: `cells[likelihood-1][impact-1]`. */
export function heatMap(points: { likelihood: number; impact: number }[]): number[][] {
  const cells = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 0));
  for (const p of points) {
    if (p.likelihood >= 1 && p.likelihood <= 5 && p.impact >= 1 && p.impact <= 5)
      cells[p.likelihood - 1][p.impact - 1]++;
  }
  return cells;
}

/**
 * The effectiveness that counts: the tested operating effectiveness once a test was reviewed
 * (Phase 4.2, D-099), else the assessed effectiveness.
 */
export function currentEffectiveness(c: {
  effectiveness: ControlEffectiveness;
  operatingEffectiveness?: ControlEffectiveness | null;
}): ControlEffectiveness {
  return c.operatingEffectiveness && c.operatingEffectiveness !== 'NOT_ASSESSED'
    ? c.operatingEffectiveness
    : c.effectiveness;
}

/**
 * A control counts as effective protection when it is active and (partly) effective — by its
 * reviewed test result when it has one, else by its assessment.
 */
export function isEffectiveControl(c: {
  status: GrcStatus;
  effectiveness: ControlEffectiveness;
  operatingEffectiveness?: ControlEffectiveness | null;
}) {
  const e = currentEffectiveness(c);
  return c.status === 'ACTIVE' && (e === 'EFFECTIVE' || e === 'PARTLY');
}

/** The next review date has passed. */
export function isOverdue(nextReviewAt: string | Date | null | undefined, now = new Date()) {
  if (!nextReviewAt) return false;
  return new Date(nextReviewAt).getTime() < now.getTime();
}

// ---------- Input schemas ----------

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max)
    .nullable()
    .transform((v) => v ?? '')
    .optional();
const id = z.guid();
const level = z.number().int().min(LIKELIHOOD_IMPACT_MIN).max(LIKELIHOOD_IMPACT_MAX);
/** ISO date (YYYY-MM-DD or a full timestamp); null clears it. */
const dateField = z
  .string()
  .trim()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'INVALID_DATE')
  .nullable()
  .optional();
const ids = z
  .array(id)
  .max(200)
  .transform((l) => [...new Set(l)]);

function requireOneName(v: { nameEn?: string; nameAr?: string }, ctx: z.RefinementCtx) {
  if (v.nameEn === undefined && v.nameAr === undefined) return;
  if (!v.nameEn && !v.nameAr)
    ctx.addIssue({ code: 'custom', path: ['nameEn'], message: 'NAME_REQUIRED' });
}

const common = {
  code: trimmed(50).nullable().optional(),
  nameEn: optionalText(300),
  nameAr: optionalText(300),
  descriptionEn: optionalText(5000),
  descriptionAr: optionalText(5000),
  ownerId: id.nullable().optional(),
  departmentId: id.nullable().optional(),
  status: z.enum(GRC_STATUSES).optional(),
  nextReviewAt: dateField,
  /** Saved with the assessment history entry when ratings or effectiveness change. */
  comment: trimmed(2000).optional(),
};

const riskFields = {
  ...common,
  category: key.optional(),
  causeEn: optionalText(3000),
  causeAr: optionalText(3000),
  consequenceEn: optionalText(3000),
  consequenceAr: optionalText(3000),
  inherentLikelihood: level.optional(),
  inherentImpact: level.optional(),
  residualLikelihood: level.nullable().optional(),
  residualImpact: level.nullable().optional(),
  response: z.enum(RISK_RESPONSES).optional(),
  controlIds: ids.optional(),
};

/** Residual likelihood and impact are set together (both or neither). */
function residualPair(
  v: { residualLikelihood?: number | null; residualImpact?: number | null },
  ctx: z.RefinementCtx,
) {
  if (v.residualLikelihood === undefined && v.residualImpact === undefined) return;
  if (((v.residualLikelihood ?? null) === null) !== ((v.residualImpact ?? null) === null))
    ctx.addIssue({ code: 'custom', path: ['residualImpact'], message: 'RESIDUAL_PAIR' });
}

export const createRiskSchema = z
  .object({
    ...riskFields,
    category: key,
    inherentLikelihood: level,
    inherentImpact: level,
  })
  .superRefine((v, ctx) => {
    if (!v.nameEn && !v.nameAr)
      ctx.addIssue({ code: 'custom', path: ['nameEn'], message: 'NAME_REQUIRED' });
    residualPair(v, ctx);
  });
export type CreateRiskInput = z.infer<typeof createRiskSchema>;

export const updateRiskSchema = z.object(riskFields).superRefine((v, ctx) => {
  requireOneName(v, ctx);
  residualPair(v, ctx);
});
export type UpdateRiskInput = z.infer<typeof updateRiskSchema>;

const controlFields = {
  ...common,
  controlType: z.enum(CONTROL_TYPES).optional(),
  nature: z.enum(CONTROL_NATURES).optional(),
  frequency: z.enum(CONTROL_FREQUENCIES).optional(),
  keyControl: z.boolean().optional(),
  /** IT system (library object of type SYSTEM) the control runs in or depends on. */
  systemId: id.nullable().optional(),
  effectiveness: z.enum(CONTROL_EFFECTIVENESS).optional(),
  riskIds: ids.optional(),
  requirementIds: ids.optional(),
};

export const createControlSchema = z.object(controlFields).superRefine((v, ctx) => {
  if (!v.nameEn && !v.nameAr)
    ctx.addIssue({ code: 'custom', path: ['nameEn'], message: 'NAME_REQUIRED' });
});
export type CreateControlInput = z.infer<typeof createControlSchema>;

export const updateControlSchema = z.object(controlFields).superRefine(requireOneName);
export type UpdateControlInput = z.infer<typeof updateControlSchema>;

const httpUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => /^https?:\/\/[^\s]+$/i.test(v), 'INVALID_URL');

const requirementFields = {
  ...common,
  level: z.enum(REQUIREMENT_LEVELS).optional(),
  parentId: id.nullable().optional(),
  sourceRef: optionalText(300),
  url: httpUrl.nullable().optional(),
  effectiveDate: dateField,
  controlIds: ids.optional(),
};

export const createRequirementSchema = z.object(requirementFields).superRefine((v, ctx) => {
  if (!v.nameEn && !v.nameAr)
    ctx.addIssue({ code: 'custom', path: ['nameEn'], message: 'NAME_REQUIRED' });
});
export type CreateRequirementInput = z.infer<typeof createRequirementSchema>;

export const updateRequirementSchema = z.object(requirementFields).superRefine(requireOneName);
export type UpdateRequirementInput = z.infer<typeof updateRequirementSchema>;

const listBase = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: trimmed(50).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  q: trimmed(200).optional(),
  status: z.enum(GRC_STATUSES).optional(),
  departmentId: id.optional(),
  ownerId: id.optional(),
  /** Only items linked to this process (any step or the process itself). */
  processId: id.optional(),
  /** Dashboard scope: owned by the department or linked to one of its processes. */
  scopeDepartmentId: id.optional(),
  /** Only items whose next review date has passed. */
  overdue: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const riskListQuerySchema = listBase.extend({
  category: key.optional(),
  /** Residual rating band key (e.g. HIGH). */
  rating: key.optional(),
  inherentRating: key.optional(),
  /** Exact heat-map cell: "likelihood,impact" on the residual (default) or inherent matrix. */
  cell: z
    .string()
    .regex(/^[1-5],[1-5]$/)
    .optional(),
  matrix: z.enum(['inherent', 'residual', 'tested']).default('residual'),
  /** Coverage filters. */
  withoutControls: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  alertWithoutEffectiveControl: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Residual rating in a high / critical band. */
  alert: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type RiskListQuery = z.infer<typeof riskListQuerySchema>;

export const controlListQuerySchema = listBase.extend({
  controlType: z.enum(CONTROL_TYPES).optional(),
  nature: z.enum(CONTROL_NATURES).optional(),
  effectiveness: z.enum(CONTROL_EFFECTIVENESS).optional(),
  keyControl: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Key controls that are not assessed or not effective. */
  keyAttention: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ControlListQuery = z.infer<typeof controlListQuerySchema>;

export const requirementListQuerySchema = listBase.extend({
  level: z.enum(REQUIREMENT_LEVELS).optional(),
  parentId: id.optional(),
  withoutControls: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type RequirementListQuery = z.infer<typeof requirementListQuerySchema>;

export const grcCommentSchema = z.object({ body: trimmed(4000).min(1) });
export type GrcCommentInput = z.infer<typeof grcCommentSchema>;

/** Dashboard scope: organisation (none), department or process. */
export const grcDashboardQuerySchema = z.object({
  departmentId: id.optional(),
  processId: id.optional(),
  /** Phase 4.2: residual heat map "using tested effectiveness" (D-103). */
  tested: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type GrcDashboardQuery = z.infer<typeof grcDashboardQuerySchema>;

export const grcRcmQuerySchema = grcDashboardQuerySchema.extend({
  locale: z.enum(['en', 'ar']).default('en'),
});
export type GrcRcmQuery = z.infer<typeof grcRcmQuerySchema>;

export const grcExportQuerySchema = z.object({
  locale: z.enum(['en', 'ar']).default('en'),
});
export type GrcExportQuery = z.infer<typeof grcExportQuerySchema>;

export const GRC_IMPORT_KINDS = ['risks', 'controls', 'requirements'] as const;
export type GrcImportKind = (typeof GRC_IMPORT_KINDS)[number];

export const grcImportQuerySchema = z.object({
  /** true: validate only and return the report; false: import when the file has no errors. */
  dryRun: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});
export type GrcImportQuery = z.infer<typeof grcImportQuerySchema>;

// ---------- DTOs ----------

export interface GrcRef {
  id: string;
  type: GrcObjectType;
  code: string | null;
  nameEn: string;
  nameAr: string;
  status: GrcStatus;
}

/** A process step (or the process itself, `bpmnElementId` = PROCESS_ELEMENT_ID) linked to an item. */
export interface GrcStepLinkDto {
  linkId: string;
  process: Pick<ProcessSummaryDto, 'id' | 'code' | 'nameEn' | 'nameAr' | 'status'>;
  bpmnElementId: string;
  element: ElementLabelDto | null;
}

interface GrcBaseDto {
  id: string;
  code: string | null;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  owner: UserRef | null;
  department: DepartmentRef | null;
  status: GrcStatus;
  nextReviewAt: string | null;
  overdue: boolean;
  /** Linked steps (and process-level links) in active processes. */
  stepCount: number;
  /** Proposer: may change and delete the item while it is a draft. */
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RiskDto extends GrcBaseDto {
  type: 'RISK';
  category: string;
  causeEn: string;
  causeAr: string;
  consequenceEn: string;
  consequenceAr: string;
  inherentLikelihood: number;
  inherentImpact: number;
  residualLikelihood: number | null;
  residualImpact: number | null;
  response: RiskResponse;
  rating: RiskRating;
  controls: (GrcRef & {
    effectiveness: ControlEffectiveness;
    operatingEffectiveness: ControlEffectiveness;
    keyControl: boolean;
  })[];
  /** At least one linked control is active and (partly) effective. */
  effectivelyControlled: boolean;
}

export interface ControlDto extends GrcBaseDto {
  type: 'CONTROL';
  controlType: ControlType;
  nature: ControlNature;
  frequency: ControlFrequency;
  keyControl: boolean;
  system: { id: string; code: string | null; nameEn: string; nameAr: string } | null;
  effectiveness: ControlEffectiveness;
  lastAssessedAt: string | null;
  /** Result of the last reviewed control test (Phase 4.2); NOT_ASSESSED until one is reviewed. */
  operatingEffectiveness: ControlEffectiveness;
  lastTestedAt: string | null;
  risks: (GrcRef & { rating: RiskRating })[];
  requirements: GrcRef[];
}

export interface RequirementDto extends GrcBaseDto {
  type: 'REQUIREMENT';
  level: RequirementLevel;
  parent: GrcRef | null;
  sourceRef: string;
  url: string | null;
  effectiveDate: string | null;
  childCount: number;
  controls: (GrcRef & { effectiveness: ControlEffectiveness })[];
}

export type GrcItemDto = RiskDto | ControlDto | RequirementDto;

export interface GrcItemDetailDto<T extends GrcItemDto = GrcItemDto> {
  item: T;
  steps: GrcStepLinkDto[];
  /** A change waiting for approval (Phase 4.2); the item shows the current values meanwhile. */
  pendingChange?: GrcChangeDto | null;
}

/** Assessment history and comments of one item, newest first. */
export interface GrcActivityDto {
  id: string;
  kind: 'CREATED' | 'ASSESSMENT' | 'STATUS' | 'COMMENT';
  /** Field → { from, to } for ratings, effectiveness and status. */
  changes: Record<string, { from: unknown; to: unknown }>;
  comment: string;
  createdAt: string;
  author: UserRef | null;
}

/** Linked risks and controls of every step of one process (modeler panel, badges, colour-by). */
export interface ProcessGrcDto {
  processId: string;
  items: (GrcRef & {
    linkId: string;
    bpmnElementId: string;
    /** Risks: residual rating; controls: effectiveness. */
    rating?: RiskRating;
    /** Risks: at least one of its own mitigating controls is active and (partly) effective. */
    effectivelyControlled?: boolean;
    effectiveness?: ControlEffectiveness;
    /** Risks and controls: the next review date has passed. */
    overdue?: boolean;
    keyControl?: boolean;
    controlType?: ControlType;
    descriptionEn: string;
    descriptionAr: string;
  })[];
}

export interface HeatMapDto {
  inherent: number[][];
  residual: number[][];
  total: number;
}

export interface GrcBreakdownRow {
  id: string;
  code: string | null;
  nameEn: string;
  nameAr: string;
  risks: number;
  alerts: number;
  withoutControls: number;
}

export interface GrcDashboardDto {
  heatMap: HeatMapDto;
  coverage: {
    risksWithoutControls: number;
    alertRisks: number;
    alertRisksWithoutEffectiveControl: number;
    keyControlsAttention: number;
    requirementsWithoutControls: number;
    stepsWithRiskNoControl: number;
    processesWithRiskNoControl: number;
    overdueReviews: number;
  };
  /** Drill-down: departments (organisation scope), processes (department scope) or steps. */
  breakdown: { level: 'department' | 'process' | 'step'; rows: GrcBreakdownRow[] };
}

/** A step (or process) with linked risks but no linked control. */
export interface UncoveredStepDto {
  process: Pick<ProcessSummaryDto, 'id' | 'code' | 'nameEn' | 'nameAr'>;
  bpmnElementId: string;
  element: ElementLabelDto | null;
  risks: GrcRef[];
}

export interface GrcImportRowIssue {
  row: number;
  column: string;
  code: string;
}

export interface GrcImportReportDto {
  kind: GrcImportKind;
  rows: number;
  created: number;
  updated: number;
  errors: GrcImportRowIssue[];
  imported: boolean;
}

// ---------- Per-step coverage (badges, colour-by, gap check) ----------

export interface StepGrcSummary {
  risks: number;
  controls: number;
  requirements: number;
  /** Highest residual score of the step's risks (null: no risk). */
  maxResidualScore: number | null;
  maxResidualBand: string | null;
  /** A high / critical residual risk whose mitigating controls include no effective one. */
  alert: boolean;
  /** Risks but no control at all at this step. */
  uncovered: boolean;
}

/** Summary of the risks and controls linked to each element of a process. */
export function summariseSteps(items: ProcessGrcDto['items']): Map<string, StepGrcSummary> {
  const out = new Map<string, StepGrcSummary>();
  const byElement = new Map<string, ProcessGrcDto['items']>();
  for (const i of items) {
    if (i.status === 'RETIRED') continue;
    byElement.set(i.bpmnElementId, [...(byElement.get(i.bpmnElementId) ?? []), i]);
  }
  for (const [elementId, list] of byElement) {
    const risks = list.filter((i) => i.type === 'RISK');
    const controls = list.filter((i) => i.type === 'CONTROL');
    const top = risks
      .filter((r) => r.rating)
      .sort((a, b) => b.rating!.residualScore - a.rating!.residualScore)[0];
    out.set(elementId, {
      risks: risks.length,
      controls: controls.length,
      requirements: list.filter((i) => i.type === 'REQUIREMENT').length,
      maxResidualScore: top?.rating?.residualScore ?? null,
      maxResidualBand: top?.rating?.residualBand ?? null,
      alert: risks.some((r) => r.rating?.alert && !r.effectivelyControlled),
      uncovered: risks.length > 0 && controls.length === 0,
    });
  }
  return out;
}

/** Library object types the Knowledge Portal leaves out for a visibility setting. */
export function portalHiddenTypes(v: GrcPortalVisibility): GrcObjectType[] {
  return v === 'ALL' ? [] : v === 'CONTROLS' ? ['RISK', 'REQUIREMENT'] : [...GRC_OBJECT_TYPES];
}

/** A risk, control or requirement whose next review is due (My tasks, reminders). */
export interface GrcReviewTaskDto {
  id: string;
  type: GrcObjectType;
  code: string | null;
  nameEn: string;
  nameAr: string;
  ownerId: string | null;
  nextReviewAt: string;
  overdue: boolean;
  link: string;
}

// ---------- Control-gap check (rules; the AI explains and suggests on top) ----------

export const CONTROL_GAP_KINDS = [
  /** High / critical residual risk at a step whose own controls are not effective (or missing). */
  'HIGH_RISK_NO_CONTROL',
  /** An approval step is performed by the same lane / role as the step that submits to it. */
  'SEGREGATION_OF_DUTIES',
  /** A risk, control or requirement is linked to an element that is not in the diagram. */
  'ORPHAN_LINK',
  /** A requirement is mapped to the process but no step has a control. */
  'REQUIREMENT_NOT_COVERED',
  /** A linked control was never assessed, or its review is overdue. */
  'MISSING_REVIEW_EVIDENCE',
  /** Anything else the AI points out. */
  'OTHER',
] as const;
export type ControlGapKind = (typeof CONTROL_GAP_KINDS)[number];

export interface ControlGap {
  kind: ControlGapKind;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  elementIds: string[];
  /** Risks, controls or requirements concerned. */
  itemIds: string[];
}

/**
 * Finds control gaps of one process from its diagram and linked GRC items (the same rules run
 * before the AI is asked, so the check is useful — and testable — without it).
 */
export function detectControlGaps(graph: BpmnGraph, items: ProcessGrcDto['items']): ControlGap[] {
  const gaps: ControlGap[] = [];
  const ids = new Set([...graph.nodes.map((n) => n.id), ...graph.lanes.map((l) => l.id)]);
  const live = items.filter((i) => i.status !== 'RETIRED');

  for (const r of live.filter(
    (i) => i.type === 'RISK' && i.rating?.alert && !i.effectivelyControlled,
  )) {
    if (!ids.has(r.bpmnElementId)) continue;
    gaps.push({
      kind: 'HIGH_RISK_NO_CONTROL',
      severity: 'HIGH',
      elementIds: [r.bpmnElementId],
      itemIds: [r.id],
    });
  }

  // Segregation of duties: the approval's lane is the lane of a step that leads to it (directly or
  // through gateways / events).
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, string[]>();
  for (const f of graph.flows) incoming.set(f.to, [...(incoming.get(f.to) ?? []), f.from]);
  const submitters = (id: string, seen = new Set<string>()): string[] =>
    (incoming.get(id) ?? []).flatMap((from) => {
      if (seen.has(from)) return [];
      seen.add(from);
      const n = byId.get(from);
      if (!n) return [];
      return isStepNode(n) ? [from] : submitters(from, seen);
    });
  for (const n of graph.nodes.filter((x) => x.stepType === 'approval' && x.laneId)) {
    const same = submitters(n.id).filter((s) => byId.get(s)?.laneId === n.laneId);
    if (same.length)
      gaps.push({
        kind: 'SEGREGATION_OF_DUTIES',
        severity: 'HIGH',
        elementIds: [...same, n.id],
        itemIds: [],
      });
  }

  for (const i of live)
    if (i.bpmnElementId !== PROCESS_ELEMENT_ID && !ids.has(i.bpmnElementId))
      gaps.push({ kind: 'ORPHAN_LINK', severity: 'MEDIUM', elementIds: [], itemIds: [i.id] });

  const stepControls = live.filter(
    (i) =>
      i.type === 'CONTROL' && i.bpmnElementId !== PROCESS_ELEMENT_ID && ids.has(i.bpmnElementId),
  );
  if (!stepControls.length)
    for (const q of live.filter((i) => i.type === 'REQUIREMENT'))
      gaps.push({
        kind: 'REQUIREMENT_NOT_COVERED',
        severity: 'MEDIUM',
        elementIds: [],
        itemIds: [q.id],
      });

  const seen = new Set<string>();
  for (const c of stepControls) {
    if (seen.has(c.id) || !(c.effectiveness === 'NOT_ASSESSED' || c.overdue)) continue;
    seen.add(c.id);
    gaps.push({
      kind: 'MISSING_REVIEW_EVIDENCE',
      severity: c.keyControl ? 'MEDIUM' : 'LOW',
      elementIds: [c.bpmnElementId],
      itemIds: [c.id],
    });
  }
  return gaps;
}

/** What accepting a control-gap suggestion does (the user confirms; nothing changes by itself). */
export const CONTROL_GAP_ACTIONS = ['NONE', 'LINK_CONTROL', 'CREATE_CONTROL'] as const;
export type ControlGapAction = (typeof CONTROL_GAP_ACTIONS)[number];

export interface ControlGapFindingDto {
  kind: ControlGapKind;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  explanation: string;
  suggestion: string;
  elementIds: string[];
  itemIds: string[];
  action: {
    type: ControlGapAction;
    /** LINK_CONTROL: an existing control. */
    controlId: string | null;
    /** CREATE_CONTROL: proposed names (the user edits them in the form). */
    nameEn: string;
    nameAr: string;
    /** Step the control belongs to. */
    elementId: string | null;
  };
}

export interface ControlGapsDto {
  summary: string;
  findings: ControlGapFindingDto[];
}

/** The rule results of a process (without AI). */
export interface ProcessGapsDto {
  gaps: ControlGap[];
}

// ---------- Approval of changes to active risks and controls (Phase 4.2, D-098) ----------

export const GRC_CHANGE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
export type GrcChangeStatus = (typeof GRC_CHANGE_STATUSES)[number];
export const GRC_CHANGE_TASK_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SKIPPED'] as const;
export type GrcChangeTaskStatus = (typeof GRC_CHANGE_TASK_STATUSES)[number];
export type GrcChangeType = 'RISK' | 'CONTROL';

/** Whether an update of an item in `status` needs approval under the settings. */
export function needsChangeApproval(
  type: GrcObjectType,
  status: GrcStatus,
  settings: Pick<GrcSettings, 'changeApproval'>,
): boolean {
  const a = settings.changeApproval;
  return !!a?.enabled && status !== 'DRAFT' && (a.types as readonly string[]).includes(type);
}

export const grcChangeDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().max(2000).optional(),
});
export type GrcChangeDecisionInput = z.infer<typeof grcChangeDecisionSchema>;

export const grcChangeListQuerySchema = z.object({
  status: z.enum(GRC_CHANGE_STATUSES).optional(),
  objectId: z.guid().optional(),
  /** Only changes waiting for the caller's decision. */
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type GrcChangeListQuery = z.infer<typeof grcChangeListQuerySchema>;

export interface GrcChangeFieldDto {
  field: string;
  from: unknown;
  to: unknown;
}

export interface GrcChangeDto {
  id: string;
  object: GrcRef;
  status: GrcChangeStatus;
  fields: GrcChangeFieldDto[];
  comment: string;
  workflowNameEn: string;
  workflowNameAr: string;
  steps: {
    nameEn: string;
    nameAr: string;
    rule: 'ANY' | 'ALL';
    tasks: {
      assignee: UserRef | null;
      status: GrcChangeTaskStatus;
      comment: string | null;
      decidedAt: string | null;
    }[];
  }[];
  currentStep: number;
  submittedBy: UserRef | null;
  submittedAt: string;
  completedAt: string | null;
  /** The caller has an open task on the current step. */
  canDecide: boolean;
  /** The caller submitted it (or administers Risk & Compliance) and it is pending. */
  canWithdraw: boolean;
}
