import { describe, expect, it } from 'vitest';
import {
  analyseLog,
  applyFilters,
  buildLogData,
  durationStats,
  heuristicsMiner,
  logFromTraces,
  netToStructure,
  quantile,
  variantId,
} from '../index';

const t = (h: number) => Date.UTC(2026, 0, 1, h);

/** L1 of van der Aalst, "Process Mining" (2016), §6: [⟨a,b,c,d⟩³, ⟨a,c,b,d⟩², ⟨a,e,d⟩]. */
const L1 = logFromTraces([
  { trace: ['a', 'b', 'c', 'd'], count: 3 },
  { trace: ['a', 'c', 'b', 'd'], count: 2 },
  ['a', 'e', 'd'],
]);

const edge = (r: ReturnType<typeof analyseLog>, from: string, to: string) =>
  r.map.edges.find((e) => e.from === from && e.to === to);

describe('directly-follows graph and variants', () => {
  it('counts the directly-follows relation of L1', () => {
    const r = analyseLog(L1);
    expect(r.cases).toBe(6);
    expect(r.events).toBe(23);
    const counts = Object.fromEntries(r.map.edges.map((e) => [`${e.from}>${e.to}`, e.count]));
    expect(counts).toEqual({
      '▶>a': 6,
      'a>b': 3,
      'a>c': 2,
      'a>e': 1,
      'b>c': 3,
      'c>b': 2,
      'b>d': 2,
      'c>d': 3,
      'e>d': 1,
      'd>■': 6,
    });
    expect(r.map.nodes.find((n) => n.activity === 'd')).toMatchObject({
      events: 6,
      cases: 6,
      ends: 6,
    });
    expect(r.variants.total).toBe(3);
    expect(r.variants.items.map((v) => [v.activities.join(''), v.count])).toEqual([
      ['abcd', 3],
      ['acbd', 2],
      ['aed', 1],
    ]);
    expect(r.variants.items[0].share).toBeCloseTo(0.5);
    expect(r.variants.items[0].id).toBe(variantId(['a', 'b', 'c', 'd']));
  });

  it('projects out infrequent activities with the activity slider', () => {
    // e is the least frequent: a → d appears instead of a → e → d.
    const r = analyseLog(L1, { activityLevel: 0.8 });
    expect(r.map.nodes.map((n) => n.activity).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(edge(r, 'a', 'd')?.count).toBe(1);
  });

  it('measures edge, processing and waiting times, throughput and bottlenecks', () => {
    const log = buildLogData([
      { caseId: '1', activity: 'A', start: t(0), end: t(1), resource: 'ann', department: 'X' },
      { caseId: '1', activity: 'B', start: t(3), end: t(4), resource: 'bob', department: 'Y' },
      { caseId: '2', activity: 'A', start: t(10), end: t(12), resource: 'ann', department: 'X' },
      { caseId: '2', activity: 'B', start: t(18), end: t(19), resource: 'bob', department: 'Y' },
    ]);
    const r = analyseLog(log);
    const ab = edge(r, 'A', 'B')!;
    expect(ab.duration).toMatchObject({
      count: 2,
      mean: 4 * 3.6e6,
      median: 4 * 3.6e6,
      max: 6 * 3.6e6,
    });
    const b = r.map.nodes.find((n) => n.activity === 'B')!;
    expect(b.processing?.mean).toBe(3.6e6);
    expect(b.waiting?.mean).toBe(4 * 3.6e6);
    expect(r.stats.throughput).toMatchObject({ mean: 6.5 * 3.6e6, min: 4 * 3.6e6, max: 9 * 3.6e6 });
    expect(r.stats.handovers).toEqual([{ from: 'ann', to: 'bob', count: 2 }]);
    expect(r.stats.departmentHandovers).toEqual([{ from: 'X', to: 'Y', count: 2 }]);
    expect(r.bottlenecks.edges[0].slowCases[0]).toEqual({ caseId: '2', ms: 6 * 3.6e6 });
    expect(r.bottlenecks.activities[0].activity).toBe('B');
    expect(r.hasStartTimes).toBe(true);
  });

  it('finds rework', () => {
    const r = analyseLog(
      logFromTraces([
        ['a', 'b', 'b', 'c'],
        ['a', 'c'],
        ['a', 'b', 'b', 'b'],
      ]),
    );
    expect(r.stats.rework.cases).toBe(2);
    expect(r.stats.rework.share).toBeCloseTo(2 / 3);
    expect(r.stats.rework.byActivity).toEqual([{ activity: 'b', cases: 2, repeats: 3 }]);
  });

  it('quantiles and duration statistics', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(durationStats([4, 1, 3, 2])).toMatchObject({
      count: 4,
      mean: 2.5,
      median: 2.5,
      min: 1,
      max: 4,
    });
    expect(durationStats([])).toBeNull();
  });
});

describe('filters', () => {
  const log = buildLogData(
    [
      { caseId: '1', activity: 'a', start: null, end: t(1), resource: 'r1', attrs: { ch: 'web' } },
      { caseId: '1', activity: 'b', start: null, end: t(2), resource: 'r2' },
      {
        caseId: '2',
        activity: 'a',
        start: null,
        end: t(30),
        resource: 'r1',
        attrs: { ch: 'email' },
      },
      { caseId: '2', activity: 'c', start: null, end: t(40), resource: 'r3' },
      { caseId: '3', activity: 'b', start: null, end: t(50), resource: 'r2' },
      { caseId: '3', activity: 'a', start: null, end: t(51), resource: 'r1' },
    ],
    ['ch'],
  );
  const kept = (f: Parameters<typeof applyFilters>[1]) =>
    [...applyFilters(log, f)].map((k, i) => (k ? log.caseIds[i] : null)).filter(Boolean);

  it('combines filters with AND', () => {
    expect(kept([{ type: 'attribute', name: 'ch', values: ['web'], exclude: false }])).toEqual([
      '1',
    ]);
    expect(kept([{ type: 'activity', activities: ['c'], mode: 'notContains' }])).toEqual([
      '1',
      '3',
    ]);
    expect(kept([{ type: 'follows', from: 'a', to: 'b', directly: true, exclude: false }])).toEqual(
      ['1'],
    );
    expect(kept([{ type: 'follows', from: 'b', to: 'a', directly: false, exclude: true }])).toEqual(
      ['1', '2'],
    );
    expect(kept([{ type: 'throughput', min: 5 * 3.6e6 }])).toEqual(['2']);
    expect(kept([{ type: 'resource', values: ['r3'], exclude: false }])).toEqual(['2']);
    expect(
      kept([{ type: 'period', from: new Date(t(20)).toISOString(), to: null, mode: 'started' }]),
    ).toEqual(['2', '3']);
    expect(kept([{ type: 'variant', ids: [variantId(['b', 'a'])], exclude: false }])).toEqual([
      '3',
    ]);
    expect(
      kept([
        { type: 'activity', activities: ['a'], mode: 'contains' },
        { type: 'cases', ids: ['2', '3'] },
      ]),
    ).toEqual(['2', '3']);
  });
});

describe('heuristics miner', () => {
  it('mines the dependency graph of L1 (all-tasks-connected)', () => {
    const net = heuristicsMiner(L1);
    const arcs = Object.fromEntries(net.arcs.map((a) => [`${a.from}>${a.to}`, a.dependency]));
    expect(Object.keys(arcs).sort()).toEqual(['a>b', 'a>c', 'a>e', 'b>d', 'c>d', 'e>d']);
    // a ⇒ b = 3 / (3 + 0 + 1); b ⇒ c = (3 − 2) / (3 + 2 + 1) is too weak (concurrency).
    expect(arcs['a>b']).toBeCloseTo(0.75);
    expect(arcs['c>d']).toBeCloseTo(0.75);
    expect(arcs['a>e']).toBeCloseTo(0.5);
    expect(net.starts).toEqual(['a']);
    expect(net.ends).toEqual(['d']);
  });

  it('detects AND splits / joins and builds a BPMN structure', () => {
    const net = heuristicsMiner(
      logFromTraces([
        { trace: ['a', 'b', 'c', 'd'], count: 5 },
        { trace: ['a', 'c', 'b', 'd'], count: 5 },
      ]),
    );
    expect(net.splits).toEqual([{ activity: 'a', kind: 'AND', targets: ['b', 'c'] }]);
    expect(net.joins).toEqual([{ activity: 'd', kind: 'AND', targets: ['b', 'c'] }]);
    const s = netToStructure(net);
    expect(s.nodes.filter((n) => n.type === 'parallelGateway')).toHaveLength(2);
    expect(s.nodes.filter((n) => n.type === 'task')).toHaveLength(4);
    expect(s.flows).toContainEqual({ from: 'Start', to: 'Activity_1' });
    const xorNet = heuristicsMiner(
      logFromTraces([
        { trace: ['a', 'b', 'd'], count: 5 },
        { trace: ['a', 'c', 'd'], count: 5 },
      ]),
    );
    expect(xorNet.splits[0]).toMatchObject({ activity: 'a', kind: 'XOR' });
  });

  it('finds length-one and length-two loops', () => {
    const loop1 = heuristicsMiner(logFromTraces([{ trace: ['a', 'b', 'b', 'b', 'c'], count: 5 }]), {
      dependency: 0.8,
    });
    expect(loop1.arcs.find((a) => a.from === 'b' && a.to === 'b')?.dependency).toBeCloseTo(10 / 11);
    const loop2 = heuristicsMiner(
      logFromTraces([
        { trace: ['a', 'b', 'c', 'b', 'c', 'b', 'd'], count: 4 },
        { trace: ['a', 'b', 'd'], count: 2 },
      ]),
    );
    expect(loop2.arcs.some((a) => a.from === 'b' && a.to === 'c')).toBe(true);
    expect(loop2.arcs.some((a) => a.from === 'c' && a.to === 'b')).toBe(true);
  });
});
