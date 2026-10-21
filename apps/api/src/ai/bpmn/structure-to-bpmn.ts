import {
  isActivity,
  isGateway,
  type NodeType,
  type ProcessStructure,
  type StructureNode,
} from './process-structure';

export const PH_NAMESPACE = 'http://processhub.io/schema/bpmn';

/** Attributes of existing elements the structure does not carry (kept when refining). */
export interface PreservedElement {
  linkedProcessId?: string;
}

export interface BuildOptions {
  /** Suffix for the process / collaboration ids. */
  key: string;
  preserve?: Map<string, PreservedElement>;
  /** Existing sequence-flow ids by "from->to", reused so comments and diffs stay stable. */
  flowIds?: Map<string, string>;
  /** Ids of the existing definitions / process / pool, kept so a refinement diffs cleanly. */
  containers?: ContainerIds;
}

export interface ContainerIds {
  definitions?: string;
  process?: string;
  collaboration?: string;
  participant?: string;
  laneSet?: string;
}

const SIZE: Record<'event' | 'gateway' | 'activity', [number, number]> = {
  event: [36, 36],
  gateway: [50, 50],
  activity: [100, 80],
};
const kind = (t: NodeType) => (isGateway(t) ? 'gateway' : isActivity(t) ? 'activity' : 'event');
const sizeOf = (t: NodeType) => SIZE[kind(t)];

/** Horizontal distance between column centres and vertical distance between rows of a lane. */
const COL_W = 160;
const ROW_H = 120;
const POOL_X = 160;
const POOL_Y = 80;
const POOL_LABEL_W = 30;
const FIRST_COL = POOL_X + POOL_LABEL_W + 70;
const LANE_PAD = 10;

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, '&#10;');

const labelAttrs = (en: string, ar: string) =>
  en || ar ? ` name="${esc(en || ar)}" ph:nameEn="${esc(en)}" ph:nameAr="${esc(ar)}"` : '';

interface Placed {
  node: StructureNode;
  col: number;
  lane: string;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Layered layout (Sugiyama-style ranking): columns are the longest path from a start event over
 * the flow graph without its back edges; each lane is a horizontal band whose rows hold nodes
 * of the same column. Edges are routed orthogonally; loops go back below their row.
 */
export function layoutStructure(s: ProcessStructure) {
  const ids = s.nodes.map((n) => n.id);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const f of s.flows) out.get(f.from)?.push(f.to);

  // Back edges: found by depth-first search from the start events (then any unvisited node).
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const t of out.get(id) ?? []) {
      if (state.get(t) === 1) back.add(`${id}->${t}`);
      else if (!state.has(t)) visit(t);
    }
    state.set(id, 2);
  };
  for (const n of s.nodes) if (n.type === 'startEvent' && !state.has(n.id)) visit(n.id);
  for (const id of ids) if (!state.has(id)) visit(id);

  // Topological order of the remaining DAG, then longest-path columns.
  const forward = s.flows.filter((f) => !back.has(`${f.from}->${f.to}`));
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const f of forward) indeg.set(f.to, (indeg.get(f.to) ?? 0) + 1);
  const order: string[] = [];
  const queue = ids.filter((id) => !indeg.get(id));
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const f of forward.filter((x) => x.from === id)) {
      indeg.set(f.to, indeg.get(f.to)! - 1);
      if (!indeg.get(f.to)) queue.push(f.to);
    }
  }
  const col = new Map(ids.map((id) => [id, 0]));
  for (const id of order)
    for (const f of forward.filter((x) => x.from === id))
      col.set(f.to, Math.max(col.get(f.to)!, col.get(id)! + 1));

  // Rows inside each lane: follow the first predecessor's row, else the nearest free row.
  const laneOf = (n: StructureNode) => (s.lanes.length ? n.lane : '');
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const rowOf = new Map<string, number>();
  const taken = new Set<string>();
  const ordered = [...order].sort(
    (a, b) => col.get(a)! - col.get(b)! || order.indexOf(a) - order.indexOf(b),
  );
  for (const id of ordered) {
    const n = byId.get(id)!;
    const pred = forward.find((f) => f.to === id && laneOf(byId.get(f.from)!) === laneOf(n));
    const preferred = pred ? (rowOf.get(pred.from) ?? 0) : 0;
    let row = preferred;
    for (let d = 0; d < 100; d++) {
      const candidates = [preferred + d, preferred - d].filter((r) => r >= 0);
      const free = candidates.find((r) => !taken.has(`${laneOf(n)}|${col.get(id)}|${r}`));
      if (free !== undefined) {
        row = free;
        break;
      }
    }
    rowOf.set(id, row);
    taken.add(`${laneOf(n)}|${col.get(id)}|${row}`);
  }

  const laneKeys = s.lanes.length ? s.lanes.map((l) => l.id) : [''];
  const laneRows = new Map(
    laneKeys.map((k) => [
      k,
      Math.max(1, ...s.nodes.filter((n) => laneOf(n) === k).map((n) => rowOf.get(n.id)! + 1)),
    ]),
  );
  const laneTop = new Map<string, number>();
  let y = POOL_Y;
  for (const k of laneKeys) {
    laneTop.set(k, y);
    y += laneRows.get(k)! * ROW_H + 2 * LANE_PAD;
  }
  const height = y - POOL_Y;
  const maxCol = Math.max(0, ...col.values());
  const width = FIRST_COL - POOL_X + maxCol * COL_W + 90;

  const placed = new Map<string, Placed>();
  for (const n of s.nodes) {
    const [w, h] = sizeOf(n.type);
    const cx = FIRST_COL + col.get(n.id)! * COL_W;
    const cy = laneTop.get(laneOf(n))! + LANE_PAD + rowOf.get(n.id)! * ROW_H + ROW_H / 2;
    placed.set(n.id, {
      node: n,
      col: col.get(n.id)!,
      lane: laneOf(n),
      row: rowOf.get(n.id)!,
      x: Math.round(cx - w / 2),
      y: Math.round(cy - h / 2),
      w,
      h,
    });
  }

  const edges = s.flows.map((f) => {
    const a = placed.get(f.from)!;
    const b = placed.get(f.to)!;
    const acx = a.x + a.w / 2;
    const acy = a.y + a.h / 2;
    const bcx = b.x + b.w / 2;
    const bcy = b.y + b.h / 2;
    let points: { x: number; y: number }[];
    if (back.has(`${f.from}->${f.to}`) || b.col <= a.col) {
      // Loop back below both shapes.
      const loopY = Math.max(a.y + a.h, b.y + b.h) + (ROW_H - SIZE.activity[1]) / 2 + 2;
      points = [
        { x: acx, y: a.y + a.h },
        { x: acx, y: loopY },
        { x: bcx, y: loopY },
        { x: bcx, y: b.y + b.h },
      ];
    } else if (acy === bcy) {
      points = [
        { x: a.x + a.w, y: acy },
        { x: b.x, y: bcy },
      ];
    } else if (isGateway(a.node.type)) {
      // Split: leave the gateway at the top or bottom, then go right.
      points = [
        { x: acx, y: bcy > acy ? a.y + a.h : a.y },
        { x: acx, y: bcy },
        { x: b.x, y: bcy },
      ];
    } else if (isGateway(b.node.type)) {
      // Join: go right, then enter the gateway from the top or bottom.
      points = [
        { x: a.x + a.w, y: acy },
        { x: bcx, y: acy },
        { x: bcx, y: acy > bcy ? b.y + b.h : b.y },
      ];
    } else {
      const midX = b.x - (COL_W - SIZE.activity[0]) / 2;
      points = [
        { x: a.x + a.w, y: acy },
        { x: midX, y: acy },
        { x: midX, y: bcy },
        { x: b.x, y: bcy },
      ];
    }
    return { flow: f, points: points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })) };
  });

  const lanes = s.lanes.map((l) => ({
    lane: l,
    x: POOL_X + POOL_LABEL_W,
    y: laneTop.get(l.id)!,
    w: width - POOL_LABEL_W,
    h: laneRows.get(l.id)! * ROW_H + 2 * LANE_PAD,
  }));
  return { placed, edges, lanes, pool: { x: POOL_X, y: POOL_Y, w: width, h: height } };
}

function eventDefinitionXml(n: StructureNode, id: string): string {
  const def = n.eventDefinition;
  if (def === 'none' || !n.type.endsWith('Event')) return '';
  if (def === 'terminate' && n.type !== 'endEvent') return '';
  return `\n      <bpmn:${def}EventDefinition id="${id}_ed" />`;
}

/** BPMN 2.0 XML (semantic model + diagram interchange) with bilingual ph: labels. */
export function structureToBpmn(s: ProcessStructure, opts: BuildOptions): string {
  const layout = layoutStructure(s);
  const ids = {
    definitions: opts.containers?.definitions ?? `Definitions_${opts.key}`,
    process: opts.containers?.process ?? `Process_${opts.key}`,
    collaboration: opts.containers?.collaboration ?? `Collaboration_${opts.key}`,
    participant: opts.containers?.participant ?? `Participant_${opts.key}`,
    laneSet: opts.containers?.laneSet ?? `LaneSet_${opts.key}`,
  };
  const processId = ids.process;
  const flowIds = new Map<string, string>();
  const usedIds = new Set([
    ...s.nodes.map((n) => n.id),
    ...s.lanes.map((l) => l.id),
    ...Object.values(ids),
  ]);
  for (const [i, f] of s.flows.entries()) {
    const key = `${f.from}->${f.to}`;
    let id = opts.flowIds?.get(key);
    if (!id || usedIds.has(id)) id = `Flow_${i + 1}_${opts.key}`;
    usedIds.add(id);
    flowIds.set(key, id);
  }
  const fid = (f: { from: string; to: string }) => flowIds.get(`${f.from}->${f.to}`)!;

  const nodesXml = s.nodes
    .map((n) => {
      const refs = [
        ...s.flows
          .filter((f) => f.to === n.id)
          .map((f) => `\n      <bpmn:incoming>${fid(f)}</bpmn:incoming>`),
        ...s.flows
          .filter((f) => f.from === n.id)
          .map((f) => `\n      <bpmn:outgoing>${fid(f)}</bpmn:outgoing>`),
      ].join('');
      const keep = opts.preserve?.get(n.id);
      const link =
        keep?.linkedProcessId && (n.type === 'callActivity' || n.type === 'subProcess')
          ? ` ph:linkedProcessId="${esc(keep.linkedProcessId)}"`
          : '';
      const desc =
        (n.descriptionEn ? ` ph:descriptionEn="${esc(n.descriptionEn)}"` : '') +
        (n.descriptionAr ? ` ph:descriptionAr="${esc(n.descriptionAr)}"` : '');
      return `    <bpmn:${n.type} id="${n.id}"${labelAttrs(n.nameEn, n.nameAr)}${link}${desc}>${refs}${eventDefinitionXml(n, n.id)}\n    </bpmn:${n.type}>`;
    })
    .join('\n');
  const flowsXml = s.flows
    .map(
      (f) =>
        `    <bpmn:sequenceFlow id="${fid(f)}" sourceRef="${f.from}" targetRef="${f.to}"${labelAttrs(f.nameEn, f.nameAr)} />`,
    )
    .join('\n');
  const laneSetXml = s.lanes.length
    ? `    <bpmn:laneSet id="${ids.laneSet}">\n` +
      s.lanes
        .map(
          (l) =>
            `      <bpmn:lane id="${l.id}"${labelAttrs(l.nameEn, l.nameAr)}>\n` +
            s.nodes
              .filter((n) => n.lane === l.id)
              .map((n) => `        <bpmn:flowNodeRef>${n.id}</bpmn:flowNodeRef>`)
              .join('\n') +
            `\n      </bpmn:lane>`,
        )
        .join('\n') +
      `\n    </bpmn:laneSet>\n`
    : '';

  const shape = (id: string, b: { x: number; y: number; w: number; h: number }, extra = '') =>
    `      <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"${extra}>\n        <dc:Bounds x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" />\n      </bpmndi:BPMNShape>`;
  const pooled = s.lanes.length > 0;
  const participantId = ids.participant;
  const shapes = [
    ...(pooled ? [shape(participantId, layout.pool, ' isHorizontal="true"')] : []),
    ...layout.lanes.map((l) => shape(l.lane.id, l, ' isHorizontal="true"')),
    ...[...layout.placed.values()].map((p) =>
      shape(p.node.id, p, p.node.type === 'exclusiveGateway' ? ' isMarkerVisible="true"' : ''),
    ),
  ].join('\n');
  const edges = layout.edges
    .map(
      (e) =>
        `      <bpmndi:BPMNEdge id="${fid(e.flow)}_di" bpmnElement="${fid(e.flow)}">\n` +
        e.points.map((p) => `        <di:waypoint x="${p.x}" y="${p.y}" />`).join('\n') +
        `\n      </bpmndi:BPMNEdge>`,
    )
    .join('\n');
  const collaboration = pooled
    ? `  <bpmn:collaboration id="${ids.collaboration}">\n    <bpmn:participant id="${participantId}"${labelAttrs(s.nameEn, s.nameAr)} processRef="${processId}" />\n  </bpmn:collaboration>\n`
    : '';
  const planeElement = pooled ? ids.collaboration : processId;

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:ph="${PH_NAMESPACE}" id="${ids.definitions}" targetNamespace="http://bpmn.io/schema/bpmn">
${collaboration}  <bpmn:process id="${processId}" isExecutable="false">
${laneSetXml}${nodesXml}
${flowsXml}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_${opts.key}">
    <bpmndi:BPMNPlane id="Plane_${opts.key}" bpmnElement="${planeElement}">
${shapes}
${edges}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}
