import { z } from 'zod';
import type { LogData } from './log-data';
import { applyFilters, miningFiltersSchema } from './filters';

/**
 * Heuristics miner (Weijters & van der Aalst, "Process mining with the HeuristicsMiner algorithm",
 * 2006; Weijters & Ribeiro 2011) — Phase 5.1, D-134:
 * - dependency a ⇒ b = (|a>b| − |b>a|) / (|a>b| + |b>a| + 1); a ⇒ a = |a>a| / (|a>a| + 1);
 *   length-two loops a ⇒₂ b = (|a>>b| + |b>>a|) / (|a>>b| + |b>>a| + 1) with a>>b = "a b a";
 * - an arc is kept when its dependency ≥ `dependency` and |a>b| ≥ `positiveObservations` and it is within
 *   `relativeToBest` of the best outgoing / incoming dependency of a / b (all-tasks-connected: every activity
 *   keeps its best input and output);
 * - splits / joins: AND when a ⇒ (b ∧ c) = (|b>c| + |c>b|) / (|a>b| + |a>c| + 1) ≥ `and`, XOR otherwise.
 */
export const heuristicsOptionsSchema = z.object({
  filters: miningFiltersSchema,
  dependency: z.number().min(0).max(1).default(0.9),
  positiveObservations: z.number().int().min(1).default(1),
  relativeToBest: z.number().min(0).max(1).default(0.05),
  loopLengthTwo: z.number().min(0).max(1).default(0.9),
  and: z.number().min(0).max(1).default(0.1),
  /** Activities in fewer than this share of cases are left out. */
  minActivityShare: z.number().min(0).max(1).default(0),
});
export type HeuristicsOptions = z.infer<typeof heuristicsOptionsSchema>;

export interface HeuristicsArc {
  from: string;
  to: string;
  dependency: number;
  count: number;
}

export interface HeuristicsGroup {
  activity: string;
  kind: 'AND' | 'XOR';
  targets: string[];
}

export interface HeuristicsNet {
  activities: { name: string; count: number; lane: string | null }[];
  arcs: HeuristicsArc[];
  starts: string[];
  ends: string[];
  splits: HeuristicsGroup[];
  joins: HeuristicsGroup[];
  cases: number;
}

/** Directly-follows counts and loop counts on the filtered cases. */
export function heuristicsMiner(
  log: LogData,
  opts: Partial<HeuristicsOptions> = {},
): HeuristicsNet {
  const o = heuristicsOptionsSchema.parse(opts);
  const keep = applyFilters(log, o.filters);
  const n = log.activities.length;
  const df = Array.from({ length: n }, () => new Float64Array(n));
  const l2 = Array.from({ length: n }, () => new Float64Array(n));
  const count = new Float64Array(n);
  const caseCount = new Float64Array(n);
  const startCount = new Float64Array(n);
  const endCount = new Float64Array(n);
  const laneVotes = Array.from({ length: n }, () => new Map<string, number>());
  let cases = 0;
  const seen = new Int32Array(n).fill(-1);
  for (let c = 0; c < log.caseIds.length; c++) {
    if (!keep[c]) continue;
    cases++;
    const a0 = log.caseOffsets[c];
    const a1 = log.caseOffsets[c + 1];
    for (let i = a0; i < a1; i++) {
      const a = log.act[i];
      count[a]++;
      if (seen[a] !== c) {
        seen[a] = c;
        caseCount[a]++;
      }
      const lane =
        log.dep[i] >= 0
          ? log.departments[log.dep[i]]
          : log.res[i] >= 0
            ? log.resources[log.res[i]]
            : null;
      if (lane) laneVotes[a].set(lane, (laneVotes[a].get(lane) ?? 0) + 1);
      if (i + 1 < a1) df[a][log.act[i + 1]]++;
      if (i + 2 < a1 && log.act[i + 2] === a && log.act[i + 1] !== a) l2[a][log.act[i + 1]]++;
    }
    if (a1 > a0) {
      startCount[log.act[a0]]++;
      endCount[log.act[a1 - 1]]++;
    }
  }
  const acts = [...Array(n).keys()].filter(
    (a) => caseCount[a] > 0 && caseCount[a] >= o.minActivityShare * cases,
  );
  const inNet = new Set(acts);
  const dep = (a: number, b: number) =>
    a === b ? df[a][a] / (df[a][a] + 1) : (df[a][b] - df[b][a]) / (df[a][b] + df[b][a] + 1);
  const dep2 = (a: number, b: number) => (l2[a][b] + l2[b][a]) / (l2[a][b] + l2[b][a] + 1);

  const arcs = new Map<string, HeuristicsArc>();
  const addArc = (a: number, b: number, d: number) => {
    const k = `${a}>${b}`;
    if (!arcs.has(k))
      arcs.set(k, {
        from: log.activities[a],
        to: log.activities[b],
        dependency: d,
        count: df[a][b],
      });
  };
  // Best output / input per activity (all-tasks-connected heuristic).
  for (const a of acts) {
    const outs = acts.filter((b) => b !== a).map((b) => [b, dep(a, b)] as const);
    const ins = acts.filter((b) => b !== a).map((b) => [b, dep(b, a)] as const);
    const bestOut = outs.reduce((m, x) => (x[1] > m[1] ? x : m), [-1, -Infinity] as readonly [
      number,
      number,
    ]);
    const bestIn = ins.reduce((m, x) => (x[1] > m[1] ? x : m), [-1, -Infinity] as readonly [
      number,
      number,
    ]);
    for (const [b, d] of outs) {
      const strong =
        d >= o.dependency &&
        df[a][b] >= o.positiveObservations &&
        bestOut[1] - d <= o.relativeToBest;
      const best = b === bestOut[0] && d > 0 && endCount[a] < caseCount[a];
      if (strong || best) addArc(a, b, d);
    }
    if (bestIn[0] >= 0 && bestIn[1] > 0 && startCount[a] < caseCount[a])
      addArc(bestIn[0], a, bestIn[1]);
    // Length-one loop.
    const self = dep(a, a);
    if (self >= o.dependency && df[a][a] >= o.positiveObservations) addArc(a, a, self);
    // Length-two loops (a b a) where the plain dependency would cancel out.
    for (const b of acts) {
      if (b === a || dep(a, a) >= o.dependency || dep(b, b) >= o.dependency) continue;
      if (dep2(a, b) >= o.loopLengthTwo && l2[a][b] >= o.positiveObservations) {
        addArc(a, b, dep2(a, b));
        addArc(b, a, dep2(a, b));
      }
    }
  }
  const arcList = [...arcs.values()].filter(
    (x) => inNet.has(log.activities.indexOf(x.from)) && inNet.has(log.activities.indexOf(x.to)),
  );
  const idx = new Map(log.activities.map((a, i) => [a, i]));
  const andMeasure = (a: number, b: number, c: number, out: boolean) =>
    out
      ? (df[b][c] + df[c][b]) / (df[a][b] + df[a][c] + 1)
      : (df[b][c] + df[c][b]) / (df[b][a] + df[c][a] + 1);
  const groups = (out: boolean): HeuristicsGroup[] => {
    const res: HeuristicsGroup[] = [];
    for (const a of acts) {
      const name = log.activities[a];
      const targets = arcList
        .filter((x) => (out ? x.from === name : x.to === name) && x.from !== x.to)
        .map((x) => (out ? x.to : x.from));
      if (targets.length < 2) continue;
      const ids = targets.map((t) => idx.get(t)!);
      let all = true;
      for (let i = 0; i < ids.length && all; i++)
        for (let j = i + 1; j < ids.length && all; j++)
          if (andMeasure(a, ids[i], ids[j], out) < o.and) all = false;
      res.push({ activity: name, kind: all ? 'AND' : 'XOR', targets });
    }
    return res;
  };
  const hasIn = new Set(arcList.filter((x) => x.from !== x.to).map((x) => x.to));
  const hasOut = new Set(arcList.filter((x) => x.from !== x.to).map((x) => x.from));
  const maxStart = Math.max(0, ...acts.map((a) => startCount[a]));
  const maxEnd = Math.max(0, ...acts.map((a) => endCount[a]));
  const starts = acts
    .filter(
      (a) =>
        startCount[a] > 0 && (startCount[a] >= 0.05 * maxStart || !hasIn.has(log.activities[a])),
    )
    .map((a) => log.activities[a]);
  const ends = acts
    .filter(
      (a) => endCount[a] > 0 && (endCount[a] >= 0.05 * maxEnd || !hasOut.has(log.activities[a])),
    )
    .map((a) => log.activities[a]);
  return {
    activities: acts.map((a) => {
      const best = [...laneVotes[a].entries()].sort((x, y) => y[1] - x[1])[0];
      return { name: log.activities[a], count: count[a], lane: best?.[0] ?? null };
    }),
    arcs: arcList,
    starts,
    ends,
    splits: groups(true),
    joins: groups(false),
    cases,
  };
}

export interface NetStructureNode {
  id: string;
  type: 'startEvent' | 'endEvent' | 'task' | 'exclusiveGateway' | 'parallelGateway';
  name: string;
  lane: string | null;
}

/**
 * Turns a heuristics net into BPMN-like nodes and flows: a task per activity, a join gateway before
 * activities with several inputs and a split gateway after those with several outputs (AND / XOR as
 * mined), one start event (XOR split to several start activities) and one end event.
 */
export function netToStructure(net: HeuristicsNet): {
  nodes: NetStructureNode[];
  flows: { from: string; to: string }[];
} {
  const id = new Map(net.activities.map((a, i) => [a.name, `Activity_${i + 1}`]));
  const laneOf = new Map(net.activities.map((a) => [a.name, a.lane]));
  const nodes: NetStructureNode[] = [
    {
      id: 'Start',
      type: 'startEvent',
      name: '',
      lane: net.starts.length ? (laneOf.get(net.starts[0]) ?? null) : null,
    },
    ...net.activities.map((a) => ({
      id: id.get(a.name)!,
      type: 'task' as const,
      name: a.name,
      lane: a.lane,
    })),
    {
      id: 'End',
      type: 'endEvent',
      name: '',
      lane: net.ends.length ? (laneOf.get(net.ends[0]) ?? null) : null,
    },
  ];
  const flows: { from: string; to: string }[] = [];
  const outs = new Map<string, string[]>();
  const ins = new Map<string, string[]>();
  for (const a of net.activities) {
    outs.set(a.name, []);
    ins.set(a.name, []);
  }
  for (const arc of net.arcs) {
    outs.get(arc.from)?.push(arc.to);
    ins.get(arc.to)?.push(arc.from);
  }
  for (const s of net.starts) ins.get(s)?.push(' start');
  for (const e of net.ends) outs.get(e)?.push(' end');
  const kind = (groups: HeuristicsGroup[], a: string) =>
    groups.find((g) => g.activity === a)?.kind === 'AND' ? 'parallelGateway' : 'exclusiveGateway';
  // Entry / exit points of each activity.
  const entry = new Map<string, string>();
  const exit = new Map<string, string>();
  for (const a of net.activities) {
    const tid = id.get(a.name)!;
    if (ins.get(a.name)!.length > 1) {
      const g = `Join_${tid}`;
      nodes.push({ id: g, type: kind(net.joins, a.name), name: '', lane: a.lane });
      flows.push({ from: g, to: tid });
      entry.set(a.name, g);
    } else entry.set(a.name, tid);
    if (outs.get(a.name)!.length > 1) {
      const g = `Split_${tid}`;
      nodes.push({ id: g, type: kind(net.splits, a.name), name: '', lane: a.lane });
      flows.push({ from: tid, to: g });
      exit.set(a.name, g);
    } else exit.set(a.name, tid);
  }
  let startExit = 'Start';
  if (net.starts.length > 1) {
    nodes.push({ id: 'Split_Start', type: 'exclusiveGateway', name: '', lane: nodes[0].lane });
    flows.push({ from: 'Start', to: 'Split_Start' });
    startExit = 'Split_Start';
  }
  let endEntry = 'End';
  if (net.ends.length > 1) {
    nodes.push({
      id: 'Join_End',
      type: 'exclusiveGateway',
      name: '',
      lane: nodes[net.activities.length + 1].lane,
    });
    flows.push({ from: 'Join_End', to: 'End' });
    endEntry = 'Join_End';
  }
  for (const s of net.starts) flows.push({ from: startExit, to: entry.get(s)! });
  for (const arc of net.arcs) flows.push({ from: exit.get(arc.from)!, to: entry.get(arc.to)! });
  for (const e of net.ends) flows.push({ from: exit.get(e)!, to: endEntry });
  return { nodes, flows };
}
