import { decodeXml, isFlowNode } from './bpmn-validation';
import {
  readStepAttributes,
  type StepAttributeIssue,
  type StepAttributes,
} from './step-attributes';
import { stepTypeOf, type StepType } from './steps';

/**
 * A light, dependency-free reader of BPMN XML for the server and the browser (Modeler design B2):
 * flow nodes with their bilingual labels, lane, step type and step attributes, sequence flows and
 * lanes. Used for process totals, reports (handbook, RACI) and modeling conventions.
 */
export interface GraphNode {
  id: string;
  /** `bpmn:UserTask`, … */
  type: string;
  name: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  stepKind: string | null;
  stepType: StepType;
  laneId: string | null;
  /** Process or sub-process the node belongs to. */
  parentId: string | null;
  labelRef: string | null;
  linkedProcessId: string | null;
  attributes: StepAttributes;
  attributeIssues: StepAttributeIssue[];
  incoming: number;
  outgoing: number;
}

export interface GraphFlow {
  id: string;
  from: string;
  to: string;
  name: string;
  nameEn: string;
  nameAr: string;
}

export interface GraphLane {
  id: string;
  name: string;
  nameEn: string;
  nameAr: string;
  roleId: string | null;
  parentLaneId: string | null;
}

export interface BpmnGraph {
  nodes: GraphNode[];
  flows: GraphFlow[];
  lanes: GraphLane[];
  participants: number;
}

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)(?:[\w.-]+:)?([\w.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

interface Open {
  local: string;
  attrs: Record<string, string>;
}

/** Attributes by local name (`ph:nameEn` → `nameEn` under `ph`); keeps prefixed and plain keys. */
function readAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(s))) out[m[1]] = decodeXml(m[2] ?? m[3] ?? '');
  return out;
}

/** `ph:` attributes without the prefix (any prefix bound to the ProcessHub namespace is `ph` here). */
function phAttrs(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) if (k.startsWith('ph:')) out[k.slice(3)] = v;
  return out;
}

const bpmnType = (local: string) => `bpmn:${local[0].toUpperCase()}${local.slice(1)}`;

export function parseBpmnGraph(xml: string): BpmnGraph {
  const nodes: GraphNode[] = [];
  const flows: GraphFlow[] = [];
  const lanes: GraphLane[] = [];
  const laneOf = new Map<string, string>();
  let participants = 0;
  const stack: Open[] = [];
  let text = '';
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  const nearest = (pred: (o: Open) => boolean) => {
    for (let i = stack.length - 1; i >= 0; i--) if (pred(stack[i])) return stack[i];
    return undefined;
  };
  while ((m = TOKEN.exec(xml))) {
    const [, cdata, closing, local, attrText, selfClosing, chars] = m;
    if (chars !== undefined || cdata !== undefined) {
      text += chars ?? cdata ?? '';
      continue;
    }
    if (!local) continue;
    if (closing) {
      const open = stack.pop();
      if (open?.local === 'flowNodeRef') {
        const lane = nearest((o) => o.local === 'lane');
        const ref = decodeXml(text.trim());
        if (lane?.attrs.id && ref) laneOf.set(ref, lane.attrs.id);
      }
      text = '';
      continue;
    }
    const attrs = readAttrs(attrText ?? '');
    const ph = phAttrs(attrs);
    const type = bpmnType(local);
    if (local === 'participant') participants++;
    if (local === 'lane' && attrs.id) {
      lanes.push({
        id: attrs.id,
        name: attrs.name ?? '',
        nameEn: ph.nameEn ?? '',
        nameAr: ph.nameAr ?? '',
        roleId: ph.roleId || null,
        parentLaneId: nearest((o) => o.local === 'lane')?.attrs.id ?? null,
      });
    } else if (local === 'sequenceFlow' && attrs.id) {
      flows.push({
        id: attrs.id,
        from: attrs.sourceRef ?? '',
        to: attrs.targetRef ?? '',
        name: attrs.name ?? '',
        nameEn: ph.nameEn ?? '',
        nameAr: ph.nameAr ?? '',
      });
    } else if ((isFlowNode(type) || local === 'boundaryEvent') && attrs.id) {
      const { values, issues } = readStepAttributes(ph);
      nodes.push({
        id: attrs.id,
        type,
        name: attrs.name ?? '',
        nameEn: ph.nameEn ?? '',
        nameAr: ph.nameAr ?? '',
        descriptionEn: ph.descriptionEn ?? '',
        descriptionAr: ph.descriptionAr ?? '',
        stepKind: ph.stepKind || null,
        stepType: stepTypeOf({ type, stepKind: ph.stepKind, nameEn: ph.nameEn || attrs.name }),
        laneId: null,
        parentId:
          nearest((o) => o.local === 'process' || o.local === 'subProcess')?.attrs.id ?? null,
        labelRef: ph.labelRef || null,
        linkedProcessId: ph.linkedProcessId || null,
        attributes: values,
        attributeIssues: issues,
        incoming: 0,
        outgoing: 0,
      });
    }
    if (!selfClosing) stack.push({ local, attrs });
    text = '';
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) n.laneId = laneOf.get(n.id) ?? null;
  for (const f of flows) {
    const a = byId.get(f.from);
    const b = byId.get(f.to);
    if (a) a.outgoing++;
    if (b) b.incoming++;
  }
  return { nodes, flows, lanes, participants };
}

/** Label of a node, flow or lane in `locale` (falls back to the other language, then `name`). */
export function graphLabel(
  x: { name: string; nameEn: string; nameAr: string },
  locale: 'en' | 'ar',
): string {
  return (locale === 'ar' ? x.nameAr || x.nameEn : x.nameEn || x.nameAr) || x.name;
}

/** Activities: the "steps" counted in totals and listed in reports. */
export const isStepNode = (n: GraphNode) =>
  /Task$|^bpmn:(SubProcess|CallActivity|Transaction)$/.test(n.type);

export interface ProcessTotals {
  steps: number;
  approvalSteps: number;
  decisions: number;
  /** Distinct IT systems linked to steps (SUPPORTS links). */
  systems: number;
  /** Lanes (roles) that hold steps. */
  roles: number;
  /** Planned processing + waiting time of the longest start-to-end path, minutes (null: no times). */
  mainPathMinutes: number | null;
  /** Steps on that path. */
  mainPath: string[];
  /** Steps without processing time. */
  stepsWithoutDuration: number;
}

/**
 * Totals shown on the process page. The main path is the start-to-end path with the largest
 * planned time (processing + waiting of its steps; loops — flows back to an earlier node — ignored),
 * like a critical path; with no times set it is the path with the most steps.
 */
export function processTotals(
  graph: BpmnGraph,
  links: { bpmnElementId: string; type: string; objectId: string }[] = [],
): ProcessTotals {
  const top = graph.nodes.filter((n) => n.type !== 'bpmn:BoundaryEvent');
  const steps = top.filter(isStepNode);
  const stepIds = new Set(steps.map((s) => s.id));
  const systems = new Set(
    links.filter((l) => l.type === 'SYSTEM' && stepIds.has(l.bpmnElementId)).map((l) => l.objectId),
  );
  // Roles: the lanes that hold steps.
  const roles = new Set(steps.map((s) => s.laneId).filter((id) => !!id));
  const minutes = (n: GraphNode) =>
    (n.attributes.durationMinutes ?? 0) + (n.attributes.waitingMinutes ?? 0);
  const anyTime = steps.some(
    (n) => n.attributes.durationMinutes !== undefined || n.attributes.waitingMinutes !== undefined,
  );

  // Longest path over the flow graph without back edges (DFS order from the start events).
  const byId = new Map(top.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  for (const f of graph.flows)
    if (byId.has(f.from) && byId.has(f.to)) out.set(f.from, [...(out.get(f.from) ?? []), f.to]);
  const starts = top.filter((n) => n.type === 'bpmn:StartEvent' || n.incoming === 0);
  const best = new Map<string, { score: number; path: string[] }>();
  const visiting = new Set<string>();
  const weight = (n: GraphNode) => (anyTime ? minutes(n) : isStepNode(n) ? 1 : 0);
  const longest = (id: string): { score: number; path: string[] } => {
    const done = best.get(id);
    if (done) return done;
    visiting.add(id);
    let next = { score: 0, path: [] as string[] };
    for (const t of out.get(id) ?? []) {
      if (visiting.has(t)) continue; // loop back
      const r = longest(t);
      if (r.score > next.score || (r.score === next.score && r.path.length > next.path.length))
        next = r;
    }
    visiting.delete(id);
    const n = byId.get(id)!;
    const result = {
      score: weight(n) + next.score,
      path: isStepNode(n) ? [id, ...next.path] : next.path,
    };
    best.set(id, result);
    return result;
  };
  let main = { score: 0, path: [] as string[] };
  for (const s of starts) {
    const r = longest(s.id);
    if (r.score > main.score || (r.score === main.score && r.path.length > main.path.length))
      main = r;
  }
  return {
    steps: steps.length,
    approvalSteps: steps.filter((s) => s.stepType === 'approval').length,
    decisions: top.filter((n) => n.stepType === 'decision').length,
    systems: systems.size,
    roles: roles.size,
    mainPathMinutes: anyTime ? main.path.reduce((t, id) => t + minutes(byId.get(id)!), 0) : null,
    mainPath: main.path,
    stepsWithoutDuration: steps.filter((s) => s.attributes.durationMinutes === undefined).length,
  };
}

/**
 * Nodes in flow order: breadth-first from the start events along the sequence flows, then the
 * nodes not reached, by document order (the order of Quick Model rows and report step tables).
 */
export function flowOrder(graph: BpmnGraph): GraphNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  for (const f of graph.flows) out.set(f.from, [...(out.get(f.from) ?? []), f.to]);
  const seen = new Set<string>();
  const order: GraphNode[] = [];
  const queue = graph.nodes.filter((n) => n.type === 'bpmn:StartEvent').map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    order.push(byId.get(id)!);
    queue.push(...(out.get(id) ?? []));
  }
  return [...order, ...graph.nodes.filter((n) => !seen.has(n.id))];
}
