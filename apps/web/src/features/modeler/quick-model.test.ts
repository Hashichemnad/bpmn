import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_THEME } from '@processhub/shared';
import { installSvgGeometry } from '@/test/svg-geometry';
import sample from '../../../../../docs/samples/PMS-01-Program-Request-Approval.bpmn?raw';
import type { BpmnInstance, CommandStack, DiagramElement, ElementRegistry } from './bpmn-types';
import { autoLayoutModule } from './auto-layout';
import { createDiagram, importDiagram } from './create-diagram';
import { bilingualModule, exportXml, laneOf, normaliseDiagram, readLabels } from './diagram';
import { EMPTY_DIAGRAM } from './phModdle';
import { themeModule } from './theme';
import { translateModule } from './translate';
import {
  applyRows,
  diagramToRows,
  emptyRow,
  parseTsv,
  quickModelModule,
  rowsFromPaste,
  validateRows,
  type QuickRow,
  type TypeLabels,
} from './quick-model';

let instance: BpmnInstance | null = null;
const state = { locale: 'en' as const };

async function load(xml: string) {
  const container = document.createElement('div');
  document.body.append(container);
  instance = createDiagram('modeler', {
    container,
    additionalModules: [
      translateModule(state),
      bilingualModule(state),
      themeModule({ theme: DEFAULT_DIAGRAM_THEME }),
      autoLayoutModule,
      quickModelModule,
    ],
  });
  await importDiagram(instance, xml);
  normaliseDiagram(instance);
  return instance;
}

const registry = (m: BpmnInstance) => m.get<ElementRegistry>('elementRegistry');
const flows = (m: BpmnInstance) =>
  registry(m)
    .filter((e) => e.type === 'bpmn:SequenceFlow')
    .map((e) => {
      const c = e as DiagramElement & { source: DiagramElement; target: DiagramElement };
      return `${c.source.id}->${c.target.id}`;
    })
    .sort();
const ids = (m: BpmnInstance) =>
  registry(m)
    .getAll()
    .map((e) => e.id)
    .sort();

beforeAll(() => installSvgGeometry());
afterEach(() => {
  instance?.destroy();
  instance = null;
});

describe('Quick Model: diagram → table', () => {
  it('reads PMS-01 as one row per step in flow order', async () => {
    const m = await load(sample);
    const rows = diagramToRows(m, (id) => (id === 'Task_CreateRequest' ? 'sys-1' : null));
    expect(rows[0]).toMatchObject({
      key: 'Task_CreateRequest',
      type: 'task',
      systemId: 'sys-1',
      role: { nameEn: 'Requester (Employee)', nameAr: 'مقدم الطلب (الموظف)' },
    });
    expect(rows[0].nameAr).not.toBe('');
    const decision = rows.find((r) => r.type === 'decision' && r.next.length === 2)!;
    expect(decision.next.every((n) => rows.some((r) => r.key === n.target))).toBe(true);
    expect(rows.some((r) => r.type === 'approval')).toBe(true);
    expect(rows.some((r) => r.type === 'end')).toBe(true);
    expect(rows.some((r) => r.key.startsWith('Start_'))).toBe(false);
    expect(validateRows(rows).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('writing the unchanged table back keeps every id, flow and label', async () => {
    const m = await load(sample);
    const before = { ids: ids(m), flows: flows(m) };
    const labelsBefore = registry(m)
      .filter((e) => e.type !== 'label')
      .map((e) => [e.id, readLabels(e.businessObject)]);
    applyRows(m, diagramToRows(m), 'en');
    expect(ids(m)).toEqual(before.ids);
    expect(flows(m)).toEqual(before.flows);
    expect(
      registry(m)
        .filter((e) => e.type !== 'label')
        .map((e) => [e.id, readLabels(e.businessObject)]),
    ).toEqual(labelsBefore);
  });
});

describe('Quick Model: table → diagram', () => {
  const rows = (): QuickRow[] => {
    const a = { ...emptyRow(), nameEn: 'Submit request', nameAr: 'تقديم الطلب' };
    const b = { ...emptyRow(), nameEn: 'Approve request', nameAr: 'اعتماد الطلب' };
    const c = { ...emptyRow(), nameEn: 'Approved?', nameAr: 'معتمد؟' };
    const d = { ...emptyRow(), nameEn: 'Record in PMS', nameAr: 'تسجيل في النظام' };
    const e = { ...emptyRow(), nameEn: 'Done', nameAr: 'تم' };
    const f = { ...emptyRow(), nameEn: 'Rejected', nameAr: 'مرفوض' };
    const requester = { id: null, nameEn: 'Requester', nameAr: 'مقدم الطلب' };
    const manager = {
      id: '5b1d7a52-6c1e-4c7f-9a33-2f8f3d0e9a11',
      nameEn: 'Manager',
      nameAr: 'المدير',
    };
    Object.assign(a, { role: requester, next: [{ target: b.key, labelEn: '', labelAr: '' }] });
    Object.assign(b, {
      role: manager,
      type: 'approval',
      next: [{ target: c.key, labelEn: '', labelAr: '' }],
    });
    Object.assign(c, {
      role: manager,
      type: 'decision',
      next: [
        { target: d.key, labelEn: 'Yes', labelAr: 'نعم' },
        { target: f.key, labelEn: 'No', labelAr: 'لا' },
      ],
    });
    Object.assign(d, {
      role: requester,
      type: 'system',
      next: [{ target: e.key, labelEn: '', labelAr: '' }],
    });
    Object.assign(e, { role: requester, type: 'end' });
    Object.assign(f, { role: manager, type: 'end' });
    return [a, b, c, d, e, f];
  };

  it('builds pool, lanes from roles, typed steps, labelled flows and a start event', async () => {
    const m = await load(EMPTY_DIAGRAM);
    const table = rows();
    expect(validateRows(table)).toEqual([]);
    const map = applyRows(m, table, 'en');
    const reg = registry(m);
    const lanes = reg.filter((e) => e.type === 'bpmn:Lane');
    expect(lanes.map((l) => readLabels(l.businessObject).nameEn).sort()).toEqual([
      'Manager',
      'Requester',
    ]);
    const managerLane = lanes.find((l) => readLabels(l.businessObject).nameEn === 'Manager')!;
    expect(managerLane.businessObject.get('ph:roleId')).toBe(table[1].role!.id);
    const el = (i: number) => reg.get(map.get(table[i].key)!)!;
    expect(el(1).type).toBe('bpmn:UserTask');
    expect(el(1).businessObject.get('ph:stepKind')).toBe('approval');
    expect(el(2).type).toBe('bpmn:ExclusiveGateway');
    expect(el(3).type).toBe('bpmn:ServiceTask');
    expect(el(4).type).toBe('bpmn:EndEvent');
    expect(laneOf(reg, el(1))).toBe(managerLane);
    expect(laneOf(reg, el(3))).not.toBe(managerLane);
    expect(el(0).businessObject.get('ph:nameAr')).toBe('تقديم الطلب');
    const yes = reg.filter(
      (e) => e.type === 'bpmn:SequenceFlow' && readLabels(e.businessObject).nameEn === 'Yes',
    );
    expect(yes).toHaveLength(1);
    expect(readLabels(yes[0].businessObject).nameAr).toBe('نعم');
    // The start event (from the empty diagram) leads to the first step.
    expect(flows(m)).toContain(`StartEvent_1->${map.get(table[0].key)}`);
    const xml = await exportXml(m, 'en');
    expect(xml).toContain('bpmn:laneSet');

    // One undo step restores the empty diagram.
    m.get<CommandStack>('commandStack').undo();
    expect(reg.filter((e) => e.type === 'bpmn:Lane')).toHaveLength(0);
    expect(reg.get(map.get(table[0].key)!)).toBeUndefined();
    expect(reg.get('StartEvent_1')).toBeDefined();
  });

  it('edits keep ids: rename, type change, removed and added steps, rewired flows', async () => {
    const m = await load(EMPTY_DIAGRAM);
    const map = applyRows(m, rows(), 'en');
    let table = diagramToRows(m);
    const reg = registry(m);
    const submit = table.find((r) => r.nameEn === 'Submit request')!;
    const record = table.find((r) => r.nameEn === 'Record in PMS')!;
    const done = table.find((r) => r.nameEn === 'Done')!;
    expect([...map.values()]).toContain(submit.key);
    // Rename, make "Record" a notification, insert a new step before "Done", drop "Rejected".
    submit.nameEn = 'Submit program request';
    record.type = 'notification';
    const added: QuickRow = {
      ...emptyRow(),
      nameEn: 'Archive file',
      nameAr: 'أرشفة الملف',
      role: submit.role,
      next: [{ target: done.key, labelEn: '', labelAr: '' }],
    };
    record.next = [{ target: added.key, labelEn: '', labelAr: '' }];
    const decision = table.find((r) => r.type === 'decision')!;
    const rejected = table.find((r) => r.nameEn === 'Rejected')!;
    decision.next = decision.next.filter((n) => n.target !== rejected.key);
    table = [...table.filter((r) => r !== rejected), added];
    const ids2 = applyRows(m, table, 'en');
    expect(reg.get(submit.key)?.businessObject.get('ph:nameEn')).toBe('Submit program request');
    expect(reg.get(record.key)?.type).toBe('bpmn:SendTask');
    expect(reg.get(rejected.key)).toBeUndefined();
    const addedId = ids2.get(added.key)!;
    expect(reg.get(addedId)?.type).toBe('bpmn:Task');
    expect(flows(m)).toEqual(
      expect.arrayContaining([`${record.key}->${addedId}`, `${addedId}->${done.key}`]),
    );
    expect(flows(m)).not.toContain(`${record.key}->${done.key}`);
    // Reading back gives the same table (ids of new rows resolved).
    const again = diagramToRows(m);
    expect(again.map((r) => r.key).sort()).toEqual(
      table.map((r) => ids2.get(r.key) ?? r.key).sort(),
    );
  });
});

describe('Quick Model: paste from Excel and validation', () => {
  const typeLabels: TypeLabels = {
    task: ['Task', 'مهمة'],
    approval: ['Approval', 'اعتماد'],
    system: ['System', 'نظام'],
    notification: ['Notification', 'إشعار'],
    decision: ['Decision', 'قرار'],
    end: ['End', 'نهاية'],
  };
  const lookup = {
    roles: [{ id: 'r1', nameEn: 'Program Manager', nameAr: 'مدير البرنامج' }],
    systems: [{ id: 's1', nameEn: 'Salesforce PMS', nameAr: 'نظام سيلزفورس' }],
    typeLabels,
  };

  it('parses tab-separated text with quoted cells', () => {
    expect(parseTsv('a\tb\n"c\td"\t"e ""x"""\r\n\n')).toEqual([
      ['a', 'b'],
      ['c\td', 'e "x"'],
    ]);
  });

  it('reads rows with roles, systems, types, next steps and conditions', () => {
    const text = [
      'Step\tStep (AR)\tPerformed by\tIT system\tType\tNext\tConditions',
      'Create request\tإنشاء الطلب\tprogram manager\tSalesforce PMS\tTask\t2',
      'Approved?\tمعتمد؟\tمدير البرنامج\t\tقرار\t3; Rejected\tYes; No',
      'Notify requester\t\tPMO Office\tSAP\tNotification\t',
      'Rejected\tمرفوض\t\t\tEnd\t',
    ].join('\n');
    const r = rowsFromPaste(text, lookup);
    expect(r.rows).toHaveLength(4);
    expect(r.rows[0]).toMatchObject({
      nameEn: 'Create request',
      nameAr: 'إنشاء الطلب',
      role: { id: 'r1' },
      systemId: 's1',
      type: 'task',
    });
    expect(r.rows[0].next.map((n) => n.target)).toEqual([r.rows[1].key]);
    expect(r.rows[1].type).toBe('decision');
    expect(r.rows[1].role?.id).toBe('r1');
    expect(r.rows[1].next).toEqual([
      { target: r.rows[2].key, labelEn: 'Yes', labelAr: '' },
      { target: r.rows[3].key, labelEn: 'No', labelAr: '' },
    ]);
    expect(r.rows[2].role).toEqual({ id: null, nameEn: 'PMO Office', nameAr: '' });
    expect(r.rows[2].type).toBe('notification');
    expect(r.unknownSystems).toEqual(['SAP']);
    expect(r.rows[3].type).toBe('end');
  });

  it('links pasted names in row order when there is no next-step column', () => {
    const r = rowsFromPaste('طلب جديد\nمراجعة\nاعتماد', lookup);
    expect(r.rows.map((x) => x.nameAr)).toEqual(['طلب جديد', 'مراجعة', 'اعتماد']);
    expect(r.rows[0].next[0].target).toBe(r.rows[1].key);
    expect(r.rows[2].next).toEqual([]);
  });

  it('reports blocking errors and warnings per row', () => {
    const a = { ...emptyRow(), nameEn: 'A' };
    const b = { ...emptyRow(), type: 'decision' as const, nameEn: 'B?' };
    const c = { ...emptyRow(), type: 'end' as const };
    a.next = [
      { target: 'missing', labelEn: '', labelAr: '' },
      { target: a.key, labelEn: '', labelAr: '' },
    ];
    b.next = [{ target: c.key, labelEn: '', labelAr: '' }];
    const d = { ...emptyRow() };
    expect(validateRows([a, b, c, d])).toEqual([
      { code: 'UNKNOWN_NEXT', severity: 'error', row: 1 },
      { code: 'SELF_LOOP', severity: 'error', row: 1 },
      { code: 'DECISION_ONE_WAY', severity: 'warning', row: 2 },
      { code: 'NAME_MISSING', severity: 'error', row: 4 },
      { code: 'NO_NEXT', severity: 'warning', row: 4 },
    ]);
    expect(validateRows([])).toEqual([{ code: 'EMPTY', severity: 'error' }]);
  });
});
