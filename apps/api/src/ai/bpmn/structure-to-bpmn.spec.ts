import { ONBOARDING, ONBOARDING_REFINED } from '../../../test/fixtures/ai-structures';
import { structureIssues, type ProcessStructure } from './process-structure';
import { layoutStructure, structureToBpmn } from './structure-to-bpmn';
import { bpmnWarnings, readBpmn } from './read-bpmn';

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('structure → BPMN', () => {
  it.each([
    ['onboarding', ONBOARDING],
    ['refined', ONBOARDING_REFINED],
  ])('lays out %s without overlaps, every shape inside its lane', (_n, s) => {
    expect(structureIssues(s)).toEqual([]);
    const { placed, lanes, pool } = layoutStructure(s);
    const shapes = [...placed.values()];
    for (const [i, a] of shapes.entries())
      for (const b of shapes.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    for (const p of shapes) {
      const lane = lanes.find((l) => l.lane.id === p.node.lane)!;
      expect(p.y).toBeGreaterThanOrEqual(lane.y);
      expect(p.y + p.h).toBeLessThanOrEqual(lane.y + lane.h);
      expect(p.x + p.w).toBeLessThanOrEqual(pool.x + pool.w);
    }
    // Columns follow the flow: the start event is left of everything else.
    const start = placed.get('Start')!;
    expect(shapes.every((p) => p === start || p.x > start.x)).toBe(true);
  });

  it('round-trips through the reader and passes the shared validation rules', () => {
    const xml = structureToBpmn(ONBOARDING, { key: 't1' });
    const back = readBpmn(xml);
    expect(back.structure.lanes.map((l) => l.id)).toEqual(['Lane_HR', 'Lane_IT', 'Lane_LM']);
    expect(back.structure.nodes.find((n) => n.id === 'Task_Record')).toMatchObject({
      type: 'userTask',
      nameAr: 'إنشاء سجل الموظف',
      lane: 'Lane_HR',
    });
    expect(back.structure.flows).toHaveLength(ONBOARDING.flows.length);
    expect(bpmnWarnings(xml)).toEqual([]);
  });

  it('keeps flow ids and preserved attributes when rebuilding', () => {
    const first = readBpmn(structureToBpmn(ONBOARDING, { key: 'a' }));
    const xml = structureToBpmn(ONBOARDING_REFINED, {
      key: 'b',
      flowIds: first.flowIds,
      preserve: new Map([['Task_Welcome', { linkedProcessId: 'ignored-for-tasks' }]]),
    });
    const again = readBpmn(xml);
    expect(again.flowIds.get('Start->Task_Record')).toBe(first.flowIds.get('Start->Task_Record'));
    expect(xml).not.toContain('ignored-for-tasks');
  });

  it('escapes labels and descriptions', () => {
    const s: ProcessStructure = {
      ...ONBOARDING,
      lanes: [],
      nodes: ONBOARDING.nodes.map((n) => ({
        ...n,
        lane: '',
        nameEn: n.id === 'Task_Record' ? 'A "quoted" <b>name</b> & more' : n.nameEn,
        descriptionEn: n.id === 'Task_Record' ? 'Line 1\nLine 2' : '',
      })),
    };
    const xml = structureToBpmn(s, { key: 'x' });
    expect(xml).toContain('ph:nameEn="A &quot;quoted&quot; &lt;b&gt;name&lt;/b&gt; &amp; more"');
    expect(xml).not.toContain('<bpmn:laneSet');
    expect(readBpmn(xml).structure.nodes.find((n) => n.id === 'Task_Record')?.nameEn).toBe(
      'A "quoted" <b>name</b> & more',
    );
  });
});
