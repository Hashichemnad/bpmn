import {
  BPMN_BIOC_NS,
  BPMN_COLOR_NS,
  themeColour,
  type DiagramTheme,
  type ThemeKind,
} from '@processhub/shared';
import { PH_NAMESPACE } from '@/features/modeler/phModdle';

interface Node {
  id: string;
  tag: string;
  kind: ThemeKind;
  en: string;
  ar: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lane: 'A' | 'B';
  def?: string;
}

const NODES: Node[] = [
  {
    id: 'Start',
    tag: 'startEvent',
    kind: 'start',
    en: 'Request needed',
    ar: 'الحاجة إلى طلب',
    x: 92,
    y: 47,
    w: 36,
    h: 36,
    lane: 'A',
  },
  {
    id: 'Create',
    tag: 'userTask',
    kind: 'humanTask',
    en: 'Create request',
    ar: 'إنشاء الطلب',
    x: 150,
    y: 25,
    w: 100,
    h: 80,
    lane: 'A',
  },
  {
    id: 'Review',
    tag: 'userTask',
    kind: 'approvalTask',
    en: 'Review request',
    ar: 'مراجعة الطلب',
    x: 280,
    y: 155,
    w: 100,
    h: 80,
    lane: 'B',
  },
  {
    id: 'Decision',
    tag: 'exclusiveGateway',
    kind: 'gateway',
    en: 'Approved?',
    ar: 'معتمد؟',
    x: 425,
    y: 170,
    w: 50,
    h: 50,
    lane: 'B',
  },
  {
    id: 'Record',
    tag: 'serviceTask',
    kind: 'systemTask',
    en: 'Create record',
    ar: 'إنشاء السجل',
    x: 530,
    y: 155,
    w: 100,
    h: 80,
    lane: 'B',
  },
  {
    id: 'Done',
    tag: 'endEvent',
    kind: 'end',
    en: 'Request done',
    ar: 'اكتمل الطلب',
    x: 682,
    y: 177,
    w: 36,
    h: 36,
    lane: 'B',
  },
  {
    id: 'Rejected',
    tag: 'endEvent',
    kind: 'endRejected',
    en: 'Rejected',
    ar: 'مرفوض',
    x: 532,
    y: 47,
    w: 36,
    h: 36,
    lane: 'A',
    def: 'terminate',
  },
];

const FLOWS: { from: string; to: string; en?: string; ar?: string; points: number[][] }[] = [
  {
    from: 'Start',
    to: 'Create',
    points: [
      [128, 65],
      [150, 65],
    ],
  },
  {
    from: 'Create',
    to: 'Review',
    points: [
      [250, 65],
      [260, 65],
      [260, 195],
      [280, 195],
    ],
  },
  {
    from: 'Review',
    to: 'Decision',
    points: [
      [380, 195],
      [425, 195],
    ],
  },
  {
    from: 'Decision',
    to: 'Record',
    en: 'Yes',
    ar: 'نعم',
    points: [
      [475, 195],
      [530, 195],
    ],
  },
  {
    from: 'Record',
    to: 'Done',
    points: [
      [630, 195],
      [682, 195],
    ],
  },
  {
    from: 'Decision',
    to: 'Rejected',
    en: 'No',
    ar: 'لا',
    points: [
      [450, 170],
      [450, 65],
      [532, 65],
    ],
  },
];

const LANES = [
  { id: 'A', en: 'Requester', ar: 'مقدم الطلب', y: 0 },
  { id: 'B', en: 'Approver', ar: 'المعتمد', y: 130 },
];

const colours = (c: { fill: string; stroke: string }) =>
  ` bioc:stroke="${c.stroke}" bioc:fill="${c.fill}" color:background-color="${c.fill}" color:border-color="${c.stroke}"`;
const names = (en: string, ar: string) => ` name="${en}" ph:nameEn="${en}" ph:nameAr="${ar}"`;

/** A small sample diagram coloured with `theme`, for the live preview in Settings → Branding. */
export function themePreviewXml(theme: DiagramTheme): string {
  const flowId = (i: number) => `Flow_${i + 1}`;
  const nodes = NODES.map((n) => {
    const refs = FLOWS.flatMap((f, i) => [
      ...(f.to === n.id ? [`<bpmn:incoming>${flowId(i)}</bpmn:incoming>`] : []),
      ...(f.from === n.id ? [`<bpmn:outgoing>${flowId(i)}</bpmn:outgoing>`] : []),
    ]).join('');
    const def = n.def ? `<bpmn:${n.def}EventDefinition id="${n.id}_def" />` : '';
    return `<bpmn:${n.tag} id="${n.id}"${names(n.en, n.ar)}>${refs}${def}</bpmn:${n.tag}>`;
  }).join('');
  const flows = FLOWS.map(
    (f, i) =>
      `<bpmn:sequenceFlow id="${flowId(i)}" sourceRef="${f.from}" targetRef="${f.to}"${f.en ? names(f.en, f.ar ?? '') : ''} />`,
  ).join('');
  const lanes = LANES.map(
    (l) =>
      `<bpmn:lane id="Lane_${l.id}"${names(l.en, l.ar)}>${NODES.filter((n) => n.lane === l.id)
        .map((n) => `<bpmn:flowNodeRef>${n.id}</bpmn:flowNodeRef>`)
        .join('')}</bpmn:lane>`,
  ).join('');
  const laneShapes = LANES.map(
    (l, i) =>
      `<bpmndi:BPMNShape id="Lane_${l.id}_di" bpmnElement="Lane_${l.id}" isHorizontal="true"${colours(themeColour(theme, 'lane', i))}><dc:Bounds x="30" y="${l.y}" width="730" height="130" /></bpmndi:BPMNShape>`,
  ).join('');
  const nodeShapes = NODES.map(
    (n) =>
      `<bpmndi:BPMNShape id="${n.id}_di" bpmnElement="${n.id}"${colours(themeColour(theme, n.kind))}${n.tag === 'exclusiveGateway' ? ' isMarkerVisible="true"' : ''}><dc:Bounds x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" /></bpmndi:BPMNShape>`,
  ).join('');
  const edges = FLOWS.map((f, i) => {
    const wps = f.points.map(([x, y]) => `<di:waypoint x="${x}" y="${y}" />`).join('');
    const [x0, y0] = f.points[0];
    const label = f.en
      ? `<bpmndi:BPMNLabel><dc:Bounds x="${x0 + 8}" y="${f.points[1][1] === y0 ? y0 - 18 : y0 - 40}" width="30" height="14" /></bpmndi:BPMNLabel>`
      : '';
    return `<bpmndi:BPMNEdge id="${flowId(i)}_di" bpmnElement="${flowId(i)}">${wps}${label}</bpmndi:BPMNEdge>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:bioc="${BPMN_BIOC_NS}" xmlns:color="${BPMN_COLOR_NS}" xmlns:ph="${PH_NAMESPACE}" id="Preview" targetNamespace="http://bpmn.io/schema/bpmn">
<bpmn:collaboration id="Collab"><bpmn:participant id="Pool"${names('Sample process', 'إجراء نموذجي')} processRef="Process" /></bpmn:collaboration>
<bpmn:process id="Process" isExecutable="false"><bpmn:laneSet id="LaneSet">${lanes}</bpmn:laneSet>${nodes}${flows}</bpmn:process>
<bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">
<bpmndi:BPMNShape id="Pool_di" bpmnElement="Pool" isHorizontal="true"><dc:Bounds x="0" y="0" width="760" height="260" /></bpmndi:BPMNShape>
${laneShapes}${nodeShapes}${edges}
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
}
