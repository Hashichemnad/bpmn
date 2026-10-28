import { describe, expect, it } from 'vitest';
import { defaultShapeSize, layoutStructure, type Bounds, type LayoutInput } from './bpmn-layout';

const overlaps = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const chain = (n: number, lanes: string[]): LayoutInput => ({
  lanes: lanes.map((id) => ({ id })),
  nodes: [
    { id: 'S', type: 'bpmn:StartEvent', lane: lanes[0] ?? '' },
    ...Array.from({ length: n }, (_, i) => ({
      id: `T${i}`,
      type: i % 5 === 4 ? 'bpmn:ExclusiveGateway' : 'bpmn:UserTask',
      lane: lanes[i % Math.max(1, lanes.length)] ?? '',
    })),
    { id: 'E', type: 'bpmn:EndEvent', lane: lanes[0] ?? '' },
  ],
  flows: [
    { from: 'S', to: 'T0' },
    ...Array.from({ length: n - 1 }, (_, i) => ({ from: `T${i}`, to: `T${i + 1}` })),
    // Every gateway also skips ahead (a second branch) and one loops back.
    ...Array.from({ length: n }, (_, i) => i)
      .filter((i) => i % 5 === 4 && i + 3 < n)
      .map((i) => ({ from: `T${i}`, to: `T${i + 3}`, nameEn: 'Skip' })),
    { from: 'T9', to: 'T2', nameEn: 'Rework' },
    { from: `T${n - 1}`, to: 'E' },
  ],
});

describe('layoutStructure (shared layered layout)', () => {
  it('accepts bpmn: types and default sizes per kind', () => {
    expect(defaultShapeSize('bpmn:UserTask')).toEqual([100, 80]);
    expect(defaultShapeSize('exclusiveGateway')).toEqual([50, 50]);
    expect(defaultShapeSize('bpmn:IntermediateCatchEvent')).toEqual([36, 36]);
    const { placed } = layoutStructure(chain(6, []));
    expect(placed.get('S')!.w).toBe(36);
    expect(placed.get('T4')!.w).toBe(50);
    expect(placed.get('S')!.x).toBeLessThan(placed.get('T0')!.x);
  });

  it('places 250 nodes in 8 lanes without overlaps, inside their lanes, fast', () => {
    const lanes = Array.from({ length: 8 }, (_, i) => `L${i}`);
    const input = chain(250, lanes);
    const started = performance.now();
    const { placed, lanes: bands, edges } = layoutStructure(input);
    expect(performance.now() - started).toBeLessThan(1500);
    const shapes = [...placed.values()];
    expect(shapes).toHaveLength(252);
    for (const [i, a] of shapes.entries())
      for (const b of shapes.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    for (const p of shapes) {
      const band = bands.find((l) => l.lane.id === p.lane)!;
      expect(p.y).toBeGreaterThanOrEqual(band.y);
      expect(p.y + p.h).toBeLessThanOrEqual(band.y + band.h);
    }
    expect(edges).toHaveLength(input.flows.length);
    expect(edges.find((e) => e.flow.nameEn === 'Rework')!.label).toBeDefined();
  });

  it('grows columns and rows for large shapes (expanded sub-processes)', () => {
    const input: LayoutInput = {
      lanes: [{ id: 'A' }, { id: 'B' }],
      nodes: [
        { id: 'S', type: 'startEvent', lane: 'A' },
        { id: 'Sub', type: 'subProcess', lane: 'A', width: 400, height: 250 },
        { id: 'T', type: 'task', lane: 'B' },
        { id: 'E', type: 'endEvent', lane: 'B' },
      ],
      flows: [
        { from: 'S', to: 'Sub' },
        { from: 'Sub', to: 'T' },
        { from: 'T', to: 'E' },
      ],
    };
    const { placed, lanes } = layoutStructure(input);
    const shapes = [...placed.values()];
    for (const [i, a] of shapes.entries())
      for (const b of shapes.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    const sub = placed.get('Sub')!;
    expect(sub.w).toBe(400);
    expect(lanes[0].h).toBeGreaterThanOrEqual(250);
    expect(placed.get('T')!.x).toBeGreaterThan(sub.x + sub.w);
  });

  it('keeps nodes of an unknown lane in the first lane and ignores dangling flows', () => {
    const { placed, edges } = layoutStructure({
      lanes: [{ id: 'A' }],
      nodes: [
        { id: 'S', type: 'startEvent', lane: 'missing' },
        { id: 'E', type: 'endEvent', lane: 'A' },
      ],
      flows: [
        { from: 'S', to: 'E' },
        { from: 'S', to: 'Nowhere' },
      ],
    });
    expect(placed.get('S')!.lane).toBe('A');
    expect(edges).toHaveLength(1);
  });
});
