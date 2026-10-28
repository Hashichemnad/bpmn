import { isFlowNode, layoutStructure, type LayoutFlow, type LayoutNode } from '@processhub/shared';
import type { BpmnInstance, CommandStack, DiagramElement, ElementRegistry } from './bpmn-types';

/**
 * Auto-layout for the modeler: the whole diagram is re-arranged with the shared layered layout
 * (the one the AI assistant uses) as ONE undoable command. Only geometry changes — ids, labels,
 * colours, step kinds, links and comments stay as they are.
 */

interface Point {
  x: number;
  y: number;
}
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
type Shape = DiagramElement &
  Box & {
    children?: Element[];
    attachers?: Shape[];
    label?: Shape;
    labels?: Shape[];
    incoming?: Connection[];
    outgoing?: Connection[];
    di?: { isHorizontal?: boolean };
  };
type Connection = DiagramElement & {
  waypoints: Point[];
  source: Shape;
  target: Shape;
  label?: Shape;
  labels?: Shape[];
};
type Element = Shape | Connection;

const isConnection = (el: Element): el is Connection => 'waypoints' in el && !!el.waypoints;

export type AutoLayoutProblem = 'SEVERAL_POOLS' | 'VERTICAL_LANES' | 'NOTHING_TO_LAYOUT';

export interface AutoLayoutPlan {
  shapes: { element: Shape; bounds: Box }[];
  /** `waypoints: null` — connection outside the layout (message flow, association…): re-routed. */
  connections: { element: Connection; waypoints: Point[] | null }[];
}

const shift = (b: Box, dx: number, dy: number): Box => ({
  x: b.x + dx,
  y: b.y + dy,
  width: b.width,
  height: b.height,
});
const labelsOf = (el: Shape | Connection) => el.labels ?? (el.label ? [el.label] : []);

/** Works out the new geometry of every element; nothing is changed yet. */
export function planAutoLayout(
  registry: ElementRegistry,
): { plan: AutoLayoutPlan } | { problem: AutoLayoutProblem } {
  const all = registry.getAll() as Element[];
  const participants = all.filter((e) => e.type === 'bpmn:Participant') as Shape[];
  if (participants.length > 1) return { problem: 'SEVERAL_POOLS' };
  const pool = participants[0];
  const lanesAll = all.filter((e) => e.type === 'bpmn:Lane') as Shape[];
  if ([pool, ...lanesAll].some((s) => s?.di?.isHorizontal === false))
    return { problem: 'VERTICAL_LANES' };

  // Flow nodes directly in the process (or pool / lanes) — not inside expanded sub-processes.
  const container = (el: DiagramElement) => {
    let p = el.parent;
    while (p && p.type === 'bpmn:Lane') p = p.parent;
    return p;
  };
  const nodes = all.filter(
    (e): e is Shape =>
      !isConnection(e) &&
      isFlowNode(e.type) &&
      e.type !== 'label' &&
      ['bpmn:Process', 'bpmn:Participant'].includes(container(e)?.type ?? ''),
  );
  if (!nodes.length) return { problem: 'NOTHING_TO_LAYOUT' };
  const inScope = new Set(nodes.map((n) => n.id));

  const leafLanes = lanesAll
    .filter((l) => !l.children?.some((c) => c.type === 'bpmn:Lane'))
    .sort((a, b) => a.y - b.y);
  const laneOfBo = new Map<unknown, string>();
  for (const lane of leafLanes) {
    const refs = (lane.businessObject as unknown as { flowNodeRef?: unknown[] }).flowNodeRef ?? [];
    for (const bo of refs) laneOfBo.set(bo, lane.id);
  }

  const flows = all.filter(
    (e): e is Connection =>
      isConnection(e) &&
      e.type === 'bpmn:SequenceFlow' &&
      inScope.has(e.source?.id) &&
      inScope.has(e.target?.id),
  );
  type N = LayoutNode & { shape: Shape };
  type F = LayoutFlow & { connection: Connection };
  const layout = layoutStructure<N, F>({
    lanes: leafLanes.map((l) => ({ id: l.id })),
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      lane: laneOfBo.get(n.businessObject) ?? '',
      width: n.width,
      height: n.height,
      shape: n,
    })),
    flows: flows.map((c) => ({
      from: c.source.id,
      to: c.target.id,
      nameEn: c.businessObject.name ?? '',
      connection: c,
    })),
  });

  // Keep the diagram where it was: the pool's top-left corner, else the first node's.
  const placed = [...layout.placed.values()];
  const dx = pool
    ? pool.x - layout.pool.x
    : Math.min(...nodes.map((n) => n.x)) - Math.min(...placed.map((p) => p.x));
  const dy = pool
    ? pool.y - layout.pool.y
    : Math.min(...nodes.map((n) => n.y)) - Math.min(...placed.map((p) => p.y));

  const shapes = new Map<Shape, Box>();
  const connections = new Map<Connection, Point[] | null>();
  /** Delta of each moved shape, used for the elements that travel with it. */
  const deltas = new Map<Shape, Point>();

  const carry = (shape: Shape, d: Point) => {
    deltas.set(shape, d);
    for (const label of labelsOf(shape)) shapes.set(label, shift(label, d.x, d.y));
    for (const attacher of shape.attachers ?? []) {
      shapes.set(attacher, shift(attacher, d.x, d.y));
      carry(attacher, d);
    }
    for (const child of shape.children ?? []) {
      if (isConnection(child)) continue;
      if (child.type === 'label' || shapes.has(child)) continue;
      shapes.set(child, shift(child, d.x, d.y));
      carry(child, d);
    }
  };

  for (const p of placed) {
    const shape = p.node.shape;
    const bounds = { x: p.x + dx, y: p.y + dy, width: p.w, height: p.h };
    shapes.set(shape, bounds);
    carry(shape, { x: bounds.x - shape.x, y: bounds.y - shape.y });
  }

  if (pool) {
    const right = pool.x + layout.pool.w;
    shapes.set(pool, { x: pool.x, y: pool.y, width: layout.pool.w, height: layout.pool.h });
    // Lanes keep their horizontal position (nested lanes keep their header bands).
    for (const band of layout.lanes) {
      const lane = leafLanes.find((l) => l.id === band.lane.id)!;
      shapes.set(lane, { x: lane.x, y: band.y + dy, width: right - lane.x, height: band.h });
    }
    // Parent lanes enclose their child lanes.
    const enclose = (lane: Shape): Box => {
      const own = shapes.get(lane);
      if (own) return own;
      const boxes = (lane.children ?? [])
        .filter((c): c is Shape => c.type === 'bpmn:Lane')
        .map(enclose);
      const y = Math.min(...boxes.map((b) => b.y));
      const box = {
        x: lane.x,
        y,
        width: right - lane.x,
        height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
      };
      shapes.set(lane, box);
      return box;
    };
    for (const lane of lanesAll) enclose(lane);
  }

  for (const edge of layout.edges) {
    const c = edge.flow.connection;
    connections.set(
      c,
      edge.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })),
    );
    for (const label of labelsOf(c)) {
      if (edge.label) {
        shapes.set(label, {
          x: edge.label.x + dx,
          y: edge.label.y + dy,
          width: label.width,
          height: label.height,
        });
      } else {
        const d = deltas.get(c.source) ?? { x: 0, y: 0 };
        shapes.set(label, shift(label, d.x, d.y));
      }
    }
  }

  // Other connections touching a moved shape: inside a moved sub-tree they travel with it,
  // anything else (message flows, associations, data associations) is re-routed.
  for (const c of all.filter(isConnection)) {
    if (connections.has(c)) continue;
    const ds = deltas.get(c.source);
    const dt = deltas.get(c.target);
    if (!ds && !dt) continue;
    if (ds && dt && ds.x === dt.x && ds.y === dt.y && !inScope.has(c.source.id)) {
      connections.set(
        c,
        c.waypoints.map((pt) => ({ x: pt.x + ds.x, y: pt.y + ds.y })),
      );
    } else connections.set(c, null);
    const d = ds ?? dt!;
    for (const label of labelsOf(c)) shapes.set(label, shift(label, d.x, d.y));
  }

  return {
    plan: {
      shapes: [...shapes].map(([element, bounds]) => ({ element, bounds })),
      connections: [...connections].map(([element, waypoints]) => ({ element, waypoints })),
    },
  };
}

interface Updater {
  updateBounds(shape: Shape): void;
  updateConnectionWaypoints(connection: Connection): void;
}
interface Layouter {
  layoutConnection(connection: Connection, hints?: unknown): Point[];
}
interface Docking {
  getCroppedWaypoints(connection: Connection): Point[];
}

interface Context {
  plan: AutoLayoutPlan;
  old?: { shapes: [Shape, Box][]; connections: [Connection, Point[]][] };
}

/** Command handler `ph.autoLayout`: applies a plan; revert restores every bound and waypoint. */
class AutoLayoutHandler {
  static $inject = ['bpmnUpdater', 'layouter', 'connectionDocking'];

  constructor(
    private readonly updater: Updater,
    private readonly layouter: Layouter,
    private readonly docking: Docking,
  ) {}

  execute(context: Context) {
    const { plan } = context;
    context.old = {
      shapes: plan.shapes.map(({ element: e }) => [
        e,
        { x: e.x, y: e.y, width: e.width, height: e.height },
      ]),
      connections: plan.connections.map(({ element: c }) => [
        c,
        c.waypoints.map((p) => ({ x: p.x, y: p.y })),
      ]),
    };
    for (const { element, bounds } of plan.shapes) {
      Object.assign(element, bounds);
      this.updater.updateBounds(element);
    }
    for (const { element, waypoints } of plan.connections) {
      if (waypoints) element.waypoints = waypoints;
      else {
        element.waypoints = this.layouter.layoutConnection(element);
        element.waypoints = this.docking.getCroppedWaypoints(element);
      }
      this.updater.updateConnectionWaypoints(element);
    }
    return [...plan.shapes.map((s) => s.element), ...plan.connections.map((c) => c.element)];
  }

  revert(context: Context) {
    const old = context.old!;
    for (const [element, bounds] of old.shapes) {
      Object.assign(element, bounds);
      this.updater.updateBounds(element);
    }
    for (const [element, waypoints] of old.connections) {
      element.waypoints = waypoints;
      this.updater.updateConnectionWaypoints(element);
    }
    return [...old.shapes.map(([e]) => e), ...old.connections.map(([c]) => c)];
  }
}

class AutoLayoutRegistration {
  static $inject = ['commandStack'];
  constructor(commandStack: { registerHandler(name: string, handler: unknown): void }) {
    commandStack.registerHandler('ph.autoLayout', AutoLayoutHandler);
  }
}

export const autoLayoutModule = {
  __init__: ['phAutoLayout'],
  phAutoLayout: ['type', AutoLayoutRegistration],
};

/** Re-arranges the diagram (one undo step). Returns a problem when the diagram is not supported. */
export function runAutoLayout(instance: BpmnInstance): AutoLayoutProblem | null {
  const result = planAutoLayout(instance.get<ElementRegistry>('elementRegistry'));
  if ('problem' in result) return result.problem;
  instance
    .get<CommandStack & { execute(cmd: string, ctx: unknown): void }>('commandStack')
    .execute('ph.autoLayout', { plan: result.plan });
  return null;
}
