import { ONBOARDING, ONBOARDING_REFINED } from '../../../test/fixtures/ai-structures';
import { structureIssues, type ProcessStructure } from './process-structure';
import { DEFAULT_DIAGRAM_THEME } from '@processhub/shared';
import { flowLabelBounds, layoutStructure, structureToBpmn } from './structure-to-bpmn';
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

  it('keeps the role a lane is linked to (ph:roleId) when rebuilding', () => {
    const first = structureToBpmn(ONBOARDING, { key: 'a' }).replace(
      '<bpmn:lane id="Lane_HR"',
      '<bpmn:lane id="Lane_HR" ph:roleId="11111111-2222-3333-4444-555555555555"',
    );
    const read = readBpmn(first);
    expect(read.preserve.get('Lane_HR')?.roleId).toBe('11111111-2222-3333-4444-555555555555');
    const again = structureToBpmn(ONBOARDING_REFINED, { key: 'b', preserve: read.preserve });
    expect(again).toMatch(
      /<bpmn:lane id="Lane_HR"[^>]*ph:roleId="11111111-2222-3333-4444-555555555555"/,
    );
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

  /** fill/stroke (BPMN-in-Color, checked against bioc) of every coloured shape. */
  const colours = (xml: string) =>
    new Map(
      [...xml.matchAll(/<bpmndi:BPMNShape [^>]*>/g)].flatMap((m) => {
        const id = /bpmnElement="([^"]+)"/.exec(m[0])![1];
        const fill = /color:background-color="([^"]+)"/.exec(m[0])?.[1];
        const stroke = /color:border-color="([^"]+)"/.exec(m[0])?.[1];
        expect(/bioc:fill="([^"]+)"/.exec(m[0])?.[1]).toBe(fill);
        expect(/bioc:stroke="([^"]+)"/.exec(m[0])?.[1]).toBe(stroke);
        return fill || stroke ? [[id, `${fill}/${stroke}`] as const] : [];
      }),
    );

  it('colours every element with the theme (BPMN-in-Color and bioc)', () => {
    const t = DEFAULT_DIAGRAM_THEME;
    const pair = (c: { fill: string; stroke: string }) => `${c.fill}/${c.stroke}`;
    const xml = structureToBpmn(ONBOARDING, { key: 'c' });
    expect(xml).toContain('xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0"');
    const c = colours(xml);
    expect(c.get('Start')).toBe(pair(t.start));
    expect(c.get('Task_Record')).toBe(pair(t.humanTask));
    expect(c.get('Task_Accounts')).toBe(pair(t.systemTask));
    expect(c.get('Gw_Ready')).toBe(pair(t.gateway));
    expect(c.get('End')).toBe(pair(t.end));
    expect(c.get('Lane_HR')).toBe(`${t.lane.fill}/${t.lane.stroke}`);
    expect(c.get('Lane_IT')).toBe(`${t.lane.fillAlt}/${t.lane.stroke}`);
    expect(c.has('Participant_c')).toBe(false);

    const approval = structureToBpmn(
      {
        ...ONBOARDING,
        nodes: ONBOARDING.nodes.map((n) =>
          n.id === 'Task_Plan' ? { ...n, nameEn: 'Approve first-week plan' } : n,
        ),
      },
      { key: 'd', theme: { ...t, approvalTask: { fill: '#000001', stroke: '#000002' } } },
    );
    expect(colours(approval).get('Task_Plan')).toBe('#000001/#000002');
  });

  it('keeps explicit colours and the approval mark when refining; theme colours follow the type', () => {
    const first = structureToBpmn(ONBOARDING, { key: 'a' })
      .replace(
        /(bpmnElement="Task_Welcome") bioc:stroke="[^"]+" bioc:fill="[^"]+" color:background-color="[^"]+" color:border-color="[^"]+"/,
        '$1 bioc:stroke="#111111" bioc:fill="#EEEEEE" color:background-color="#EEEEEE" color:border-color="#111111"',
      )
      .replace('id="Task_Plan"', 'id="Task_Plan" ph:stepKind="approval"');
    const read = readBpmn(first);
    expect(read.preserve.get('Task_Welcome')).toMatchObject({ fill: '#EEEEEE', stroke: '#111111' });
    expect(read.preserve.get('Task_Plan')).toMatchObject({ stepKind: 'approval' });
    // The refinement turns the (theme-coloured) record step into a service task.
    const refined = {
      ...read.structure,
      nodes: read.structure.nodes.map((n) =>
        n.id === 'Task_Record' ? { ...n, type: 'serviceTask' as const } : n,
      ),
    };
    const xml = structureToBpmn(refined, { key: 'b', preserve: read.preserve });
    const c = colours(xml);
    expect(c.get('Task_Welcome')).toBe('#EEEEEE/#111111');
    expect(c.get('Task_Record')).toBe('#EEF0F2/#59636E');
    expect(c.get('Task_Plan')).toBe('#FBF3E0/#8A6D1E');
    expect(xml).toContain('id="Task_Plan" name="Prepare first-week plan"');
    expect(xml).toMatch(/id="Task_Plan"[^>]*ph:stepKind="approval"/);
  });

  it('puts the labels of gateway branches on their own branch, not on the shared trunk', () => {
    const s: ProcessStructure = {
      ...ONBOARDING,
      lanes: [],
      nodes: [
        ...ONBOARDING.nodes.filter((n) => !['Task_Plan', 'Task_Welcome', 'End'].includes(n.id)),
        ...['A', 'B', 'C'].map((k) => ({
          ...ONBOARDING.nodes.find((n) => n.id === 'Task_Plan')!,
          id: `Task_${k}`,
          nameEn: `Branch ${k}`,
        })),
        { ...ONBOARDING.nodes.find((n) => n.id === 'End')! },
      ].map((n) => ({ ...n, lane: '' })),
      flows: [
        ...ONBOARDING.flows.filter((f) => f.from !== 'Gw_Ready' && !f.from.match(/Plan|Welcome/)),
        { from: 'Gw_Ready', to: 'Task_A', nameEn: 'Small', nameAr: 'صغير' },
        { from: 'Gw_Ready', to: 'Task_B', nameEn: 'Medium', nameAr: 'متوسط' },
        { from: 'Gw_Ready', to: 'Task_C', nameEn: 'Large amount', nameAr: 'مبلغ كبير' },
        ...['A', 'B', 'C'].map((k) => ({ from: `Task_${k}`, to: 'End', nameEn: '', nameAr: '' })),
      ],
    };
    const { edges, placed } = layoutStructure(s);
    const gw = placed.get('Gw_Ready')!;
    const branches = edges.filter((e) => e.flow.from === 'Gw_Ready');
    expect(branches).toHaveLength(3);
    for (const e of branches) {
      const target = placed.get(e.flow.to)!;
      const rowY = target.y + target.h / 2;
      // Right of the gateway centre (off the trunk), just above the branch's own row.
      expect(e.label!.x).toBeGreaterThan(gw.x + gw.w / 2);
      expect(e.label!.y + e.label!.h).toBeLessThanOrEqual(rowY);
      expect(e.label!.y + e.label!.h).toBeGreaterThan(rowY - 10);
    }
    const ys = branches.map((e) => e.label!.y);
    expect(new Set(ys).size).toBe(3);
    // Unlabelled flows get no label; the XML carries BPMNLabel bounds for the others.
    expect(edges.filter((e) => !e.flow.nameEn).every((e) => !e.label)).toBe(true);
    const xml = structureToBpmn(s, { key: 'l' });
    expect(xml.match(/<bpmndi:BPMNLabel>/g)).toHaveLength(3);
  });

  it('places labels of other flows above their longest horizontal segment', () => {
    const b = flowLabelBounds(
      [
        { x: 0, y: 100 },
        { x: 0, y: 200 },
        { x: 400, y: 200 },
      ],
      'Return for correction',
      false,
    );
    expect(b.y + b.h).toBeLessThanOrEqual(200);
    expect(b.x + b.w / 2).toBeCloseTo(200, 0);
  });
});
