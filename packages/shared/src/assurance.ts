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
