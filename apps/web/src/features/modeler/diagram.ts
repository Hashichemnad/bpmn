import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';
import { isFlowNode, type BpmnGraphElement, type Locale } from '@processhub/shared';
import { exportName, labelAttr, normaliseLabel, pickLabel, type LabelHolder } from './labels';
import type {
  BpmnInstance,
  BusinessObject,
  DiagramElement,
  ElementRegistry,
  EventBus,
  Modeling,
} from './bpmn-types';

export interface LabelState {
  locale: Locale;
}

export function readLabels(bo: BusinessObject): LabelHolder {
  return {
    name: bo.name,
    nameEn: (bo.get('ph:nameEn') as string | undefined) ?? undefined,
    nameAr: (bo.get('ph:nameAr') as string | undefined) ?? undefined,
  };
}

export const linkedProcessOf = (bo: BusinessObject) =>
  (bo.get('ph:linkedProcessId') as string | undefined) || null;

/**
 * Keeps ph:nameEn / ph:nameAr in sync when a label is edited on the canvas:
 * the edited text is stored under the active language, in the same undoable command.
 * A label typed by hand is no longer the library object's name: the link (ph:labelRef) goes.
 */
class BilingualLabelBehavior extends CommandInterceptor {
  static override $inject = ['eventBus', 'modeling', 'phLabelState'];

  constructor(eventBus: EventBus, modeling: Modeling, state: LabelState) {
    super(eventBus as never);
    this.postExecute(
      'element.updateLabel',
      (event: { context: { element: DiagramElement; newLabel?: string } }) => {
        const { element, newLabel } = event.context;
        const target = element.labelTarget ?? element;
        const bo = target.businessObject;
        const attr = `ph:${labelAttr(state.locale)}`;
        const value = newLabel?.trim() ? newLabel : undefined;
        if ((bo.get(attr) ?? undefined) !== value)
          modeling.updateModdleProperties(target, bo, { [attr]: value });
        if (bo.get('ph:labelRef'))
          modeling.updateModdleProperties(target, bo, { 'ph:labelRef': undefined });
      },
    );
  }
}

export function bilingualModule(state: LabelState) {
  return {
    __init__: ['phBilingualLabels'],
    phLabelState: ['value', state],
    phBilingualLabels: ['type', BilingualLabelBehavior],
  };
}

function labelled(registry: ElementRegistry) {
  return registry.filter(
    (el) => el.type !== 'label' && !!el.businessObject && el.type !== 'bpmn:Process',
  );
}

/** Moves plain `name` values of imported diagrams into the bilingual attributes. */
export function normaliseDiagram(instance: BpmnInstance): void {
  for (const el of labelled(instance.get<ElementRegistry>('elementRegistry'))) {
    const patch = normaliseLabel(readLabels(el.businessObject));
    if (patch) Object.entries(patch).forEach(([k, v]) => el.businessObject.set(`ph:${k}`, v));
  }
}

/** Shows every label in `locale` (falling back to the other language) without touching the undo stack. */
export function applyLanguage(instance: BpmnInstance, locale: Locale): void {
  const eventBus = instance.get<EventBus>('eventBus');
  for (const el of labelled(instance.get<ElementRegistry>('elementRegistry'))) {
    const bo = el.businessObject;
    const labels = readLabels(bo);
    if (!labels.nameEn && !labels.nameAr) continue;
    const display = pickLabel(labels, locale);
    if (bo.name !== display) {
      bo.name = display;
      eventBus.fire('element.changed', { element: el });
      if (el.label) eventBus.fire('element.changed', { element: el.label });
    }
  }
}

/** Writes the English-first name into `name` so exported XML reads well in other tools. */
export function prepareForExport(instance: BpmnInstance): void {
  for (const el of labelled(instance.get<ElementRegistry>('elementRegistry'))) {
    const bo = el.businessObject;
    const labels = readLabels(bo);
    if (labels.nameEn || labels.nameAr) bo.name = exportName(labels);
  }
}

/** Serialises the diagram with interoperable names, then restores the display language. */
export async function exportXml(instance: BpmnInstance, locale: Locale): Promise<string> {
  prepareForExport(instance);
  try {
    const { xml } = await instance.saveXML({ format: true });
    return xml ?? '';
  } finally {
    applyLanguage(instance, locale);
  }
}

export function buildGraph(instance: BpmnInstance): BpmnGraphElement[] {
  return instance
    .get<ElementRegistry>('elementRegistry')
    .filter((el) => el.type !== 'label' && isFlowNode(el.type))
    .map((el) => {
      const bo = el.businessObject;
      return {
        id: el.id,
        type: el.type,
        name: bo.name,
        incoming: bo.incoming?.length ?? 0,
        outgoing: bo.outgoing?.length ?? 0,
        linkedProcessId: linkedProcessOf(bo),
        nested: el.parent?.type === 'bpmn:SubProcess',
      };
    });
}

const ACTIVITY =
  /^bpmn:(Task|UserTask|ServiceTask|ManualTask|ScriptTask|BusinessRuleTask|SendTask|ReceiveTask|SubProcess|CallActivity)$/;
export const isActivityElement = (el: DiagramElement) => ACTIVITY.test(el.type);
export const canDrillDown = (el: DiagramElement) =>
  el.type === 'bpmn:CallActivity' || el.type === 'bpmn:SubProcess';

/** The lane an element is placed in (its innermost lane), or null. */
export function laneOf(registry: ElementRegistry, el: DiagramElement): DiagramElement | null {
  const lanes = registry.filter((l) => {
    if (l.type !== 'bpmn:Lane') return false;
    const refs = (l.businessObject as unknown as { flowNodeRef?: unknown[] }).flowNodeRef;
    return !!refs?.includes(el.businessObject);
  });
  // Nested lanes: the innermost one has no child lanes holding the element.
  return lanes.find((l) => !lanes.some((o) => o !== l && o.parent === l)) ?? lanes[0] ?? null;
}

/** Role object (library) a lane is linked to. */
export const laneRoleOf = (lane: DiagramElement | null) =>
  (lane?.businessObject.get('ph:roleId') as string | undefined) || null;
