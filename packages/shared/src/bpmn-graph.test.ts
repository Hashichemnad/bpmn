import { describe, expect, it } from 'vitest';
import { flowOrder, parseBpmnGraph, processTotals } from './bpmn-graph';
import { durationBand, readStepAttributes, splitMinutes } from './step-attributes';

const xml = (body: string, lanes = '') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="D">
  <bpmn:process id="P">${lanes}${body}</bpmn:process>
</bpmn:definitions>`;

describe('parseBpmnGraph', () => {
  it('reads step attributes, entities and nested lanes, and reports invalid values', () => {
    const g = parseBpmnGraph(
      xml(
        `<bpmn:task id="T1" name="A &amp; B" ph:nameEn="A &amp; B" ph:durationMinutes="90" ph:waitingMinutes="30" ph:costPerExecution="12.5" ph:inputsEn="Form" />
         <bpmn:task id="T2" ph:durationMinutes="-1" ph:frequencyPerMonth="abc" />
         <bpmn:sequenceFlow id="F1" sourceRef="T1" targetRef="T2" ph:nameEn="Yes" />`,
        `<bpmn:laneSet id="LS"><bpmn:lane id="L1" ph:nameEn="Parent"><bpmn:childLaneSet id="CLS">
           <bpmn:lane id="L2" ph:roleId="r1"><bpmn:flowNodeRef>T1</bpmn:flowNodeRef></bpmn:lane>
         </bpmn:childLaneSet></bpmn:lane></bpmn:laneSet>`,
      ),
    );
    const [t1, t2] = g.nodes;
    expect(t1).toMatchObject({
      nameEn: 'A & B',
      laneId: 'L2',
      outgoing: 1,
      attributes: {
        durationMinutes: 90,
        waitingMinutes: 30,
        costPerExecution: 12.5,
        inputsEn: 'Form',
      },
    });
    expect(t2.incoming).toBe(1);
    expect(t2.attributeIssues).toEqual([
      { attribute: 'durationMinutes', code: 'NEGATIVE' },
      { attribute: 'frequencyPerMonth', code: 'NOT_A_NUMBER' },
    ]);
    expect(g.lanes).toEqual([
      { id: 'L1', name: '', nameEn: 'Parent', nameAr: '', roleId: null, parentLaneId: null },
      { id: 'L2', name: '', nameEn: '', nameAr: '', roleId: 'r1', parentLaneId: 'L1' },
    ]);
    expect(g.flows[0]).toMatchObject({ from: 'T1', to: 'T2', nameEn: 'Yes' });
  });
});

describe('processTotals', () => {
  const body = `
    <bpmn:startEvent id="S" />
    <bpmn:userTask id="A" ph:nameEn="Submit" ph:durationMinutes="30" />
    <bpmn:exclusiveGateway id="G" />
    <bpmn:userTask id="B" ph:nameEn="Approve request" ph:durationMinutes="60" ph:waitingMinutes="1440" />
    <bpmn:serviceTask id="C" ph:durationMinutes="5" />
    <bpmn:endEvent id="E" />
    <bpmn:sequenceFlow id="f1" sourceRef="S" targetRef="A" />
    <bpmn:sequenceFlow id="f2" sourceRef="A" targetRef="G" />
    <bpmn:sequenceFlow id="f3" sourceRef="G" targetRef="B" />
    <bpmn:sequenceFlow id="f4" sourceRef="G" targetRef="C" />
    <bpmn:sequenceFlow id="f5" sourceRef="B" targetRef="E" />
    <bpmn:sequenceFlow id="f6" sourceRef="C" targetRef="E" />
    <bpmn:sequenceFlow id="f7" sourceRef="B" targetRef="A" />`;

  it('counts steps, approvals, systems and the longest planned path (loops ignored)', () => {
    const t = processTotals(parseBpmnGraph(xml(body)), [
      { bpmnElementId: 'C', type: 'SYSTEM', objectId: 's1' },
      { bpmnElementId: 'A', type: 'SYSTEM', objectId: 's1' },
      { bpmnElementId: 'B', type: 'SYSTEM', objectId: 's2' },
      { bpmnElementId: 'G', type: 'SYSTEM', objectId: 's3' },
    ]);
    expect(t).toMatchObject({
      steps: 3,
      approvalSteps: 1,
      decisions: 1,
      systems: 2,
      mainPathMinutes: 30 + 60 + 1440,
      mainPath: ['A', 'B'],
      stepsWithoutDuration: 0,
    });
  });

  it('without times the main path is the one with most steps', () => {
    const t = processTotals(
      parseBpmnGraph(xml(body.replace(/ ph:(duration|waiting)Minutes="\d+"/g, ''))),
    );
    expect(t.mainPathMinutes).toBeNull();
    expect(t.mainPath).toHaveLength(2);
    expect(t.stepsWithoutDuration).toBe(3);
  });
});

describe('step attributes', () => {
  it('validates numbers and text', () => {
    expect(
      readStepAttributes({ durationMinutes: '15', slaMinutes: '1e9', outputsAr: 'x'.repeat(2001) }),
    ).toEqual({
      values: { durationMinutes: 15 },
      issues: [
        { attribute: 'slaMinutes', code: 'TOO_LARGE' },
        { attribute: 'outputsAr', code: 'TOO_LONG' },
      ],
    });
  });

  it('bands and splits durations', () => {
    expect([undefined, 10, 60, 480, 481].map(durationBand)).toEqual([
      'none',
      'short',
      'medium',
      'medium',
      'long',
    ]);
    expect(splitMinutes(2880)).toEqual({ value: 2, unit: 'days' });
    expect(splitMinutes(120)).toEqual({ value: 2, unit: 'hours' });
    expect(splitMinutes(90)).toEqual({ value: 90, unit: 'minutes' });
  });
});

describe('flowOrder', () => {
  it('lists nodes breadth-first from the start, then the unreached ones', () => {
    const g = parseBpmnGraph(
      xml(`<bpmn:task id="Z" /><bpmn:startEvent id="S" /><bpmn:task id="B" /><bpmn:task id="A" />
        <bpmn:sequenceFlow id="f1" sourceRef="S" targetRef="A" />
        <bpmn:sequenceFlow id="f2" sourceRef="A" targetRef="B" />`),
    );
    expect(flowOrder(g).map((n) => n.id)).toEqual(['S', 'A', 'B', 'Z']);
  });
});
