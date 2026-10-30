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
