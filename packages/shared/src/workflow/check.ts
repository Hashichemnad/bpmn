import { feelSyntaxError } from './feel';
import { inputFields, type FormSchema } from './forms';
import { isApprovalNode, noneStart, timerError, type WfNode, type WorkflowModel } from './model';

/**
 * Executable check (phase 5.2 step 1): blocking errors and warnings shown in the modeler's Validation
 * panel and enforced when a version is deployed. Codes are translated in the web client
 * (`workflow.json` → `check.<code>`); `detail` carries names / messages.
 */
export const EXEC_ISSUE_CODES = [
  'NO_PROCESS',
  'MULTIPLE_POOLS',
  'NO_START',
  'MULTIPLE_NONE_STARTS',
  'UNSUPPORTED_ELEMENT',
  'UNSUPPORTED_EVENT',
  'SUBPROCESS',
  'EXEC_INVALID',
  'NO_INCOMING',
  'NO_OUTGOING',
  'NO_ASSIGNMENT',
  'ASSIGNMENT_INCOMPLETE',
  'FORM_EMPTY',
  'APPROVAL_NO_APPROVE_PATH',
  'APPROVAL_RETURN_UNMAPPED',
  'OUTCOME_NOT_APPROVAL',
  'CONDITION_MISSING',
  'CONDITION_SYNTAX',
  'CONDITION_IGNORED',
  'DEFAULT_ON_PARALLEL',
  'NO_DECISION',
  'DECISION_NOT_FOUND',
  'DECISION_INVALID',
  'DECISION_NOT_APPROVED',
  'NO_LINKED_PROCESS',
  'LINKED_NOT_EXECUTABLE',
  'LINKED_SELF',
  'SERVICE_KIND_MISSING',
  'SET_DATA_EMPTY',
  'SET_DATA_SYNTAX',
  'DOCUMENT_TEMPLATE_MISSING',
  'NOTIFY_RECIPIENTS_MISSING',
  'NOTIFY_TEXT_MISSING',
  'TIMER_MISSING',
  'TIMER_INVALID',
  'TIMER_TOO_SHORT',
  'TIMER_TOO_MANY',
  'TIMER_CYCLE_INTERMEDIATE',
  'BOUNDARY_HOST',
  'BOUNDARY_EVENT_KIND',
  'ERROR_END_NO_CODE',
  'FIELD_REF_UNKNOWN',
  'PREVIOUS_STEP_UNKNOWN',
  'NO_DUE_TIME',
  'NO_END',
] as const;
export type ExecIssueCode = (typeof EXEC_ISSUE_CODES)[number];

export interface ExecIssue {
  code: ExecIssueCode;
  severity: 'error' | 'warning';
  elementId: string | null;
  detail?: string;
}

const SUPPORTED = new Set([
  'startEvent',
  'endEvent',
  'intermediateCatchEvent',
  'intermediateThrowEvent',
  'boundaryEvent',
  'userTask',
  'serviceTask',
  'sendTask',
  'businessRuleTask',
  'callActivity',
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
]);

/** Element types and the localisation key of what to use instead. */
export const UNSUPPORTED_HINTS: Record<string, string> = {
  task: 'userTask',
  manualTask: 'userTask',
  receiveTask: 'userTask',
  scriptTask: 'serviceTask',
  eventBasedGateway: 'exclusiveGateway',
  complexGateway: 'inclusiveGateway',
};

/** Keys every form before a step provides (start form + all task forms): for reference checks. */
function allFormKeys(model: WorkflowModel): Set<string> {
  const keys = new Set<string>();
  for (const n of Object.values(model.nodes)) {
    const f: FormSchema | null = n.exec.form;
    if (f) for (const x of f.fields) keys.add(x.key);
    for (const s of n.exec.set) keys.add(s.key);
  }
  return keys;
}

export function checkExecutable(model: WorkflowModel): ExecIssue[] {
  const issues: ExecIssue[] = [];
  const add = (
    code: ExecIssueCode,
    elementId: string | null,
    severity: 'error' | 'warning' = 'error',
    detail?: string,
  ) => issues.push({ code, severity, elementId, ...(detail ? { detail } : {}) });

  const nodes = model.order.map((id) => model.nodes[id]);
  if (!nodes.length) {
    add('NO_PROCESS', null);
    return issues;
  }
  if (model.processCount > 1) add('MULTIPLE_POOLS', null);
  const starts = nodes.filter((n) => n.type === 'startEvent' && !n.parentId);
  const none = starts.filter((n) => n.eventKind === 'none');
  if (!noneStart(model)) add('NO_START', null);
  if (none.length > 1) for (const n of none.slice(1)) add('MULTIPLE_NONE_STARTS', n.id);
  if (!nodes.some((n) => n.type === 'endEvent')) add('NO_END', null, 'warning');

  const keys = allFormKeys(model);
  const userTaskIds = new Set(nodes.filter((n) => n.type === 'userTask').map((n) => n.id));

  for (const n of nodes) {
    if (n.parentId) continue; // reported on the sub-process itself
    if (n.execError) add('EXEC_INVALID', n.id, 'error', n.execError);
    if (['subProcess', 'transaction', 'adHocSubProcess'].includes(n.type)) {
      add('SUBPROCESS', n.id);
      continue;
    }
    if (!SUPPORTED.has(n.type)) {
      add('UNSUPPORTED_ELEMENT', n.id, 'error', UNSUPPORTED_HINTS[n.type] ?? n.type);
      continue;
    }
    if (n.eventKind === 'other') {
      add('UNSUPPORTED_EVENT', n.id, 'error', n.eventDefinition ?? '');
      continue;
    }
    checkConnections(n, add);
    checkEvent(n, model, add);
    switch (n.type) {
      case 'startEvent':
        if (n.exec.form && !inputFields(n.exec.form).length) add('FORM_EMPTY', n.id, 'warning');
        break;
      case 'userTask':
        checkAssignment(n, keys, userTaskIds, add);
        if (n.exec.dueMinutes === null && n.slaMinutes === null)
          add('NO_DUE_TIME', n.id, 'warning');
        if (isApprovalNode(n)) checkApproval(n, model, add);
        break;
      case 'businessRuleTask':
        if (!n.decisionRef || !n.decisionId) add('NO_DECISION', n.id);
        break;
      case 'callActivity':
        if (!n.linkedProcessId) add('NO_LINKED_PROCESS', n.id);
        break;
      case 'sendTask': {
        const t = n.exec.notify;
        if (!t || !t.recipients.length) add('NOTIFY_RECIPIENTS_MISSING', n.id);
        else for (const r of t.recipients) checkAssignmentFields(n, r, keys, userTaskIds, add);
        if (!t || !(t.subjectEn || t.subjectAr) || !(t.bodyEn || t.bodyAr))
          add('NOTIFY_TEXT_MISSING', n.id);
        break;
      }
      case 'serviceTask':
        if (!n.exec.kind) add('SERVICE_KIND_MISSING', n.id);
        else if (n.exec.kind === 'SET_DATA') {
          if (!n.exec.set.length) add('SET_DATA_EMPTY', n.id);
          for (const s of n.exec.set) {
            const err = feelSyntaxError(s.expression);
            if (err) add('SET_DATA_SYNTAX', n.id, 'error', `${s.key}: ${err}`);
          }
        } else if (n.exec.kind === 'GENERATE_DOCUMENT') {
          const d = n.exec.document;
          if (!d || !(d.bodyEn || d.bodyAr || d.includeData))
            add('DOCUMENT_TEMPLATE_MISSING', n.id);
        }
        break;
      case 'exclusiveGateway':
      case 'inclusiveGateway':
        if (n.outgoing.length > 1)
          for (const fid of n.outgoing) {
            const f = model.flows[fid];
            if (!f || fid === n.defaultFlow) continue;
            if (!f.condition) add('CONDITION_MISSING', fid, 'error', n.id);
          }
        break;
      case 'parallelGateway':
        if (n.defaultFlow) add('DEFAULT_ON_PARALLEL', n.id, 'warning');
        for (const fid of n.outgoing)
          if (model.flows[fid]?.condition) add('CONDITION_IGNORED', fid, 'warning');
        break;
    }
  }
  for (const f of Object.values(model.flows)) {
    if (f.execError) add('EXEC_INVALID', f.id, 'error', f.execError);
    if (f.condition) {
      const err = feelSyntaxError(f.condition);
      if (err) add('CONDITION_SYNTAX', f.id, 'error', err);
    }
    if (f.exec.outcome) {
      const src = model.nodes[f.from];
      if (src && !isApprovalNode(src)) add('OUTCOME_NOT_APPROVAL', f.id, 'warning');
    }
  }
  return issues;
}

type Add = (
  code: ExecIssueCode,
  id: string | null,
  sev?: 'error' | 'warning',
  detail?: string,
) => void;

function checkConnections(n: WfNode, add: Add) {
  const isStart = n.type === 'startEvent' || n.type === 'boundaryEvent';
  if (!isStart && !n.incoming.length) add('NO_INCOMING', n.id);
  if (n.type !== 'endEvent' && !n.outgoing.length) add('NO_OUTGOING', n.id, 'warning');
}

function checkEvent(n: WfNode, model: WorkflowModel, add: Add) {
  if (n.eventKind === 'timer') {
    if (n.type === 'endEvent' || n.type === 'intermediateThrowEvent')
      return add('UNSUPPORTED_EVENT', n.id, 'error', 'timer');
    const err = timerError(n.timer);
    if (err === 'MISSING') add('TIMER_MISSING', n.id);
    else if (err === 'TOO_SHORT') add('TIMER_TOO_SHORT', n.id, 'error', n.timer?.value);
    else if (err === 'TOO_MANY') add('TIMER_TOO_MANY', n.id, 'error', n.timer?.value);
    else if (err) add('TIMER_INVALID', n.id, 'error', n.timer?.value);
    if (n.type === 'intermediateCatchEvent' && n.timer?.kind === 'cycle')
      add('TIMER_CYCLE_INTERMEDIATE', n.id);
  }
  if (n.eventKind === 'error') {
    if (!['endEvent', 'boundaryEvent'].includes(n.type))
      add('UNSUPPORTED_EVENT', n.id, 'error', 'error');
    if (n.type === 'endEvent' && !n.errorCode) add('ERROR_END_NO_CODE', n.id, 'warning');
  }
  if (n.eventKind === 'terminate' && n.type !== 'endEvent')
    add('UNSUPPORTED_EVENT', n.id, 'error', 'terminate');
  if (n.type === 'startEvent' && n.eventKind === 'error')
    add('UNSUPPORTED_EVENT', n.id, 'error', 'error');
  if (n.type === 'boundaryEvent') {
    const host = n.attachedTo ? model.nodes[n.attachedTo] : undefined;
    if (n.eventKind !== 'timer' && n.eventKind !== 'error') add('BOUNDARY_EVENT_KIND', n.id);
    else if (
      !host ||
      (n.eventKind === 'timer' &&
        !['userTask', 'callActivity', 'serviceTask'].includes(host.type)) ||
      (n.eventKind === 'error' &&
        !['userTask', 'callActivity', 'serviceTask', 'businessRuleTask'].includes(host.type))
    )
      add('BOUNDARY_HOST', n.id);
  }
  if (n.type === 'intermediateCatchEvent' && n.eventKind === 'none')
    add('UNSUPPORTED_EVENT', n.id, 'error', 'none');
}

function checkAssignment(n: WfNode, keys: Set<string>, tasks: Set<string>, add: Add) {
  const a = n.exec.assignment;
  if (!a) {
    if (!n.laneRoleId) add('NO_ASSIGNMENT', n.id);
    return;
  }
  if (a.type === 'LANE_ROLE' && !n.laneRoleId)
    add('ASSIGNMENT_INCOMPLETE', n.id, 'error', 'LANE_ROLE');
  checkAssignmentFields(n, a, keys, tasks, add);
}

function checkAssignmentFields(
  n: WfNode,
  a: NonNullable<WfNode['exec']['assignment']>,
  keys: Set<string>,
  tasks: Set<string>,
  add: Add,
) {
  if (a.type === 'ROLE' && !a.roleId) add('ASSIGNMENT_INCOMPLETE', n.id, 'error', 'ROLE');
  if (
    (a.type === 'ROLE' || a.type === 'LANE_ROLE') &&
    a.department === 'SPECIFIC' &&
    !a.departmentId
  )
    add('ASSIGNMENT_INCOMPLETE', n.id, 'error', 'DEPARTMENT');
  if (a.type === 'USER' && !a.userId) add('ASSIGNMENT_INCOMPLETE', n.id, 'error', 'USER');
  if (a.type === 'FORM_FIELD') {
    if (!a.fieldKey) add('ASSIGNMENT_INCOMPLETE', n.id, 'error', 'FORM_FIELD');
    else if (!keys.has(a.fieldKey)) add('FIELD_REF_UNKNOWN', n.id, 'error', a.fieldKey);
  }
  if (a.type === 'PREVIOUS_PERFORMER') {
    if (!a.elementId) add('ASSIGNMENT_INCOMPLETE', n.id, 'error', 'PREVIOUS_PERFORMER');
    else if (!tasks.has(a.elementId)) add('PREVIOUS_STEP_UNKNOWN', n.id, 'error', a.elementId);
  }
}

function checkApproval(n: WfNode, model: WorkflowModel, add: Add) {
  const flows = n.outgoing.map((f) => model.flows[f]).filter(Boolean);
  const marked = flows.filter((f) => f.exec.outcome);
  if (!marked.length) {
    // The decision is read by a gateway after the task (`decision = "APPROVE"`).
    if (flows.length > 1) add('APPROVAL_NO_APPROVE_PATH', n.id);
    return;
  }
  const unmarked = flows.filter((f) => !f.exec.outcome);
  if (!marked.some((f) => f.exec.outcome === 'APPROVE') && !unmarked.length)
    add('APPROVAL_NO_APPROVE_PATH', n.id);
  if (!marked.some((f) => f.exec.outcome === 'RETURN') && !unmarked.length)
    add('APPROVAL_RETURN_UNMAPPED', n.id, 'warning');
}

/** Blocking errors only. */
export const blockingExecIssues = (issues: ExecIssue[]) =>
  issues.filter((i) => i.severity === 'error');
