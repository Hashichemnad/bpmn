import type { LabelSourceType, Locale } from '@processhub/shared';
import type {
  BpmnInstance,
  BusinessObject,
  DiagramElement,
  ElementRegistry,
  EventBus,
  Modeling,
  Overlays,
} from './bpmn-types';
import { pickLabel } from './labels';

/**
 * Labels from the library (Dictionary, Modeler design B2, D-083): a label chosen in the
 * autocomplete fills both languages and links the element to the object with `ph:labelRef`
 * (lanes: `ph:roleId`, the lane–role link of D-079). The API turns the reference into an object
 * link on save; renaming the object can update every linked label.
 */
export interface LabelSource {
  id: string;
  type: LabelSourceType;
  nameEn: string;
  nameAr: string;
}

export const labelRefOf = (bo: BusinessObject | undefined) =>
  ((bo?.get('ph:labelRef') as string | undefined) || null) ?? null;

/** Object types the autocomplete offers for an element: lanes are roles. */
export function sourceTypesFor(element: DiagramElement): LabelSourceType[] {
  if (element.type === 'bpmn:Lane') return ['ROLE'];
  if (element.type === 'bpmn:SequenceFlow' || element.type === 'bpmn:Participant') return ['TERM'];
  return ['TERM', 'ROLE', 'SYSTEM'];
}

/** Sets both labels from the object and links the element to it (undoable edits). */
export function applyLabelSource(
  instance: BpmnInstance,
  element: DiagramElement,
  source: LabelSource,
  locale: Locale,
): void {
  const modeling = instance.get<Modeling>('modeling');
  const bo = element.businessObject;
  const names = {
    nameEn: source.nameEn || source.nameAr,
    nameAr: source.nameAr || source.nameEn,
  };
  const display = pickLabel(names, locale);
  // The visible label first (this drops an older reference), then both names and the link.
  if ((bo.name ?? '') !== display) modeling.updateLabel(element, display || null);
  const link =
    element.type === 'bpmn:Lane' && source.type === 'ROLE'
      ? { 'ph:roleId': source.id }
      : { 'ph:labelRef': source.id };
  modeling.updateModdleProperties(element, bo, {
    'ph:nameEn': names.nameEn,
    'ph:nameAr': names.nameAr,
    ...link,
  });
}

/** Removes the link; the label text stays. */
export function unlinkLabelSource(instance: BpmnInstance, element: DiagramElement): void {
  instance
    .get<Modeling>('modeling')
    .updateModdleProperties(element, element.businessObject, { 'ph:labelRef': undefined });
}

const MARKER_TYPE = 'ph-labelref';
const BOOK_ICON =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M3 2.5A1.5 1.5 0 0 1 4.5 1H13v11H4.5a.5.5 0 0 0 0 1H13v1H4.5A1.5 1.5 0 0 1 3 12.5zM5 3v1h6V3zm0 2v1h4V5z"/></svg>';

/**
 * Small book marker at the top inline-start corner of every element whose label comes from the
 * library. Kept in sync with edits and undo; returns a cleanup function.
 */
export function syncLabelRefMarkers(instance: BpmnInstance, title: string): () => void {
  const overlays = instance.get<Overlays>('overlays');
  const registry = instance.get<ElementRegistry>('elementRegistry');
  const eventBus = instance.get<EventBus>('eventBus');
  const draw = () => {
    overlays.remove({ type: MARKER_TYPE });
    for (const el of registry.filter((e) => e.type !== 'label' && !!labelRefOf(e.businessObject))) {
      const html = document.createElement('span');
      html.className = 'ph-labelref-marker';
      html.title = title;
      html.setAttribute('role', 'img');
      html.setAttribute('aria-label', title);
      html.innerHTML = BOOK_ICON;
      overlays.add(el, MARKER_TYPE, { position: { top: -7, left: -7 }, html });
    }
  };
  draw();
  eventBus.on('commandStack.changed', draw);
  eventBus.on('import.done', draw);
  return () => {
    eventBus.off('commandStack.changed', draw);
    eventBus.off('import.done', draw);
    overlays.remove({ type: MARKER_TYPE });
  };
}
