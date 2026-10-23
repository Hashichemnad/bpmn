import { DEFAULT_DIAGRAM_THEME } from '@processhub/shared';
import { applyThemeToXml } from '../src/models/diagram-theme-xml';

/**
 * Generates small BPMN 2.0 diagrams (with diagram interchange) for seed data
 * and tests. Labels are stored bilingually in ph:nameEn / ph:nameAr; the
 * standard `name` attribute carries the English label for other BPMN tools.
 * Shapes get the default colour theme (BPMN-in-Color, D-067).
 */
export const PH_NAMESPACE = 'http://processhub.io/schema/bpmn';

export type NodeType =
  | 'startEvent'
  | 'endEvent'
  | 'task'
  | 'userTask'
  | 'serviceTask'
  | 'exclusiveGateway'
  | 'callActivity';

export interface DiagramNode {
  id: string;
  type: NodeType;
  en: string;
  ar: string;
  x: number;
  y: number;
  linkedProcessId?: string;
  /** Step description shown in the portal (ph:descriptionEn / ph:descriptionAr). */
  descEn?: string;
  descAr?: string;
}

export interface DiagramFlow {
  id: string;
  from: string;
  to: string;
  en?: string;
  ar?: string;
}

const SIZE: Record<NodeType, [number, number]> = {
  startEvent: [36, 36],
  endEvent: [36, 36],
  task: [100, 80],
  userTask: [100, 80],
  serviceTask: [100, 80],
  callActivity: [100, 80],
  exclusiveGateway: [50, 50],
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const labelAttrs = (en?: string, ar?: string) =>
  en || ar
    ? ` name="${esc(en || ar || '')}" ph:nameEn="${esc(en ?? '')}" ph:nameAr="${esc(ar ?? '')}"`
    : '';

export function buildBpmn(processKey: string, nodes: DiagramNode[], flows: DiagramFlow[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = (id: string) => flows.filter((f) => f.to === id);
  const outgoing = (id: string) => flows.filter((f) => f.from === id);

  const semantic = nodes
    .map((n) => {
      const refs = [
        ...incoming(n.id).map((f) => `      <bpmn:incoming>${f.id}</bpmn:incoming>`),
        ...outgoing(n.id).map((f) => `      <bpmn:outgoing>${f.id}</bpmn:outgoing>`),
      ].join('\n');
      const link = n.linkedProcessId ? ` ph:linkedProcessId="${n.linkedProcessId}"` : '';
      const desc =
        (n.descEn ? ` ph:descriptionEn="${esc(n.descEn)}"` : '') +
        (n.descAr ? ` ph:descriptionAr="${esc(n.descAr)}"` : '');
      return `    <bpmn:${n.type} id="${n.id}"${labelAttrs(n.en, n.ar)}${link}${desc}>\n${refs}\n    </bpmn:${n.type}>`;
    })
    .join('\n');
  const seqFlows = flows
    .map(
      (f) =>
        `    <bpmn:sequenceFlow id="${f.id}" sourceRef="${f.from}" targetRef="${f.to}"${labelAttrs(f.en, f.ar)} />`,
    )
    .join('\n');

  const shapes = nodes
    .map((n) => {
      const [w, h] = SIZE[n.type];
      const marker = n.type === 'exclusiveGateway' ? ' isMarkerVisible="true"' : '';
      return `      <bpmndi:BPMNShape id="${n.id}_di" bpmnElement="${n.id}"${marker}>\n        <dc:Bounds x="${n.x}" y="${n.y}" width="${w}" height="${h}" />\n      </bpmndi:BPMNShape>`;
    })
    .join('\n');
  const edges = flows
    .map((f) => {
      const a = byId.get(f.from)!;
      const b = byId.get(f.to)!;
      const [aw, ah] = SIZE[a.type];
      const bh = SIZE[b.type][1];
      const start = { x: a.x + aw, y: a.y + ah / 2 };
      const end = { x: b.x, y: b.y + bh / 2 };
      let points = [start, end];
      if (start.y !== end.y) {
        // Leave a gateway vertically when going to another row, then turn.
        const fromGateway = a.type === 'exclusiveGateway';
        points = fromGateway
          ? [
              { x: a.x + aw / 2, y: end.y > start.y ? a.y + ah : a.y },
              { x: a.x + aw / 2, y: end.y },
              end,
            ]
          : [
              start,
              { x: (start.x + end.x) / 2, y: start.y },
              { x: (start.x + end.x) / 2, y: end.y },
              end,
            ];
      }
      const wps = points.map((p) => `        <di:waypoint x="${p.x}" y="${p.y}" />`).join('\n');
      return `      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}">\n${wps}\n      </bpmndi:BPMNEdge>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:ph="${PH_NAMESPACE}" id="Definitions_${processKey}" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_${processKey}" isExecutable="false">
${semantic}
${seqFlows}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_${processKey}">
    <bpmndi:BPMNPlane id="Plane_${processKey}" bpmnElement="Process_${processKey}">
${shapes}
${edges}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
  return applyThemeToXml(xml, DEFAULT_DIAGRAM_THEME).xml;
}
