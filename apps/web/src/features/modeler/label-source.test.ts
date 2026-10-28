import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_THEME, extractLabelRefs } from '@processhub/shared';
import { installSvgGeometry } from '@/test/svg-geometry';
import sample from '../../../../../docs/samples/PMS-01-Program-Request-Approval.bpmn?raw';
import type { BpmnInstance, CommandStack, ElementRegistry, Modeling } from './bpmn-types';
import { createDiagram, importDiagram } from './create-diagram';
import { bilingualModule, exportXml, normaliseDiagram, readLabels } from './diagram';
import { themeModule } from './theme';
import { translateModule } from './translate';
import {
  applyLabelSource,
  labelRefOf,
  sourceTypesFor,
  syncLabelRefMarkers,
  unlinkLabelSource,
} from './label-source';

const TERM = {
  id: '5b1d7a52-6c1e-4c7f-9a33-2f8f3d0e9a11',
  type: 'TERM' as const,
  nameEn: 'Program request',
  nameAr: 'طلب برنامج',
};
const ROLE = {
  id: '7c1d7a52-6c1e-4c7f-9a33-2f8f3d0e9a22',
  type: 'ROLE' as const,
  nameEn: 'PMO',
  nameAr: '',
};

let instance: BpmnInstance | null = null;
const state = { locale: 'en' as 'en' | 'ar' };

async function load() {
  const container = document.createElement('div');
  document.body.append(container);
  instance = createDiagram('modeler', {
    container,
    additionalModules: [
      translateModule(state),
      bilingualModule(state),
      themeModule({ theme: DEFAULT_DIAGRAM_THEME }),
    ],
  });
  await importDiagram(instance, sample);
  normaliseDiagram(instance);
  return instance;
}
const get = (m: BpmnInstance, id: string) => m.get<ElementRegistry>('elementRegistry').get(id)!;

beforeAll(() => installSvgGeometry());
afterEach(() => {
  instance?.destroy();
  instance = null;
  state.locale = 'en';
});

describe('labels from the library (dictionary)', () => {
  it('fills both languages, links the element and survives export', async () => {
    const m = await load();
    const task = get(m, 'Task_CreateRequest');
    applyLabelSource(m, task, TERM, 'en');
    expect(readLabels(task.businessObject)).toEqual({
      name: 'Program request',
      nameEn: 'Program request',
      nameAr: 'طلب برنامج',
    });
    expect(labelRefOf(task.businessObject)).toBe(TERM.id);
    const xml = await exportXml(m, 'en');
    expect(extractLabelRefs(xml).get('Task_CreateRequest')).toBe(TERM.id);
  });

  it('shows the active language and fills an empty language from the other', async () => {
    const m = await load();
    const task = get(m, 'Task_Screening');
    applyLabelSource(m, task, ROLE, 'ar');
    expect(task.businessObject.name).toBe('PMO');
    expect(task.businessObject.get('ph:nameAr')).toBe('PMO');
  });

  it('a label typed by hand removes the link (one undo restores it)', async () => {
    const m = await load();
    const task = get(m, 'Task_CreateRequest');
    applyLabelSource(m, task, TERM, 'en');
    m.get<Modeling>('modeling').updateLabel(task, 'Something else');
    expect(labelRefOf(task.businessObject)).toBeNull();
    expect(task.businessObject.get('ph:nameEn')).toBe('Something else');
    m.get<CommandStack>('commandStack').undo();
    expect(labelRefOf(task.businessObject)).toBe(TERM.id);
    unlinkLabelSource(m, task);
    expect(labelRefOf(task.businessObject)).toBeNull();
    expect(task.businessObject.get('ph:nameEn')).toBe('Program request');
  });

  it('links a lane to a role through ph:roleId (lane = role)', async () => {
    const m = await load();
    const lane = get(m, 'Lane_Admin');
    expect(sourceTypesFor(lane)).toEqual(['ROLE']);
    expect(sourceTypesFor(get(m, 'Task_CreateRequest'))).toEqual(['TERM', 'ROLE', 'SYSTEM']);
    applyLabelSource(m, lane, ROLE, 'en');
    expect(lane.businessObject.get('ph:roleId')).toBe(ROLE.id);
    expect(labelRefOf(lane.businessObject)).toBeNull();
  });

  it('marks linked elements and follows undo', async () => {
    const m = await load();
    const cleanup = syncLabelRefMarkers(m, 'From the dictionary');
    const markers = () => document.querySelectorAll('.ph-labelref-marker').length;
    expect(markers()).toBe(0);
    applyLabelSource(m, get(m, 'Task_CreateRequest'), TERM, 'en');
    expect(markers()).toBe(1);
    m.get<CommandStack>('commandStack').undo();
    m.get<CommandStack>('commandStack').undo();
    expect(markers()).toBe(0);
    cleanup();
  });
});
