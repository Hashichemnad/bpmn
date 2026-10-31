/**
 * Layered auto-layout of the application landscape (Phase 4.3, D-110): applications are ranked
 * by the longest chain of interfaces leading to them (cycles broken by depth-first search), then
 * ordered inside each rank by the average position of their neighbours (two barycentre sweeps).
 * Applications without interfaces go to a last row. Pure function, no DOM.
 */
export interface LayoutNode {
  id: string;
}
export interface LayoutEdge {
  sourceId: string;
  targetId: string;
}
export interface Placed {
  x: number;
  y: number;
}
export interface LandscapeLayout {
  positions: Map<string, Placed>;
  width: number;
  height: number;
}

export const NODE_W = 190;
export const NODE_H = 58;
const GAP_X = 110;
const GAP_Y = 28;
const MARGIN = 24;
const ISOLATED_PER_ROW = 6;

export function layoutLandscape(nodes: LayoutNode[], edges: LayoutEdge[]): LandscapeLayout {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const valid = edges.filter(
    (e) => known.has(e.sourceId) && known.has(e.targetId) && e.sourceId !== e.targetId,
  );
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of valid) out.get(e.sourceId)!.push(e.targetId);

  // Break cycles: drop edges that point back to a node on the current DFS path.
  const state = new Map<string, 0 | 1 | 2>();
  const forward = new Map<string, string[]>(ids.map((id) => [id, []]));
  const visit = (id: string) => {
    state.set(id, 1);
    for (const next of out.get(id)!) {
      const s = state.get(next) ?? 0;
      if (s === 1) continue;
      forward.get(id)!.push(next);
      if (s === 0) visit(next);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.get(id)) visit(id);

  // Longest-path ranks over the acyclic edges.
  const rank = new Map<string, number>();
  const incoming = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const targets of forward.values())
    for (const t of targets) incoming.set(t, incoming.get(t)! + 1);
  const queue = ids.filter((id) => incoming.get(id) === 0);
  for (const id of queue) rank.set(id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const t of forward.get(id)!) {
      rank.set(t, Math.max(rank.get(t) ?? 0, rank.get(id)! + 1));
      incoming.set(t, incoming.get(t)! - 1);
      if (incoming.get(t) === 0) queue.push(t);
    }
  }

  const connected = new Set(valid.flatMap((e) => [e.sourceId, e.targetId]));
  const layers: string[][] = [];
  for (const id of ids) {
    if (!connected.has(id)) continue;
    const r = rank.get(id) ?? 0;
    (layers[r] ??= []).push(id);
  }
  const compact = layers.filter((l) => l?.length);

  // Barycentre ordering: neighbours in the previous layer, then the next layer.
  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of valid) {
    neighbours.get(e.sourceId)!.push(e.targetId);
    neighbours.get(e.targetId)!.push(e.sourceId);
  }
  const indexIn = new Map<string, number>();
  compact.forEach((l) => l.forEach((id, i) => indexIn.set(id, i)));
  const sweep = (from: number, to: number, step: number) => {
    for (let i = from; i !== to; i += step) {
      const ref = new Set(compact[i - step]);
      const layer = compact[i];
      const score = (id: string) => {
        const ns = neighbours.get(id)!.filter((n) => ref.has(n));
        return ns.length
          ? ns.reduce((s, n) => s + indexIn.get(n)!, 0) / ns.length
          : indexIn.get(id)!;
      };
      layer.sort((a, b) => score(a) - score(b));
      layer.forEach((id, k) => indexIn.set(id, k));
    }
  };
  if (compact.length > 1) {
    sweep(1, compact.length, 1);
    sweep(compact.length - 2, -1, -1);
  }

  const positions = new Map<string, Placed>();
  const tallest = Math.max(0, ...compact.map((l) => l.length));
  const columnHeight = tallest * (NODE_H + GAP_Y) - GAP_Y;
  compact.forEach((layer, c) => {
    const offset = (columnHeight - (layer.length * (NODE_H + GAP_Y) - GAP_Y)) / 2;
    layer.forEach((id, r) =>
      positions.set(id, {
        x: MARGIN + c * (NODE_W + GAP_X),
        y: MARGIN + Math.max(0, offset) + r * (NODE_H + GAP_Y),
      }),
    );
  });
  const isolated = ids.filter((id) => !connected.has(id));
  const top = compact.length ? MARGIN + columnHeight + GAP_Y * 2 : MARGIN;
  isolated.forEach((id, i) =>
    positions.set(id, {
      x: MARGIN + (i % ISOLATED_PER_ROW) * (NODE_W + GAP_Y),
      y: top + Math.floor(i / ISOLATED_PER_ROW) * (NODE_H + GAP_Y),
    }),
  );
  let width = 0;
  let height = 0;
  for (const p of positions.values()) {
    width = Math.max(width, p.x + NODE_W + MARGIN);
    height = Math.max(height, p.y + NODE_H + MARGIN);
  }
  return { positions, width: Math.max(width, 320), height: Math.max(height, 160) };
}
