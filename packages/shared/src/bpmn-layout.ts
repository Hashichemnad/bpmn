/**
 * Layered layout of a BPMN process (used by the AI builder on the server and by the modeler's
 * "Auto-layout" command in the browser). Pure geometry: no XML, no DOM.
 *
 * Node types may be given as `userTask` or `bpmn:UserTask`.
 */

export interface LayoutNode {
  id: string;
  type: string;
  /** Lane id; empty when the process has no lanes. */
  lane: string;
  /** Current size of the shape; defaults by kind (activities 100×80, gateways 50, events 36). */
  width?: number;
  height?: number;
}

export interface LayoutFlow {
  from: string;
  to: string;
  nameEn?: string;
  nameAr?: string;
}

export interface LayoutInput<N extends LayoutNode = LayoutNode, F extends LayoutFlow = LayoutFlow> {
  lanes: { id: string }[];
  nodes: N[];
  flows: F[];
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedNode<N extends LayoutNode = LayoutNode> extends Bounds {
  node: N;
  col: number;
  lane: string;
  row: number;
}

export interface LayoutResult<
  N extends LayoutNode = LayoutNode,
  F extends LayoutFlow = LayoutFlow,
> {
  placed: Map<string, PlacedNode<N>>;
  edges: { flow: F; points: { x: number; y: number }[]; label?: Bounds }[];
  lanes: { lane: { id: string }; x: number; y: number; w: number; h: number }[];
  pool: Bounds;
}

const local = (type: string) => type.replace(/^bpmn:/, '').toLowerCase();
export const isLayoutGateway = (type: string) => local(type).endsWith('gateway');
export const isLayoutEvent = (type: string) => local(type).endsWith('event');

const SIZE: Record<'event' | 'gateway' | 'activity', [number, number]> = {
  event: [36, 36],
  gateway: [50, 50],
  activity: [100, 80],
};
const kindOf = (t: string) =>
  isLayoutGateway(t) ? 'gateway' : isLayoutEvent(t) ? 'event' : 'activity';
export const defaultShapeSize = (type: string): [number, number] => SIZE[kindOf(type)];

/** Horizontal distance between column centres and vertical distance between rows of a lane. */
const COL_W = 160;
const ROW_H = 120;
/** Free space next to the widest shape of a column / above and below the tallest of a row. */
const COL_GAP = COL_W - SIZE.activity[0];
const ROW_GAP = ROW_H - SIZE.activity[1];
const POOL_X = 160;
const POOL_Y = 80;
const POOL_LABEL_W = 30;
const FIRST_COL = POOL_X + POOL_LABEL_W + 70;
const LANE_PAD = 10;
/** Distance of a loop-back line below the lower of its two shapes. */
const LOOP_GAP = ROW_GAP / 2 + 2;

/** Sequence-flow labels: at most this wide (bpmn-js wraps longer text), one line high per row. */
const LABEL_MAX_W = 110;
const LABEL_LINE_H = 14;

/**
 * Label bounds of a sequence flow. A branch leaving a gateway gets its label at the start of its
 * own horizontal segment (never on the vertical trunk shared with the other branches); other
 * flows get it centred above their longest horizontal segment.
 */
export function flowLabelBounds(
  points: { x: number; y: number }[],
  text: string,
  fromGateway: boolean,
): Bounds {
  const textW = Math.round(text.length * 6.2) + 4;
  const w = Math.max(24, Math.min(LABEL_MAX_W, textW));
  const h = LABEL_LINE_H * Math.max(1, Math.ceil(textW / LABEL_MAX_W));
  const segments = points.slice(1).map((p, i) => ({ a: points[i], b: p }));
  const horizontal = segments.filter((sg) => sg.a.y === sg.b.y && sg.a.x !== sg.b.x);
  const seg = fromGateway
    ? horizontal[0]
    : [...horizontal].sort((m, n) => Math.abs(n.b.x - n.a.x) - Math.abs(m.b.x - m.a.x))[0];
  if (!seg) {
    // Only vertical segments: next to the middle of the first one.
    const a = points[0];
    const b = points[1] ?? a;
    return { x: Math.round(a.x + 6), y: Math.round((a.y + b.y) / 2 - h / 2), w, h };
  }
  const rightwards = seg.b.x > seg.a.x;
  const x = fromGateway
    ? rightwards
      ? seg.a.x + 8
      : seg.a.x - 8 - w
    : (seg.a.x + seg.b.x) / 2 - w / 2;
  return { x: Math.round(x), y: Math.round(seg.a.y - h - 3), w, h };
}

/**
 * Layered layout (Sugiyama-style ranking): columns are the longest path from a start event over
 * the flow graph without its back edges; each lane is a horizontal band whose rows hold nodes
 * of the same column. Columns and rows grow for shapes larger than the defaults (expanded
 * sub-processes). Edges are routed orthogonally; loops go back below their row.
 */
export function layoutStructure<N extends LayoutNode, F extends LayoutFlow>(
  s: LayoutInput<N, F>,
): LayoutResult<N, F> {
  const ids = s.nodes.map((n) => n.id);
  const known = new Set(ids);
  const flows = s.flows.filter((f) => known.has(f.from) && known.has(f.to));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const f of flows) out.get(f.from)?.push(f.to);

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
  for (const n of s.nodes) if (local(n.type) === 'startevent' && !state.has(n.id)) visit(n.id);
  for (const id of ids) if (!state.has(id)) visit(id);

  // Topological order of the remaining DAG, then longest-path columns.
  const forward = flows.filter((f) => !back.has(`${f.from}->${f.to}`));
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
  const laneIds = new Set(s.lanes.map((l) => l.id));
  const laneOf = (n: LayoutNode) =>
    s.lanes.length ? (laneIds.has(n.lane) ? n.lane : s.lanes[0].id) : '';
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const rowOf = new Map<string, number>();
  const taken = new Set<string>();
  const position = new Map(order.map((id, i) => [id, i]));
  const ordered = [...order].sort(
    (a, b) => col.get(a)! - col.get(b)! || position.get(a)! - position.get(b)!,
  );
  for (const id of ordered) {
    const n = byId.get(id)!;
    const pred = forward.find((f) => f.to === id && laneOf(byId.get(f.from)!) === laneOf(n));
    const preferred = pred ? (rowOf.get(pred.from) ?? 0) : 0;
    let row = preferred;
    for (let d = 0; d < 1000; d++) {
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

  const size = (n: LayoutNode): [number, number] => {
    const [w, h] = defaultShapeSize(n.type);
    return [n.width ?? w, n.height ?? h];
  };

  // Column widths and row heights grow with the largest shape they hold.
  const maxCol = Math.max(0, ...col.values());
  const colW = Array.from({ length: maxCol + 1 }, () => COL_W);
  for (const n of s.nodes) {
    const c = col.get(n.id)!;
    colW[c] = Math.max(colW[c], size(n)[0] + COL_GAP);
  }
  const colCentre: number[] = [];
  for (let c = 0; c <= maxCol; c++)
    colCentre[c] =
      c === 0
        ? FIRST_COL + (colW[0] - COL_W) / 2
        : colCentre[c - 1] + colW[c - 1] / 2 + colW[c] / 2;

  const laneKeys = s.lanes.length ? s.lanes.map((l) => l.id) : [''];
  const rowH = new Map<string, number[]>(
    laneKeys.map((k) => {
      const rows = Math.max(
        1,
        ...s.nodes.filter((n) => laneOf(n) === k).map((n) => rowOf.get(n.id)! + 1),
      );
      return [k, Array.from({ length: rows }, () => ROW_H)];
    }),
  );
  for (const n of s.nodes) {
    const heights = rowH.get(laneOf(n))!;
    const r = rowOf.get(n.id)!;
    heights[r] = Math.max(heights[r], size(n)[1] + ROW_GAP);
  }
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const laneTop = new Map<string, number>();
  let y = POOL_Y;
  for (const k of laneKeys) {
    laneTop.set(k, y);
    y += sum(rowH.get(k)!) + 2 * LANE_PAD;
  }
  const height = y - POOL_Y;
  const width = colCentre[maxCol] - POOL_X + Math.max(90, colW[maxCol] / 2 + 10);

  const placed = new Map<string, PlacedNode<N>>();
  for (const n of s.nodes) {
    const [w, h] = size(n);
    const lane = laneOf(n);
    const r = rowOf.get(n.id)!;
    const heights = rowH.get(lane)!;
    const cx = colCentre[col.get(n.id)!];
    const cy = laneTop.get(lane)! + LANE_PAD + sum(heights.slice(0, r)) + heights[r] / 2;
    placed.set(n.id, {
      node: n,
      col: col.get(n.id)!,
      lane,
      row: r,
      x: Math.round(cx - w / 2),
      y: Math.round(cy - h / 2),
      w,
      h,
    });
  }

  const edges = flows.map((f) => {
    const a = placed.get(f.from)!;
    const b = placed.get(f.to)!;
    const acx = a.x + a.w / 2;
    const acy = a.y + a.h / 2;
    const bcx = b.x + b.w / 2;
    const bcy = b.y + b.h / 2;
    let points: { x: number; y: number }[];
    if (back.has(`${f.from}->${f.to}`) || b.col <= a.col) {
      // Loop back below both shapes.
      const loopY = Math.max(a.y + a.h, b.y + b.h) + LOOP_GAP;
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
    } else if (isLayoutGateway(a.node.type)) {
      // Split: leave the gateway at the top or bottom, then go right.
      points = [
        { x: acx, y: bcy > acy ? a.y + a.h : a.y },
        { x: acx, y: bcy },
        { x: b.x, y: bcy },
      ];
    } else if (isLayoutGateway(b.node.type)) {
      // Join: go right, then enter the gateway from the top or bottom.
      points = [
        { x: a.x + a.w, y: acy },
        { x: bcx, y: acy },
        { x: bcx, y: acy > bcy ? b.y + b.h : b.y },
      ];
    } else {
      const midX = b.x - COL_GAP / 2;
      points = [
        { x: a.x + a.w, y: acy },
        { x: midX, y: acy },
        { x: midX, y: bcy },
        { x: b.x, y: bcy },
      ];
    }
    const rounded = points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    const text = [f.nameEn ?? '', f.nameAr ?? ''].sort((m, n) => n.length - m.length)[0];
    const label = text.trim()
      ? flowLabelBounds(rounded, text, isLayoutGateway(a.node.type))
      : undefined;
    return { flow: f, points: rounded, label };
  });

  const lanes = s.lanes.map((l) => ({
    lane: l,
    x: POOL_X + POOL_LABEL_W,
    y: laneTop.get(l.id)!,
    w: width - POOL_LABEL_W,
    h: sum(rowH.get(l.id)!) + 2 * LANE_PAD,
  }));
  return { placed, edges, lanes, pool: { x: POOL_X, y: POOL_Y, w: width, h: height } };
}
