import { describe, expect, it } from 'vitest';
import { parseDiagramContent, stringifyDiagramContent } from './diagrams';
import { generateSipoc, splitList } from './sipoc';

const task = (id: string, en: string, extra = '') =>
  `<bpmn:userTask id="${id}" name="${en}" ph:nameEn="${en}" ph:nameAr="${en} ع" ${extra}/>`;
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:ph="http://processhub.io/schema/bpmn" id="D">
  <bpmn:collaboration id="C">
    <bpmn:participant id="P_Main" name="Purchasing" processRef="Process_1" />
    <bpmn:participant id="P_Vendor" name="Vendor" ph:nameEn="Vendor" ph:nameAr="المورد" />
    <bpmn:messageFlow id="M1" sourceRef="P_Vendor" targetRef="T1" />
    <bpmn:messageFlow id="M2" sourceRef="T3" targetRef="P_Vendor" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="L1" name="Requester" ph:nameEn="Requester" ph:nameAr="مقدم الطلب"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>T1</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="L2" name="Buyer" ph:nameEn="Buyer" ph:nameAr="المشتري"><bpmn:flowNodeRef>T2</bpmn:flowNodeRef><bpmn:flowNodeRef>T3</bpmn:flowNodeRef><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S" />
    ${task('T1', 'Raise request', 'ph:inputsEn="Budget; Specification" ph:inputsAr="الميزانية؛ المواصفات" ph:outputsEn="Purchase request"')}
    ${task('T2', 'Approve request', 'ph:inputsEn="Purchase request"')}
    ${task('T3', 'Issue order', 'ph:outputsEn="Purchase order"')}
    <bpmn:endEvent id="E" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T1" />
    <bpmn:sequenceFlow id="F2" sourceRef="T1" targetRef="T2" />
    <bpmn:sequenceFlow id="F3" sourceRef="T2" targetRef="T3" />
    <bpmn:sequenceFlow id="F4" sourceRef="T3" targetRef="E" />
  </bpmn:process>
</bpmn:definitions>`;

describe('SIPOC generation (D-125)', () => {
  it('splits free-text lists', () => {
    expect(splitList('A; B\nC، D')).toEqual(['A', 'B', 'C', 'D']);
  });

  it('builds the five columns from the main path, step attributes, lanes and pools', () => {
    const c = generateSipoc(XML, '11111111-1111-4111-8111-111111111111');
    const names = (col: keyof typeof c.columns) => c.columns[col].map((i) => i.nameEn);
    expect(names('steps')).toEqual(['Raise request', 'Approve request', 'Issue order']);
    expect(names('inputs')).toEqual(['Budget', 'Specification', 'Purchase request']);
    expect(c.columns.inputs[0].nameAr).toBe('الميزانية');
    expect(names('outputs')).toEqual(['Purchase request', 'Purchase order']);
    expect(names('suppliers')).toEqual(['Vendor', 'Requester']);
    expect(names('customers')).toEqual(['Vendor', 'Buyer']);
    expect(parseDiagramContent('SIPOC', stringifyDiagramContent(c)).ok).toBe(true);
  });
});
