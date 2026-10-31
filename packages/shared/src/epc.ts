import type { DiagramEdge, DiagramNode, GraphContent } from './diagrams';

/**
 * Event-driven process chains (ARIS EPC, D-124): syntax rules for the Validation panel and the
 * conversion to a BPMN process structure (the API turns it into BPMN XML with the shared layout).
 */

export const EPC_FLOW_KINDS = ['event', 'function', 'and', 'or', 'xor', 'processPath'] as const;
export const EPC_CONNECTOR_KINDS = ['and', 'or', 'xor'] as const;
export const EPC_RESOURCE_KINDS = ['orgUnit', 'system', 'information', 'document'] as const;

const isConnector = (k: string) => (EPC_CONNECTOR_KINDS as readonly string[]).includes(k);
const isFlowKind = (k: string) => (EPC_FLOW_KINDS as readonly string[]).includes(k);
const isResource = (k: string) => (EPC_RESOURCE_KINDS as readonly string[]).includes(k);
/** Functions and process paths are both "active" elements. */
const isActive = (k: string) => k === 'function' || k === 'processPath';

export const EPC_ISSUE_CODES = [
  'NO_START_EVENT',
  'NO_END_EVENT',
  'START_NOT_EVENT',
  'END_NOT_EVENT',
  'EVENT_EVENT',
  'FUNCTION_FUNCTION',
  'DECISION_AFTER_EVENT',
  'CONNECTOR_DEGREE',
  'BRANCH_WITHOUT_CONNECTOR',
  'RESOURCE_UNASSIGNED',
  'UNCONNECTED',
] as const;
export type EpcIssueCode = (typeof EPC_ISSUE_CODES)[number];

export interface EpcIssue {
  code: EpcIssueCode;
  /** Element the warning is about (none for diagram-wide warnings). */
  elementId: string | null;
}

interface Graph {
  nodes: Map<string, DiagramNode>;
  out: Map<string, string[]>;
  inc: Map<string, string[]>;
  flows: DiagramEdge[];
}

function graphOf(c: GraphContent): Graph {
  const nodes = new Map(c.nodes.map((n) => [n.id, n]));
  const flows = c.edges.filter(
    (e) =>
      e.kind === 'flow' &&
      isFlowKind(nodes.get(e.sourceId)?.kind ?? '') &&
      isFlowKind(nodes.get(e.targetId)?.kind ?? ''),
  );
  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const n of c.nodes) {
    out.set(n.id, []);
    inc.set(n.id, []);
  }
  for (const f of flows) {
    out.get(f.sourceId)!.push(f.targetId);
    inc.get(f.targetId)!.push(f.sourceId);
  }
  return { nodes, out, inc, flows };
}

/** Nearest non-connector elements reached by following flows through connectors. */
function reach(g: Graph, start: string, dir: 'out' | 'inc'): DiagramNode[] {
  const found: DiagramNode[] = [];
  const seen = new Set<string>();
  const stack = [...(dir === 'out' ? g.out : g.inc).get(start)!];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = g.nodes.get(id)!;
    if (isConnector(n.kind)) stack.push(...(dir === 'out' ? g.out : g.inc).get(id)!);
    else found.push(n);
  }
  return found;
}

/** EPC syntax rules (warnings in the Validation panel; saving is never blocked). */
export function epcIssues(c: GraphContent): EpcIssue[] {
  const g = graphOf(c);
  const issues: EpcIssue[] = [];
  const add = (code: EpcIssueCode, elementId: string | null) => {
    if (!issues.some((i) => i.code === code && i.elementId === elementId))
      issues.push({ code, elementId });
  };
  const flowNodes = c.nodes.filter((n) => isFlowKind(n.kind));
  if (!flowNodes.length) return issues;
  const starts = flowNodes.filter((n) => !g.inc.get(n.id)!.length);
  const ends = flowNodes.filter((n) => !g.out.get(n.id)!.length);
  if (!starts.some((n) => n.kind === 'event')) add('NO_START_EVENT', null);
  if (!ends.some((n) => n.kind === 'event')) add('NO_END_EVENT', null);
  for (const n of flowNodes) {
    const ins = g.inc.get(n.id)!.length;
    const outs = g.out.get(n.id)!.length;
    if (!ins && !outs) {
      add('UNCONNECTED', n.id);
      continue;
    }
    if (isConnector(n.kind)) {
      // A connector either splits (1 in, several out) or joins (several in, 1 out).
      if (!((ins === 1 && outs >= 2) || (ins >= 2 && outs === 1))) add('CONNECTOR_DEGREE', n.id);
      // Events cannot decide: no OR / XOR split right after a single event.
      if (n.kind !== 'and' && outs >= 2) {
        const before = reach(g, n.id, 'inc');
        if (before.length === 1 && before[0].kind === 'event') add('DECISION_AFTER_EVENT', n.id);
      }
      continue;
    }
    if (!ins && n.kind !== 'event') add('START_NOT_EVENT', n.id);
    if (!outs && n.kind !== 'event') add('END_NOT_EVENT', n.id);
    if (ins > 1 || outs > 1) add('BRANCH_WITHOUT_CONNECTOR', n.id);
    // Events and functions alternate (connectors in between are transparent).
    for (const next of reach(g, n.id, 'out')) {
      if (n.kind === 'event' && next.kind === 'event') add('EVENT_EVENT', next.id);
      if (isActive(n.kind) && isActive(next.kind)) add('FUNCTION_FUNCTION', next.id);
    }
  }
  const nodes = g.nodes;
  for (const r of c.nodes.filter((n) => isResource(n.kind))) {
    const attached = c.edges.some(
      (e) =>
        (e.sourceId === r.id && nodes.get(e.targetId)?.kind === 'function') ||
        (e.targetId === r.id && nodes.get(e.sourceId)?.kind === 'function'),
    );
    if (!attached) add('RESOURCE_UNASSIGNED', r.id);
  }
  return issues;
}

// ---------- EPC → BPMN ----------

export type EpcBpmnNodeType =
  | 'startEvent'
  | 'endEvent'
  | 'intermediateThrowEvent'
  | 'task'
  | 'userTask'
  | 'serviceTask'
  | 'callActivity'
  | 'exclusiveGateway'
  | 'parallelGateway'
  | 'inclusiveGateway';

/** Same shape as the API's AI process structure (lanes, nodes, flows with bilingual labels). */
export interface EpcBpmnStructure {
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  explanation: string;
  lanes: { id: string; nameEn: string; nameAr: string }[];
  nodes: {
    id: string;
    type: EpcBpmnNodeType;
    eventDefinition: 'none';
    nameEn: string;
    nameAr: string;
    lane: string;
    descriptionEn: string;
    descriptionAr: string;
    systemEn: string;
    systemAr: string;
  }[];
  flows: { from: string; to: string; nameEn: string; nameAr: string }[];
}

export type EpcMappingResult =
  | 'TASK'
  | 'USER_TASK'
  | 'SERVICE_TASK'
  | 'CALL_ACTIVITY'
  | 'START_EVENT'
  | 'END_EVENT'
  | 'FLOW_LABEL'
  | 'DROPPED_STATE'
  | 'GATEWAY'
  | 'LANE'
  | 'SYSTEM_LINK'
  | 'DOCUMENT_LINK'
  | 'NOT_CONVERTED';

/** One row of the mapping report: EPC element → BPMN element (or what happened to it). */
export interface EpcMappingRow {
  epcId: string;
  epcKind: string;
  nameEn: string;
  nameAr: string;
  result: EpcMappingResult;
  bpmnId: string | null;
}

export interface EpcConversion {
  structure: EpcBpmnStructure;
  report: EpcMappingRow[];
  /** BPMN element → linked process (process paths → call activities). */
  linkedProcesses: Map<string, string>;
  /** Lane → library Role (org units linked to a role). */
  laneRoles: Map<string, string>;
  /** BPMN task → library objects of the assigned systems / documents (object links). */
  objectLinks: { elementId: string; objectId: string; kind: 'SYSTEM' | 'DOCUMENT' }[];
}

const GATEWAY: Record<string, EpcBpmnNodeType> = {
  xor: 'exclusiveGateway',
  and: 'parallelGateway',
  or: 'inclusiveGateway',
};

/**
 * EPC → BPMN (how ARIS users move to BPMN): functions → tasks (user task with an org unit,
 * service task with only a system), process paths → call activities, start / end events → start /
 * end events, events between steps are states and are dropped (after an XOR / OR split their name
 * labels the branch), connectors → gateways, org units → lanes, systems / documents → object
 * links. Every element gets a row in the mapping report.
 */
export function epcToBpmn(
  c: GraphContent,
  names: { nameEn: string; nameAr: string },
): EpcConversion {
  const g = graphOf(c);
  const report: EpcMappingRow[] = [];
  const row = (n: DiagramNode, result: EpcMappingResult, bpmnId: string | null) =>
    report.push({
      epcId: n.id,
      epcKind: n.kind,
      nameEn: n.nameEn,
      nameAr: n.nameAr,
      result,
      bpmnId,
    });
  const assigned = (fn: string, kind: string) =>
    c.edges
      .filter((e) => e.kind === 'assignment' && (e.sourceId === fn || e.targetId === fn))
      .map((e) => g.nodes.get(e.sourceId === fn ? e.targetId : e.sourceId)!)
      .filter((n) => n?.kind === kind);

  // Lanes: one per org unit assigned to a function.
  const lanes = new Map<string, { id: string; nameEn: string; nameAr: string }>();
  const laneRoles = new Map<string, string>();
  for (const u of c.nodes.filter((n) => n.kind === 'orgUnit')) {
    const id = `Lane_${u.id}`.slice(0, 64);
    lanes.set(u.id, { id, nameEn: u.nameEn, nameAr: u.nameAr });
    if (u.objectId) laneRoles.set(id, u.objectId);
    row(u, 'LANE', id);
  }

  const kept = new Map<string, EpcBpmnStructure['nodes'][number]>();
  const linkedProcesses = new Map<string, string>();
  const objectLinks: EpcConversion['objectLinks'] = [];
  const laneOf = new Map<string, string>();
  for (const n of c.nodes.filter((x) => isFlowKind(x.kind))) {
    const ins = g.inc.get(n.id)!.length;
    const outs = g.out.get(n.id)!.length;
    let type: EpcBpmnNodeType | null = null;
    let result: EpcMappingResult = 'NOT_CONVERTED';
    let system: DiagramNode[] = [];
    if (n.kind === 'event') {
      if (!ins) [type, result] = ['startEvent', 'START_EVENT'];
      else if (!outs) [type, result] = ['endEvent', 'END_EVENT'];
    } else if (isConnector(n.kind)) {
      [type, result] = [GATEWAY[n.kind], 'GATEWAY'];
    } else if (n.kind === 'processPath') {
      [type, result] = ['callActivity', 'CALL_ACTIVITY'];
      if (n.processId) linkedProcesses.set(n.id, n.processId);
    } else {
      const units = assigned(n.id, 'orgUnit');
      system = assigned(n.id, 'system');
      if (units[0]) laneOf.set(n.id, lanes.get(units[0].id)!.id);
      [type, result] = units.length
        ? ['userTask', 'USER_TASK']
        : system.length
          ? ['serviceTask', 'SERVICE_TASK']
          : ['task', 'TASK'];
      for (const s of system) {
        if (s.objectId) objectLinks.push({ elementId: n.id, objectId: s.objectId, kind: 'SYSTEM' });
        row(s, 'SYSTEM_LINK', n.id);
      }
      for (const d of [...assigned(n.id, 'document'), ...assigned(n.id, 'information')]) {
        if (d.objectId && d.kind === 'document')
          objectLinks.push({ elementId: n.id, objectId: d.objectId, kind: 'DOCUMENT' });
        row(d, 'DOCUMENT_LINK', n.id);
      }
    }
    if (!type) continue;
    kept.set(n.id, {
      id: n.id,
      type,
      eventDefinition: 'none',
      nameEn: n.nameEn,
      nameAr: n.nameAr,
      lane: '',
      descriptionEn: n.descriptionEn ?? '',
      descriptionAr: n.descriptionAr ?? '',
      systemEn: system
        .map((s) => s.nameEn)
        .filter(Boolean)
        .join(', '),
      systemAr: system
        .map((s) => s.nameAr)
        .filter(Boolean)
        .join('، '),
    });
    row(n, result, n.id);
  }

  // Intermediate events are states: bridge them, labelling the branch after a split.
  const flows: EpcBpmnStructure['flows'] = [];
  const seen = new Set<string>();
  for (const f of g.flows) {
    if (!kept.has(f.sourceId)) continue;
    const queue: { to: string; label?: DiagramNode }[] = [{ to: f.targetId }];
    const visited = new Set<string>();
    const src = g.nodes.get(f.sourceId)!;
    const split = isConnector(src.kind) && g.out.get(src.id)!.length > 1;
    while (queue.length) {
      const { to, label } = queue.shift()!;
      if (visited.has(to)) continue;
      visited.add(to);
      if (kept.has(to)) {
        const key = `${f.sourceId}>${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // After a decision the event names the branch (also when it is the end event).
        const target = g.nodes.get(to)!;
        const name = split ? (label ?? (target.kind === 'event' ? target : undefined)) : undefined;
        flows.push({
          from: f.sourceId,
          to,
          nameEn: name?.nameEn ?? '',
          nameAr: name?.nameAr ?? '',
        });
        continue;
      }
      const state = g.nodes.get(to)!;
      if (!report.some((r) => r.epcId === state.id))
        row(state, split ? 'FLOW_LABEL' : 'DROPPED_STATE', null);
      for (const next of g.out.get(to)!) queue.push({ to: next, label: label ?? state });
    }
  }

  // Lanes of gateways and events: the lane of the nearest task before (or after) them.
  const nodes = [...kept.values()];
  if (lanes.size) {
    const first = [...lanes.values()][0].id;
    const preds = new Map<string, string[]>();
    const succs = new Map<string, string[]>();
    for (const f of flows) {
      preds.set(f.to, [...(preds.get(f.to) ?? []), f.from]);
      succs.set(f.from, [...(succs.get(f.from) ?? []), f.to]);
    }
    const near = (id: string, map: Map<string, string[]>) => {
      const seenIds = new Set<string>();
      const stack = [...(map.get(id) ?? [])];
      while (stack.length) {
        const x = stack.shift()!;
        if (seenIds.has(x)) continue;
        seenIds.add(x);
        if (laneOf.has(x)) return laneOf.get(x)!;
        stack.push(...(map.get(x) ?? []));
      }
      return null;
    };
    for (const n of nodes)
      n.lane = laneOf.get(n.id) ?? near(n.id, preds) ?? near(n.id, succs) ?? first;
  }
  // Lanes no task ended up in are left out.
  const used = new Set(nodes.map((n) => n.lane));
  return {
    structure: {
      nameEn: names.nameEn,
      nameAr: names.nameAr,
      descriptionEn: '',
      descriptionAr: '',
      explanation: '',
      lanes: [...lanes.values()].filter((l) => used.has(l.id)),
      nodes,
      flows,
    },
    report,
    linkedProcesses,
    laneRoles,
    objectLinks,
  };
}

// ---------- API ----------

export interface EpcConversionResultDto {
  processId: string;
  code: string;
  report: EpcMappingRow[];
}
