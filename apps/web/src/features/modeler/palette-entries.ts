import type { Locale } from '@processhub/shared';
import type { BpmnInstance, DiagramElement } from './bpmn-types';

/**
 * Entries of the ProcessHub palette (grouped, labelled, searchable). Each entry starts the same
 * bpmn-js create / tool interaction as the standard palette; ready-made steps create typed,
 * labelled elements (the theme colours them on creation).
 */
export type PaletteGroup =
  'tools' | 'events' | 'activities' | 'gateways' | 'data' | 'swimlanes' | 'ready';

export const PALETTE_GROUPS: PaletteGroup[] = [
  'ready',
  'events',
  'activities',
  'gateways',
  'data',
  'swimlanes',
  'tools',
];

export type ReadyStepKey =
  'approval' | 'managerReview' | 'systemStep' | 'notification' | 'waitingTime' | 'subProcessLink';

export interface ReadyStep {
  key: ReadyStepKey;
  type: string;
  eventDefinitionType?: string;
  stepKind?: 'approval' | 'task';
  icon: string;
}

export const READY_STEPS: ReadyStep[] = [
  { key: 'approval', type: 'bpmn:UserTask', stepKind: 'approval', icon: 'bpmn-icon-user-task' },
  {
    key: 'managerReview',
    type: 'bpmn:UserTask',
    stepKind: 'approval',
    icon: 'bpmn-icon-user-task',
  },
  { key: 'systemStep', type: 'bpmn:ServiceTask', icon: 'bpmn-icon-service-task' },
  { key: 'notification', type: 'bpmn:SendTask', icon: 'bpmn-icon-send-task' },
  {
    key: 'waitingTime',
    type: 'bpmn:IntermediateCatchEvent',
    eventDefinitionType: 'bpmn:TimerEventDefinition',
    icon: 'bpmn-icon-intermediate-event-catch-timer',
  },
  { key: 'subProcessLink', type: 'bpmn:CallActivity', icon: 'bpmn-icon-call-activity' },
];

export interface PaletteEntry {
  key: string;
  group: PaletteGroup;
  /** bpmn-font icon class. */
  icon: string;
  /** i18n key (modeler namespace) of the label. */
  labelKey: string;
  ready?: ReadyStep;
  /** Standard bpmn-js shape to create, or a tool / special action. */
  create?: { type: string; options?: Record<string, unknown> };
  special?: 'hand' | 'lasso' | 'space' | 'connect' | 'subprocess' | 'participant';
}

const shape = (
  key: string,
  group: PaletteGroup,
  type: string,
  icon: string,
  options?: Record<string, unknown>,
): PaletteEntry => ({
  key,
  group,
  icon,
  labelKey: `palette.entries.${key}`,
  create: { type, options },
});

export const PALETTE_ENTRIES: PaletteEntry[] = [
  ...READY_STEPS.map((ready) => ({
    key: ready.key,
    group: 'ready' as const,
    icon: ready.icon,
    labelKey: `palette.ready.${ready.key}.label`,
    ready,
  })),
  shape('startEvent', 'events', 'bpmn:StartEvent', 'bpmn-icon-start-event-none'),
  shape(
    'intermediateEvent',
    'events',
    'bpmn:IntermediateThrowEvent',
    'bpmn-icon-intermediate-event-none',
  ),
  shape(
    'timerEvent',
    'events',
    'bpmn:IntermediateCatchEvent',
    'bpmn-icon-intermediate-event-catch-timer',
    {
      eventDefinitionType: 'bpmn:TimerEventDefinition',
    },
  ),
  shape(
    'messageEvent',
    'events',
    'bpmn:IntermediateCatchEvent',
    'bpmn-icon-intermediate-event-catch-message',
    {
      eventDefinitionType: 'bpmn:MessageEventDefinition',
    },
  ),
  shape('endEvent', 'events', 'bpmn:EndEvent', 'bpmn-icon-end-event-none'),
  shape('task', 'activities', 'bpmn:Task', 'bpmn-icon-task'),
  shape('userTask', 'activities', 'bpmn:UserTask', 'bpmn-icon-user-task'),
  shape('serviceTask', 'activities', 'bpmn:ServiceTask', 'bpmn-icon-service-task'),
  shape('manualTask', 'activities', 'bpmn:ManualTask', 'bpmn-icon-manual-task'),
  shape('callActivity', 'activities', 'bpmn:CallActivity', 'bpmn-icon-call-activity'),
  {
    key: 'subProcess',
    group: 'activities',
    icon: 'bpmn-icon-subprocess-expanded',
    labelKey: 'palette.entries.subProcess',
    special: 'subprocess',
  },
  shape('exclusiveGateway', 'gateways', 'bpmn:ExclusiveGateway', 'bpmn-icon-gateway-xor'),
  shape('parallelGateway', 'gateways', 'bpmn:ParallelGateway', 'bpmn-icon-gateway-parallel'),
  shape('inclusiveGateway', 'gateways', 'bpmn:InclusiveGateway', 'bpmn-icon-gateway-or'),
  shape('eventGateway', 'gateways', 'bpmn:EventBasedGateway', 'bpmn-icon-gateway-eventbased'),
  shape('dataObject', 'data', 'bpmn:DataObjectReference', 'bpmn-icon-data-object'),
  shape('dataStore', 'data', 'bpmn:DataStoreReference', 'bpmn-icon-data-store'),
  shape('annotation', 'data', 'bpmn:TextAnnotation', 'bpmn-icon-text-annotation'),
  shape('group', 'data', 'bpmn:Group', 'bpmn-icon-group'),
  {
    key: 'participant',
    group: 'swimlanes',
    icon: 'bpmn-icon-participant',
    labelKey: 'palette.entries.participant',
    special: 'participant',
  },
  {
    key: 'hand',
    group: 'tools',
    icon: 'bpmn-icon-hand-tool',
    labelKey: 'palette.entries.hand',
    special: 'hand',
  },
  {
    key: 'lasso',
    group: 'tools',
    icon: 'bpmn-icon-lasso-tool',
    labelKey: 'palette.entries.lasso',
    special: 'lasso',
  },
  {
    key: 'space',
    group: 'tools',
    icon: 'bpmn-icon-space-tool',
    labelKey: 'palette.entries.space',
    special: 'space',
  },
  {
    key: 'connect',
    group: 'tools',
    icon: 'bpmn-icon-connection-multi',
    labelKey: 'palette.entries.connect',
    special: 'connect',
  },
];

/** Entries whose label (active language) or English label contains the query. */
export function filterEntries(
  entries: PaletteEntry[],
  query: string,
  label: (e: PaletteEntry) => string,
  englishLabel: (e: PaletteEntry) => string,
): PaletteEntry[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return entries;
  return entries.filter(
    (e) =>
      label(e).toLocaleLowerCase().includes(q) || englishLabel(e).toLocaleLowerCase().includes(q),
  );
}

interface ElementFactory {
  createShape(attrs: Record<string, unknown>): DiagramElement;
  createParticipantShape(): DiagramElement;
}
interface Create {
  start(event: Event, elements: DiagramElement | DiagramElement[], context?: unknown): void;
}

/** Element of a ready-made step with both labels set (the shown one in `locale`). */
export function createReadyShape(
  instance: BpmnInstance,
  step: ReadyStep,
  names: { en: string; ar: string },
  locale: Locale,
): DiagramElement {
  const shapeEl = instance.get<ElementFactory>('elementFactory').createShape({
    type: step.type,
    ...(step.eventDefinitionType ? { eventDefinitionType: step.eventDefinitionType } : {}),
  });
  const bo = shapeEl.businessObject;
  bo.set('ph:nameEn', names.en);
  bo.set('ph:nameAr', names.ar);
  bo.name = locale === 'ar' ? names.ar || names.en : names.en || names.ar;
  if (step.stepKind) bo.set('ph:stepKind', step.stepKind);
  return shapeEl;
}

/** Starts the interaction of an entry (create by click or drag, or activate a tool). */
export function startEntry(
  instance: BpmnInstance,
  entry: PaletteEntry,
  event: Event,
  readyNames: (step: ReadyStep) => { en: string; ar: string },
  locale: Locale,
): DiagramElement | null {
  const factory = instance.get<ElementFactory>('elementFactory');
  const create = instance.get<Create>('create');
  if (entry.ready) {
    const el = createReadyShape(instance, entry.ready, readyNames(entry.ready), locale);
    create.start(event, el);
    return el;
  }
  if (entry.create) {
    const el = factory.createShape({ type: entry.create.type, ...entry.create.options });
    create.start(event, el);
    return el;
  }
  switch (entry.special) {
    case 'hand':
      instance.get<{ activateHand(e: Event): void }>('handTool').activateHand(event);
      break;
    case 'lasso':
      instance.get<{ activateSelection(e: Event): void }>('lassoTool').activateSelection(event);
      break;
    case 'space':
      instance.get<{ activateSelection(e: Event): void }>('spaceTool').activateSelection(event);
      break;
    case 'connect':
      instance.get<{ start(e: Event): void }>('globalConnect').start(event);
      break;
    case 'participant':
      create.start(event, factory.createParticipantShape());
      break;
    case 'subprocess': {
      const sub = factory.createShape({ type: 'bpmn:SubProcess', x: 0, y: 0, isExpanded: true });
      const start = factory.createShape({ type: 'bpmn:StartEvent', x: 40, y: 82, parent: sub });
      create.start(event, [sub, start], { hints: { autoSelect: [sub] } });
      break;
    }
  }
  return null;
}
