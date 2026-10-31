import { z } from 'zod';
import type { BpmnGraph, GraphNode } from '../bpmn-graph';
import { quantile } from './analysis';

/**
 * Discrete-event simulation of a BPMN process (Phase 5.1, D-138): cases arrive (Poisson process in
 * working time), tokens flow through the model, tasks seize a person of their lane's role (capacity,
 * FIFO queue) and take a sampled working time (fixed / normal / triangular / exponential / uniform);
 * a working calendar (Sun–Thu or Mon–Fri, hours, holidays) applies to arrivals and work; gateways
 * branch by probability (exclusive, inclusive) or fork / join (parallel, inclusive join waits for
 * the branches that can still arrive). Seeded random numbers make runs reproducible.
 */

// ---------- Scenario parameters ----------

export const DISTRIBUTION_TYPES = [
  'fixed',
  'normal',
  'triangular',
  'exponential',
  'uniform',
] as const;
export type DistributionType = (typeof DISTRIBUTION_TYPES)[number];

const minutes = z.number().min(0).max(1_000_000);
export const distributionSchema = z.object({
  type: z.enum(DISTRIBUTION_TYPES),
  /** fixed / normal / exponential: mean (minutes). */
  mean: minutes.optional(),
  /** normal: standard deviation. */
  sd: minutes.optional(),
  /** triangular / uniform: min, most likely (triangular), max. */
  min: minutes.optional(),
  mode: minutes.optional(),
  max: minutes.optional(),
});
export type Distribution = z.infer<typeof distributionSchema>;

export const WORK_WEEKS = ['SUN_THU', 'MON_FRI', 'ALL'] as const;
export type WorkWeek = (typeof WORK_WEEKS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const scenarioParamsSchema = z.object({
  arrival: z
    .object({
      /** Cases per working day or per month; `model` = `ph:frequencyPerMonth` of the process. */
      unit: z.enum(['day', 'month', 'model']).default('model'),
      rate: z.number().min(0).max(1_000_000).default(0),
    })
    .default({ unit: 'model', rate: 0 }),
  calendar: z
    .object({
      week: z.enum(WORK_WEEKS).default('SUN_THU'),
      start: hhmm.default('07:30'),
      end: hhmm.default('15:30'),
      /** Public holidays (YYYY-MM-DD), editable; default: UAE list of the simulated year. */
      holidays: z
        .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
        .max(400)
        .default([]),
      /** 24 / 7 (queueing tests, automated processes). */
      alwaysOpen: z.boolean().default(false),
    })
    .default({ week: 'SUN_THU', start: '07:30', end: '15:30', holidays: [], alwaysOpen: false }),
  /** First simulated day. */
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .default('2026-01-04'),
  days: z.number().int().min(1).max(3660).default(90),
  warmupDays: z.number().int().min(0).max(365).default(10),
  seed: z.number().int().min(0).max(2_147_483_647).default(42),
  /** Per step (element id): duration and cost overrides. */
  steps: z
    .record(
      z.string(),
      z.object({
        duration: distributionSchema.optional(),
        cost: z.number().min(0).max(1e9).optional(),
      }),
    )
    .default({}),
  /** Per lane (lane id): people and cost per hour. */
  resources: z
    .record(
      z.string(),
      z.object({
        capacity: z.number().int().min(0).max(10_000),
        costPerHour: z.number().min(0).max(1e6).default(0),
      }),
    )
    .default({}),
  /** Branch probabilities (sequence flow id → %), for exclusive / inclusive gateways. */
  probabilities: z.record(z.string(), z.number().min(0).max(100)).default({}),
  /** Case SLA in hours (share of cases completed within it); null = none. */
  slaHours: z.number().min(0).max(1e6).nullable().default(null),
});
export type ScenarioParams = z.infer<typeof scenarioParamsSchema>;
export type ScenarioParamsInput = z.input<typeof scenarioParamsSchema>;

/** UAE federal public holidays (fixed dates and announced Islamic dates, editable per scenario). */
export const UAE_HOLIDAYS: Record<number, string[]> = {
  2026: [
    '2026-01-01',
    '2026-03-19',
    '2026-03-20',
    '2026-03-21',
    '2026-05-26',
    '2026-05-27',
    '2026-05-28',
    '2026-05-29',
    '2026-06-16',
    '2026-08-25',
    '2026-12-01',
    '2026-12-02',
    '2026-12-03',
  ],
  2027: [
    '2027-01-01',
    '2027-03-09',
    '2027-03-10',
    '2027-03-11',
    '2027-05-15',
    '2027-05-16',
    '2027-05-17',
    '2027-05-18',
    '2027-06-06',
    '2027-08-14',
    '2027-12-01',
    '2027-12-02',
    '2027-12-03',
  ],
};

// ---------- Random numbers ----------

/** Mulberry32: small, fast, seedable PRNG with a 2^32 period (enough for one run). */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sample(d: Distribution, r: () => number): number {
  switch (d.type) {
    case 'fixed':
      return d.mean ?? 0;
    case 'exponential':
      return -Math.log(1 - r()) * (d.mean ?? 0);
    case 'uniform': {
      const lo = d.min ?? 0;
      const hi = Math.max(lo, d.max ?? lo);
      return lo + (hi - lo) * r();
    }
    case 'triangular': {
      const a = d.min ?? 0;
      const c = Math.max(a, d.mode ?? a);
      const b = Math.max(c, d.max ?? c);
      if (b === a) return a;
      const u = r();
      const f = (c - a) / (b - a);
      return u < f
        ? a + Math.sqrt(u * (b - a) * (c - a))
        : b - Math.sqrt((1 - u) * (b - a) * (b - c));
    }
    case 'normal': {
      // Box–Muller, truncated at 0.
      const u1 = 1 - r();
      const u2 = r();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.max(0, (d.mean ?? 0) + (d.sd ?? 0) * z);
    }
  }
}

export const distributionMean = (d: Distribution): number => {
  switch (d.type) {
    case 'triangular':
      return ((d.min ?? 0) + (d.mode ?? 0) + (d.max ?? 0)) / 3;
    case 'uniform':
      return ((d.min ?? 0) + (d.max ?? 0)) / 2;
    default:
      return d.mean ?? 0;
  }
};

// ---------- Working calendar (minutes since the start of the first simulated day) ----------

const DAY = 1440;
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

export class WorkCalendar {
  private readonly open: number;
  private readonly close: number;
  private readonly startDow: number;
  private readonly startMs: number;
  private readonly holidays: Set<string>;
  constructor(private readonly p: ScenarioParams) {
    this.open = hm(p.calendar.start);
    this.close = Math.max(this.open + 1, hm(p.calendar.end));
    this.startMs = Date.parse(`${p.startDate}T00:00:00Z`);
    this.startDow = new Date(this.startMs).getUTCDay();
    this.holidays = new Set(p.calendar.holidays);
  }
  get always() {
    return this.p.calendar.alwaysOpen;
  }
  /** Working minutes per working day. */
  get dayMinutes() {
    return this.always ? DAY : this.close - this.open;
  }
  isWorkDay(day: number): boolean {
    if (this.always) return true;
    const dow = (this.startDow + day) % 7;
    const w = this.p.calendar.week;
    if (w === 'SUN_THU' && (dow === 5 || dow === 6)) return false;
    if (w === 'MON_FRI' && (dow === 0 || dow === 6)) return false;
    const date = new Date(this.startMs + day * 86_400_000).toISOString().slice(0, 10);
    return !this.holidays.has(date);
  }
  /** The same moment or the next one in working time. */
  next(t: number): number {
    if (this.always) return t;
    let day = Math.floor(t / DAY);
    let m = t - day * DAY;
    for (let guard = 0; guard < 400; guard++) {
      if (this.isWorkDay(day)) {
        if (m < this.open) return day * DAY + this.open;
        if (m < this.close) return day * DAY + m;
      }
      day++;
      m = 0;
    }
    return t;
  }
  /** End time of `work` working minutes starting at `t`. */
  add(t: number, work: number): number {
    if (this.always) return t + work;
    let cur = this.next(t);
    let left = work;
    for (let guard = 0; guard < 100_000 && left > 1e-9; guard++) {
      const day = Math.floor(cur / DAY);
      const endOfDay = day * DAY + this.close;
      const avail = endOfDay - cur;
      if (left <= avail) return cur + left;
      left -= avail;
      cur = this.next(endOfDay + 1e-6);
    }
    return cur;
  }
  /** Working minutes between two moments. */
  between(a: number, b: number): number {
    if (this.always) return Math.max(0, b - a);
    let total = 0;
    for (let day = Math.floor(a / DAY); day * DAY < b; day++) {
      if (!this.isWorkDay(day)) continue;
      const lo = Math.max(a, day * DAY + this.open);
      const hi = Math.min(b, day * DAY + this.close);
      if (hi > lo) total += hi - lo;
    }
    return total;
  }
  workDays(from: number, to: number): number {
    let n = 0;
    for (let d = from; d < to; d++) if (this.isWorkDay(d)) n++;
    return n;
  }
}

// ---------- Validation ----------

export type SimIssueCode =
  | 'NO_START'
  | 'NO_ARRIVALS'
  | 'MISSING_DURATION'
  | 'PROBABILITIES_SUM'
  | 'LANE_WITHOUT_CAPACITY'
  | 'NO_END';

export interface SimIssue {
  code: SimIssueCode;
  severity: 'error' | 'warning';
  elementId: string | null;
  /** PROBABILITIES_SUM: the sum (%). */
  value?: number;
}

const isGw = (t: string) => /Gateway$/.test(t);
const isTask = (n: GraphNode) => !isGw(n.type) && !/Event$/.test(n.type);

function topLevel(graph: BpmnGraph) {
  const containers = new Set(
    graph.nodes.filter((n) => /SubProcess$|Transaction$/.test(n.type)).map((n) => n.id),
  );
  const nodes = graph.nodes.filter(
    (n) => n.type !== 'bpmn:BoundaryEvent' && !(n.parentId && containers.has(n.parentId)),
  );
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, flows: graph.flows.filter((f) => ids.has(f.from) && ids.has(f.to)) };
}

/** Arrivals per month from the model: the largest `ph:frequencyPerMonth` of its steps. */
export function modelArrivalsPerMonth(graph: BpmnGraph): number {
  return Math.max(0, ...graph.nodes.map((n) => n.attributes.frequencyPerMonth ?? 0));
}

export function stepDistribution(n: GraphNode, p: ScenarioParams): Distribution | null {
  const o = p.steps[n.id]?.duration;
  if (o) return o;
  const d = n.attributes.durationMinutes;
  return d === undefined ? null : { type: 'fixed', mean: d };
}

export function validateScenario(graph: BpmnGraph, input: ScenarioParamsInput): SimIssue[] {
  const p = scenarioParamsSchema.parse(input);
  const { nodes, flows } = topLevel(graph);
  const issues: SimIssue[] = [];
  const incoming = new Map<string, number>();
  for (const f of flows) incoming.set(f.to, (incoming.get(f.to) ?? 0) + 1);
  const starts = nodes.filter(
    (n) => n.type === 'bpmn:StartEvent' || (!incoming.get(n.id) && !isGw(n.type)),
  );
  if (!starts.length) issues.push({ code: 'NO_START', severity: 'error', elementId: null });
  if (!nodes.some((n) => n.type === 'bpmn:EndEvent'))
    issues.push({ code: 'NO_END', severity: 'warning', elementId: null });
  const rate = p.arrival.unit === 'model' ? modelArrivalsPerMonth(graph) : p.arrival.rate;
  if (!(rate > 0)) issues.push({ code: 'NO_ARRIVALS', severity: 'error', elementId: null });
  for (const n of nodes) {
    if (isTask(n) && !stepDistribution(n, p))
      issues.push({ code: 'MISSING_DURATION', severity: 'warning', elementId: n.id });
    if (n.type === 'bpmn:ExclusiveGateway' || n.type === 'bpmn:InclusiveGateway') {
      const outs = flows.filter((f) => f.from === n.id);
      if (outs.length < 2) continue;
      const given = outs.filter((f) => p.probabilities[f.id] !== undefined);
      if (!given.length) continue; // equal split by default
      const sum = outs.reduce((s, f) => s + (p.probabilities[f.id] ?? 0), 0);
      const exclusive = n.type === 'bpmn:ExclusiveGateway';
      if ((exclusive && Math.abs(sum - 100) > 0.5) || given.length !== outs.length)
        issues.push({
          code: 'PROBABILITIES_SUM',
          severity: 'error',
          elementId: n.id,
          value: Math.round(sum * 10) / 10,
        });
    }
  }
  const usedLanes = new Set(
    nodes
      .filter(isTask)
      .map((n) => n.laneId)
      .filter((x): x is string => !!x),
  );
  for (const lane of usedLanes)
    if (!p.resources[lane] || p.resources[lane].capacity < 1)
      issues.push({ code: 'LANE_WITHOUT_CAPACITY', severity: 'error', elementId: lane });
  return issues;
}

// ---------- Engine ----------

export interface SimStepResult {
  elementId: string;
  executions: number;
  /** Mean minutes waiting for a person (queue) / working. */
  meanWaiting: number;
  meanProcessing: number;
  /** Share of executions within `ph:slaMinutes` (null without SLA). */
  slaShare: number | null;
  cost: number;
}

export interface SimResourceResult {
  laneId: string;
  name: string;
  capacity: number;
  utilisation: number;
  /** Time-average and maximum queue length. */
  meanQueue: number;
  maxQueue: number;
  cost: number;
}

export interface SimulationResult {
  cases: { arrived: number; completed: number; inProgress: number };
  /** Calendar hours from arrival to completion (completed cases after the warm-up). */
  throughput: { mean: number; median: number; p90: number; max: number } | null;
  costPerCase: number;
  totalCost: number;
  /** Share of completed cases within the case SLA (null without one). */
  slaShare: number | null;
  /** Share of task executions within their step SLA (null when no step has one). */
  stepSlaShare: number | null;
  steps: SimStepResult[];
  resources: SimResourceResult[];
  /** Completed cases and mean throughput hours per simulated week (after the warm-up). */
  weekly: { week: number; completed: number; meanHours: number | null }[];
  events: number;
  truncated: boolean;
}

interface Token {
  caseId: number;
  node: string;
  /** Flow the token arrived on. */
  via: string | null;
}

interface Ev {
  t: number;
  seq: number;
  kind: 0 | 1 | 2 | 3; // 0 arrival, 1 token at node, 2 task done, 3 planned wait over
  token?: Token;
  item?: { token: Token; queued: number; work: number };
  task?: { token: Token; lane: string | null; start: number; queued: number };
}

/** Binary min-heap on (t, seq). */
class Heap {
  private readonly a: Ev[] = [];
  get size() {
    return this.a.length;
  }
  push(e: Ev) {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].t < e.t || (a[p].t === e.t && a[p].seq < e.seq)) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = e;
  }
  pop(): Ev | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        const lt = (x: Ev, y: Ev) => x.t < y.t || (x.t === y.t && x.seq < y.seq);
        if (l < a.length && lt(a[l], m === i ? last : a[m])) m = l;
        if (r < a.length && lt(a[r], m === i ? last : a[m])) m = r;
        if (m === i) break;
        a[i] = a[m];
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

export const MAX_SIM_EVENTS = 5_000_000;

export function simulate(
  graph: BpmnGraph,
  input: ScenarioParamsInput,
  progress: (v: number) => void = () => undefined,
): SimulationResult {
  const p = scenarioParamsSchema.parse(input);
  const { nodes, flows } = topLevel(graph);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outs = new Map<string, typeof flows>();
  const ins = new Map<string, typeof flows>();
  for (const n of nodes) {
    outs.set(n.id, []);
    ins.set(n.id, []);
  }
  for (const f of flows) {
    outs.get(f.from)!.push(f);
    ins.get(f.to)!.push(f);
  }
  const startNode =
    nodes.find((n) => n.type === 'bpmn:StartEvent' && !ins.get(n.id)!.length) ??
    nodes.find((n) => !ins.get(n.id)!.length && !isGw(n.type));
  const cal = new WorkCalendar(p);
  const r = rng(p.seed);
  const horizon = p.days * DAY;
  const warmup = p.warmupDays * DAY;
  // Reachability (for inclusive joins): can a token at node x still reach node y?
  const reach = new Map<string, Set<string>>();
  const reachable = (x: string) => {
    let s = reach.get(x);
    if (s) return s;
    s = new Set<string>();
    const stack = [x];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const f of outs.get(cur) ?? [])
        if (!s.has(f.to)) {
          s.add(f.to);
          stack.push(f.to);
        }
    }
    reach.set(x, s);
    return s;
  };
  // Arrivals.
  const perMonth =
    p.arrival.unit === 'model'
      ? modelArrivalsPerMonth(graph)
      : p.arrival.unit === 'month'
        ? p.arrival.rate
        : 0;
  const workDaysPerMonth = cal.always
    ? 30.4
    : Math.max(1, (cal.workDays(0, p.days) / p.days) * 30.4);
  const perDay = p.arrival.unit === 'day' ? p.arrival.rate : perMonth / workDaysPerMonth;
  const meanGap = perDay > 0 ? cal.dayMinutes / perDay : Infinity;

  // Resources (lanes).
  const laneName = new Map(graph.lanes.map((l) => [l.id, l.nameEn || l.nameAr || l.name || l.id]));
  interface Pool {
    capacity: number;
    busy: number;
    queue: { token: Token; queued: number; work: number }[];
    busyMinutes: number;
    queueArea: number;
    maxQueue: number;
    lastChange: number;
    cost: number;
    costPerHour: number;
  }
  const pools = new Map<string, Pool>();
  const pool = (lane: string) => {
    let pl = pools.get(lane);
    if (!pl) {
      const cfg = p.resources[lane];
      pl = {
        capacity: Math.max(1, cfg?.capacity ?? 1),
        busy: 0,
        queue: [],
        busyMinutes: 0,
        queueArea: 0,
        maxQueue: 0,
        lastChange: 0,
        cost: 0,
        costPerHour: cfg?.costPerHour ?? 0,
      };
      pools.set(lane, pl);
    }
    return pl;
  };
  const measured = (t: number) => Math.max(0, Math.min(t, horizon) - warmup);
  const touch = (pl: Pool, t: number) => {
    // Time-weighted queue length inside the measurement window.
    const a = Math.max(pl.lastChange, warmup);
    const b = Math.min(t, horizon);
    if (b > a) pl.queueArea += pl.queue.length * (b - a);
    pl.lastChange = t;
  };

  // Case state.
  interface CaseState {
    arrival: number;
    tokens: number;
    cost: number;
    done: boolean;
    joins: Map<string, Map<string, number>>;
    /** Active tokens per node (inclusive joins). */
    at: Map<string, number>;
  }
  const cases: CaseState[] = [];
  const stepStats = new Map<
    string,
    { n: number; wait: number; proc: number; slaOk: number; slaN: number; cost: number }
  >();
  const stat = (id: string) => {
    let s = stepStats.get(id);
    if (!s) {
      s = { n: 0, wait: 0, proc: 0, slaOk: 0, slaN: 0, cost: 0 };
      stepStats.set(id, s);
    }
    return s;
  };
  const throughput: number[] = [];
  const weekly = new Map<number, { n: number; sum: number }>();
  let arrived = 0;
  let completed = 0;
  let slaOk = 0;
  let caseCostSum = 0;
  let casesCosted = 0;

  const heap = new Heap();
  let seq = 0;
  const schedule = (e: Omit<Ev, 'seq'>) => heap.push({ ...e, seq: seq++ } as Ev);
  if (startNode && meanGap < Infinity)
    schedule({ t: cal.next(-Math.log(1 - r()) * meanGap), kind: 0 });

  const move = (c: CaseState, caseId: number, to: string, via: string | null, t: number) => {
    c.tokens++;
    c.at.set(to, (c.at.get(to) ?? 0) + 1);
    schedule({ t, kind: 1, token: { caseId, node: to, via } });
  };
  const leave = (c: CaseState, node: string) => {
    c.tokens--;
    c.at.set(node, (c.at.get(node) ?? 1) - 1);
  };
  const finishCase = (caseId: number, t: number) => {
    const c = cases[caseId];
    if (c.done) return;
    c.done = true;
    if (c.arrival < warmup) return;
    if (t > horizon) return;
    completed++;
    const hours = (t - c.arrival) / 60;
    throughput.push(hours);
    if (p.slaHours !== null && hours <= p.slaHours) slaOk++;
    caseCostSum += c.cost;
    casesCosted++;
    const w = Math.floor((t - warmup) / (7 * DAY));
    const wk = weekly.get(w) ?? { n: 0, sum: 0 };
    wk.n++;
    wk.sum += hours;
    weekly.set(w, wk);
  };
  const branches = (node: string, inclusive: boolean) => {
    const os = outs.get(node)!;
    if (os.length <= 1) return os;
    const given = os.some((f) => p.probabilities[f.id] !== undefined);
    const prob = (f: (typeof os)[number]) =>
      (given ? (p.probabilities[f.id] ?? 0) : 100 / os.length) / 100;
    if (inclusive) {
      const chosen = os.filter((f) => r() < prob(f));
      return chosen.length ? chosen : [os[Math.floor(r() * os.length)]];
    }
    let u = r() * os.reduce((s, f) => s + prob(f), 0);
    for (const f of os) {
      u -= prob(f);
      if (u <= 0) return [f];
    }
    return [os[os.length - 1]];
  };
  const startWork = (
    pl: Pool | null,
    item: { token: Token; queued: number; work: number },
    t: number,
  ) => {
    const end = cal.add(t, item.work);
    // Busy time inside the measurement window is booked when the work ends.
    if (pl) pl.busy++;
    schedule({
      t: end,
      kind: 2,
      task: {
        token: item.token,
        lane: byId.get(item.token.node)?.laneId ?? null,
        start: t,
        queued: item.queued,
      },
    });
  };

  let events = 0;
  let truncated = false;
  let lastProgress = 0;
  const ready = (item: { token: Token; queued: number; work: number }, t: number) => {
    const lane = byId.get(item.token.node)?.laneId ?? null;
    if (!lane) return startWork(null, item, cal.next(t));
    const pl = pool(lane);
    touch(pl, t);
    if (pl.busy < pl.capacity) startWork(pl, item, cal.next(t));
    else {
      pl.queue.push(item);
      if (t >= warmup && pl.queue.length > pl.maxQueue) pl.maxQueue = pl.queue.length;
    }
  };

  while (heap.size) {
    const e = heap.pop()!;
    if (e.t > horizon) break;
    if (++events > MAX_SIM_EVENTS) {
      truncated = true;
      break;
    }
    if (e.t - lastProgress > horizon / 50) {
      lastProgress = e.t;
      progress(e.t / horizon);
    }
    if (e.kind === 0) {
      const caseId = cases.length;
      const c: CaseState = {
        arrival: e.t,
        tokens: 0,
        cost: 0,
        done: false,
        joins: new Map(),
        at: new Map(),
      };
      cases.push(c);
      if (e.t >= warmup) arrived++;
      move(c, caseId, startNode!.id, null, e.t);
      schedule({ t: cal.next(cal.add(e.t, -Math.log(1 - r()) * meanGap)), kind: 0 });
      continue;
    }
    if (e.kind === 3) {
      ready(e.item!, e.t);
      continue;
    }
    if (e.kind === 2) {
      const { token, lane, start, queued } = e.task!;
      const c = cases[token.caseId];
      const n = byId.get(token.node)!;
      const work = cal.between(start, e.t);
      const st = stat(n.id);
      if (queued >= warmup) {
        st.n++;
        st.wait += start - queued;
        st.proc += e.t - start;
        const sla = n.attributes.slaMinutes;
        if (sla !== undefined) {
          st.slaN++;
          if (e.t - queued <= sla) st.slaOk++;
        }
      }
      const execCost = (p.steps[n.id]?.cost ?? n.attributes.costPerExecution ?? 0) as number;
      let cost = execCost;
      if (lane) {
        const pl = pool(lane);
        touch(pl, e.t);
        pl.busy--;
        pl.busyMinutes += cal.between(Math.max(start, warmup), Math.min(e.t, horizon));
        const labour = (work / 60) * pl.costPerHour;
        cost += labour;
        if (queued >= warmup) pl.cost += labour;
        touch(pl, e.t);
        const next = pl.queue.shift();
        if (next) startWork(pl, next, e.t);
      }
      c.cost += cost;
      if (queued >= warmup) st.cost += cost;
      leave(c, n.id);
      for (const f of outs.get(n.id)!) move(c, token.caseId, f.to, f.id, e.t);
      if (!c.tokens) finishCase(token.caseId, e.t);
      continue;
    }
    // Token arrives at a node.
    const token = e.token!;
    const c = cases[token.caseId];
    if (c.done) continue;
    const n = byId.get(token.node);
    if (!n) {
      leave(c, token.node);
      if (!c.tokens) finishCase(token.caseId, e.t);
      continue;
    }
    if (isGw(n.type)) {
      const incoming = ins.get(n.id)!;
      const parallel = n.type === 'bpmn:ParallelGateway';
      const inclusive = n.type === 'bpmn:InclusiveGateway';
      if ((parallel || inclusive) && incoming.length > 1) {
        const arrivedMap = c.joins.get(n.id) ?? new Map<string, number>();
        c.joins.set(n.id, arrivedMap);
        arrivedMap.set(token.via ?? '', (arrivedMap.get(token.via ?? '') ?? 0) + 1);
        let ready: boolean;
        if (parallel) ready = incoming.every((f) => (arrivedMap.get(f.id) ?? 0) > 0);
        else {
          // Ready when no other token of the case can still reach this join.
          ready = true;
          for (const [node, cnt] of c.at)
            if (cnt > 0 && node !== n.id && reachable(node).has(n.id)) {
              ready = false;
              break;
            }
        }
        if (!ready) continue; // the token waits (still counted at the join)
        // Consume one token per arrived branch.
        let consumed = 0;
        for (const f of incoming) {
          const k = arrivedMap.get(f.id) ?? 0;
          if (k > 0) {
            arrivedMap.set(f.id, k - 1);
            consumed++;
          }
        }
        if (!consumed) consumed = 1;
        for (let i = 0; i < consumed; i++) leave(c, n.id);
      } else leave(c, n.id);
      const targets = parallel ? outs.get(n.id)! : branches(n.id, inclusive);
      for (const f of targets) move(c, token.caseId, f.to, f.id, e.t);
      if (!c.tokens) finishCase(token.caseId, e.t);
      continue;
    }
    if (/Event$/.test(n.type)) {
      leave(c, n.id);
      if (n.type === 'bpmn:EndEvent' && /terminate/i.test(n.stepKind ?? '')) {
        finishCase(token.caseId, e.t);
        continue;
      }
      const delay =
        n.type === 'bpmn:IntermediateCatchEvent' ? (n.attributes.durationMinutes ?? 0) : 0;
      for (const f of outs.get(n.id)!) move(c, token.caseId, f.to, f.id, e.t + delay);
      if (!c.tokens) finishCase(token.caseId, e.t);
      continue;
    }
    // Task: planned waiting (no resource, `ph:waitingMinutes`), then the work with a person.
    const dist = stepDistribution(n, p);
    const item = { token, queued: e.t, work: dist ? sample(dist, r) : 0 };
    const plannedWait = n.attributes.waitingMinutes ?? 0;
    if (plannedWait > 0) schedule({ t: cal.add(e.t, plannedWait), kind: 3, item });
    else ready(item, e.t);
  }
  const window = measured(horizon);
  const workWindow = cal.between(warmup, horizon) || window;
  for (const pl of pools.values()) touch(pl, horizon);
  const tp = Float64Array.from(throughput).sort();
  const totalCost = caseCostSum;
  const stepSla = [...stepStats.values()].reduce((a, s) => [a[0] + s.slaOk, a[1] + s.slaN], [0, 0]);
  return {
    cases: {
      arrived,
      completed,
      inProgress: cases.filter((c) => !c.done && c.arrival >= warmup).length,
    },
    throughput: tp.length
      ? {
          mean: tp.reduce((s, x) => s + x, 0) / tp.length,
          median: quantile(tp, 0.5),
          p90: quantile(tp, 0.9),
          max: tp[tp.length - 1],
        }
      : null,
    costPerCase: casesCosted ? caseCostSum / casesCosted : 0,
    totalCost,
    slaShare: p.slaHours === null || !completed ? null : slaOk / completed,
    stepSlaShare: stepSla[1] ? stepSla[0] / stepSla[1] : null,
    steps: nodes.filter(isTask).map((n) => {
      const s = stepStats.get(n.id);
      return {
        elementId: n.id,
        executions: s?.n ?? 0,
        meanWaiting: s?.n ? s.wait / s.n : 0,
        meanProcessing: s?.n ? s.proc / s.n : 0,
        slaShare: s?.slaN ? s.slaOk / s.slaN : null,
        cost: s?.cost ?? 0,
      };
    }),
    resources: [...pools.entries()].map(([laneId, pl]) => ({
      laneId,
      name: laneName.get(laneId) ?? laneId,
      capacity: pl.capacity,
      utilisation: workWindow ? Math.min(1, pl.busyMinutes / (pl.capacity * workWindow)) : 0,
      meanQueue: window ? pl.queueArea / window : 0,
      maxQueue: pl.maxQueue,
      cost: pl.cost,
    })),
    weekly: [...weekly.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([week, w]) => ({
        week: week + 1,
        completed: w.n,
        meanHours: w.n ? w.sum / w.n : null,
      })),
    events,
    truncated,
  };
}
