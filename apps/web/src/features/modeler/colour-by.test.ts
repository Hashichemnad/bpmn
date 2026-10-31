import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_THEME, parseBpmnGraph } from '@processhub/shared';
import { installSvgGeometry } from '@/test/svg-geometry';
import sample from '../../../../../docs/samples/PMS-01-Program-Request-Approval.bpmn?raw';
import type { BpmnInstance, ElementRegistry, Modeling } from './bpmn-types';
import { createDiagram, importDiagram } from './create-diagram';
import { bilingualModule, exportXml, normaliseDiagram } from './diagram';
import { themeModule } from './theme';
import { translateModule } from './translate';
import { applyColourBy, clearColourBy, planColourBy, type ColourByContext } from './colour-by';

let instance: BpmnInstance | null = null;
const state = { locale: 'en' as const };
beforeAll(() => installSvgGeometry());
afterEach(() => {
  instance?.destroy();
  instance = null;
});

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

const ctx = (links: ColourByContext['links'] = []): ColourByContext => ({
  links,
  locale: 'en',
  label: (k) => k,
});
const reg = (m: BpmnInstance) => m.get<ElementRegistry>('elementRegistry');

describe('colour by', () => {
  it('groups steps by lane role and dims what is not a step', async () => {
    const m = await load();
    const plan = planColourBy(reg(m), 'role', ctx());
    const requester = plan.legend.find((l) => l.label === 'Requester (Employee)')!;
    expect(requester.count).toBeGreaterThan(3);
    expect(plan.legend.every((l) => l.fill && l.stroke)).toBe(true);
    expect(plan.classes.get('Task_CreateRequest')).toMatch(/^ph-cb-c\d+$/);
    const gateway = reg(m).filter((e) => e.type === 'bpmn:ExclusiveGateway')[0];
    expect(plan.classes.get(gateway.id)).toBe('ph-cb-dim');
  });

  it('colours by IT system from SUPPORTS links, the rest "none"', async () => {
    const m = await load();
    const plan = planColourBy(
      reg(m),
      'system',
      ctx([
        {
          bpmnElementId: 'Task_CreateRequest',
          relation: 'SUPPORTS',
          repoObject: { id: 's1', type: 'SYSTEM', code: null, nameEn: 'Salesforce', nameAr: '' },
        },
      ]),
    );
    expect(plan.legend[0]).toMatchObject({ key: 'system:s1', label: 'Salesforce', count: 1 });
    expect(plan.legend[plan.legend.length - 1].key).toBe('none');
  });

  it('application lifecycle: the step with a phasing-out system stands out', async () => {
    const m = await load();
    const link = (bpmnElementId: string, id: string) => ({
      bpmnElementId,
      relation: 'SUPPORTS' as const,
      repoObject: { id, type: 'SYSTEM' as const, code: null, nameEn: id, nameAr: '' },
    });
    const plan = planColourBy(reg(m), 'appLifecycle', {
      ...ctx([
        link('Task_CreateRequest', 'erp'),
        link('Task_CreateRequest', 'crm'),
        link('Task_Screening', 'crm'),
      ]),
      lifecycles: new Map([
        ['erp', 'PHASING_OUT'],
        ['crm', 'ACTIVE'],
      ]),
    });
    expect(plan.legend.find((l) => l.key === 'lifecycle:PHASING_OUT')?.count).toBe(1);
    expect(plan.legend.find((l) => l.key === 'lifecycle:ACTIVE')?.count).toBe(1);
    expect(plan.colours.get('Task_CreateRequest')).toEqual({ fill: '#FFEDD5', stroke: '#C2410C' });
    expect(plan.legend[plan.legend.length - 1].key).toBe('none');
  });

  it('step type, duration bands and missing information', async () => {
    const m = await load();
    const types = planColourBy(reg(m), 'type', ctx()).legend.map((l) => l.key);
    expect(types).toEqual(
      expect.arrayContaining(['type:task', 'type:approval', 'type:decision', 'type:end']),
    );
    const task = reg(m).get('Task_CreateRequest')!;
    m.get<Modeling>('modeling').updateModdleProperties(task, task.businessObject, {
      'ph:durationMinutes': '90',
    });
    const durations = planColourBy(reg(m), 'duration', ctx()).legend;
    expect(durations.find((l) => l.key === 'duration:medium')?.count).toBe(1);
    // PMS-01 steps have descriptions and lanes: all complete; remove one description.
    m.get<Modeling>('modeling').updateModdleProperties(task, task.businessObject, {
      'ph:descriptionEn': undefined,
      'ph:descriptionAr': undefined,
    });
    const missing = planColourBy(reg(m), 'missing', ctx());
    expect(missing.missing.get('Task_CreateRequest')).toEqual(['description']);
    expect(
      missing.legend.find((l) => l.key === 'missing:incomplete')?.count,
    ).toBeGreaterThanOrEqual(1);
  });

  it('is view only: markers and a stylesheet, removed again; the XML keeps its colours', async () => {
    const m = await load();
    const before = await exportXml(m, 'en');
    applyColourBy(m, 'type', ctx());
    expect(document.getElementById('ph-colour-by-style')).not.toBeNull();
    expect(document.querySelectorAll('[class*="ph-cb-c"]').length).toBeGreaterThan(10);
    expect(await exportXml(m, 'en')).toBe(before);
    clearColourBy(m);
    expect(document.getElementById('ph-colour-by-style')).toBeNull();
    expect(document.querySelectorAll('[class*="ph-cb-"]').length).toBe(0);
  });
});

describe('step attributes in the XML', () => {
  it('round-trip through the modeler and the shared reader', async () => {
    const m = await load();
    const task = reg(m).get('Task_Screening')!;
    m.get<Modeling>('modeling').updateModdleProperties(task, task.businessObject, {
      'ph:durationMinutes': '120',
      'ph:waitingMinutes': '1440',
      'ph:frequencyPerMonth': '25',
      'ph:costPerExecution': '35.5',
      'ph:slaMinutes': '2880',
      'ph:inputsAr': 'نموذج الطلب',
    });
    const node = parseBpmnGraph(await exportXml(m, 'en')).nodes.find(
      (n) => n.id === 'Task_Screening',
    )!;
    expect(node.attributes).toEqual({
      durationMinutes: 120,
      waitingMinutes: 1440,
      frequencyPerMonth: 25,
      costPerExecution: 35.5,
      slaMinutes: 2880,
      inputsAr: 'نموذج الطلب',
    });
    expect(node.attributeIssues).toEqual([]);
  });
});
