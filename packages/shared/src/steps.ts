import { STEP_KIND_APPROVAL, STEP_KIND_TASK, isApprovalLabel } from './diagram-theme';

/**
 * Business step types (Modeler design B2): used by Quick Model (table entry), the "colour by step
 * type" view, reports and modeling conventions. Every BPMN flow node maps to one of them;
 * `other` covers events, parallel / inclusive gateways, sub-processes and the like.
 */
export const STEP_TYPES = [
  'task',
  'approval',
  'system',
  'notification',
  'decision',
  'end',
] as const;
export type StepType = (typeof STEP_TYPES)[number] | 'other';

export interface StepTypeInfo {
  /** BPMN type, `bpmn:UserTask` or `userTask`. */
  type: string;
  /** ph:stepKind of a user task. */
  stepKind?: string | null;
  /** English label (approval steps are recognised by it when no step kind is set). */
  nameEn?: string | null;
}

const local = (t: string) => t.replace(/^bpmn:/, '').replace(/^./, (c) => c.toUpperCase());

export function stepTypeOf(el: StepTypeInfo): StepType {
  const t = local(el.type);
  if (t === 'UserTask') {
    if (el.stepKind === STEP_KIND_APPROVAL) return 'approval';
    if (el.stepKind === STEP_KIND_TASK) return 'task';
    return isApprovalLabel(el.nameEn) ? 'approval' : 'task';
  }
  if (t === 'Task' || t === 'ManualTask') return 'task';
  if (t === 'ServiceTask' || t === 'ScriptTask' || t === 'BusinessRuleTask') return 'system';
  if (t === 'SendTask') return 'notification';
  if (t === 'ExclusiveGateway') return 'decision';
  if (t === 'EndEvent') return 'end';
  return 'other';
}

/** BPMN type (and step kind) created for a step type. */
export const STEP_TYPE_BPMN: Record<
  (typeof STEP_TYPES)[number],
  { type: string; stepKind?: string }
> = {
  task: { type: 'bpmn:Task' },
  approval: { type: 'bpmn:UserTask', stepKind: STEP_KIND_APPROVAL },
  system: { type: 'bpmn:ServiceTask' },
  notification: { type: 'bpmn:SendTask' },
  decision: { type: 'bpmn:ExclusiveGateway' },
  end: { type: 'bpmn:EndEvent' },
};
