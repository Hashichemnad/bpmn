import { describe, expect, it } from 'vitest';
import { parseBpmnGraph } from './bpmn-graph';
import {
  DEFAULT_CONVENTIONS,
  blockingIssues,
  checkConventions,
  modelingConventionsSchema,
  resolveConventions,
  type ModelingConventions,
} from './conventions';

const xml = (body: string, lanes = '') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="D">
  <bpmn:process id="P">${lanes}${body}</bpmn:process>
</bpmn:definitions>`;

const LANES = `<bpmn:laneSet id="LS">
  <bpmn:lane id="L1" ph:roleId="r1"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>T1</bpmn:flowNodeRef><bpmn:flowNodeRef>A1</bpmn:flowNodeRef><bpmn:flowNodeRef>G1</bpmn:flowNodeRef><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane>
  <bpmn:lane id="L2"><bpmn:flowNodeRef>T2</bpmn:flowNodeRef></bpmn:lane>
</bpmn:laneSet>`;

const GOOD = `
  <bpmn:startEvent id="S" />
  <bpmn:userTask id="T1" ph:nameEn="Fill form" ph:nameAr="تعبئة النموذج" ph:descriptionEn="Fill it" />
  <bpmn:userTask id="A1" ph:stepKind="approval" ph:nameEn="Approve" ph:nameAr="اعتماد" ph:descriptionAr="اعتماد الطلب" />
  <bpmn:exclusiveGateway id="G1" />
  <bpmn:endEvent id="E" />
  <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T1" />
  <bpmn:sequenceFlow id="F2" sourceRef="T1" targetRef="A1" />
  <bpmn:sequenceFlow id="F3" sourceRef="A1" targetRef="G1" />
  <bpmn:sequenceFlow id="F4" sourceRef="G1" targetRef="E" />`;

const withRules = (
  patch: Partial<
    Record<keyof ModelingConventions['rules'], { enabled: boolean; mandatory: boolean }>
  >,
  maxElements = 50,
): ModelingConventions => ({
  rules: { ...DEFAULT_CONVENTIONS.rules, ...patch },
  maxElements,
});

describe('checkConventions', () => {
  it('passes a diagram that follows every rule', () => {
    expect(checkConventions(parseBpmnGraph(xml(GOOD, LANES)), DEFAULT_CONVENTIONS)).toEqual([]);
  });

  it('reports each rule with its element and whether it is mandatory', () => {
    const body = `
      <bpmn:startEvent id="S" />
      <bpmn:userTask id="T1" ph:nameEn="Fill form" />
      <bpmn:userTask id="A1" ph:stepKind="approval" ph:nameEn="Approve" ph:nameAr="اعتماد" ph:descriptionEn="x" />
      <bpmn:task id="T2" ph:nameEn="Archive" ph:nameAr="أرشفة" />
      <bpmn:endEvent id="E" />
      <bpmn:task id="LOOSE" ph:nameEn="Loose" ph:nameAr="منفصل" />
      <bpmn:boundaryEvent id="B" attachedToRef="T1" />
      <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T1" />
      <bpmn:sequenceFlow id="F2" sourceRef="T1" targetRef="A1" />
      <bpmn:sequenceFlow id="F3" sourceRef="A1" targetRef="T2" />
      <bpmn:sequenceFlow id="F4" sourceRef="T2" targetRef="E" />`;
    const issues = checkConventions(
      parseBpmnGraph(xml(body, LANES)),
      withRules({ laneRole: { enabled: true, mandatory: true } }, 5),
    );
    expect(issues).toEqual([
      { rule: 'maxElements', mandatory: false, count: 7, max: 5 },
      { rule: 'bilingualLabels', mandatory: false, elementId: 'T1' },
      { rule: 'userTaskDescription', mandatory: false, elementId: 'T1' },
      { rule: 'approvalDecision', mandatory: false, elementId: 'A1' },
      { rule: 'laneRole', mandatory: true, elementId: 'T2' },
      { rule: 'laneRole', mandatory: true, elementId: 'LOOSE' },
      { rule: 'noUnconnected', mandatory: false, elementId: 'LOOSE' },
    ]);
    expect(blockingIssues(issues).map((i) => i.elementId)).toEqual(['T2', 'LOOSE']);
  });

  it('skips disabled rules', () => {
    const body = `<bpmn:task id="T" /><bpmn:task id="U" />`;
    const off = Object.fromEntries(
      Object.keys(DEFAULT_CONVENTIONS.rules).map((r) => [r, { enabled: false, mandatory: false }]),
    );
    expect(checkConventions(parseBpmnGraph(xml(body)), withRules(off))).toEqual([]);
  });
});

describe('modeling conventions setting', () => {
  it('makes mandatory rules enabled and validates the limit', () => {
    const parsed = modelingConventionsSchema.parse({
      ...DEFAULT_CONVENTIONS,
      rules: { ...DEFAULT_CONVENTIONS.rules, laneRole: { enabled: false, mandatory: true } },
    });
    expect(parsed.rules.laneRole).toEqual({ enabled: true, mandatory: true });
    expect(
      modelingConventionsSchema.safeParse({ ...DEFAULT_CONVENTIONS, maxElements: 2 }).success,
    ).toBe(false);
    expect(
      modelingConventionsSchema.safeParse({ ...DEFAULT_CONVENTIONS, extra: true }).success,
    ).toBe(false);
  });

  it('merges a stored value over the defaults', () => {
    expect(resolveConventions(null)).toEqual(DEFAULT_CONVENTIONS);
    const v = resolveConventions({
      rules: { noUnconnected: { mandatory: true } },
      maxElements: 80,
    });
    expect(v.maxElements).toBe(80);
    expect(v.rules.noUnconnected).toEqual({ enabled: true, mandatory: true });
    expect(v.rules.laneRole).toEqual({ enabled: true, mandatory: false });
    expect(resolveConventions({ maxElements: 'x' })).toEqual(DEFAULT_CONVENTIONS);
  });
});
