/**
 * bpmn-moddle extension for ProcessHub attributes stored in the BPMN XML:
 *   ph:nameEn / ph:nameAr       — bilingual labels (the standard `name` mirrors the active language)
 *   ph:linkedProcessId          — repository process a call activity / sub-process drills down into
 *   ph:descriptionEn / Ar       — step description shown in the Knowledge Portal
 *   ph:stepKind                 — "approval" marks a user task as an approval step ("task": a
 *                                 normal step even when its label starts with Review / Approve …)
 *   ph:roleId                   — lane linked to a Role of the object library (label = role name)
 */
export const PH_NAMESPACE = 'http://processhub.io/schema/bpmn';

export const phModdleDescriptor = {
  name: 'ProcessHub',
  prefix: 'ph',
  uri: PH_NAMESPACE,
  xml: { tagAlias: 'lowerCase' },
  associations: [],
  types: [
    {
      name: 'BilingualElement',
      extends: ['bpmn:BaseElement'],
      properties: [
        { name: 'nameEn', isAttr: true, type: 'String' },
        { name: 'nameAr', isAttr: true, type: 'String' },
        { name: 'linkedProcessId', isAttr: true, type: 'String' },
        { name: 'descriptionEn', isAttr: true, type: 'String' },
        { name: 'descriptionAr', isAttr: true, type: 'String' },
        { name: 'stepKind', isAttr: true, type: 'String' },
        { name: 'roleId', isAttr: true, type: 'String' },
      ],
    },
  ],
};

export const EMPTY_DIAGRAM = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:ph="${PH_NAMESPACE}" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="StartEvent_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="180" y="160" width="36" height="36" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
