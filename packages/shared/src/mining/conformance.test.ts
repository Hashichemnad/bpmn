import { describe, expect, it } from 'vitest';
import {
  checkConformance,
  logFromTraces,
  parseBpmnGraph,
  replayTrace,
  traceFitness,
  type WorkflowNet,
} from '../index';

const bpmn = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D"><bpmn:process id="P">${body}</bpmn:process></bpmn:definitions>`;
const flow = (id: string, from: string, to: string) =>
  `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${to}" />`;
const task = (id: string) => `<bpmn:task id="${id}" name="${id}" />`;

const SEQ = parseBpmnGraph(
  bpmn(
    `<bpmn:startEvent id="S" />${task('A')}${task('B')}${task('C')}<bpmn:endEvent id="E" />` +
      flow('f1', 'S', 'A') +
      flow('f2', 'A', 'B') +
      flow('f3', 'B', 'C') +
      flow('f4', 'C', 'E'),
  ),
);
const AND = parseBpmnGraph(
  bpmn(
    `<bpmn:startEvent id="S" />${task('A')}<bpmn:parallelGateway id="G1" />${task('B')}${task('C')}<bpmn:parallelGateway id="G2" />${task('D')}<bpmn:endEvent id="E" />` +
      flow('f1', 'S', 'A') +
      flow('f2', 'A', 'G1') +
      flow('f3', 'G1', 'B') +
      flow('f4', 'G1', 'C') +
      flow('f5', 'B', 'G2') +
      flow('f6', 'C', 'G2') +
      flow('f7', 'G2', 'D') +
      flow('f8', 'D', 'E'),
  ),
);
const XOR = parseBpmnGraph(
  bpmn(
    `<bpmn:startEvent id="S" />${task('A')}<bpmn:exclusiveGateway id="X1" />${task('B')}${task('C')}<bpmn:exclusiveGateway id="X2" />${task('D')}<bpmn:endEvent id="E" />` +
      flow('f1', 'S', 'A') +
      flow('f2', 'A', 'X1') +
      flow('f3', 'X1', 'B') +
      flow('f4', 'X1', 'C') +
      flow('f5', 'B', 'X2') +
      flow('f6', 'C', 'X2') +
      flow('f7', 'X2', 'D') +
      flow('f8', 'D', 'E'),
  ),
);
const identity = (acts: string[]) => Object.fromEntries(acts.map((a) => [a, a]));

describe('token-based replay', () => {
  it('reproduces the textbook example: ⟨a,d,c,e,h⟩ on the sequential net N2 → p = c = 6, m = r = 1', () => {
    // van der Aalst, Process Mining (2016), §8.2: N2 only allows ⟨a,c,d,e,h⟩.
    const net: WorkflowNet = {
      places: ['start', 'end', 'c1', 'c2', 'c3', 'c4'],
      source: 0,
      sink: 1,
      flowPlace: new Map(),
      transitions: [
        { id: 'a', label: 'a', inputs: [0], outputs: [2] },
        { id: 'c', label: 'c', inputs: [2], outputs: [3] },
        { id: 'd', label: 'd', inputs: [3], outputs: [4] },
        { id: 'e', label: 'e', inputs: [4], outputs: [5] },
        { id: 'h', label: 'h', inputs: [5], outputs: [1] },
      ],
    };
    const r = replayTrace(net, ['a', 'd', 'c', 'e', 'h']);
    expect(r).toMatchObject({ produced: 6, consumed: 6, missing: 1, remaining: 1 });
    expect(traceFitness(r)).toBeCloseTo(5 / 6);
    const ok = replayTrace(net, ['a', 'c', 'd', 'e', 'h']);
    expect(ok).toMatchObject({ produced: 6, consumed: 6, missing: 0, remaining: 0 });
    expect(traceFitness(ok)).toBe(1);
  });

  it('classifies skipped, wrong-order and inserted steps', () => {
    const log = logFromTraces([
      { trace: ['A', 'B', 'C'], count: 6 },
      { trace: ['A', 'C'], count: 2 },
      ['A', 'C', 'B'],
      ['A', 'X', 'B', 'C'],
      ['A', 'B', 'B', 'C'],
    ]);
    const r = checkConformance(log, SEQ, { ...identity(['A', 'B', 'C']), X: null });
    expect(r.cases).toBe(11);
    expect(r.conformingCases).toBe(6);
    const dev = (kind: string) => r.deviations.filter((d) => d.kind === kind);
    expect(dev('SKIPPED')).toEqual([expect.objectContaining({ elementId: 'B', cases: 2 })]);
    expect(dev('WRONG_ORDER')).toEqual([
      expect.objectContaining({ elementId: 'C', otherElementId: 'B', cases: 1 }),
    ]);
    expect(dev('INSERTED').map((d) => [d.activity, d.elementId, d.cases])).toEqual(
      expect.arrayContaining([
        ['X', null, 1],
        ['B', 'B', 1],
      ]),
    );
    // ⟨A,C⟩: p = c = 5 (silent start / end events), m = r = 1 → 0.8.
    expect(r.fitness).toBeGreaterThan(0.9);
    expect(r.fitness).toBeLessThan(1);
    expect(r.elements.B).toMatchObject({ cases: 9, deviations: 3 }); // 2 skipped + 1 repeated
    expect(r.flows.f2).toBe(11); // every case fires A
    expect(r.unobserved).toEqual([]);
  });

  it('replays exclusive and parallel gateways through silent transitions', () => {
    const xor = checkConformance(
      logFromTraces([
        ['A', 'B', 'D'],
        ['A', 'C', 'D'],
      ]),
      XOR,
      identity(['A', 'B', 'C', 'D']),
    );
    expect(xor).toMatchObject({ fitness: 1, conformingShare: 1 });
    expect(xor.flows).toMatchObject({ f3: 1, f4: 1, f7: 2 });
    const and = checkConformance(
      logFromTraces([
        ['A', 'B', 'C', 'D'],
        ['A', 'C', 'B', 'D'],
        ['A', 'B', 'D'],
      ]),
      AND,
      identity(['A', 'B', 'C', 'D']),
    );
    expect(and.conformingCases).toBe(2);
    expect(and.deviations).toEqual([
      expect.objectContaining({ kind: 'SKIPPED', elementId: 'C', cases: 1 }),
    ]);
  });

  it('treats steps that never occur in the log as silent and lists them', () => {
    const r = checkConformance(logFromTraces([['A', 'C']]), SEQ, identity(['A', 'C']));
    expect(r.fitness).toBe(1);
    expect(r.unobserved).toEqual(['B']);
  });
});
