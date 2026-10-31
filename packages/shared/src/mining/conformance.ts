import { z } from 'zod';
import type { BpmnGraph } from '../bpmn-graph';
import { eventTime, type LogData } from './log-data';
import { applyFilters, miningFiltersSchema } from './filters';
import { durationStats, type DurationStats } from './analysis';

/**
 * Conformance checking (Phase 5.1, D-135): the BPMN model becomes a workflow net and every case is
 * replayed with token-based replay (Rozinat & van der Aalst, "Conformance checking of processes
 * based on monitoring real behavior", Information Systems 33(1), 2008):
 *   fitness = ½ (1 − missing / consumed) + ½ (1 − remaining / produced).
 * Silent transitions (gateways, unmapped events and steps) are fired when they enable the next
 * observed step (shortest sequence, bounded search) or reach the end.
 */

// ---------- Petri net from BPMN ----------

export interface Transition {
  id: string;
  /** BPMN element id of a visible step; null = silent. */
  label: string | null;
  inputs: number[];
  outputs: number[];
}

export interface WorkflowNet {
  places: string[];
  transitions: Transition[];
  source: number;
  sink: number;
  /** Place index of each sequence flow. */
  flowPlace: Map<string, number>;
}

const isGateway = (t: string) => /Gateway$/.test(t);
const isEventType = (t: string) => /Event$/.test(t);

/** Non-empty subsets (inclusive gateways with up to 4 branches; more are treated as exclusive). */
function subsets<T>(xs: T[]): T[][] {
  if (xs.length > 4) return xs.map((x) => [x]);
  const out: T[][] = [];
  for (let m = 1; m < 1 << xs.length; m++) out.push(xs.filter((_, i) => m & (1 << i)));
  return out;
}

/**
 * Workflow net of the top-level flow nodes: one place per sequence flow plus source and sink;
 * activities with several incoming flows join exclusively, several outgoing flows split in parallel
 * (BPMN semantics); gateways become silent transitions. `visible` = element ids observed in the log.
 */
export function bpmnToPetriNet(graph: BpmnGraph, visible: Set<string>): WorkflowNet {
  const containers = new Set(
    graph.nodes.filter((n) => /SubProcess$|Transaction$/.test(n.type)).map((n) => n.id),
  );
  const nodes = graph.nodes.filter(
    (n) => n.type !== 'bpmn:BoundaryEvent' && !(n.parentId && containers.has(n.parentId)),
  );
  const ids = new Set(nodes.map((n) => n.id));
  const flows = graph.flows.filter((f) => ids.has(f.from) && ids.has(f.to));
  const places = ['source', 'sink'];
  const flowPlace = new Map<string, number>();
  for (const f of flows) {
    flowPlace.set(f.id, places.length);
    places.push(f.id);
  }
  const ins = new Map<string, number[]>();
  const outs = new Map<string, number[]>();
  for (const n of nodes) {
    ins.set(n.id, []);
    outs.set(n.id, []);
  }
  for (const f of flows) {
    outs.get(f.from)!.push(flowPlace.get(f.id)!);
    ins.get(f.to)!.push(flowPlace.get(f.id)!);
  }
  const transitions: Transition[] = [];
  const add = (id: string, label: string | null, inputs: number[], outputs: number[]) =>
    transitions.push({ id, label, inputs, outputs });
  for (const n of nodes) {
    let i = ins.get(n.id)!;
    let o = outs.get(n.id)!;
    // Nodes without incoming flows start the case; without outgoing flows they end it.
    if (!i.length) i = [0];
    if (!o.length) o = [1];
    const label = visible.has(n.id) ? n.id : null;
    if (isGateway(n.type)) {
      if (n.type === 'bpmn:ParallelGateway') add(`${n.id}`, null, i, o);
      else if (n.type === 'bpmn:InclusiveGateway') {
        // Join: any subset of the incoming branches; split: any subset of the outgoing ones.
        let k = 0;
        for (const si of subsets(i))
          for (const so of subsets(o)) add(`${n.id}#${k++}`, null, si, so);
      } else {
        let k = 0;
        for (const a of i) for (const b of o) add(`${n.id}#${k++}`, null, [a], [b]);
      }
    } else {
      // Exclusive join of several incoming flows, parallel split to all outgoing flows.
      i.forEach((p, k) => add(i.length > 1 ? `${n.id}#${k}` : n.id, label, [p], o));
    }
  }
  return { places, transitions, source: 0, sink: 1, flowPlace };
}

// ---------- Token-based replay ----------

export const conformanceRequestSchema = z.object({ filters: miningFiltersSchema });
export type ConformanceRequest = z.infer<typeof conformanceRequestSchema>;

export type DeviationKind = 'SKIPPED' | 'INSERTED' | 'WRONG_ORDER';

export interface DeviationDto {
  kind: DeviationKind;
  /** Step(s) concerned (BPMN element ids); INSERTED: none. */
  elementId: string | null;
  /** WRONG_ORDER: the step that came too early. */
  otherElementId: string | null;
  /** INSERTED: the activity of the log. */
  activity: string | null;
  cases: number;
  exampleCases: string[];
}

export interface ElementStats {
  cases: number;
  events: number;
  processing: DurationStats | null;
  waiting: DurationStats | null;
  /** Cases with a deviation at this step. */
  deviations: number;
}

export interface ConformanceResult {
  cases: number;
  /** Log-level fitness from the summed token counts. */
  fitness: number;
  /** Mean of the case fitness values. */
  meanCaseFitness: number;
  conformingCases: number;
  conformingShare: number;
  deviations: DeviationDto[];
  elements: Record<string, ElementStats>;
  /** Tokens that passed each sequence flow (cases). */
  flows: Record<string, number>;
  /** Steps of the model never observed in the log. */
  unobserved: string[];
  tokens: { produced: number; consumed: number; missing: number; remaining: number };
}

type Marking = Int32Array;

const enabled = (m: Marking, t: Transition) => t.inputs.every((p) => m[p] > 0);

/** Shortest sequence of silent transitions after which `goal` holds (BFS, bounded). */
function silentPath(
  silent: Transition[],
  m: Marking,
  goal: (m: Marking) => boolean,
  maxStates = 400,
): Transition[] | null {
  if (goal(m)) return [];
  const seen = new Set<string>([m.join(',')]);
  const queue: { m: Marking; path: Transition[] }[] = [{ m, path: [] }];
  while (queue.length && seen.size < maxStates) {
    const cur = queue.shift()!;
    if (cur.path.length >= 12) continue;
    for (const t of silent) {
      if (!enabled(cur.m, t)) continue;
      const next = cur.m.slice();
      for (const p of t.inputs) next[p]--;
      for (const p of t.outputs) next[p]++;
      const key = next.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const path = [...cur.path, t];
      if (goal(next)) return path;
      queue.push({ m: next, path });
    }
  }
  return null;
}

interface TraceReplay {
  produced: number;
  consumed: number;
  missing: number;
  remaining: number;
  deviations: {
    kind: DeviationKind;
    elementId: string | null;
    other: string | null;
    activity: string | null;
  }[];
  /** Places that received tokens (flow frequency). */
  placesUsed: Set<number>;
}

/**
 * Replays one trace (element ids; null = activity not in the model). Returns token counts,
 * deviations (skipped / inserted / wrong order) and the flows used.
 */
export function replayTrace(
  net: WorkflowNet,
  trace: (string | null)[],
  activities: string[] = [],
): TraceReplay {
  const m: Marking = new Int32Array(net.places.length);
  const byLabel = new Map<string, Transition[]>();
  const silent = net.transitions.filter((t) => t.label === null);
  for (const t of net.transitions)
    if (t.label) byLabel.set(t.label, [...(byLabel.get(t.label) ?? []), t]);
  // Producers of each place (for explaining missing tokens).
  const producers = new Map<number, Transition[]>();
  for (const t of net.transitions)
    for (const p of t.outputs) producers.set(p, [...(producers.get(p) ?? []), t]);
  const consumers = new Map<number, Transition[]>();
  for (const t of net.transitions)
    for (const p of t.inputs) consumers.set(p, [...(consumers.get(p) ?? []), t]);
  const visibleAround = (p: number, dir: 'back' | 'fwd') => {
    const found = new Set<string>();
    const seen = new Set<number>([p]);
    let frontier = [p];
    for (let depth = 0; depth < 8 && frontier.length && !found.size; depth++) {
      const next: number[] = [];
      for (const q of frontier)
        for (const t of (dir === 'back' ? producers : consumers).get(q) ?? []) {
          if (t.label) found.add(t.label);
          else
            for (const r of dir === 'back' ? t.inputs : t.outputs)
              if (!seen.has(r)) {
                seen.add(r);
                next.push(r);
              }
        }
      frontier = next;
    }
    return [...found];
  };
  const r: TraceReplay = {
    produced: 1,
    consumed: 0,
    missing: 0,
    remaining: 0,
    deviations: [],
    placesUsed: new Set(),
  };
  m[net.source] = 1;
  const fired = new Set<string>();
  const fire = (t: Transition) => {
    for (const p of t.inputs) m[p]--;
    for (const p of t.outputs) {
      m[p]++;
      r.placesUsed.add(p);
    }
    r.consumed += t.inputs.length;
    r.produced += t.outputs.length;
  };
  trace.forEach((label, idx) => {
    if (label === null || !byLabel.has(label)) {
      r.deviations.push({
        kind: 'INSERTED',
        elementId: null,
        other: null,
        activity: activities[idx] ?? null,
      });
      return;
    }
    const cands = byLabel.get(label)!;
    let t = cands.find((x) => enabled(m, x));
    if (!t) {
      const path = silentPath(silent, m, (mm) => cands.some((x) => enabled(mm, x)));
      if (path) {
        for (const s of path) fire(s);
        t = cands.find((x) => enabled(m, x));
      }
    }
    if (!t && fired.has(label)) {
      // An unmodelled repetition (rework the model does not allow): inserted, not replayed.
      r.deviations.push({
        kind: 'INSERTED',
        elementId: label,
        other: null,
        activity: activities[idx] ?? null,
      });
      return;
    }
    if (!t) {
      // Force: the candidate with the fewest missing tokens.
      t = cands.reduce((best, x) =>
        x.inputs.filter((p) => m[p] <= 0).length < best.inputs.filter((p) => m[p] <= 0).length
          ? x
          : best,
      );
      for (const p of t.inputs)
        if (m[p] <= 0) {
          m[p]++;
          r.missing++;
          const around = visibleAround(p, 'back');
          const notYet = around.filter((b) => !fired.has(b));
          const before = notYet.length ? notYet : around;
          const later = before.find((b) => trace.indexOf(b, idx + 1) > idx);
          if (later)
            r.deviations.push({
              kind: 'WRONG_ORDER',
              elementId: label,
              other: later,
              activity: null,
            });
          else
            for (const b of before.length ? before : [null])
              r.deviations.push({ kind: 'SKIPPED', elementId: b, other: null, activity: null });
        }
    }
    fire(t);
    fired.add(label);
  });
  // End: reach the sink through silent transitions, then the environment consumes its token.
  if (m[net.sink] <= 0) {
    const path = silentPath(silent, m, (mm) => mm[net.sink] > 0);
    if (path) for (const s of path) fire(s);
  }
  if (m[net.sink] > 0) m[net.sink]--;
  else {
    r.missing++;
    // The case ended before the model's end: the next visible steps were skipped.
    const open = [...m.keys()].filter((p) => m[p] > 0);
    const next = new Set(open.flatMap((p) => visibleAround(p, 'fwd')));
    for (const e of next.size ? next : [null])
      r.deviations.push({ kind: 'SKIPPED', elementId: e, other: null, activity: null });
  }
  r.consumed++;
  for (let p = 0; p < m.length; p++) if (m[p] > 0) r.remaining += m[p];
  return r;
}

export const traceFitness = (r: {
  produced: number;
  consumed: number;
  missing: number;
  remaining: number;
}) =>
  0.5 * (1 - (r.consumed ? r.missing / r.consumed : 0)) +
  0.5 * (1 - (r.produced ? r.remaining / r.produced : 0));

/**
 * Conformance of a log against a model: replay per variant (cases with the same sequence share the
 * result), deviations with frequencies and example cases, per-step statistics and flow counts.
 */
export function checkConformance(
  log: LogData,
  graph: BpmnGraph,
  activityToElement: Record<string, string | null>,
  req: Partial<ConformanceRequest> = {},
  progress: (v: number) => void = () => undefined,
): ConformanceResult {
  const { filters } = conformanceRequestSchema.parse(req);
  const keep = applyFilters(log, filters);
  const elementOf = log.activities.map((a) => activityToElement[a] ?? null);
  const visible = new Set(elementOf.filter((x): x is string => !!x));
  const net = bpmnToPetriNet(graph, visible);
  const placeFlow = new Map([...net.flowPlace.entries()].map(([f, p]) => [p, f]));
  const variantCache = new Map<string, TraceReplay>();
  const devs = new Map<string, DeviationDto & { seen: number }>();
  const flows: Record<string, number> = {};
  const elements: Record<string, ElementStats> = {};
  const proc = new Map<string, number[]>();
  const wait = new Map<string, number[]>();
  const elementCases = new Map<string, number>();
  let produced = 0;
  let consumed = 0;
  let missing = 0;
  let remaining = 0;
  let fitnessSum = 0;
  let conforming = 0;
  let cases = 0;
  const elementDevCases = new Map<string, number>();
  for (let c = 0; c < log.caseIds.length; c++) {
    if (!keep[c]) continue;
    cases++;
    const a0 = log.caseOffsets[c];
    const a1 = log.caseOffsets[c + 1];
    const trace: (string | null)[] = [];
    const acts: string[] = [];
    const caseElements = new Set<string>();
    for (let i = a0; i < a1; i++) {
      const el = elementOf[log.act[i]];
      trace.push(el);
      acts.push(log.activities[log.act[i]]);
      if (el) {
        caseElements.add(el);
        if (!Number.isNaN(log.start[i])) {
          (proc.get(el) ?? proc.set(el, []).get(el)!).push(log.end[i] - log.start[i]);
          if (i > a0)
            (wait.get(el) ?? wait.set(el, []).get(el)!).push(
              Math.max(0, log.start[i] - log.end[i - 1]),
            );
        } else if (i > a0) {
          (wait.get(el) ?? wait.set(el, []).get(el)!).push(
            Math.max(0, eventTime(log, i) - log.end[i - 1]),
          );
        }
        const s =
          elements[el] ??
          (elements[el] = { cases: 0, events: 0, processing: null, waiting: null, deviations: 0 });
        s.events++;
      }
    }
    for (const el of caseElements) elementCases.set(el, (elementCases.get(el) ?? 0) + 1);
    const key = acts.join('\u001f');
    let rep = variantCache.get(key);
    if (!rep) {
      rep = replayTrace(net, trace, acts);
      variantCache.set(key, rep);
    }
    produced += rep.produced;
    consumed += rep.consumed;
    missing += rep.missing;
    remaining += rep.remaining;
    fitnessSum += traceFitness(rep);
    if (!rep.missing && !rep.remaining && !rep.deviations.length) conforming++;
    for (const p of rep.placesUsed) {
      const f = placeFlow.get(p);
      if (f) flows[f] = (flows[f] ?? 0) + 1;
    }
    const caseDevKeys = new Set<string>();
    const caseDevElements = new Set<string>();
    for (const d of rep.deviations) {
      const k = `${d.kind}|${d.elementId}|${d.other}|${d.activity}`;
      if (caseDevKeys.has(k)) continue;
      caseDevKeys.add(k);
      let dto = devs.get(k);
      if (!dto) {
        dto = {
          kind: d.kind,
          elementId: d.elementId,
          otherElementId: d.other,
          activity: d.activity,
          cases: 0,
          exampleCases: [],
          seen: 0,
        };
        devs.set(k, dto);
      }
      dto.cases++;
      if (dto.exampleCases.length < 5) dto.exampleCases.push(log.caseIds[c]);
      if (d.elementId) caseDevElements.add(d.elementId);
    }
    for (const el of caseDevElements) elementDevCases.set(el, (elementDevCases.get(el) ?? 0) + 1);
    if (cases % 5000 === 0) progress(c / log.caseIds.length);
  }
  for (const [el, s] of Object.entries(elements)) {
    s.cases = elementCases.get(el) ?? 0;
    s.processing = durationStats(proc.get(el) ?? []);
    s.waiting = durationStats(wait.get(el) ?? []);
  }
  for (const [el, n] of elementDevCases) {
    const s =
      elements[el] ??
      (elements[el] = { cases: 0, events: 0, processing: null, waiting: null, deviations: 0 });
    s.deviations = n;
  }
  const modelSteps = graph.nodes
    .filter((n) => !isGateway(n.type) && !isEventType(n.type))
    .map((n) => n.id);
  const fitness =
    consumed && produced ? 0.5 * (1 - missing / consumed) + 0.5 * (1 - remaining / produced) : 1;
  return {
    cases,
    fitness,
    meanCaseFitness: cases ? fitnessSum / cases : 1,
    conformingCases: conforming,
    conformingShare: cases ? conforming / cases : 1,
    deviations: [...devs.values()].map(({ seen: _s, ...d }) => d).sort((a, b) => b.cases - a.cases),
    elements,
    flows,
    unobserved: modelSteps.filter((s) => !visible.has(s)),
    tokens: { produced, consumed, missing, remaining },
  };
}
