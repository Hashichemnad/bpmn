import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { graphLabel, isStepNode, parseBpmnGraph, processTotals } from '@processhub/shared';

/** The shared BPMN reader on the main test diagram (PMS-01). */
const pms01 = readFileSync(
  join(__dirname, '../../../../docs/samples/PMS-01-Program-Request-Approval.bpmn'),
  'utf8',
);

describe('parseBpmnGraph on PMS-01', () => {
  it('reads nodes with lanes and step types, flows and lanes', () => {
    const g = parseBpmnGraph(pms01);
    expect(g.lanes).toHaveLength(8);
    const create = g.nodes.find((n) => n.id === 'Task_CreateRequest')!;
    expect(create).toMatchObject({
      type: 'bpmn:UserTask',
      stepType: 'task',
      laneId: 'Lane_Requester',
    });
    expect(create.nameAr).not.toBe('');
    expect(graphLabel(create, 'ar')).toBe(create.nameAr);
    expect(g.nodes.filter((n) => n.stepType === 'approval').length).toBeGreaterThan(2);
    expect(g.flows.every((f) => g.nodes.some((n) => n.id === f.from))).toBe(true);
    expect(g.nodes.filter(isStepNode).length).toBeGreaterThan(10);
    expect(g.participants).toBe(1);
  });

  it('has a main path from the request to the end', () => {
    const t = processTotals(parseBpmnGraph(pms01));
    expect(t.mainPath[0]).toBe('Task_CreateRequest');
    expect(t.steps).toBeGreaterThan(10);
  });
});
