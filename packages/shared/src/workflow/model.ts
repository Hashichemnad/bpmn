import { z } from 'zod';
import { formSchema, type FormSchema } from './forms';
import { childEl, childEls, parseXmlTree, type XmlEl } from './xml-tree';

/**
 * Execution settings stored in the BPMN XML (D-147) and the workflow model the engine runs on.
 * Standard BPMN: conditions (`conditionExpression`, S-FEEL), default flows, timer definitions, error /
 * terminate end events, boundary events. ProcessHub: one `ph:exec` JSON attribute per element.
 */

// ---------- Execution settings (ph:exec) ----------

export const ASSIGNMENT_TYPES = [
  /** Users holding the job role linked to the task's lane (`ph:roleId`). */
  'LANE_ROLE',
  /** Users holding a job role (library ROLE), optionally only in the initiator's / a given department. */
  'ROLE',
  'USER',
  'PROCESS_OWNER',
  'INITIATOR',
  /** Head (`Department.managerId`) of the initiator's department. */
  'INITIATOR_MANAGER',
  /** Whoever completed an earlier step. */
  'PREVIOUS_PERFORMER',
  /** A user chosen in a form field (`user` field). */
  'FORM_FIELD',
] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

const uuid = z.string().uuid();

export const assignmentSchema = z.object({
  type: z.enum(ASSIGNMENT_TYPES),
  /** ROLE: library role id. */
  roleId: uuid.nullable().default(null),
  /** ROLE / LANE_ROLE: ANY department, the INITIATOR's, or a SPECIFIC one. */
  department: z.enum(['ANY', 'INITIATOR', 'SPECIFIC']).default('ANY'),
  departmentId: uuid.nullable().default(null),
  /** USER */
  userId: uuid.nullable().default(null),
  /** PREVIOUS_PERFORMER: element id of the earlier step. */
  elementId: z.string().max(200).nullable().default(null),
  /** FORM_FIELD: key of a `user` field. */
  fieldKey: z.string().max(60).nullable().default(null),
});
export type Assignment = z.infer<typeof assignmentSchema>;
export type AssignmentInput = z.input<typeof assignmentSchema>;

export const APPROVAL_OUTCOMES = ['APPROVE', 'REJECT', 'RETURN'] as const;
export type ApprovalOutcome = (typeof APPROVAL_OUTCOMES)[number];

export const ESCALATION_TARGETS = ['DEFAULT', 'NONE', 'MANAGER', 'OWNER', 'BOTH'] as const;
export type EscalationTarget = (typeof ESCALATION_TARGETS)[number];

export const SERVICE_KINDS = ['SET_DATA', 'GENERATE_DOCUMENT'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

const tpl = (max: number) => z.string().max(max).default('');

export const notificationTemplateSchema = z.object({
  recipients: z.array(assignmentSchema).max(10).default([]),
  subjectEn: tpl(300),
  subjectAr: tpl(300),
  bodyEn: tpl(5000),
  bodyAr: tpl(5000),
  /** Also send an e-mail (subject to each user's notification preferences). */
  email: z.boolean().default(true),
});
export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;

export const documentTemplateSchema = z.object({
  fileNameEn: z.string().trim().max(120).default('document'),
  fileNameAr: z.string().trim().max(120).default(''),
  /** Language of the generated Word document: the initiator's, English or Arabic. */
  language: z.enum(['INITIATOR', 'en', 'ar']).default('INITIATOR'),
  titleEn: tpl(300),
  titleAr: tpl(300),
  /** Paragraphs with {{field}} placeholders (plain text; one paragraph per line). */
  bodyEn: tpl(20_000),
  bodyAr: tpl(20_000),
  /** Append a table with all form data of the case. */
  includeData: z.boolean().default(true),
});
export type DocumentTemplate = z.infer<typeof documentTemplateSchema>;

export const execConfigSchema = z.object({
  /** User task / approval task / none start event. */
  form: formSchema.nullable().default(null),
  assignment: assignmentSchema.nullable().default(null),
  /** Working minutes until due; null = the step attribute `ph:slaMinutes`. */
  dueMinutes: z.number().int().min(1).max(525_600).nullable().default(null),
  /** Four-eyes: the initiator and earlier performers of this case cannot complete the task. */
  fourEyes: z.boolean().default(false),
  escalation: z.enum(ESCALATION_TARGETS).default('DEFAULT'),
  /** Sequence flow out of an approval task: the decision that takes it. */
  outcome: z.enum(APPROVAL_OUTCOMES).nullable().default(null),
  /** Send task. */
  notify: notificationTemplateSchema.nullable().default(null),
  /** Service task. */
  kind: z.enum(SERVICE_KINDS).nullable().default(null),
  set: z
    .array(
      z.object({
        key: z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]{0,59}$/)
          .refine((k) => !['__proto__', 'constructor', 'prototype'].includes(k), 'RESERVED_KEY'),
        expression: z.string().max(2000),
      }),
    )
    .max(30)
    .default([]),
  document: documentTemplateSchema.nullable().default(null),
  /** Timer events: count the duration in working time (business calendar). */
  workingTime: z.boolean().default(false),
});
export type ExecConfig = z.infer<typeof execConfigSchema>;
export type ExecConfigInput = z.input<typeof execConfigSchema>;

export const EMPTY_EXEC: ExecConfig = execConfigSchema.parse({});

/** Compact JSON for `ph:exec`: only values that differ from the defaults. */
export function serializeExec(cfg: ExecConfigInput): string {
  const full = execConfigSchema.parse(cfg);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(full)) {
    const d = (EMPTY_EXEC as Record<string, unknown>)[k];
    if (JSON.stringify(v) !== JSON.stringify(d)) out[k] = v;
  }
  return Object.keys(out).length ? JSON.stringify(out) : '';
}

export function parseExec(raw: string | undefined | null): {
  config: ExecConfig;
  error: string | null;
} {
  if (!raw || !raw.trim()) return { config: EMPTY_EXEC, error: null };
  try {
    const r = execConfigSchema.safeParse(JSON.parse(raw));
    if (r.success) return { config: r.data, error: null };
    return {
      config: EMPTY_EXEC,
      error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  } catch (e) {
    return { config: EMPTY_EXEC, error: (e as Error).message };
  }
}

// ---------- Timers (ISO 8601) ----------

const DUR =
  /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** ISO 8601 duration → minutes (months = 30 days, years = 365 days); null when invalid. */
export function parseIsoDurationMinutes(s: string): number | null {
  const m = DUR.exec(s.trim());
  if (!m || s.trim() === 'P' || s.trim().endsWith('T')) return null;
  const [y, mo, w, d, h, mi, se] = m.slice(1).map((x) => (x ? Number(x) : 0));
  const total = y * 525_600 + mo * 43_200 + w * 10_080 + d * 1440 + h * 60 + mi + se / 60;
  return total > 0 ? total : null;
}

export type TimerKind = 'duration' | 'date' | 'cycle';
export interface TimerDef {
  kind: TimerKind;
  value: string;
}

/** Parsed `R[n]/[start/]duration` cycle. */
export function parseCycle(
  s: string,
): { repeat: number | null; start: Date | null; minutes: number } | null {
  const parts = s.trim().split('/');
  if (parts.length < 2 || !/^R\d*$/.test(parts[0])) return null;
  const repeat = parts[0].length > 1 ? Number(parts[0].slice(1)) : null;
  let start: Date | null = null;
  let dur = parts[1];
  if (parts.length === 3) {
    const t = Date.parse(parts[1]);
    if (Number.isNaN(t)) return null;
    start = new Date(t);
    dur = parts[2];
  }
  const minutes = parseIsoDurationMinutes(dur);
  if (minutes === null) return null;
  return { repeat, start, minutes };
}

/**
 * Timer limits (final session part B, SEC-29): a timer start event or a non-interrupting boundary
 * timer with `R/PT1S` would start cases or send notifications on every scheduler run without end.
 */
export const MIN_TIMER_DURATION_MINUTES = 1;
export const MIN_TIMER_CYCLE_MINUTES = 5;
export const MAX_TIMER_REPEAT = 1000;

export function timerError(t: TimerDef | null): string | null {
  if (!t || !t.value.trim()) return 'MISSING';
  if (t.kind === 'duration') {
    const minutes = parseIsoDurationMinutes(t.value);
    if (minutes === null) return 'INVALID';
    return minutes < MIN_TIMER_DURATION_MINUTES ? 'TOO_SHORT' : null;
  }
  if (t.kind === 'date') return Number.isNaN(Date.parse(t.value)) ? 'INVALID' : null;
  const c = parseCycle(t.value);
  if (!c) return 'INVALID';
  if (c.minutes < MIN_TIMER_CYCLE_MINUTES) return 'TOO_SHORT';
  return c.repeat !== null && c.repeat > MAX_TIMER_REPEAT ? 'TOO_MANY' : null;
}

// ---------- Workflow model ----------

export type EventKind = 'none' | 'timer' | 'error' | 'terminate' | 'other';

export interface WfNode {
  id: string;
  /** Local BPMN type: `userTask`, `exclusiveGateway`, `endEvent` … */
  type: string;
  name: string;
  nameEn: string;
  nameAr: string;
  laneId: string | null;
  /** Library role of the lane (`ph:roleId`). */
  laneRoleId: string | null;
  incoming: string[];
  outgoing: string[];
  defaultFlow: string | null;
  eventKind: EventKind | null;
  /** Names of unsupported event definitions (message, signal …). */
  eventDefinition: string | null;
  timer: TimerDef | null;
  errorCode: string | null;
  attachedTo: string | null;
  cancelActivity: boolean;
  stepKind: string | null;
  linkedProcessId: string | null;
  decisionRef: string | null;
  decisionId: string | null;
  slaMinutes: number | null;
  exec: ExecConfig;
  execError: string | null;
  /** Parent element id when nested in a sub-process. */
  parentId: string | null;
}

export interface WfFlow {
  id: string;
  from: string;
  to: string;
  name: string;
  nameEn: string;
  nameAr: string;
  condition: string | null;
  exec: ExecConfig;
  execError: string | null;
}

export interface WorkflowModel {
  processElementId: string;
  /** Number of `bpmn:process` elements with flow nodes (only one is executable). */
  processCount: number;
  nodes: Record<string, WfNode>;
  flows: Record<string, WfFlow>;
  /** Node ids in document order. */
  order: string[];
  boundaries: Record<string, string[]>;
}

const FLOW_NODE_TYPES = new Set([
  'startEvent',
  'endEvent',
  'intermediateCatchEvent',
  'intermediateThrowEvent',
  'boundaryEvent',
  'task',
  'userTask',
  'manualTask',
  'serviceTask',
  'sendTask',
  'receiveTask',
  'scriptTask',
  'businessRuleTask',
  'callActivity',
  'subProcess',
  'transaction',
  'adHocSubProcess',
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
  'eventBasedGateway',
  'complexGateway',
]);

const ph = (el: XmlEl, k: string) => el.attrs[`ph:${k}`];

/** True when the element is an approval step (`ph:stepKind="approval"`). */
export const isApprovalNode = (n: Pick<WfNode, 'type' | 'stepKind'>) =>
  n.type === 'userTask' && n.stepKind === 'approval';

export const nodeLabel = (
  n: Pick<WfNode, 'nameEn' | 'nameAr' | 'name' | 'id'>,
  locale: string,
): string => (locale === 'ar' ? n.nameAr || n.nameEn : n.nameEn || n.nameAr) || n.name || n.id;

export function readWorkflowModel(xml: string): WorkflowModel {
  const root = parseXmlTree(xml);
  const defs = root.children.find((c) => c.local === 'definitions');
  const errorCodes = new Map<string, string>();
  const processes = defs ? childEls(defs, 'process') : [];
  if (defs)
    for (const e of childEls(defs, 'error'))
      errorCodes.set(e.attrs.id ?? '', e.attrs.errorCode ?? e.attrs.name ?? '');
  const withNodes = processes.filter((p) => p.children.some((c) => FLOW_NODE_TYPES.has(c.local)));
  const proc = withNodes[0] ?? processes[0];
  const model: WorkflowModel = {
    processElementId: proc?.attrs.id ?? '',
    processCount: withNodes.length,
    nodes: {},
    flows: {},
    order: [],
    boundaries: {},
  };
  if (!proc) return model;

  const laneOf = new Map<string, { id: string; roleId: string | null }>();
  // Nested lanes: the innermost lane wins (child lane sets are read after their parent lane).
  const readLaneSet = (set: XmlEl) => {
    for (const lane of childEls(set, 'lane')) {
      for (const ref of childEls(lane, 'flowNodeRef'))
        laneOf.set(ref.text.trim(), {
          id: lane.attrs.id ?? '',
          roleId: ph(lane, 'roleId') || null,
        });
      const child = childEl(lane, 'childLaneSet');
      if (child) readLaneSet(child);
    }
  };
  for (const set of childEls(proc, 'laneSet')) readLaneSet(set);

  const walk = (container: XmlEl, parentId: string | null) => {
    for (const el of container.children) {
      if (el.local === 'sequenceFlow') {
        const id = el.attrs.id ?? '';
        const cond = childEl(el, 'conditionExpression');
        const { config, error } = parseExec(ph(el, 'exec'));
        model.flows[id] = {
          id,
          from: el.attrs.sourceRef ?? '',
          to: el.attrs.targetRef ?? '',
          name: el.attrs.name ?? '',
          nameEn: ph(el, 'nameEn') ?? '',
          nameAr: ph(el, 'nameAr') ?? '',
          condition: cond && cond.text.trim() ? cond.text.trim() : null,
          exec: config,
          execError: error,
        };
        continue;
      }
      if (!FLOW_NODE_TYPES.has(el.local)) continue;
      const id = el.attrs.id ?? '';
      let eventKind: EventKind | null = null;
      let eventDefinition: string | null = null;
      let timer: TimerDef | null = null;
      let errorCode: string | null = null;
      if (el.local.endsWith('Event')) {
        const defsOf = el.children.filter((c) => c.local.endsWith('EventDefinition'));
        if (!defsOf.length) eventKind = 'none';
        else if (defsOf.length > 1) {
          eventKind = 'other';
          eventDefinition = 'multiple';
        } else {
          const d = defsOf[0];
          if (d.local === 'timerEventDefinition') {
            eventKind = 'timer';
            const kind = (['timeDuration', 'timeDate', 'timeCycle'] as const).find((k) =>
              childEl(d, k),
            );
            timer = kind
              ? {
                  kind:
                    kind === 'timeDuration' ? 'duration' : kind === 'timeDate' ? 'date' : 'cycle',
                  value: childEl(d, kind)!.text.trim(),
                }
              : null;
          } else if (d.local === 'errorEventDefinition') {
            eventKind = 'error';
            const ref = d.attrs.errorRef;
            errorCode = ref ? (errorCodes.get(ref) ?? ref) || null : null;
          } else if (d.local === 'terminateEventDefinition') eventKind = 'terminate';
          else {
            eventKind = 'other';
            eventDefinition = d.local.replace('EventDefinition', '');
          }
        }
      }
      const { config, error } = parseExec(ph(el, 'exec'));
      const sla = Number(ph(el, 'slaMinutes'));
      const lane = laneOf.get(id);
      model.nodes[id] = {
        id,
        type: el.local,
        name: el.attrs.name ?? '',
        nameEn: ph(el, 'nameEn') ?? '',
        nameAr: ph(el, 'nameAr') ?? '',
        laneId: lane?.id ?? null,
        laneRoleId: lane?.roleId ?? null,
        incoming: [],
        outgoing: [],
        defaultFlow: el.attrs.default ?? null,
        eventKind,
        eventDefinition,
        timer,
        errorCode,
        attachedTo: el.attrs.attachedToRef ?? null,
        cancelActivity: el.attrs.cancelActivity !== 'false',
        stepKind: ph(el, 'stepKind') ?? null,
        linkedProcessId: ph(el, 'linkedProcessId') || null,
        decisionRef: ph(el, 'decisionRef') || null,
        decisionId: ph(el, 'decisionId') || null,
        slaMinutes: Number.isFinite(sla) && sla > 0 ? sla : null,
        exec: config,
        execError: error,
        parentId,
      };
      model.order.push(id);
      if (['subProcess', 'transaction', 'adHocSubProcess'].includes(el.local)) walk(el, id);
    }
  };
  walk(proc, null);
  for (const f of Object.values(model.flows)) {
    model.nodes[f.from]?.outgoing.push(f.id);
    model.nodes[f.to]?.incoming.push(f.id);
  }
  for (const n of Object.values(model.nodes))
    if (n.type === 'boundaryEvent' && n.attachedTo)
      (model.boundaries[n.attachedTo] ??= []).push(n.id);
  return model;
}

/** Form of a start event / task (null when none). */
export const nodeForm = (n: WfNode | undefined): FormSchema | null => n?.exec.form ?? null;

/** The none start event cases begin at (the first in document order). */
export function noneStart(model: WorkflowModel): WfNode | null {
  return (
    model.order
      .map((id) => model.nodes[id])
      .find((n) => n.type === 'startEvent' && n.eventKind === 'none' && !n.parentId) ?? null
  );
}

export function timerStarts(model: WorkflowModel): WfNode[] {
  return model.order
    .map((id) => model.nodes[id])
    .filter((n) => n.type === 'startEvent' && n.eventKind === 'timer' && !n.parentId);
}

/** Steps people work on (user and approval tasks) in document order. */
export const userTaskNodes = (model: WorkflowModel) =>
  model.order.map((id) => model.nodes[id]).filter((n) => n.type === 'userTask');
