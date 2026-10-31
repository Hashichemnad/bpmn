import { serializeExec, type ExecConfigInput } from '@processhub/shared';

/**
 * Builds executable BPMN 2.0 XML (with lanes and diagram interchange) for the workflow demo seed and the
 * tests (Phase 5.2): bilingual labels (ph:nameEn / ph:nameAr), `ph:exec` execution settings, standard
 * conditions, timers, boundary and error / terminate events. Layout: columns by path depth, rows by lane.
 */
export const PH_NS = 'http://processhub.io/schema/bpmn';

export type WfNodeType =
  | 'startEvent'
  | 'endEvent'
  | 'userTask'
  | 'serviceTask'
  | 'sendTask'
  | 'businessRuleTask'
  | 'callActivity'
  | 'exclusiveGateway'
  | 'parallelGateway'
  | 'inclusiveGateway'
  | 'intermediateCatchEvent'
  | 'boundaryEvent'
  | 'task';

export interface WfNodeSpec {
  id: string;
  type: WfNodeType;
  en: string;
  ar: string;
  lane?: string;
  exec?: ExecConfigInput;
  approval?: boolean;
  slaMinutes?: number;
  /** Timer events: ISO 8601 duration / date / cycle. */
  timer?: { kind: 'timeDuration' | 'timeDate' | 'timeCycle'; value: string };
  /** End events: terminate / error (with code). */
  end?: 'terminate' | { errorCode: string };
  /** Boundary events. */
  attachedTo?: string;
  interrupting?: boolean;
  error?: boolean;
  defaultFlow?: string;
  decisionRef?: string;
  decisionId?: string;
  linkedProcessId?: string;
  descEn?: string;
  descAr?: string;
}

export interface WfFlowSpec {
  id: string;
  from: string;
  to: string;
  en?: string;
  ar?: string;
  condition?: string;
  exec?: ExecConfigInput;
}

export interface WfLaneSpec {
  id: string;
  en: string;
  ar: string;
  roleId?: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SIZE: Record<WfNodeType, [number, number]> = {
  startEvent: [36, 36],
  endEvent: [36, 36],
  intermediateCatchEvent: [36, 36],
  boundaryEvent: [36, 36],
  userTask: [110, 80],
  serviceTask: [110, 80],
  sendTask: [110, 80],
  businessRuleTask: [110, 80],
  callActivity: [110, 80],
  task: [110, 80],
  exclusiveGateway: [50, 50],
  parallelGateway: [50, 50],
  inclusiveGateway: [50, 50],
};

const COL = 170;
const LANE_H = 150;
const LEFT = 70;

export function buildWorkflowBpmn(
  processKey: string,
  nodes: WfNodeSpec[],
  flows: WfFlowSpec[],
  lanes: WfLaneSpec[] = [],
): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Column = longest distance from a start event (back edges ignored).
  const depth = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const f of flows) (out.get(f.from) ?? out.set(f.from, []).get(f.from)!).push(f.to);
  const visit = (id: string, d: number, path: Set<string>) => {
    if (path.has(id)) return;
    if ((depth.get(id) ?? -1) >= d) return;
    depth.set(id, d);
    const next = new Set(path).add(id);
    for (const t of out.get(id) ?? []) visit(t, d + 1, next);
  };
  for (const n of nodes) if (n.type === 'startEvent') visit(n.id, 0, new Set());
  for (const n of nodes)
    if (n.type === 'boundaryEvent' && n.attachedTo) {
      const d = depth.get(n.attachedTo) ?? 0;
      for (const t of out.get(n.id) ?? []) visit(t, d + 1, new Set([n.id]));
    }
  const laneIndex = new Map(lanes.map((l, i) => [l.id, i]));
  const laneOf = (n: WfNodeSpec): string | undefined =>
    n.type === 'boundaryEvent' && n.attachedTo
      ? laneOf(byId.get(n.attachedTo)!)
      : (n.lane ?? lanes[0]?.id);
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const used = new Map<string, number>();
  for (const n of nodes) {
    if (n.type === 'boundaryEvent') continue;
    const [w, h] = SIZE[n.type];
    const col = depth.get(n.id) ?? 0;
    const li = n.lane ? (laneIndex.get(n.lane) ?? 0) : 0;
    const key = `${li}:${col}`;
    const slot = used.get(key) ?? 0;
    used.set(key, slot + 1);
    const cx = LEFT + 60 + col * COL + 55;
    const cy =
      30 + li * LANE_H + LANE_H / 2 + (slot ? (slot % 2 ? -1 : 1) * 32 * Math.ceil(slot / 2) : 0);
    pos.set(n.id, { x: cx - w / 2, y: cy - h / 2, w, h });
  }
  for (const n of nodes) {
    if (n.type !== 'boundaryEvent' || !n.attachedTo) continue;
    const host = pos.get(n.attachedTo)!;
    const siblings = nodes.filter((x) => x.attachedTo === n.attachedTo);
    const k = siblings.indexOf(n);
    pos.set(n.id, { x: host.x + host.w - 30 - k * 40, y: host.y + host.h - 18, w: 36, h: 36 });
  }
  const maxCol = Math.max(0, ...[...depth.values()]);
  const width = LEFT + 60 + (maxCol + 1) * COL + 40;
  const height = Math.max(1, lanes.length) * LANE_H;

  const execAttr = (c?: ExecConfigInput) => {
    if (!c) return '';
    const s = serializeExec(c);
    return s ? ` ph:exec="${esc(s)}"` : '';
  };
  const label = (en?: string, ar?: string) =>
    en || ar
      ? ` name="${esc(en || ar || '')}" ph:nameEn="${esc(en ?? '')}" ph:nameAr="${esc(ar ?? '')}"`
      : '';

  const xmlNodes = nodes
    .map((n) => {
      const attrs = [
        label(n.en, n.ar),
        n.approval ? ' ph:stepKind="approval"' : '',
        n.slaMinutes ? ` ph:slaMinutes="${n.slaMinutes}"` : '',
        n.defaultFlow ? ` default="${n.defaultFlow}"` : '',
        n.decisionRef ? ` ph:decisionRef="${n.decisionRef}"` : '',
        n.decisionId ? ` ph:decisionId="${esc(n.decisionId)}"` : '',
        n.linkedProcessId ? ` ph:linkedProcessId="${n.linkedProcessId}"` : '',
        n.descEn ? ` ph:descriptionEn="${esc(n.descEn)}"` : '',
        n.descAr ? ` ph:descriptionAr="${esc(n.descAr)}"` : '',
        n.attachedTo ? ` attachedToRef="${n.attachedTo}"` : '',
        n.type === 'boundaryEvent' && n.interrupting === false ? ' cancelActivity="false"' : '',
        execAttr(n.exec),
      ].join('');
      const inner: string[] = [];
      for (const f of flows)
        if (f.to === n.id) inner.push(`<bpmn:incoming>${f.id}</bpmn:incoming>`);
      for (const f of flows)
        if (f.from === n.id) inner.push(`<bpmn:outgoing>${f.id}</bpmn:outgoing>`);
      if (n.timer)
        inner.push(
          `<bpmn:timerEventDefinition id="${n.id}_td"><bpmn:${n.timer.kind} xsi:type="bpmn:tFormalExpression">${esc(n.timer.value)}</bpmn:${n.timer.kind}></bpmn:timerEventDefinition>`,
        );
      if (n.end === 'terminate') inner.push(`<bpmn:terminateEventDefinition id="${n.id}_td" />`);
      else if (n.end && typeof n.end === 'object')
        inner.push(
          `<bpmn:errorEventDefinition id="${n.id}_ed" errorRef="Error_${n.end.errorCode}" />`,
        );
      if (n.error) inner.push(`<bpmn:errorEventDefinition id="${n.id}_ed" />`);
      return `    <bpmn:${n.type} id="${n.id}"${attrs}>${inner.join('')}</bpmn:${n.type}>`;
    })
    .join('\n');
  const xmlFlows = flows
    .map((f) => {
      const cond = f.condition
        ? `<bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${esc(f.condition)}</bpmn:conditionExpression>`
        : '';
      return `    <bpmn:sequenceFlow id="${f.id}" sourceRef="${f.from}" targetRef="${f.to}"${label(f.en, f.ar)}${execAttr(f.exec)}>${cond}</bpmn:sequenceFlow>`;
    })
    .join('\n');
  const errors = [
    ...new Set(nodes.flatMap((n) => (n.end && typeof n.end === 'object' ? [n.end.errorCode] : []))),
  ]
    .map((c) => `  <bpmn:error id="Error_${c}" name="${esc(c)}" errorCode="${esc(c)}" />`)
    .join('\n');
  const laneXml = lanes.length
    ? `    <bpmn:laneSet id="LaneSet_${processKey}">\n${lanes
        .map(
          (l) =>
            `      <bpmn:lane id="${l.id}"${label(l.en, l.ar)}${l.roleId ? ` ph:roleId="${l.roleId}"` : ''}>${nodes
              .filter((n) => laneOf(n) === l.id)
              .map((n) => `<bpmn:flowNodeRef>${n.id}</bpmn:flowNodeRef>`)
              .join('')}</bpmn:lane>`,
        )
        .join('\n')}\n    </bpmn:laneSet>`
    : '';
  const center = (id: string) => {
    const p = pos.get(id)!;
    return { x: p.x + p.w / 2, y: p.y + p.h / 2, ...p };
  };
  const edges = flows
    .map((f) => {
      const a = center(f.from);
      const b = center(f.to);
      const pts =
        Math.abs(a.y - b.y) < 2
          ? [
              [a.x + a.w / 2, a.y],
              [b.x - b.w / 2, b.y],
            ]
          : b.x > a.x
            ? [
                [a.x + a.w / 2, a.y],
                [(a.x + b.x) / 2, a.y],
                [(a.x + b.x) / 2, b.y],
                [b.x - b.w / 2, b.y],
              ]
            : [
                [a.x, a.y + a.h / 2],
                [a.x, Math.max(a.y, b.y) + 70],
                [b.x, Math.max(a.y, b.y) + 70],
                [b.x, b.y + b.h / 2],
              ];
      return `      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}">${pts
        .map(([x, y]) => `<di:waypoint x="${Math.round(x)}" y="${Math.round(y)}" />`)
        .join('')}</bpmndi:BPMNEdge>`;
    })
    .join('\n');
  const shapes = nodes
    .map((n) => {
      const p = pos.get(n.id)!;
      return `      <bpmndi:BPMNShape id="${n.id}_di" bpmnElement="${n.id}"${n.type.endsWith('Gateway') ? ' isMarkerVisible="true"' : ''}><dc:Bounds x="${Math.round(p.x)}" y="${Math.round(p.y)}" width="${p.w}" height="${p.h}" /></bpmndi:BPMNShape>`;
    })
    .join('\n');
  const laneShapes = lanes
    .map(
      (l, i) =>
        `      <bpmndi:BPMNShape id="${l.id}_di" bpmnElement="${l.id}" isHorizontal="true"><dc:Bounds x="${LEFT}" y="${30 + i * LANE_H}" width="${width - LEFT}" height="${LANE_H}" /></bpmndi:BPMNShape>`,
    )
    .join('\n');
  const pool = lanes.length
    ? `      <bpmndi:BPMNShape id="Pool_${processKey}_di" bpmnElement="Pool_${processKey}" isHorizontal="true"><dc:Bounds x="${LEFT - 30}" y="30" width="${width - LEFT + 30}" height="${height}" /></bpmndi:BPMNShape>\n`
    : '';
  const collab = lanes.length
    ? `  <bpmn:collaboration id="Collab_${processKey}"><bpmn:participant id="Pool_${processKey}" processRef="Process_${processKey}" /></bpmn:collaboration>\n`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ph="${PH_NS}" id="Definitions_${processKey}" targetNamespace="http://processhub.local/bpmn">
${errors ? `${errors}\n` : ''}${collab}  <bpmn:process id="Process_${processKey}" isExecutable="true">
${laneXml}
${xmlNodes}
${xmlFlows}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_${processKey}">
    <bpmndi:BPMNPlane id="Plane_${processKey}" bpmnElement="${lanes.length ? `Collab_${processKey}` : `Process_${processKey}`}">
${pool}${laneShapes}
${shapes}
${edges}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}
