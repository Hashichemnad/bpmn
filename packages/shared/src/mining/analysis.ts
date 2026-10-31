import { z } from 'zod';
import { caseSpan, eventTime, type LogData } from './log-data';
import { applyFilters, caseTrace, miningFiltersSchema, variantId } from './filters';

/**
 * Discovery and analysis of an event log (Phase 5.1, D-133): directly-follows graph with
 * frequency and performance, variants, statistics (throughput, trend, rework, resources,
 * handovers) and bottlenecks — all in one pass over the filtered cases (worker thread).
 */
export const START = '▶';
export const END = '■';

export const analysisRequestSchema = z.object({
  filters: miningFiltersSchema,
  /** Share of activities kept on the map, most frequent first (1 = all); others are projected out. */
  activityLevel: z.number().min(0).max(1).default(1),
  /** Variants returned (most frequent first). */
  topVariants: z.number().int().min(1).max(2000).default(300),
});
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;

export interface DurationStats {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  p90: number;
  total: number;
}

export interface DfgNode {
  activity: string;
  events: number;
  cases: number;
  /** Times the activity starts / ends a case. */
  starts: number;
  ends: number;
  /** End − start of the events (only with start times). */
  processing: DurationStats | null;
  /** Previous event's end → this start (only with start times). */
  waiting: DurationStats | null;
}

export interface DfgEdge {
  from: string;
  to: string;
  count: number;
  cases: number;
  /** End of `from` → start of `to` (null for start / end markers). */
  duration: DurationStats | null;
}

export interface VariantDto {
  id: string;
  activities: string[];
  count: number;
  share: number;
  meanMs: number;
  medianMs: number;
  exampleCases: string[];
}

export interface TrendPoint {
  period: string;
  started: number;
  completed: number;
  /** Mean throughput time of the cases completed in the period. */
  meanMs: number | null;
}

export interface ResourceStat {
  resource: string;
  events: number;
  cases: number;
  activities: { activity: string; events: number }[];
}

export interface Handover {
  from: string;
  to: string;
  count: number;
}

export interface CaseDuration {
  caseId: string;
  ms: number;
}

export interface LogAnalysis {
  totalCases: number;
  cases: number;
  events: number;
  hasStartTimes: boolean;
  activityLevel: number;
  map: { nodes: DfgNode[]; edges: DfgEdge[] };
  variants: { total: number; items: VariantDto[] };
  stats: {
    throughput: DurationStats | null;
    p10: number | null;
    p25: number | null;
    p75: number | null;
    p95: number | null;
    eventsPerCase: number;
    granularity: 'week' | 'month';
    trend: TrendPoint[];
    histogram: { from: number; to: number; count: number }[];
    rework: {
      cases: number;
      share: number;
      byActivity: { activity: string; cases: number; repeats: number }[];
    };
    resources: ResourceStat[];
    handovers: Handover[];
    departmentHandovers: Handover[];
    departments: { department: string; events: number; cases: number }[];
  };
  bottlenecks: {
    edges: (DfgEdge & { slowCases: CaseDuration[] })[];
    activities: (DfgNode & { slowCases: CaseDuration[] })[];
  };
  /** Values of the extra attributes (filter choices), most frequent first. */
  attributeValues: Record<string, string[]>;
  resourcesList: string[];
  departmentsList: string[];
  activitiesList: string[];
}

/** Summary statistics of durations (sorts the array in place). */
export function durationStats(values: number[] | Float64Array): DurationStats | null {
  const n = values.length;
  if (!n) return null;
  const a = values instanceof Float64Array ? values : Float64Array.from(values);
  a.sort();
  let total = 0;
  for (let i = 0; i < n; i++) total += a[i];
  return {
    count: n,
    mean: total / n,
    median: quantile(a, 0.5),
    min: a[0],
    max: a[n - 1],
    p90: quantile(a, 0.9),
    total,
  };
}

/** Linear-interpolation quantile of a sorted array. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const keyOf = (a: number, b: number) => a * 1_000_003 + b;

function periodKey(t: number, g: 'week' | 'month'): string {
  const d = new Date(t);
  if (g === 'month') return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return m.toISOString().slice(0, 10);
}

/** Top `k` by a score, keeping the list small (k ≤ 20). */
function pushTop(list: CaseDuration[], item: CaseDuration, k = 5) {
  if (list.length < k) {
    list.push(item);
    list.sort((a, b) => b.ms - a.ms);
  } else if (item.ms > list[k - 1].ms) {
    list[k - 1] = item;
    list.sort((a, b) => b.ms - a.ms);
  }
}

export function analyseLog(
  log: LogData,
  req: Partial<AnalysisRequest> = {},
  progress: (v: number) => void = () => undefined,
): LogAnalysis {
  const { filters, activityLevel, topVariants } = analysisRequestSchema.parse(req);
  const keep = applyFilters(log, filters);
  const nAct = log.activities.length;
  const withStart = !Number.isNaN(log.start.find((x) => !Number.isNaN(x)) ?? NaN);

  // Activity frequency on the filtered cases → kept activities for the map.
  const freq = new Float64Array(nAct);
  let cases = 0;
  let events = 0;
  for (let c = 0; c < log.caseIds.length; c++) {
    if (!keep[c]) continue;
    cases++;
    for (let i = log.caseOffsets[c]; i < log.caseOffsets[c + 1]; i++) {
      freq[log.act[i]]++;
      events++;
    }
  }
  const present = [...Array(nAct).keys()]
    .filter((a) => freq[a] > 0)
    .sort((a, b) => freq[b] - freq[a]);
  const keepCount = Math.max(1, Math.ceil(present.length * activityLevel));
  const onMap = new Uint8Array(nAct);
  for (const a of present.slice(0, keepCount)) onMap[a] = 1;

  // Per activity / edge accumulators.
  const nodeEvents = new Float64Array(nAct);
  const nodeCases = new Float64Array(nAct);
  const nodeStarts = new Float64Array(nAct);
  const nodeEnds = new Float64Array(nAct);
  const proc: number[][] = Array.from({ length: nAct }, () => []);
  const wait: number[][] = Array.from({ length: nAct }, () => []);
  const nodeSlow: CaseDuration[][] = Array.from({ length: nAct }, () => []);
  const edges = new Map<
    number,
    { count: number; cases: number; lastCase: number; d: number[]; slow: CaseDuration[] }
  >();
  const START_I = nAct;
  const END_I = nAct + 1;
  const edge = (a: number, b: number) => {
    const k = keyOf(a, b);
    let e = edges.get(k);
    if (!e) {
      e = { count: 0, cases: 0, lastCase: -1, d: [], slow: [] };
      edges.set(k, e);
    }
    return e;
  };

  // Variants, throughput, rework, resources, handovers.
  const variants = new Map<
    string,
    { acts: number[]; count: number; d: number[]; examples: string[] }
  >();
  const throughput: number[] = [];
  const reworkCases = new Float64Array(nAct);
  const reworkRepeats = new Float64Array(nAct);
  let reworkAny = 0;
  const resEvents = new Map<
    number,
    { events: number; cases: number; last: number; acts: Map<number, number> }
  >();
  const depEvents = new Map<number, { events: number; cases: number; last: number }>();
  const handovers = new Map<number, number>();
  const depHandovers = new Map<number, number>();
  const trendStart = new Map<string, number>();
  const trendDone = new Map<string, { n: number; sum: number }>();
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let c = 0; c < log.caseIds.length; c++) {
    if (!keep[c]) continue;
    const [s, e] = caseSpan(log, c);
    if (s < tMin) tMin = s;
    if (e > tMax) tMax = e;
  }
  const granularity: 'week' | 'month' = tMax - tMin > 120 * 86_400_000 ? 'month' : 'week';

  const seen = new Int32Array(nAct).fill(-1);
  const counts = new Uint32Array(nAct);
  let done = 0;
  for (let c = 0; c < log.caseIds.length; c++) {
    if (!keep[c]) continue;
    const a0 = log.caseOffsets[c];
    const a1 = log.caseOffsets[c + 1];
    const caseId = log.caseIds[c];
    const [cs, ce] = caseSpan(log, c);
    const dur = ce - cs;
    throughput.push(dur);
    const sk = periodKey(cs, granularity);
    trendStart.set(sk, (trendStart.get(sk) ?? 0) + 1);
    const ek = periodKey(ce, granularity);
    const td = trendDone.get(ek) ?? { n: 0, sum: 0 };
    td.n++;
    td.sum += dur;
    trendDone.set(ek, td);

    // Full trace: variants, rework, resources, handovers.
    const trace = caseTrace(log, c);
    const vid = trace.join(',');
    let v = variants.get(vid);
    if (!v) {
      v = { acts: trace, count: 0, d: [], examples: [] };
      variants.set(vid, v);
    }
    v.count++;
    v.d.push(dur);
    if (v.examples.length < 5) v.examples.push(caseId);
    let rework = false;
    for (const a of trace) {
      if (seen[a] !== c) {
        seen[a] = c;
        counts[a] = 0;
      }
      counts[a]++;
      if (counts[a] === 2) {
        reworkCases[a]++;
        rework = true;
      }
      if (counts[a] >= 2) reworkRepeats[a]++;
    }
    if (rework) reworkAny++;
    for (let i = a0; i < a1; i++) {
      const r = log.res[i];
      if (r >= 0) {
        let rs = resEvents.get(r);
        if (!rs) {
          rs = { events: 0, cases: 0, last: -1, acts: new Map() };
          resEvents.set(r, rs);
        }
        rs.events++;
        if (rs.last !== c) {
          rs.last = c;
          rs.cases++;
        }
        rs.acts.set(log.act[i], (rs.acts.get(log.act[i]) ?? 0) + 1);
      }
      const dp = log.dep[i];
      if (dp >= 0) {
        let ds = depEvents.get(dp);
        if (!ds) {
          ds = { events: 0, cases: 0, last: -1 };
          depEvents.set(dp, ds);
        }
        ds.events++;
        if (ds.last !== c) {
          ds.last = c;
          ds.cases++;
        }
      }
      if (i > a0) {
        const r0 = log.res[i - 1];
        if (r0 >= 0 && r >= 0 && r0 !== r)
          handovers.set(keyOf(r0, r), (handovers.get(keyOf(r0, r)) ?? 0) + 1);
        const d0 = log.dep[i - 1];
        if (d0 >= 0 && dp >= 0 && d0 !== dp)
          depHandovers.set(keyOf(d0, dp), (depHandovers.get(keyOf(d0, dp)) ?? 0) + 1);
      }
    }

    // Map: projected trace (activities on the map only).
    let prev = -1;
    let prevEnd = NaN;
    for (let i = a0; i < a1; i++) {
      const a = log.act[i];
      if (!onMap[a]) continue;
      nodeEvents[a]++;
      const st = eventTime(log, i);
      if (withStart && !Number.isNaN(log.start[i])) {
        const p = log.end[i] - log.start[i];
        proc[a].push(p);
        if (!Number.isNaN(prevEnd)) {
          const w = Math.max(0, log.start[i] - prevEnd);
          wait[a].push(w);
          pushTop(nodeSlow[a], { caseId, ms: w + p });
        } else pushTop(nodeSlow[a], { caseId, ms: p });
      }
      const from = prev < 0 ? START_I : prev;
      const ed = edge(from, a);
      ed.count++;
      if (ed.lastCase !== c) {
        ed.lastCase = c;
        ed.cases++;
      }
      if (prev >= 0) {
        const d = Math.max(0, st - prevEnd);
        ed.d.push(d);
        pushTop(ed.slow, { caseId, ms: d });
      } else nodeStarts[a]++;
      prev = a;
      prevEnd = log.end[i];
    }
    if (prev >= 0) {
      nodeEnds[prev]++;
      const ed = edge(prev, END_I);
      ed.count++;
      ed.cases++;
    }
    // Cases per activity on the map.
    const caseActs = new Set<number>();
    for (let i = a0; i < a1; i++) if (onMap[log.act[i]]) caseActs.add(log.act[i]);
    for (const a of caseActs) nodeCases[a]++;

    if (++done % 5000 === 0) progress(done / Math.max(cases, 1));
  }

  const name = (i: number) => (i === START_I ? START : i === END_I ? END : log.activities[i]);
  const nodes: DfgNode[] = present
    .filter((a) => onMap[a])
    .map((a) => ({
      activity: log.activities[a],
      events: nodeEvents[a],
      cases: nodeCases[a],
      starts: nodeStarts[a],
      ends: nodeEnds[a],
      processing: durationStats(proc[a]),
      waiting: durationStats(wait[a]),
    }));
  const edgeList: (DfgEdge & { slowCases: CaseDuration[] })[] = [...edges.entries()].map(
    ([k, e]) => {
      const from = Math.floor(k / 1_000_003);
      const to = k % 1_000_003;
      return {
        from: name(from),
        to: name(to),
        count: e.count,
        cases: e.cases,
        duration: from === START_I || to === END_I ? null : durationStats(e.d),
        slowCases: e.slow,
      };
    },
  );
  edgeList.sort((a, b) => b.count - a.count);

  const vlist = [...variants.values()].sort((a, b) => b.count - a.count);
  const variantItems: VariantDto[] = vlist.slice(0, topVariants).map((v) => {
    const st = durationStats(v.d)!;
    const acts = v.acts.map((a) => log.activities[a]);
    return {
      id: variantId(acts),
      activities: acts,
      count: v.count,
      share: v.count / Math.max(cases, 1),
      meanMs: st.mean,
      medianMs: st.median,
      exampleCases: v.examples,
    };
  });

  const tp = Float64Array.from(throughput).sort();
  const tpStats = durationStats(tp);
  const bins = 20;
  const histogram: { from: number; to: number; count: number }[] = [];
  if (tp.length) {
    const hi = quantile(tp, 0.98) || tp[tp.length - 1] || 1;
    const width = Math.max(hi / bins, 1);
    for (let b = 0; b < bins; b++)
      histogram.push({ from: b * width, to: (b + 1) * width, count: 0 });
    for (const d of tp) histogram[Math.min(bins - 1, Math.floor(d / width))].count++;
  }
  const periods = [...new Set([...trendStart.keys(), ...trendDone.keys()])].sort();
  const trend: TrendPoint[] = periods.map((p) => {
    const d = trendDone.get(p);
    return {
      period: p,
      started: trendStart.get(p) ?? 0,
      completed: d?.n ?? 0,
      meanMs: d ? d.sum / d.n : null,
    };
  });
  const handoverList = (m: Map<number, number>, dict: string[]) =>
    [...m.entries()]
      .map(([k, count]) => ({
        from: dict[Math.floor(k / 1_000_003)],
        to: dict[k % 1_000_003],
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 100);

  const attributeValues: Record<string, string[]> = {};
  log.attrNames.forEach((n, ai) => {
    const cnt = new Map<number, number>();
    for (const x of log.attrs[ai]) if (x >= 0) cnt.set(x, (cnt.get(x) ?? 0) + 1);
    attributeValues[n] = [...cnt.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200)
      .map(([x]) => log.attrDicts[ai][x]);
  });

  return {
    totalCases: log.caseIds.length,
    cases,
    events,
    hasStartTimes: withStart,
    activityLevel,
    map: { nodes, edges: edgeList.map(({ slowCases: _s, ...e }) => e) },
    variants: { total: variants.size, items: variantItems },
    stats: {
      throughput: tpStats,
      p10: tp.length ? quantile(tp, 0.1) : null,
      p25: tp.length ? quantile(tp, 0.25) : null,
      p75: tp.length ? quantile(tp, 0.75) : null,
      p95: tp.length ? quantile(tp, 0.95) : null,
      eventsPerCase: cases ? events / cases : 0,
      granularity,
      trend,
      histogram,
      rework: {
        cases: reworkAny,
        share: cases ? reworkAny / cases : 0,
        byActivity: present
          .filter((a) => reworkCases[a] > 0)
          .map((a) => ({
            activity: log.activities[a],
            cases: reworkCases[a],
            repeats: reworkRepeats[a],
          }))
          .sort((a, b) => b.cases - a.cases),
      },
      resources: [...resEvents.entries()]
        .map(([r, s]) => ({
          resource: log.resources[r],
          events: s.events,
          cases: s.cases,
          activities: [...s.acts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([a, n]) => ({ activity: log.activities[a], events: n })),
        }))
        .sort((a, b) => b.events - a.events)
        .slice(0, 500),
      handovers: handoverList(handovers, log.resources),
      departmentHandovers: handoverList(depHandovers, log.departments),
      departments: [...depEvents.entries()]
        .map(([d, s]) => ({ department: log.departments[d], events: s.events, cases: s.cases }))
        .sort((a, b) => b.events - a.events),
    },
    bottlenecks: {
      edges: edgeList
        .filter((e) => e.duration)
        .sort((a, b) => b.duration!.mean - a.duration!.mean)
        .slice(0, 25),
      activities: present
        .filter((a) => onMap[a] && (proc[a].length || wait[a].length))
        .map((a) => ({
          ...nodes.find((n) => n.activity === log.activities[a])!,
          slowCases: nodeSlow[a],
        }))
        .sort(
          (a, b) =>
            (b.waiting?.mean ?? 0) +
            (b.processing?.mean ?? 0) -
            ((a.waiting?.mean ?? 0) + (a.processing?.mean ?? 0)),
        )
        .slice(0, 25),
    },
    attributeValues,
    resourcesList: log.resources,
    departmentsList: log.departments,
    activitiesList: present.map((a) => log.activities[a]),
  };
}
