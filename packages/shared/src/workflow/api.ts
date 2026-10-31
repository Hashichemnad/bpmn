import { z } from 'zod';
import { paginationQuerySchema } from '../schemas';
import type { UserRef } from '../types';
import { workCalendarSchema } from './calendar';
import type { ExecIssue } from './check';
import type { FormSchema } from './forms';
import { APPROVAL_OUTCOMES, ESCALATION_TARGETS, type ApprovalOutcome } from './model';

// ---------- Constants ----------

export const CASE_STATUSES = ['RUNNING', 'COMPLETED', 'CANCELLED', 'WITHDRAWN'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const CASE_OUTCOMES = ['NORMAL', 'TERMINATE', 'ERROR'] as const;
export type CaseOutcome = (typeof CASE_OUTCOMES)[number];

export const WF_TASK_STATUSES = ['OPEN', 'COMPLETED', 'CANCELLED'] as const;
export type WfTaskStatus = (typeof WF_TASK_STATUSES)[number];

export const WF_JOB_KINDS = ['TIMER', 'START_TIMER', 'DOCUMENT', 'CALL', 'REMINDER'] as const;
export type WfJobKind = (typeof WF_JOB_KINDS)[number];

export const START_MODES = ['ALL', 'RESTRICTED'] as const;
export type StartMode = (typeof START_MODES)[number];

/** Timeline entry kinds (WorkflowEvent.type). */
export const CASE_EVENT_TYPES = [
  'STARTED',
  'STEP_STARTED',
  'STEP_COMPLETED',
  'STEP_CANCELLED',
  'TASK_CREATED',
  'TASK_CLAIMED',
  'TASK_UNCLAIMED',
  'TASK_COMPLETED',
  'TASK_DELEGATED',
  'TASK_REASSIGNED',
  'TASK_ESCALATED',
  'TIMER_FIRED',
  'DECISION',
  'NOTIFICATION_SENT',
  'DOCUMENT_GENERATED',
  'CHILD_STARTED',
  'INCIDENT',
  'RETRIED',
  'COMMENT',
  'FILE_ADDED',
  'WITHDRAWN',
  'CANCELLED',
  'COMPLETED',
] as const;
export type CaseEventType = (typeof CASE_EVENT_TYPES)[number];

export const WORKFLOW_ERROR_CODES = [
  'NOT_EXECUTABLE',
  'NOT_DEPLOYED',
  'NOT_PUBLISHED',
  'EXECUTABLE_CHECK_FAILED',
  'START_NOT_ALLOWED',
  'FORM_INVALID',
  'TASK_ALREADY_COMPLETED',
  'TASK_NOT_ASSIGNED',
  'TASK_CLAIMED_BY_OTHER',
  'FOUR_EYES',
  'COMMENT_REQUIRED',
  'DECISION_REQUIRED',
  'CASE_NOT_RUNNING',
  'WITHDRAW_NOT_ALLOWED',
  'CONCURRENT_UPDATE',
  'NO_INCIDENT',
] as const;

// ---------- Settings ----------

export const workflowSettingsSchema = z.object({
  calendar: workCalendarSchema.default({
    week: 'SUN_THU',
    start: '07:30',
    end: '15:30',
    timeZone: 'Asia/Dubai',
  }),
  /** Reminder this many working minutes before a task is due (0 = no reminder). */
  reminderMinutesBefore: z.number().int().min(0).max(10_080).default(240),
  /** Default escalation target of overdue tasks (a step can override it). */
  escalation: z.enum(['NONE', 'MANAGER', 'OWNER', 'BOTH']).default('MANAGER'),
  /** Escalate this many working minutes after the due time (0 = at the due time). */
  escalationDelayMinutes: z.number().int().min(0).max(10_080).default(0),
  /** Repeat the escalation every N working hours while overdue (0 = once). */
  escalationRepeatHours: z.number().int().min(0).max(720).default(0),
});
export type WorkflowSettings = z.infer<typeof workflowSettingsSchema>;
export const DEFAULT_WORKFLOW_SETTINGS: WorkflowSettings = workflowSettingsSchema.parse({});

// ---------- Process configuration ----------

const uuid = z.string().uuid();

export const workflowConfigInputSchema = z.object({
  enabled: z.boolean(),
  /** Case number prefix, e.g. "PMS" → PMS-2026-00012. */
  casePrefix: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9]{0,9}$/),
  startMode: z.enum(START_MODES).default('ALL'),
  /** System roles (keys) and departments allowed to start when RESTRICTED. */
  startRoles: z.array(z.string().max(40)).max(20).default([]),
  startDepartmentIds: z.array(uuid).max(100).default([]),
  allowWithdraw: z.boolean().default(true),
  /** Users who may monitor this process's cases (besides workflow.monitor of its department). */
  monitorUserIds: z.array(uuid).max(50).default([]),
  /** Delete form data and files of closed cases after N days (null = keep). */
  retentionDays: z.number().int().min(30).max(36_500).nullable().default(null),
  /** Live event log (Phase 5.1) fed by the cases; pseudonymise performers. */
  eventLog: z.boolean().default(true),
  pseudonymiseLog: z.boolean().default(false),
  /** Reminder this many working minutes before due (null = workflow settings). D-154. */
  reminderMinutesBefore: z.number().int().min(0).max(10_080).nullable().default(null),
  /** Escalate this many working minutes after due (null = workflow settings). D-154. */
  escalationDelayMinutes: z.number().int().min(0).max(10_080).nullable().default(null),
});
export type WorkflowConfigInput = z.infer<typeof workflowConfigInputSchema>;

export interface WorkflowDeploymentDto {
  id: string;
  versionNumber: number;
  versionLabel: string | null;
  deployedAt: string;
  deployedBy: UserRef | null;
  active: boolean;
  runningCases: number;
}

export interface WorkflowConfigDto extends WorkflowConfigInput {
  processId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  /** Latest published version (only that one can be deployed). */
  publishedVersion: number | null;
  activeDeployment: WorkflowDeploymentDto | null;
  deployments: WorkflowDeploymentDto[];
  eventLogId: string | null;
  canDesign: boolean;
  canDeploy: boolean;
}

export const checkInputSchema = z.object({
  /** Check the working model (modeler) or the published version (before deployment). */
  source: z.enum(['working', 'published']).default('working'),
  /** Optional XML from the modeler (unsaved changes). */
  xml: z
    .string()
    .max(6 * 1024 * 1024)
    .optional(),
});

export interface ExecCheckDto {
  issues: ExecIssue[];
  versionNumber: number | null;
  deployable: boolean;
}

// ---------- Catalogue and start ----------

export interface CatalogueItemDto {
  processId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  category: string;
  department: { id: string; nameEn: string; nameAr: string } | null;
  owner: UserRef | null;
  casePrefix: string;
  versionNumber: number;
  myOpenCases: number;
}

export interface StartFormDto extends CatalogueItemDto {
  form: FormSchema | null;
  /** BPMN XML of the deployed version (read-only diagram). */
  bpmnXml: string;
}

export const startCaseSchema = z.object({
  data: z.record(z.string(), z.unknown()).default({}),
  /** Files uploaded before starting (draft files of the user). */
  fileIds: z.array(uuid).max(20).default([]),
});
export type StartCaseInput = z.infer<typeof startCaseSchema>;

// ---------- Cases ----------

export const caseListQuerySchema = paginationQuerySchema.extend({
  /** mine: started by me; involved: I worked / work on it; monitor: monitor view. */
  scope: z.enum(['mine', 'involved', 'monitor']).default('mine'),
  processId: uuid.optional(),
  status: z.enum(CASE_STATUSES).optional(),
  /** Only stuck cases (incident). */
  stuck: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  q: z.string().trim().max(200).optional(),
});
export type CaseListQuery = z.infer<typeof caseListQuerySchema>;

export interface CaseSummaryDto {
  id: string;
  number: string;
  processId: string;
  processCode: string;
  processNameEn: string;
  processNameAr: string;
  titleEn: string;
  titleAr: string;
  status: CaseStatus;
  outcome: CaseOutcome | null;
  initiator: UserRef | null;
  startedAt: string;
  completedAt: string | null;
  /** Current steps (open tasks / waiting elements). */
  currentSteps: { elementId: string; nameEn: string; nameAr: string }[];
  stuck: boolean;
  overdue: boolean;
  versionNumber: number;
}

export interface CaseTaskDto {
  id: string;
  elementId: string;
  nameEn: string;
  nameAr: string;
  approval: boolean;
  status: WfTaskStatus;
  assignee: UserRef | null;
  candidates: UserRef[];
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
  completedBy: UserRef | null;
  decision: ApprovalOutcome | null;
  comment: string | null;
  /** Submitted form data with the form it was entered on (read-only once submitted). */
  form: FormSchema | null;
  data: Record<string, unknown> | null;
}

export interface CaseEventDto {
  id: string;
  type: CaseEventType;
  elementId: string | null;
  nameEn: string;
  nameAr: string;
  user: UserRef | null;
  at: string;
  data: Record<string, unknown>;
}

export interface CaseFileDto {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  kind: 'UPLOAD' | 'GENERATED';
  taskId: string | null;
  createdAt: string;
  createdBy: UserRef | null;
}

export interface CaseCommentDto {
  id: string;
  body: string;
  author: UserRef | null;
  createdAt: string;
}

export interface CaseIncidentDto {
  tokenId: string;
  elementId: string;
  nameEn: string;
  nameAr: string;
  code: string;
  message: string;
}

export interface CaseDetailDto extends CaseSummaryDto {
  bpmnXml: string;
  activeElementIds: string[];
  completedElementIds: string[];
  startForm: FormSchema | null;
  startData: Record<string, unknown> | null;
  tasks: CaseTaskDto[];
  events: CaseEventDto[];
  files: CaseFileDto[];
  comments: CaseCommentDto[];
  incidents: CaseIncidentDto[];
  parentCase: { id: string; number: string } | null;
  childCases: { id: string; number: string; status: CaseStatus }[];
  /** Form data was removed by the retention setting. */
  dataPurged: boolean;
  canWithdraw: boolean;
  canCancel: boolean;
  canRetry: boolean;
  canComment: boolean;
  canUpload: boolean;
}

export const caseReasonSchema = z.object({ reason: z.string().trim().min(1).max(2000) });
export const caseCommentSchema = z.object({ body: z.string().trim().min(1).max(5000) });

// ---------- Tasks ----------

export const taskListQuerySchema = paginationQuerySchema.extend({
  /** mine: assigned to me; group: I am a candidate (unclaimed); all: admin view. */
  scope: z.enum(['mine', 'group', 'all']).default('mine'),
  processId: uuid.optional(),
  /** overdue | soon (due within a working day) */
  due: z.enum(['overdue', 'soon']).optional(),
  q: z.string().trim().max(200).optional(),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export interface WfTaskSummaryDto {
  id: string;
  caseId: string;
  caseNumber: string;
  caseTitleEn: string;
  caseTitleAr: string;
  processId: string;
  processNameEn: string;
  processNameAr: string;
  elementId: string;
  nameEn: string;
  nameAr: string;
  approval: boolean;
  assignee: UserRef | null;
  /** Group task waiting to be claimed. */
  unclaimed: boolean;
  candidateCount: number;
  initiator: UserRef | null;
  dueAt: string | null;
  createdAt: string;
  /** Delegated or substitute (out of office) task: for whom. */
  onBehalfOf: UserRef | null;
}

export interface WfTaskDetailDto extends WfTaskSummaryDto {
  status: WfTaskStatus;
  version: number;
  form: FormSchema | null;
  /** Initial values: case variables + saved draft. */
  values: Record<string, unknown>;
  /** All case data so far (read-only context for the performer). */
  caseData: Record<string, unknown>;
  bpmnXml: string;
  canComplete: boolean;
  canClaim: boolean;
  canUnclaim: boolean;
  canDelegate: boolean;
  canReassign: boolean;
  /** Why the user cannot complete (FOUR_EYES …). */
  blockedReason: string | null;
  /** Decisions offered (approval tasks). */
  decisions: ApprovalOutcome[];
  candidates: UserRef[];
}

export const completeTaskSchema = z.object({
  data: z.record(z.string(), z.unknown()).default({}),
  decision: z.enum(APPROVAL_OUTCOMES).nullable().default(null),
  comment: z.string().trim().max(5000).default(''),
  /** Optimistic lock: the task version the user saw. */
  version: z.number().int().min(0),
});
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;

export const saveTaskSchema = z.object({ data: z.record(z.string(), z.unknown()).default({}) });

export const delegateTaskSchema = z.object({
  userId: uuid,
  comment: z.string().trim().max(2000).default(''),
});

// ---------- Out of office ----------

export const outOfOfficeSchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    substituteId: uuid.nullable(),
  })
  .refine((v) => (v.from === null) === (v.to === null), { message: 'PERIOD_INCOMPLETE' })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'PERIOD_ORDER' })
  .refine((v) => !v.from || !!v.substituteId, { message: 'SUBSTITUTE_REQUIRED' });
export type OutOfOfficeInput = z.infer<typeof outOfOfficeSchema>;
export interface OutOfOfficeDto extends OutOfOfficeInput {
  substitute: UserRef | null;
  active: boolean;
}

// ---------- Monitoring and dashboard ----------

export interface MonitorProcessDto {
  processId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  running: number;
  completed: number;
  cancelled: number;
  stuck: number;
  overdueTasks: number;
}

export interface MonitorDto {
  processes: MonitorProcessDto[];
  overdueTasks: WfTaskSummaryDto[];
  stuckCases: (CaseSummaryDto & { incidents: CaseIncidentDto[] })[];
}

export const reassignSchema = z.object({
  userId: uuid,
  comment: z.string().trim().max(2000).default(''),
});

export const dashboardQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  processId: uuid.optional(),
  /** Group the series by week or month. */
  period: z.enum(['week', 'month']).default('week'),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export interface WorkflowDashboardDto {
  from: string;
  to: string;
  started: number;
  completed: number;
  running: number;
  /** Throughput time of completed cases, working hours. */
  throughput: { mean: number | null; median: number | null; p90: number | null };
  slaCompliance: number | null;
  series: { period: string; started: number; completed: number; meanHours: number | null }[];
  steps: {
    processId: string;
    elementId: string;
    nameEn: string;
    nameAr: string;
    completed: number;
    onTime: number;
    meanHours: number | null;
    open: number;
    overdue: number;
  }[];
  workload: {
    kind: 'USER' | 'ROLE' | 'DEPARTMENT';
    id: string;
    nameEn: string;
    nameAr: string;
    open: number;
    overdue: number;
    completed: number;
  }[];
  topOverdue: WfTaskSummaryDto[];
}

export const escalationTargets = ESCALATION_TARGETS;
