import {
  parseExec,
  serializeExec,
  type ExecConfig,
  type ExecConfigInput,
} from '@processhub/shared';
import type {
  BpmnInstance,
  BusinessObject,
  DiagramElement,
  ElementRegistry,
  Modeling,
} from '@/features/modeler/bpmn-types';

/**
 * Reading and writing execution settings on bpmn-js elements (D-147): `ph:exec` JSON, standard
 * conditions, default flows, timer definitions, boundary interruption and error codes. All changes go
 * through `modeling` (undo / redo), except new `bpmn:Error` root elements.
 */
interface Moddle {
  create(type: string, attrs?: Record<string, unknown>): BusinessObject;
}

export const execOf = (bo: BusinessObject): ExecConfig =>
  parseExec(bo.get('ph:exec') as string | undefined).config;

export function writeExec(
  instance: BpmnInstance,
  el: DiagramElement,
  patch: Partial<ExecConfigInput>,
) {
  const bo = el.businessObject;
  const next = { ...execOf(bo), ...patch };
  const json = serializeExec(next);
  instance
    .get<Modeling>('modeling')
    .updateModdleProperties(el, bo, { 'ph:exec': json || undefined });
}

export const conditionOf = (bo: BusinessObject) =>
  ((bo.get('conditionExpression') as { body?: string } | undefined)?.body ?? '').trim();

export function writeCondition(instance: BpmnInstance, el: DiagramElement, body: string) {
  const moddle = instance.get<Moddle>('moddle');
  instance.get<Modeling>('modeling').updateModdleProperties(el, el.businessObject, {
    conditionExpression: body.trim()
      ? moddle.create('bpmn:FormalExpression', { body: body.trim() })
      : undefined,
  });
}

/** Source element of a sequence flow. */
export const sourceOf = (instance: BpmnInstance, flow: DiagramElement) => {
  const src = flow.businessObject.get('sourceRef') as BusinessObject | undefined;
  return src ? instance.get<ElementRegistry>('elementRegistry').get(src.id) : undefined;
};

export const isDefaultFlow = (instance: BpmnInstance, flow: DiagramElement) => {
  const src = sourceOf(instance, flow);
  return (src?.businessObject.get('default') as BusinessObject | undefined)?.id === flow.id;
};

export function setDefaultFlow(instance: BpmnInstance, flow: DiagramElement, on: boolean) {
  const src = sourceOf(instance, flow);
  if (!src) return;
  instance.get<Modeling>('modeling').updateModdleProperties(src, src.businessObject, {
    default: on ? flow.businessObject : undefined,
  });
}

export type TimerKey = 'timeDuration' | 'timeDate' | 'timeCycle';

export const eventDefinition = (bo: BusinessObject, type: string) =>
  ((bo.get('eventDefinitions') as BusinessObject[] | undefined) ?? []).find(
    (d) => d.$type === type,
  );

export function timerOf(bo: BusinessObject): { key: TimerKey; value: string } | null {
  const def = eventDefinition(bo, 'bpmn:TimerEventDefinition');
  if (!def) return null;
  for (const key of ['timeDuration', 'timeDate', 'timeCycle'] as const) {
    const v = def.get(key) as { body?: string } | undefined;
    if (v) return { key, value: v.body ?? '' };
  }
  return { key: 'timeDuration', value: '' };
}

export function writeTimer(
  instance: BpmnInstance,
  el: DiagramElement,
  key: TimerKey,
  value: string,
) {
  const def = eventDefinition(el.businessObject, 'bpmn:TimerEventDefinition');
  if (!def) return;
  const moddle = instance.get<Moddle>('moddle');
  instance.get<Modeling>('modeling').updateModdleProperties(el, def, {
    timeDuration: undefined,
    timeDate: undefined,
    timeCycle: undefined,
    [key]: moddle.create('bpmn:FormalExpression', { body: value.trim() }),
  });
}

export function errorCodeOf(bo: BusinessObject): string {
  const def = eventDefinition(bo, 'bpmn:ErrorEventDefinition');
  const ref = def?.get('errorRef') as BusinessObject | undefined;
  return ((ref?.get('errorCode') as string | undefined) ?? '').trim();
}

interface Definitions {
  get(name: 'rootElements'): BusinessObject[];
}

export function writeErrorCode(instance: BpmnInstance, el: DiagramElement, code: string) {
  const def = eventDefinition(el.businessObject, 'bpmn:ErrorEventDefinition');
  if (!def) return;
  const modeling = instance.get<Modeling>('modeling');
  const trimmed = code
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .slice(0, 60);
  if (!trimmed) return modeling.updateModdleProperties(el, def, { errorRef: undefined });
  const definitions = (instance as unknown as { getDefinitions(): Definitions }).getDefinitions();
  const roots = definitions.get('rootElements');
  let error = roots.find((r) => r.$type === 'bpmn:Error' && r.get('errorCode') === trimmed);
  if (!error) {
    error = instance.get<Moddle>('moddle').create('bpmn:Error', {
      id: `Error_${trimmed.replace(/[^A-Za-z0-9_]/g, '_')}`,
      name: trimmed,
      errorCode: trimmed,
    });
    roots.push(error);
  }
  modeling.updateModdleProperties(el, def, { errorRef: error });
}

/** Keys of all form fields and "set data" variables in the diagram (for hints and pickers). */
export function variableKeys(instance: BpmnInstance): { key: string; type: string }[] {
  const out = new Map<string, string>();
  for (const el of instance.get<ElementRegistry>('elementRegistry').getAll()) {
    if (el.type === 'label') continue;
    const cfg = execOf(el.businessObject);
    for (const f of cfg.form?.fields ?? []) if (!out.has(f.key)) out.set(f.key, f.type);
    for (const s of cfg.set) if (!out.has(s.key)) out.set(s.key, 'data');
  }
  return [...out].map(([key, type]) => ({ key, type }));
}
