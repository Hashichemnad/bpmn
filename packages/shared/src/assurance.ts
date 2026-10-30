import { z } from 'zod';
import { SYSTEM_ROLE_KEYS, type SystemRoleKey } from './constants';
import type { ControlEffectiveness, ControlFrequency, GrcChangeDto, GrcRef } from './grc';
import type { DepartmentRef, UserRef } from './types';

/**
 * Assurance (Phase 4.2, module M10 — DECISIONS D-098 onwards): approval of GRC changes, control
 * testing, issues and action plans, audit management, questionnaires and the assurance dashboard.
 */

/** Everything assurance-related waiting for the current user (My tasks). */
export interface AssuranceTasksDto {
  /** Changes of active risks / controls waiting for the user's approval. */
  grcChanges: GrcChangeDto[];
  /** Control tests the user has to execute (planned, in progress, returned). */
  testsToExecute: ControlTestDto[];
  /** Submitted control tests the user may review (never their own). */
  testsToReview: ControlTestDto[];
  /** Open issues the user owns. */
  issues: IssueDto[];
  /** Open actions the user owns. */
  issueActions: (IssueActionDto & {
    issue: Pick<IssueDto, 'id' | 'code' | 'titleEn' | 'titleAr'>;
  })[];
  /** Issues ready for verification the user may verify. */
  issuesToVerify: IssueDto[];
  /** Audit findings waiting for the user's management response. */
  findingsToAnswer: AuditFindingDto[];
  /** Questionnaires the user has not submitted yet (open campaigns). */
  surveys: (Pick<MyResponseDto, 'id' | 'status'> & {
    campaign: Pick<CampaignDto, 'id' | 'titleEn' | 'titleAr' | 'purpose' | 'endAt'>;
  })[];
}

// ---------- Control testing (step 1, D-099) ----------

export const TEST_TYPES = ['DESIGN', 'OPERATING'] as const;
export type TestType = (typeof TEST_TYPES)[number];

export const TEST_FREQUENCIES = [
  'MONTHLY',
  'QUARTERLY',
  'SEMI_ANNUAL',
  'ANNUAL',
  'AD_HOC',
] as const;
export type TestFrequency = (typeof TEST_FREQUENCIES)[number];

export const CONTROL_TEST_STATUSES = [
  'PLANNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'RETURNED',
  'REVIEWED',
  'CLOSED',
] as const;
export type ControlTestStatus = (typeof CONTROL_TEST_STATUSES)[number];
/** Statuses in which the tester still has to act. */
export const OPEN_TEST_STATUSES: readonly ControlTestStatus[] = [
  'PLANNED',
  'IN_PROGRESS',
  'RETURNED',
];

export const TEST_CONCLUSIONS = [
  'EFFECTIVE',
  'EFFECTIVE_WITH_EXCEPTIONS',
  'NOT_EFFECTIVE',
] as const;
export type TestConclusion = (typeof TEST_CONCLUSIONS)[number];

export const SAMPLE_RESULTS = ['PASS', 'EXCEPTION', 'FAIL'] as const;
export type SampleResult = (typeof SAMPLE_RESULTS)[number];
export const STEP_RESULTS = ['PASS', 'FAIL', 'NA'] as const;
export type StepResult = (typeof STEP_RESULTS)[number];

export const MAX_TEST_STEPS = 30;
export const MAX_SAMPLE_SIZE = 100;

/** Test frequency suggested for a control frequency (frequent controls: quarterly testing). */
export function testFrequencyFor(controlFrequency: ControlFrequency): TestFrequency {
  switch (controlFrequency) {
    case 'QUARTERLY':
      return 'SEMI_ANNUAL';
    case 'ANNUAL':
    case 'AD_HOC':
      return 'ANNUAL';
    default:
      return 'QUARTERLY';
  }
}

/** Sample size suggested for a control frequency (common audit practice). */
export function sampleSizeFor(controlFrequency: ControlFrequency): number {
  const sizes: Record<ControlFrequency, number> = {
    PER_TRANSACTION: 25,
    DAILY: 20,
    WEEKLY: 5,
    MONTHLY: 2,
    QUARTERLY: 2,
    ANNUAL: 1,
    AD_HOC: 1,
  };
  return sizes[controlFrequency];
}

export const TEST_FREQUENCY_MONTHS: Record<Exclude<TestFrequency, 'AD_HOC'>, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12,
};

/** Period label of a scheduled test due on `due` (e.g. 2026-Q4, 2026-H2, 2026-11, 2026). */
export function testPeriod(frequency: TestFrequency, due: Date): string {
  const y = due.getUTCFullYear();
  const m = due.getUTCMonth();
  switch (frequency) {
    case 'MONTHLY':
      return `${y}-${String(m + 1).padStart(2, '0')}`;
    case 'QUARTERLY':
      return `${y}-Q${Math.floor(m / 3) + 1}`;
    case 'SEMI_ANNUAL':
      return `${y}-H${m < 6 ? 1 : 2}`;
    case 'ANNUAL':
      return String(y);
    default:
      return due.toISOString().slice(0, 10);
  }
}

/** Operating effectiveness recorded on the control when a test with this conclusion is reviewed. */
export const CONCLUSION_EFFECTIVENESS: Record<TestConclusion, ControlEffectiveness> = {
  EFFECTIVE: 'EFFECTIVE',
  EFFECTIVE_WITH_EXCEPTIONS: 'PARTLY',
  NOT_EFFECTIVE: 'NOT_EFFECTIVE',
};

export interface TestSample {
  ref: string;
  /** One result per procedure step. */
  steps: (StepResult | null)[];
  result: SampleResult | null;
  note: string;
}

/** Conclusion suggested from the sample results (the tester may differ and explain why). */
export function suggestConclusion(samples: Pick<TestSample, 'result'>[]): TestConclusion | null {
  if (!samples.length || samples.some((s) => !s.result)) return null;
  if (samples.some((s) => s.result === 'FAIL')) return 'NOT_EFFECTIVE';
  if (samples.some((s) => s.result === 'EXCEPTION')) return 'EFFECTIVE_WITH_EXCEPTIONS';
  return 'EFFECTIVE';
}

/** Whether a test can be submitted: every sample has a result and a conclusion is chosen. */
export function testProblems(t: {
  samples: Pick<TestSample, 'result'>[];
  conclusion: TestConclusion | null;
}): ('NO_SAMPLES' | 'SAMPLE_WITHOUT_RESULT' | 'NO_CONCLUSION')[] {
  const out: ('NO_SAMPLES' | 'SAMPLE_WITHOUT_RESULT' | 'NO_CONCLUSION')[] = [];
  if (!t.samples.length) out.push('NO_SAMPLES');
  if (t.samples.some((s) => !s.result)) out.push('SAMPLE_WITHOUT_RESULT');
  if (!t.conclusion) out.push('NO_CONCLUSION');
  return out;
}

const bilingualStep = z.object({
  en: z.string().trim().max(1000).default(''),
  ar: z.string().trim().max(1000).default(''),
});
const roleKey = z.enum(SYSTEM_ROLE_KEYS);
const dateOnly = z
  .string()
  .trim()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'INVALID_DATE');

const planFields = {
  testType: z.enum(TEST_TYPES),
  procedure: z.array(bilingualStep).max(MAX_TEST_STEPS),
  sampleSize: z.number().int().min(1).max(MAX_SAMPLE_SIZE),
  frequency: z.enum(TEST_FREQUENCIES),
  testerId: z.guid().nullable().optional(),
  testerRoleKey: roleKey.nullable().optional(),
  reviewerId: z.guid().nullable().optional(),
  reviewerRoleKey: roleKey.nullable().optional(),
  nextDueAt: dateOnly.nullable().optional(),
  leadDays: z.number().int().min(0).max(180).optional(),
  active: z.boolean().optional(),
};

/** The same user may not be both tester and reviewer (four-eyes). */
function distinctPeople(
  v: { testerId?: string | null; reviewerId?: string | null },
  ctx: z.RefinementCtx,
) {
  if (v.testerId && v.testerId === v.reviewerId)
    ctx.addIssue({ code: 'custom', path: ['reviewerId'], message: 'TESTER_IS_REVIEWER' });
}

export const createTestPlanSchema = z
  .object({ controlId: z.guid(), ...planFields })
  .superRefine(distinctPeople);
export type CreateTestPlanInput = z.infer<typeof createTestPlanSchema>;

export const updateTestPlanSchema = z.object(planFields).partial().superRefine(distinctPeople);
export type UpdateTestPlanInput = z.infer<typeof updateTestPlanSchema>;

/** A test created by hand: from a plan (its settings) or ad hoc for a control. */
export const createControlTestSchema = z
  .object({
    planId: z.guid().optional(),
    controlId: z.guid().optional(),
    testType: z.enum(TEST_TYPES).optional(),
    dueAt: dateOnly,
    procedure: z.array(bilingualStep).max(MAX_TEST_STEPS).optional(),
    sampleSize: z.number().int().min(1).max(MAX_SAMPLE_SIZE).optional(),
    testerId: z.guid().nullable().optional(),
    testerRoleKey: roleKey.nullable().optional(),
    reviewerId: z.guid().nullable().optional(),
    reviewerRoleKey: roleKey.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.planId && !v.controlId)
      ctx.addIssue({ code: 'custom', path: ['controlId'], message: 'PLAN_OR_CONTROL_REQUIRED' });
    distinctPeople(v, ctx);
  });
export type CreateControlTestInput = z.infer<typeof createControlTestSchema>;

export const testResultsSchema = z.object({
  samples: z
    .array(
      z.object({
        ref: z.string().trim().max(200).default(''),
        steps: z.array(z.enum(STEP_RESULTS).nullable()).max(MAX_TEST_STEPS).default([]),
        result: z.enum(SAMPLE_RESULTS).nullable().default(null),
        note: z.string().trim().max(2000).default(''),
      }),
    )
    .max(MAX_SAMPLE_SIZE),
  conclusion: z.enum(TEST_CONCLUSIONS).nullable(),
  testerComment: z.string().trim().max(5000).default(''),
});
export type TestResultsInput = z.infer<typeof testResultsSchema>;

export const testReviewSchema = z
  .object({
    decision: z.enum(['APPROVE', 'RETURN']),
    comment: z.string().trim().max(5000).default(''),
  })
  .superRefine((v, ctx) => {
    if (v.decision === 'RETURN' && !v.comment)
      ctx.addIssue({ code: 'custom', path: ['comment'], message: 'COMMENT_REQUIRED' });
  });
export type TestReviewInput = z.infer<typeof testReviewSchema>;

export const assuranceCommentSchema = z.object({ body: z.string().trim().min(1).max(4000) });
export type AssuranceCommentInput = z.infer<typeof assuranceCommentSchema>;

const boolParam = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const controlTestListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['dueAt', 'status', 'control', 'conclusion']).default('dueAt'),
  order: z.enum(['asc', 'desc']).default('asc'),
  q: z.string().trim().max(200).optional(),
  controlId: z.guid().optional(),
  status: z.enum(CONTROL_TEST_STATUSES).optional(),
  conclusion: z.enum(TEST_CONCLUSIONS).optional(),
  departmentId: z.guid().optional(),
  processId: z.guid().optional(),
  /** Past the due date and not yet submitted. */
  overdue: boolParam,
  /** Not yet reviewed (planned, in progress, submitted, returned). */
  open: boolParam,
  /** Assigned to the caller (as tester or reviewer). */
  mine: boolParam,
});
export type ControlTestListQuery = z.infer<typeof controlTestListQuerySchema>;

export interface AssigneeDto {
  user: UserRef | null;
  roleKey: SystemRoleKey | null;
}

export interface TestPlanDto {
  id: string;
  control: GrcRef;
  testType: TestType;
  procedure: { en: string; ar: string }[];
  sampleSize: number;
  frequency: TestFrequency;
  tester: AssigneeDto;
  reviewer: AssigneeDto;
  nextDueAt: string | null;
  leadDays: number;
  active: boolean;
  testCount: number;
  updatedAt: string;
}

export interface AssuranceFileDto {
  id: string;
  /** The record the file belongs to (test, issue, action …). */
  ownerId: string;
  fileName: string;
  contentType: string;
  size: number;
  url: string;
  createdAt: string;
  createdBy: UserRef | null;
}

export interface AssuranceEventDto {
  id: string;
  kind: 'CREATED' | 'STATUS' | 'UPDATED' | 'COMMENT' | 'FILE';
  changes: Record<string, { from: unknown; to: unknown }>;
  comment: string;
  createdAt: string;
  author: UserRef | null;
}

export interface ControlTestDto {
  id: string;
  planId: string | null;
  control: GrcRef & {
    keyControl: boolean;
    department: DepartmentRef | null;
    owner: UserRef | null;
  };
  testType: TestType;
  period: string;
  dueAt: string;
  status: ControlTestStatus;
  origin: 'SCHEDULED' | 'MANUAL';
  overdue: boolean;
  procedure: { en: string; ar: string }[];
  sampleSize: number;
  tester: AssigneeDto;
  reviewer: AssigneeDto;
  samples: TestSample[];
  conclusion: TestConclusion | null;
  testerComment: string;
  reviewComment: string;
  executedBy: UserRef | null;
  reviewedBy: UserRef | null;
  startedAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  /** What the caller may do now (checked again on the server). */
  can: { execute: boolean; review: boolean; close: boolean; manage: boolean };
}

export interface ControlTestDetailDto extends ControlTestDto {
  files: AssuranceFileDto[];
  events: AssuranceEventDto[];
}

/** Download path of an assurance file (evidence). */
export const assuranceFileUrl = (id: string) => `/api/v1/assurance/files/${id}`;

// ---------- Settings: issue severity scale and escalation (D-100) ----------

const scaleKey = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'INVALID_KEY');

export const assuranceSettingsSchema = z
  .strictObject({
    /** Issue severity / finding rating scale, lowest first. */
    severities: z
      .array(
        z.object({
          key: scaleKey,
          nameEn: z.string().trim().min(1).max(60),
          nameAr: z.string().trim().min(1).max(60),
          colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'INVALID_COLOUR'),
        }),
      )
      .min(2)
      .max(6),
    /** Days after the due date before an open issue or action is escalated. */
    escalationDays: z.number().int().min(0).max(180),
    /** Escalated to the owner's department manager, the Risk & Compliance officers, or both. */
    escalateTo: z.enum(['MANAGER', 'RISK_OFFICER', 'BOTH']),
    /** Owners are reminded this many days before an issue or action is due. */
    reminderDaysBefore: z.number().int().min(0).max(90),
  })
  .superRefine((v, ctx) => {
    const keys = v.severities.map((s) => s.key);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: 'custom', path: ['severities'], message: 'DUPLICATE_KEY' });
  });
export type AssuranceSettings = z.infer<typeof assuranceSettingsSchema>;

export const DEFAULT_ASSURANCE_SETTINGS: AssuranceSettings = {
  severities: [
    { key: 'LOW', nameEn: 'Low', nameAr: 'منخفضة', colour: '#52c41a' },
    { key: 'MEDIUM', nameEn: 'Medium', nameAr: 'متوسطة', colour: '#faad14' },
    { key: 'HIGH', nameEn: 'High', nameAr: 'مرتفعة', colour: '#fa8c16' },
    { key: 'CRITICAL', nameEn: 'Critical', nameAr: 'حرجة', colour: '#f5222d' },
  ],
  escalationDays: 7,
  escalateTo: 'BOTH',
  reminderDaysBefore: 7,
};

export function resolveAssuranceSettings(value: unknown): AssuranceSettings {
  if (!value || typeof value !== 'object') return DEFAULT_ASSURANCE_SETTINGS;
  const parsed = assuranceSettingsSchema.safeParse({
    ...DEFAULT_ASSURANCE_SETTINGS,
    ...(value as object),
  });
  return parsed.success ? parsed.data : DEFAULT_ASSURANCE_SETTINGS;
}

// ---------- Issues and action plans (step 2, D-100) ----------

export const ISSUE_SOURCES = [
  'CONTROL_TEST',
  'RISK_ASSESSMENT',
  'AUDIT_FINDING',
  'FEEDBACK',
  'MANUAL',
] as const;
export type IssueSource = (typeof ISSUE_SOURCES)[number];

export const ISSUE_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'READY_FOR_VERIFICATION',
  'CLOSED',
  'ACCEPTED_RISK',
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const OPEN_ISSUE_STATUSES: readonly IssueStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'READY_FOR_VERIFICATION',
];

/** Lifecycle actions on an issue (who may do what is checked on the server). */
export const ISSUE_ACTIONS = [
  'START',
  'READY',
  'VERIFY',
  'REJECT_VERIFICATION',
  'ACCEPT_RISK',
  'REOPEN',
] as const;
export type IssueAction = (typeof ISSUE_ACTIONS)[number];

const ISSUE_TRANSITIONS: Record<IssueAction, { from: readonly IssueStatus[]; to: IssueStatus }> = {
  START: { from: ['OPEN'], to: 'IN_PROGRESS' },
  READY: { from: ['OPEN', 'IN_PROGRESS'], to: 'READY_FOR_VERIFICATION' },
  VERIFY: { from: ['READY_FOR_VERIFICATION'], to: 'CLOSED' },
  REJECT_VERIFICATION: { from: ['READY_FOR_VERIFICATION'], to: 'IN_PROGRESS' },
  ACCEPT_RISK: { from: ['OPEN', 'IN_PROGRESS', 'READY_FOR_VERIFICATION'], to: 'ACCEPTED_RISK' },
  REOPEN: { from: ['CLOSED', 'ACCEPTED_RISK'], to: 'IN_PROGRESS' },
};

/** The status after `action`, or null when the action is not possible from `status`. */
export function issueTransition(status: IssueStatus, action: IssueAction): IssueStatus | null {
  const t = ISSUE_TRANSITIONS[action];
  return t.from.includes(status) ? t.to : null;
}

/** Ageing buckets (days since the issue was raised) for dashboards. */
export const AGE_BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];
export function ageBucket(days: number): AgeBucket {
  return days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v ?? '')
    .optional();

const issueFields = {
  titleEn: text(300),
  titleAr: text(300),
  descriptionEn: text(5000),
  descriptionAr: text(5000),
  severity: scaleKey.optional(),
  ownerId: z.guid().nullable().optional(),
  dueAt: dateOnly.nullable().optional(),
  processId: z.guid().nullable().optional(),
  bpmnElementId: z.string().trim().max(200).nullable().optional(),
  riskId: z.guid().nullable().optional(),
  controlId: z.guid().nullable().optional(),
  requirementId: z.guid().nullable().optional(),
  departmentId: z.guid().nullable().optional(),
};

function issueTitle(v: { titleEn?: string; titleAr?: string }, ctx: z.RefinementCtx) {
  if (!v.titleEn && !v.titleAr)
    ctx.addIssue({ code: 'custom', path: ['titleEn'], message: 'NAME_REQUIRED' });
}

export const createIssueSchema = z
  .object({
    ...issueFields,
    severity: scaleKey,
    sourceType: z.enum(ISSUE_SOURCES).default('MANUAL'),
    sourceId: z.guid().nullable().optional(),
    /** An initial action plan. */
    actions: z
      .array(
        z.object({
          titleEn: text(300),
          titleAr: text(300),
          ownerId: z.guid().nullable().optional(),
          dueAt: dateOnly.nullable().optional(),
        }),
      )
      .max(30)
      .optional(),
  })
  .superRefine((v, ctx) => {
    issueTitle(v, ctx);
    if (v.sourceType !== 'MANUAL' && !v.sourceId)
      ctx.addIssue({ code: 'custom', path: ['sourceId'], message: 'SOURCE_REQUIRED' });
  });
export type CreateIssueInput = z.infer<typeof createIssueSchema>;

export const updateIssueSchema = z.object(issueFields).superRefine((v, ctx) => {
  if (v.titleEn !== undefined || v.titleAr !== undefined) issueTitle(v, ctx);
});
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;

export const issueTransitionSchema = z
  .object({
    action: z.enum(ISSUE_ACTIONS),
    comment: z.string().trim().max(5000).default(''),
  })
  .superRefine((v, ctx) => {
    if (['ACCEPT_RISK', 'REJECT_VERIFICATION', 'REOPEN'].includes(v.action) && !v.comment)
      ctx.addIssue({ code: 'custom', path: ['comment'], message: 'COMMENT_REQUIRED' });
  });
export type IssueTransitionInput = z.infer<typeof issueTransitionSchema>;

export const issueActionSchema = z
  .object({
    titleEn: text(300),
    titleAr: text(300),
    note: text(5000),
    ownerId: z.guid().nullable().optional(),
    dueAt: dateOnly.nullable().optional(),
    progress: z.number().int().min(0).max(100).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.titleEn !== undefined || v.titleAr !== undefined) issueTitle(v, ctx);
  });
export type IssueActionInput = z.infer<typeof issueActionSchema>;

export const issueListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['code', 'severity', 'status', 'dueAt', 'createdAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().trim().max(200).optional(),
  status: z.enum(ISSUE_STATUSES).optional(),
  severity: scaleKey.optional(),
  sourceType: z.enum(ISSUE_SOURCES).optional(),
  sourceId: z.guid().optional(),
  ownerId: z.guid().optional(),
  processId: z.guid().optional(),
  controlId: z.guid().optional(),
  riskId: z.guid().optional(),
  departmentId: z.guid().optional(),
  /** Not closed or accepted. */
  open: boolParam,
  /** Open and past the due date. */
  overdue: boolParam,
  /** Owned by the caller (issue or one of its actions). */
  mine: boolParam,
  ageBucket: z.enum(AGE_BUCKETS).optional(),
});
export type IssueListQuery = z.infer<typeof issueListQuerySchema>;

export interface IssueActionDto {
  id: string;
  issueId: string;
  titleEn: string;
  titleAr: string;
  note: string;
  owner: UserRef | null;
  dueAt: string | null;
  progress: number;
  done: boolean;
  overdue: boolean;
  completedAt: string | null;
  files: AssuranceFileDto[];
  /** The caller may update progress / evidence (action owner, issue owner, issue managers). */
  canUpdate: boolean;
}

export interface IssueLinkRef {
  id: string;
  code: string | null;
  nameEn: string;
  nameAr: string;
}

export interface IssueDto {
  id: string;
  code: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  sourceType: IssueSource;
  sourceId: string | null;
  /** In-app path of the source (test, risk, finding, the item the feedback is about). */
  sourceLink: string | null;
  severity: string;
  status: IssueStatus;
  owner: UserRef | null;
  raisedBy: UserRef | null;
  dueAt: string | null;
  overdue: boolean;
  ageDays: number;
  process: (IssueLinkRef & { status: string }) | null;
  bpmnElementId: string | null;
  elementLabel: { nameEn: string; nameAr: string } | null;
  risk: IssueLinkRef | null;
  control: IssueLinkRef | null;
  requirement: IssueLinkRef | null;
  department: DepartmentRef | null;
  actionCount: number;
  actionsDone: number;
  /** Average progress of the actions (0 without actions). */
  progress: number;
  acceptanceJustification: string;
  acceptedBy: UserRef | null;
  acceptedAt: string | null;
  verifiedBy: UserRef | null;
  verifiedAt: string | null;
  closedAt: string | null;
  escalatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Lifecycle actions the caller may take now. */
  allowed: IssueAction[];
  canEdit: boolean;
}

export interface IssueDetailDto extends IssueDto {
  actions: IssueActionDto[];
  files: AssuranceFileDto[];
  events: AssuranceEventDto[];
}

// ---------- Audit management (step 3, D-101) ----------

export const ENGAGEMENT_STATUSES = [
  'PLANNED',
  'FIELDWORK',
  'REPORTING',
  'FOLLOW_UP',
  'CLOSED',
] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export const WORK_ITEM_STATUSES = ['OPEN', 'DONE', 'NOT_APPLICABLE'] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];
export const WORK_ITEM_RESULTS = ['SATISFACTORY', 'EXCEPTION'] as const;
export type WorkItemResult = (typeof WORK_ITEM_RESULTS)[number];

export const RESPONSE_STATUSES = ['PENDING', 'ACCEPTED', 'DISAGREED'] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];

/** Engagements move one stage forward or back; closing needs every finding answered. */
export function engagementMove(from: EngagementStatus, to: EngagementStatus): boolean {
  return Math.abs(ENGAGEMENT_STATUSES.indexOf(from) - ENGAGEMENT_STATUSES.indexOf(to)) === 1;
}

const ids = z
  .array(z.guid())
  .max(200)
  .transform((l) => [...new Set(l)]);

const engagementFields = {
  year: z.number().int().min(2000).max(2100),
  titleEn: text(300),
  titleAr: text(300),
  objectiveEn: text(5000),
  objectiveAr: text(5000),
  scopeEn: text(5000),
  scopeAr: text(5000),
  leadId: z.guid().nullable().optional(),
  teamIds: ids.optional(),
  plannedStart: dateOnly.nullable().optional(),
  plannedEnd: dateOnly.nullable().optional(),
  processIds: ids.optional(),
  departmentIds: ids.optional(),
  riskIds: ids.optional(),
  controlIds: ids.optional(),
  requirementIds: ids.optional(),
  summaryEn: text(10000),
  summaryAr: text(10000),
};

export const createEngagementSchema = z.object(engagementFields).superRefine(issueTitle);
export type CreateEngagementInput = z.infer<typeof createEngagementSchema>;
export const updateEngagementSchema = z
  .object({ ...engagementFields, year: engagementFields.year.optional() })
  .superRefine((v, ctx) => {
    if (v.titleEn !== undefined || v.titleAr !== undefined) issueTitle(v, ctx);
  });
export type UpdateEngagementInput = z.infer<typeof updateEngagementSchema>;

export const engagementStatusSchema = z.object({
  status: z.enum(ENGAGEMENT_STATUSES),
  comment: z.string().trim().max(2000).default(''),
});
export type EngagementStatusInput = z.infer<typeof engagementStatusSchema>;

export const workItemSchema = z.object({
  titleEn: text(300),
  titleAr: text(300),
  procedure: z.array(bilingualStep).max(MAX_TEST_STEPS).optional(),
  /** A control of the scope; its test procedure is copied when no procedure is given. */
  controlId: z.guid().nullable().optional(),
  status: z.enum(WORK_ITEM_STATUSES).optional(),
  result: z.enum(WORK_ITEM_RESULTS).nullable().optional(),
  notes: text(10000),
  assigneeId: z.guid().nullable().optional(),
});
export type WorkItemInput = z.infer<typeof workItemSchema>;

const findingFields = {
  titleEn: text(300),
  titleAr: text(300),
  rating: scaleKey.optional(),
  conditionEn: text(5000),
  conditionAr: text(5000),
  criteriaEn: text(5000),
  criteriaAr: text(5000),
  requirementId: z.guid().nullable().optional(),
  causeEn: text(5000),
  causeAr: text(5000),
  effectEn: text(5000),
  effectAr: text(5000),
  recommendationEn: text(5000),
  recommendationAr: text(5000),
  processId: z.guid().nullable().optional(),
  bpmnElementId: z.string().trim().max(200).nullable().optional(),
  riskId: z.guid().nullable().optional(),
  controlId: z.guid().nullable().optional(),
  workItemId: z.guid().nullable().optional(),
  responseOwnerId: z.guid().nullable().optional(),
};
export const createFindingSchema = z
  .object({ ...findingFields, rating: scaleKey })
  .superRefine(issueTitle);
export type CreateFindingInput = z.infer<typeof createFindingSchema>;
export const updateFindingSchema = z.object(findingFields).superRefine((v, ctx) => {
  if (v.titleEn !== undefined || v.titleAr !== undefined) issueTitle(v, ctx);
});
export type UpdateFindingInput = z.infer<typeof updateFindingSchema>;

/** Management response: agree with an action plan (creates an issue) or disagree with a reason. */
export const findingResponseSchema = z
  .object({
    status: z.enum(['ACCEPTED', 'DISAGREED']),
    agreedActionEn: text(5000),
    agreedActionAr: text(5000),
    targetDate: dateOnly.nullable().optional(),
    ownerId: z.guid().nullable().optional(),
    comment: z.string().trim().max(5000).default(''),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'ACCEPTED' && !v.agreedActionEn && !v.agreedActionAr)
      ctx.addIssue({ code: 'custom', path: ['agreedActionEn'], message: 'ACTION_REQUIRED' });
    if (v.status === 'ACCEPTED' && !v.targetDate)
      ctx.addIssue({ code: 'custom', path: ['targetDate'], message: 'TARGET_DATE_REQUIRED' });
    if (v.status === 'DISAGREED' && !v.comment)
      ctx.addIssue({ code: 'custom', path: ['comment'], message: 'COMMENT_REQUIRED' });
  });
export type FindingResponseInput = z.infer<typeof findingResponseSchema>;

export const engagementListQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  status: z.enum(ENGAGEMENT_STATUSES).optional(),
  q: z.string().trim().max(200).optional(),
  processId: z.guid().optional(),
  departmentId: z.guid().optional(),
});
export type EngagementListQuery = z.infer<typeof engagementListQuerySchema>;

export const auditReportQuerySchema = z.object({ locale: z.enum(['en', 'ar']).default('en') });

export interface AuditEngagementDto {
  id: string;
  code: string;
  year: number;
  titleEn: string;
  titleAr: string;
  objectiveEn: string;
  objectiveAr: string;
  scopeEn: string;
  scopeAr: string;
  status: EngagementStatus;
  lead: UserRef | null;
  team: UserRef[];
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  scope: {
    processes: IssueLinkRef[];
    departments: DepartmentRef[];
    risks: IssueLinkRef[];
    controls: IssueLinkRef[];
    requirements: IssueLinkRef[];
  };
  summaryEn: string;
  summaryAr: string;
  itemCount: number;
  itemsDone: number;
  findingCount: number;
  /** Findings per rating key. */
  findingsByRating: Record<string, number>;
  /** Planned end passed and not in reporting yet. */
  late: boolean;
  canManage: boolean;
  updatedAt: string;
}

export interface AuditWorkItemDto {
  id: string;
  titleEn: string;
  titleAr: string;
  procedure: { en: string; ar: string }[];
  control: IssueLinkRef | null;
  status: WorkItemStatus;
  result: WorkItemResult | null;
  notes: string;
  assignee: UserRef | null;
  files: AssuranceFileDto[];
}

export interface AuditFindingDto {
  id: string;
  engagementId: string;
  engagement: Pick<AuditEngagementDto, 'id' | 'code' | 'titleEn' | 'titleAr' | 'status'>;
  code: string;
  titleEn: string;
  titleAr: string;
  rating: string;
  conditionEn: string;
  conditionAr: string;
  criteriaEn: string;
  criteriaAr: string;
  requirement: IssueLinkRef | null;
  causeEn: string;
  causeAr: string;
  effectEn: string;
  effectAr: string;
  recommendationEn: string;
  recommendationAr: string;
  process: IssueLinkRef | null;
  bpmnElementId: string | null;
  elementLabel: { nameEn: string; nameAr: string } | null;
  risk: IssueLinkRef | null;
  control: IssueLinkRef | null;
  workItemId: string | null;
  responseStatus: ResponseStatus;
  responseOwner: UserRef | null;
  agreedActionEn: string;
  agreedActionAr: string;
  targetDate: string | null;
  responseComment: string;
  respondedAt: string | null;
  issue: { id: string; code: string; status: IssueStatus } | null;
  files: AssuranceFileDto[];
  /** The caller is the response owner (or manages audits) and the response is pending. */
  canRespond: boolean;
}

export interface AuditEngagementDetailDto extends AuditEngagementDto {
  items: AuditWorkItemDto[];
  findings: AuditFindingDto[];
  events: AssuranceEventDto[];
}

/** One process or department of the audit universe. */
export interface AuditUniverseRow {
  kind: 'PROCESS' | 'DEPARTMENT';
  id: string;
  code: string | null;
  nameEn: string;
  nameAr: string;
  /** Highest residual score of its active risks (0 = no risks). */
  priorityScore: number;
  priorityBand: string | null;
  riskCount: number;
  lastAuditedAt: string | null;
  /** Engagements of the requested year covering it. */
  planned: Pick<AuditEngagementDto, 'id' | 'code' | 'status'>[];
}

// ---------- Questionnaires and surveys (step 4, D-102) ----------

export const QUESTION_TYPES = [
  'SINGLE',
  'MULTIPLE',
  'RATING',
  'YES_NO_NA',
  'TEXT',
  'NUMBER',
  'DATE',
  'FILE',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const SURVEY_PURPOSES = ['GENERAL', 'RCSA', 'COMPLIANCE', 'PROCESS_FEEDBACK'] as const;
export type SurveyPurpose = (typeof SURVEY_PURPOSES)[number];
export const QUESTIONNAIRE_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type QuestionnaireStatus = (typeof QUESTIONNAIRE_STATUSES)[number];
export const CAMPAIGN_STATUSES = ['DRAFT', 'OPEN', 'CLOSED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const RESPONSE_PROGRESS = ['SENT', 'OPENED', 'SUBMITTED'] as const;
export type ResponseProgress = (typeof RESPONSE_PROGRESS)[number];
export const PROPOSAL_FIELDS = ['LIKELIHOOD', 'IMPACT', 'EFFECTIVENESS'] as const;
export type ProposalField = (typeof PROPOSAL_FIELDS)[number];
export const PROPOSAL_STATUSES = ['PENDING', 'ACCEPTED', 'DISMISSED'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const MAX_SECTIONS = 20;
export const MAX_QUESTIONS = 200;
export const MAX_OPTIONS = 30;

const shortId = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, 'INVALID_KEY');
const label = (max: number) => z.string().trim().max(max).default('');

export const questionSchema = z.object({
  id: shortId,
  type: z.enum(QUESTION_TYPES),
  textEn: label(1000),
  textAr: label(1000),
  helpEn: label(2000).optional(),
  helpAr: label(2000).optional(),
  required: z.boolean().default(false),
  /** Scoring weight (0 = not scored). */
  weight: z.number().min(0).max(100).default(0),
  options: z
    .array(
      z.object({
        id: shortId,
        en: label(300),
        ar: label(300),
        score: z.number().min(-100).max(100).default(0),
      }),
    )
    .max(MAX_OPTIONS)
    .default([]),
  /** Shown only when the answer of another (earlier) question is one of these values. */
  showIf: z
    .object({ questionId: shortId, equals: z.array(z.string().max(100)).min(1).max(30) })
    .nullable()
    .optional(),
  /**
   * Risk & control self-assessment: a RATING answer proposes the residual likelihood / impact of a
   * risk; a SINGLE answer whose option ids are effectiveness values proposes a control's effectiveness.
   */
  link: z
    .object({ objectId: z.guid(), field: z.enum(PROPOSAL_FIELDS) })
    .nullable()
    .optional(),
});
export type Question = z.infer<typeof questionSchema>;

export const questionnaireDefinitionSchema = z
  .object({
    sections: z
      .array(
        z.object({
          id: shortId,
          titleEn: label(300),
          titleAr: label(300),
          questions: z.array(questionSchema).max(MAX_QUESTIONS),
        }),
      )
      .min(1)
      .max(MAX_SECTIONS),
  })
  .superRefine((d, ctx) => {
    const ids = d.sections.flatMap((s) => s.questions.map((q) => q.id));
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'DUPLICATE_KEY' });
    if (ids.length > MAX_QUESTIONS)
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'TOO_MANY_QUESTIONS' });
    const seen = new Set<string>();
    d.sections.forEach((s, si) =>
      s.questions.forEach((q, qi) => {
        const path = ['sections', si, 'questions', qi];
        if (!q.textEn && !q.textAr)
          ctx.addIssue({ code: 'custom', path: [...path, 'textEn'], message: 'NAME_REQUIRED' });
        if ((q.type === 'SINGLE' || q.type === 'MULTIPLE') && q.options.length < 2)
          ctx.addIssue({ code: 'custom', path: [...path, 'options'], message: 'OPTIONS_REQUIRED' });
        if (q.showIf && !seen.has(q.showIf.questionId))
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'showIf'],
            message: 'CONDITION_ON_LATER_QUESTION',
          });
        if (q.link?.field === 'EFFECTIVENESS' && q.type !== 'SINGLE')
          ctx.addIssue({ code: 'custom', path: [...path, 'link'], message: 'INVALID_LINK' });
        if (q.link && q.link.field !== 'EFFECTIVENESS' && q.type !== 'RATING')
          ctx.addIssue({ code: 'custom', path: [...path, 'link'], message: 'INVALID_LINK' });
        seen.add(q.id);
      }),
    );
  });
export type QuestionnaireDefinition = z.infer<typeof questionnaireDefinitionSchema>;

/** An answer: option id(s), a rating 1–5, YES / NO / NA, text, number, ISO date or file ids. */
export type Answer = string | number | string[] | null;
export type Answers = Record<string, Answer>;

const allQuestions = (d: QuestionnaireDefinition) => d.sections.flatMap((s) => s.questions);

/** Whether a question is shown for the answers given so far (conditional show / hide). */
export function isQuestionVisible(q: Question, answers: Answers): boolean {
  if (!q.showIf) return true;
  const a = answers[q.showIf.questionId];
  const values = Array.isArray(a) ? a : a === null || a === undefined ? [] : [String(a)];
  return values.some((v) => q.showIf!.equals.includes(String(v)));
}

/** Problems of a submission: required visible questions without an answer, invalid values. */
export function answerProblems(d: QuestionnaireDefinition, answers: Answers) {
  const problems: { questionId: string; code: 'REQUIRED' | 'INVALID' }[] = [];
  for (const q of allQuestions(d)) {
    if (!isQuestionVisible(q, answers)) continue;
    const a = answers[q.id];
    const empty = a === null || a === undefined || a === '' || (Array.isArray(a) && !a.length);
    if (empty) {
      if (q.required) problems.push({ questionId: q.id, code: 'REQUIRED' });
      continue;
    }
    const opts = q.options.map((o) => o.id);
    const ok =
      q.type === 'SINGLE'
        ? typeof a === 'string' && opts.includes(a)
        : q.type === 'MULTIPLE'
          ? Array.isArray(a) && a.every((v) => opts.includes(v))
          : q.type === 'RATING'
            ? typeof a === 'number' && Number.isInteger(a) && a >= 1 && a <= 5
            : q.type === 'YES_NO_NA'
              ? a === 'YES' || a === 'NO' || a === 'NA'
              : q.type === 'NUMBER'
                ? typeof a === 'number' && Number.isFinite(a)
                : q.type === 'DATE'
                  ? typeof a === 'string' && !Number.isNaN(Date.parse(a))
                  : q.type === 'FILE'
                    ? Array.isArray(a) && a.length <= 10
                    : typeof a === 'string' && a.length <= 10000;
    if (!ok) problems.push({ questionId: q.id, code: 'INVALID' });
  }
  return problems;
}

/** Weighted score of the visible answers (null when nothing is scored). */
export function scoreAnswers(d: QuestionnaireDefinition, answers: Answers) {
  let score = 0;
  let max = 0;
  for (const q of allQuestions(d)) {
    if (!q.weight || !isQuestionVisible(q, answers)) continue;
    const a = answers[q.id];
    if (q.type === 'RATING') {
      max += 5 * q.weight;
      if (typeof a === 'number') score += a * q.weight;
    } else if (q.type === 'YES_NO_NA') {
      if (a === 'NA') continue;
      max += q.weight;
      if (a === 'YES') score += q.weight;
    } else if (q.type === 'SINGLE' || q.type === 'MULTIPLE') {
      const best =
        q.type === 'SINGLE'
          ? Math.max(0, ...q.options.map((o) => o.score))
          : q.options.reduce((n, o) => n + Math.max(0, o.score), 0);
      max += best * q.weight;
      const chosen = Array.isArray(a) ? a : typeof a === 'string' ? [a] : [];
      score +=
        q.options.filter((o) => chosen.includes(o.id)).reduce((n, o) => n + o.score, 0) * q.weight;
    }
  }
  return max ? { score, maxScore: max, percent: Math.round((score / max) * 100) } : null;
}

/** RCSA proposals of a submission (linked questions with an answer). */
export function proposalsFromAnswers(d: QuestionnaireDefinition, answers: Answers) {
  const out: { questionId: string; objectId: string; field: ProposalField; value: string }[] = [];
  for (const q of allQuestions(d)) {
    if (!q.link || !isQuestionVisible(q, answers)) continue;
    const a = answers[q.id];
    if (q.link.field === 'EFFECTIVENESS') {
      if (typeof a === 'string' && ['EFFECTIVE', 'PARTLY', 'NOT_EFFECTIVE'].includes(a))
        out.push({ questionId: q.id, objectId: q.link.objectId, field: 'EFFECTIVENESS', value: a });
    } else if (typeof a === 'number') {
      out.push({
        questionId: q.id,
        objectId: q.link.objectId,
        field: q.link.field,
        value: String(a),
      });
    }
  }
  return out;
}

/** The short built-in questionnaire of "Request feedback" on a process. */
export const PROCESS_FEEDBACK_DEFINITION: QuestionnaireDefinition = {
  sections: [
    {
      id: 'feedback',
      titleEn: 'Your feedback on the process',
      titleAr: 'ملاحظاتك على العملية',
      questions: [
        {
          id: 'clarity',
          type: 'RATING',
          textEn: 'How clear is the process as drawn?',
          textAr: 'ما مدى وضوح العملية كما هي مرسومة؟',
          required: true,
          weight: 1,
          options: [],
        },
        {
          id: 'matches',
          type: 'YES_NO_NA',
          textEn: 'Does it match how the work is done today?',
          textAr: 'هل تطابق طريقة العمل الحالية؟',
          required: true,
          weight: 1,
          options: [],
        },
        {
          id: 'differences',
          type: 'TEXT',
          textEn: 'What is different or missing?',
          textAr: 'ما المختلف أو الناقص؟',
          required: false,
          weight: 0,
          options: [],
          showIf: { questionId: 'matches', equals: ['NO'] },
        },
        {
          id: 'suggestions',
          type: 'TEXT',
          textEn: 'Other suggestions',
          textAr: 'اقتراحات أخرى',
          required: false,
          weight: 0,
          options: [],
        },
      ],
    },
  ],
};

export const audienceSchema = z.object({
  userIds: ids.default([]),
  roleKeys: z.array(z.enum(SYSTEM_ROLE_KEYS)).max(20).default([]),
  departmentIds: ids.default([]),
});
export type Audience = z.infer<typeof audienceSchema>;

const questionnaireFields = {
  titleEn: text(300),
  titleAr: text(300),
  descriptionEn: text(5000),
  descriptionAr: text(5000),
  purpose: z.enum(SURVEY_PURPOSES).optional(),
  definition: questionnaireDefinitionSchema.optional(),
  status: z.enum(QUESTIONNAIRE_STATUSES).optional(),
};
export const createQuestionnaireSchema = z
  .object({ ...questionnaireFields, definition: questionnaireDefinitionSchema })
  .superRefine(issueTitle);
export type CreateQuestionnaireInput = z.infer<typeof createQuestionnaireSchema>;
export const updateQuestionnaireSchema = z.object(questionnaireFields).superRefine((v, ctx) => {
  if (v.titleEn !== undefined || v.titleAr !== undefined) issueTitle(v, ctx);
});
export type UpdateQuestionnaireInput = z.infer<typeof updateQuestionnaireSchema>;

const campaignFields = {
  titleEn: text(300),
  titleAr: text(300),
  audience: audienceSchema.optional(),
  startAt: dateOnly.nullable().optional(),
  endAt: dateOnly.nullable().optional(),
  reminderDaysBefore: z.number().int().min(0).max(60).optional(),
  processId: z.guid().nullable().optional(),
  departmentId: z.guid().nullable().optional(),
};
/** The title defaults to the questionnaire's. */
export const createCampaignSchema = z.object({ ...campaignFields, questionnaireId: z.guid() });
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export const updateCampaignSchema = z.object(campaignFields);
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

/** "Request feedback" on a process: a campaign of the built-in questionnaire, launched at once. */
export const feedbackRequestSchema = z.object({
  processId: z.guid(),
  audience: audienceSchema,
  endAt: dateOnly,
  messageEn: text(1000),
  messageAr: text(1000),
});
export type FeedbackRequestInput = z.infer<typeof feedbackRequestSchema>;

export const saveAnswersSchema = z.object({
  answers: z.record(
    z.string().max(40),
    z.union([z.string().max(10000), z.number(), z.array(z.string().max(100)).max(50), z.null()]),
  ),
  submit: z.boolean().default(false),
});
export type SaveAnswersInput = z.infer<typeof saveAnswersSchema>;

export const proposalDecisionSchema = z.object({ decision: z.enum(['ACCEPT', 'DISMISS']) });
export type ProposalDecisionInput = z.infer<typeof proposalDecisionSchema>;

export interface QuestionnaireDto {
  id: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  purpose: SurveyPurpose;
  definition: QuestionnaireDefinition;
  status: QuestionnaireStatus;
  questionCount: number;
  campaignCount: number;
  updatedAt: string;
}

export interface CampaignDto {
  id: string;
  questionnaireId: string | null;
  titleEn: string;
  titleAr: string;
  purpose: SurveyPurpose;
  status: CampaignStatus;
  audience: Audience;
  audienceLabels: { users: UserRef[]; departments: DepartmentRef[] };
  startAt: string | null;
  endAt: string | null;
  reminderDaysBefore: number;
  process: IssueLinkRef | null;
  department: DepartmentRef | null;
  launchedAt: string | null;
  closedAt: string | null;
  counts: Record<ResponseProgress, number>;
  /** Submitted / sent (0–100). */
  responseRate: number;
  pendingProposals: number;
  createdAt: string;
}

export interface CampaignDetailDto extends CampaignDto {
  definition: QuestionnaireDefinition;
  responses: {
    id: string;
    user: UserRef;
    status: ResponseProgress;
    openedAt: string | null;
    submittedAt: string | null;
    score: number | null;
    maxScore: number | null;
  }[];
}

/** Aggregated answers of one question (results dashboard). */
export interface QuestionResultDto {
  questionId: string;
  type: QuestionType;
  answered: number;
  /** Option id / YES / NO / NA / rating "1"…"5" → count. */
  counts: Record<string, number>;
  average: number | null;
  texts: string[];
  files: number;
}

export interface CampaignResultsDto {
  campaignId: string;
  counts: Record<ResponseProgress, number>;
  responseRate: number;
  averageScorePercent: number | null;
  questions: QuestionResultDto[];
}

export interface SurveyProposalDto {
  id: string;
  questionId: string;
  object: GrcRef;
  field: ProposalField;
  value: string;
  /** The value in force now. */
  current: string | null;
  status: ProposalStatus;
  respondent: UserRef | null;
  createdAt: string;
}

/** The caller's own response with the questionnaire (respondent view). */
export interface MyResponseDto {
  id: string;
  campaign: Pick<
    CampaignDto,
    'id' | 'titleEn' | 'titleAr' | 'purpose' | 'status' | 'endAt' | 'process'
  > & { definition: QuestionnaireDefinition; descriptionEn: string; descriptionAr: string };
  status: ResponseProgress;
  answers: Answers;
  files: AssuranceFileDto[];
  submittedAt: string | null;
  /** Open campaign and not yet submitted. */
  canAnswer: boolean;
}

// ---------- Assurance dashboard (step 5, D-103) ----------

export const assuranceDashboardQuerySchema = z.object({
  departmentId: z.guid().optional(),
  processId: z.guid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type AssuranceDashboardQuery = z.infer<typeof assuranceDashboardQuerySchema>;

export const assuranceExportQuerySchema = assuranceDashboardQuerySchema.extend({
  locale: z.enum(['en', 'ar']).default('en'),
});

export interface TestBreakdownRow {
  id: string;
  code: string | null;
  nameEn: string;
  nameAr: string;
  done: number;
  due: number;
  overdue: number;
  /** Reviewed tests concluded effective (incl. with exceptions), percent of reviewed; null = none. */
  effectivePercent: number | null;
}

export interface AssuranceDashboardDto {
  year: number;
  tests: {
    /** Reviewed or closed in the year. */
    done: number;
    /** Open and not yet due. */
    due: number;
    overdue: number;
    awaitingReview: number;
    effectivePercent: number | null;
    byConclusion: Record<string, number>;
    byDepartment: TestBreakdownRow[];
    byProcess: TestBreakdownRow[];
  };
  issues: {
    open: number;
    overdue: number;
    bySeverity: Record<string, number>;
    byAge: Record<string, number>;
    actionsOverdue: number;
    acceptedRisks: number;
  };
  audits: {
    /** Engagements of the year per status. */
    byStatus: Record<string, number>;
    total: number;
    /** Closed or in follow-up / total, percent. */
    progressPercent: number;
    late: number;
    findingsByRating: Record<string, number>;
    findingsPendingResponse: number;
  };
  surveys: {
    campaigns: Pick<
      CampaignDto,
      'id' | 'titleEn' | 'titleAr' | 'status' | 'responseRate' | 'counts' | 'purpose'
    >[];
    /** Submitted / sent of the open and recent campaigns. */
    responseRate: number;
  };
}
