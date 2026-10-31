import dagre from '@dagrejs/dagre';
import { END, START, type DfgEdge, type DfgNode } from '@processhub/shared';

/**
 * Layout and simplification of the process map (D-133): the path slider keeps the most frequent
 * edges but never leaves an activity without its strongest incoming and outgoing edge; dagre
 * places the nodes top to bottom (the same in Arabic: the flow reads downwards).
 */
export interface MapEdgeLike {
  from: string;
  to: string;
  count: number;
}

export function simplifyEdges<E extends MapEdgeLike>(edges: E[], pathLevel: number): E[] {
  if (pathLevel >= 1 || edges.length < 3) return edges;
  const sorted = [...edges].sort((a, b) => b.count - a.count);
  const keep = new Set(sorted.slice(0, Math.max(1, Math.ceil(sorted.length * pathLevel))));
  const best = (key: 'from' | 'to') => {
    const m = new Map<string, E>();
    for (const e of sorted) if (e.from !== e.to && !m.has(e[key])) m.set(e[key], e);
    return m;
  };
  for (const e of best('from').values()) keep.add(e);
  for (const e of best('to').values()) keep.add(e);
  return edges.filter((e) => keep.has(e));
}

export interface PlacedNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  marker: boolean;
}

export interface PlacedEdge<E> {
  edge: E;
  points: { x: number; y: number }[];
}

export const NODE_W = 190;
export const NODE_H = 48;
const MARK = 32;

export function layoutMap<E extends MapEdgeLike>(
  nodes: { id: string; label: string }[],
  edges: E[],
): { nodes: PlacedNode[]; edges: PlacedEdge<E>[]; width: number; height: number } {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60, edgesep: 20, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const marker = n.id === START || n.id === END;
    g.setNode(n.id, {
      label: n.label,
      width: marker ? MARK : NODE_W,
      height: marker ? MARK : NODE_H,
    });
  }
  edges.forEach((e, i) => {
    if (g.hasNode(e.from) && g.hasNode(e.to) && e.from !== e.to)
      g.setEdge(
        e.from,
        e.to,
        { weight: Math.max(1, Math.log2(e.count + 1)), labelpos: 'c', width: 40, height: 16 },
        `e${i}`,
      );
  });
  dagre.layout(g);
  const placed: PlacedNode[] = nodes
    .filter((n) => g.hasNode(n.id))
    .map((n) => {
      const v = g.node(n.id);
      return {
        id: n.id,
        label: n.label,
        x: v.x,
        y: v.y,
        width: v.width,
        height: v.height,
        marker: n.id === START || n.id === END,
      };
    });
  const byId = new Map(placed.map((p) => [p.id, p]));
  const placedEdges: PlacedEdge<E>[] = edges.map((e, i) => {
    if (e.from === e.to) {
      // Self loop: a small arc on the right side of the node.
      const n = byId.get(e.from)!;
      const x = n.x + n.width / 2;
      return {
        edge: e,
        points: [
          { x, y: n.y - 10 },
          { x: x + 28, y: n.y - 18 },
          { x: x + 28, y: n.y + 18 },
          { x, y: n.y + 10 },
        ],
      };
    }
    const ge = g.edge({ v: e.from, w: e.to, name: `e${i}` });
    return { edge: e, points: ge?.points ?? [] };
  });
  const graph = g.graph();
  return {
    nodes: placed,
    edges: placedEdges,
    width: (graph.width ?? 400) + 40,
    height: (graph.height ?? 300) + 20,
  };
}

/** Nodes of a map result, with the start and end markers. */
export function mapNodes(nodes: DfgNode[]): { id: string; label: string }[] {
  return [
    { id: START, label: START },
    ...nodes.map((n) => ({ id: n.activity, label: n.activity })),
    { id: END, label: END },
  ];
}

/** Edges along a variant (for highlighting). */
export function variantEdges(acts: string[]): Set<string> {
  const keys = new Set<string>();
  const path = [START, ...acts, END];
  for (let i = 0; i + 1 < path.length; i++) keys.add(`${path[i]}\u0001${path[i + 1]}`);
  return keys;
}

export const edgeKey = (e: Pick<DfgEdge, 'from' | 'to'>) => `${e.from}\u0001${e.to}`;
