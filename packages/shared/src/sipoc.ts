import { isStepNode, parseBpmnGraph, type GraphNode } from './bpmn-graph';
import type { SipocContent, SipocItem } from './diagrams';

/**
 * SIPOC generation from a BPMN process (D-125): process steps from the main path (5–7 high-level
 * steps), inputs / outputs from the B2 step attributes (`ph:inputsEn/Ar`, `ph:outputsEn/Ar`),
 * suppliers / customers from the lanes where the process starts / ends and from the other pools
 * exchanging messages with it. Everything stays editable after generation.
 */

export const SIPOC_MIN_STEPS = 5;
export const SIPOC_MAX_STEPS = 7;

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#10;/g, '\n')
    .replace(/&amp;/g, '&');

/** Splits a free-text list ("Invoice; Purchase order", one per line …) into items. */
export const splitList = (s: string | undefined) =>
  (s ?? '')
    .split(/[\n;؛،,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Longest start → end path through the flow (back edges ignored), the "main path". Falls back to
 * the flow order when the model has no start event.
 */
function mainPath(nodes: GraphNode[], flows: { from: string; to: string }[]): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  for (const f of flows) out.set(f.from, [...(out.get(f.from) ?? []), f.to]);
  const best = new Map<string, string[]>();
  const visiting = new Set<string>();
  const longest = (id: string): string[] => {
    if (best.has(id)) return best.get(id)!;
    if (visiting.has(id)) return [];
    visiting.add(id);
    let tail: string[] = [];
    for (const next of out.get(id) ?? []) {
      const p = longest(next);
      const steps = (x: string[]) =>
        x.filter((n) => byId.get(n) && isStepNode(byId.get(n)!)).length;
      if (steps(p) > steps(tail)) tail = p;
    }
    visiting.delete(id);
    const path = [id, ...tail];
    best.set(id, path);
    return path;
  };
  const starts = nodes.filter((n) => n.type === 'bpmn:StartEvent');
  let path: string[] = [];
  for (const s of starts) {
    const p = longest(s.id);
    if (p.length > path.length) path = p;
  }
  return path.map((id) => byId.get(id)!).filter(Boolean);
}

/** Keeps at most `max` items, evenly spread, always with the first and the last. */
function sample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from(
    { length: max },
    (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))],
  );
}

interface Pool {
  id: string;
  nameEn: string;
  nameAr: string;
  processRef: string | null;
}

/** Pools (participants) and message flows, read from the XML (the graph reader skips them). */
function poolsAndMessages(xml: string) {
  const pools: Pool[] = [];
  const messages: { from: string; to: string }[] = [];
  const attrs = (s: string) =>
    Object.fromEntries([...s.matchAll(/([\w:.-]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]));
  for (const m of xml.matchAll(/<(?:[\w-]+:)?participant\s([^>]*?)\/?>/g)) {
    const a = attrs(m[1]);
    pools.push({
      id: a.id,
      nameEn: a['ph:nameEn'] || a.name || '',
      nameAr: a['ph:nameAr'] || '',
      processRef: a.processRef ?? null,
    });
  }
  for (const m of xml.matchAll(/<(?:[\w-]+:)?messageFlow\s([^>]*?)\/?>/g)) {
    const a = attrs(m[1]);
    if (a.sourceRef && a.targetRef) messages.push({ from: a.sourceRef, to: a.targetRef });
  }
  return { pools, messages };
}

export function generateSipoc(bpmnXml: string, processId?: string): SipocContent {
  const graph = parseBpmnGraph(bpmnXml);
  let path = mainPath(graph.nodes, graph.flows);
  if (!path.some(isStepNode)) path = graph.nodes;
  const steps = sample(path.filter(isStepNode), SIPOC_MAX_STEPS);
  const lanes = new Map(graph.lanes.map((l) => [l.id, l]));
  const uniq = (items: { en: string; ar: string }[]) => {
    const seen = new Set<string>();
    return items.filter((i) => {
      const key = (i.en || i.ar).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const list = (n: GraphNode, en: 'inputsEn' | 'outputsEn', ar: 'inputsAr' | 'outputsAr') => {
    const a = splitList(n.attributes[en]);
    const b = splitList(n.attributes[ar]);
    return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => ({
      en: a[i] ?? '',
      ar: b[i] ?? '',
    }));
  };
  // All steps of the process contribute inputs / outputs, not only the sampled ones.
  const allSteps = graph.nodes.filter(isStepNode);
  const inputs = uniq(allSteps.flatMap((n) => list(n, 'inputsEn', 'inputsAr')));
  const outputs = uniq(allSteps.flatMap((n) => list(n, 'outputsEn', 'outputsAr')));

  const laneOf = (n: GraphNode | undefined) => (n?.laneId ? lanes.get(n.laneId) : undefined);
  const { pools, messages } = poolsAndMessages(bpmnXml);
  const external = pools.filter(
    (p) => !p.processRef || !graph.nodes.some((n) => n.id === p.processRef),
  );
  const ownIds = new Set(graph.nodes.map((n) => n.id));
  const poolOf = (id: string) => external.find((p) => p.id === id);
  const startLanes = graph.nodes
    .filter((n) => n.type === 'bpmn:StartEvent')
    .map((n) => laneOf(n) ?? laneOf(steps[0]))
    .filter(Boolean);
  const endLanes = graph.nodes
    .filter((n) => n.type === 'bpmn:EndEvent')
    .map((n) => laneOf(n) ?? laneOf(steps[steps.length - 1]))
    .filter(Boolean);
  const name = (x: { nameEn: string; nameAr: string; name?: string }) => ({
    en: x.nameEn || x.name || '',
    ar: x.nameAr,
  });
  const suppliers = uniq([
    ...messages
      .filter((m) => ownIds.has(m.to) || !poolOf(m.to))
      .flatMap((m) => (poolOf(m.from) ? [name(poolOf(m.from)!)] : [])),
    ...startLanes.map((l) => name(l!)),
  ]);
  const customers = uniq([
    ...messages
      .filter((m) => ownIds.has(m.from) || !poolOf(m.from))
      .flatMap((m) => (poolOf(m.to) ? [name(poolOf(m.to)!)] : [])),
    ...endLanes.map((l) => name(l!)),
  ]);
  const items = (prefix: string, values: { en: string; ar: string }[]): SipocItem[] =>
    values.slice(0, 40).map((v, i) => ({ id: `${prefix}_${i + 1}`, nameEn: v.en, nameAr: v.ar }));
  return {
    schema: 1,
    type: 'SIPOC',
    ...(processId ? { processId } : {}),
    columns: {
      suppliers: items('S', suppliers),
      inputs: items('I', inputs),
      steps: steps.map((n) => ({
        id: `P_${n.id}`.slice(0, 80),
        nameEn: n.nameEn || n.name,
        nameAr: n.nameAr,
      })),
      outputs: items('O', outputs),
      customers: items('C', customers),
    },
  };
}
