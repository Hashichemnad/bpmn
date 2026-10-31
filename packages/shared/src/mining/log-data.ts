/**
 * Columnar, dictionary-encoded event log used by every mining algorithm (Phase 5.1, D-128):
 * events sorted by case, then time; strings stored once; times in epoch milliseconds (NaN = none).
 * 1 million events take about 40 MB. `encodeLogData` / `decodeLogData` give a compact binary form
 * that the API stores (gzip) in the file storage and hands to worker threads.
 */
export interface LogData {
  caseIds: string[];
  activities: string[];
  resources: string[];
  departments: string[];
  attrNames: string[];
  /** Dictionary of each extra attribute (same order as `attrNames`). */
  attrDicts: string[][];
  /** Events of case c are `caseOffsets[c] … caseOffsets[c + 1] - 1`. */
  caseOffsets: Uint32Array;
  act: Uint32Array;
  /** Resource / department index per event, -1 = none. */
  res: Int32Array;
  dep: Int32Array;
  start: Float64Array;
  end: Float64Array;
  /** Per attribute: dictionary index per event, -1 = none. */
  attrs: Int32Array[];
}

export interface MiningEventInput {
  caseId: string;
  activity: string;
  /** Epoch ms; null when the log has no start times. */
  start: number | null;
  end: number;
  resource?: string | null;
  department?: string | null;
  attrs?: Record<string, string | null | undefined>;
}

class Dict {
  readonly values: string[] = [];
  private readonly index = new Map<string, number>();
  id(v: string): number {
    let i = this.index.get(v);
    if (i === undefined) {
      i = this.values.length;
      this.values.push(v);
      this.index.set(v, i);
    }
    return i;
  }
}

/** Growable typed array. */
class Column<T extends Float64Array | Int32Array | Uint32Array> {
  private data: T;
  length = 0;
  constructor(private readonly make: (n: number) => T) {
    this.data = make(1024);
  }
  push(v: number) {
    if (this.length === this.data.length) {
      const next = this.make(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
  get(i: number) {
    return this.data[i];
  }
}

/** Collects events in any order; `build()` sorts them by case and time. */
export class LogDataBuilder {
  private readonly cases = new Dict();
  private readonly acts = new Dict();
  private readonly ress = new Dict();
  private readonly deps = new Dict();
  private readonly attrDicts: Dict[];
  private readonly caseCol = new Column((n) => new Uint32Array(n));
  private readonly actCol = new Column((n) => new Uint32Array(n));
  private readonly resCol = new Column((n) => new Int32Array(n));
  private readonly depCol = new Column((n) => new Int32Array(n));
  private readonly startCol = new Column((n) => new Float64Array(n));
  private readonly endCol = new Column((n) => new Float64Array(n));
  private readonly attrCols: Column<Int32Array>[];

  constructor(readonly attrNames: string[] = []) {
    this.attrDicts = attrNames.map(() => new Dict());
    this.attrCols = attrNames.map(() => new Column((n) => new Int32Array(n)));
  }

  get size() {
    return this.actCol.length;
  }

  add(e: MiningEventInput) {
    this.caseCol.push(this.cases.id(e.caseId));
    this.actCol.push(this.acts.id(e.activity));
    this.resCol.push(e.resource ? this.ress.id(e.resource) : -1);
    this.depCol.push(e.department ? this.deps.id(e.department) : -1);
    this.startCol.push(e.start ?? NaN);
    this.endCol.push(e.end);
    this.attrNames.forEach((name, i) => {
      const v = e.attrs?.[name];
      this.attrCols[i].push(
        v === null || v === undefined || v === '' ? -1 : this.attrDicts[i].id(v),
      );
    });
  }

  /** Unsorted columns and dictionaries (cheap; sorted by `sortRawLog`, e.g. in a worker thread). */
  raw(): RawLog {
    const n = this.size;
    const take = <T extends Float64Array | Int32Array | Uint32Array>(
      c: Column<T>,
      make: (n: number) => T,
    ) => {
      const out = make(n);
      for (let i = 0; i < n; i++) out[i] = c.get(i);
      return out;
    };
    return {
      caseIds: this.cases.values,
      activities: this.acts.values,
      resources: this.ress.values,
      departments: this.deps.values,
      attrNames: this.attrNames,
      attrDicts: this.attrDicts.map((d) => d.values),
      caseIdx: take(this.caseCol, (k) => new Uint32Array(k)),
      act: take(this.actCol, (k) => new Uint32Array(k)),
      res: take(this.resCol, (k) => new Int32Array(k)),
      dep: take(this.depCol, (k) => new Int32Array(k)),
      start: take(this.startCol, (k) => new Float64Array(k)),
      end: take(this.endCol, (k) => new Float64Array(k)),
      attrs: this.attrCols.map((c) => take(c, (k) => new Int32Array(k))),
    };
  }

  build(): LogData {
    return sortRawLog(this.raw());
  }
}

/** Events in arrival order (output of the import, input of `sortRawLog`). */
export interface RawLog extends Omit<LogData, 'caseOffsets'> {
  caseIdx: Uint32Array;
}

/** Sorts events by case (cases in order of their first event) and time. */
export function sortRawLog(raw: RawLog): LogData {
  {
    const n = raw.act.length;
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    const key = (i: number) => {
      const s = raw.start[i];
      return Number.isNaN(s) ? raw.end[i] : s;
    };
    order.sort(
      (a, b) =>
        raw.caseIdx[a] - raw.caseIdx[b] || key(a) - key(b) || raw.end[a] - raw.end[b] || a - b,
    );
    // Cases are renumbered in order of their first event's time, so case order is chronological.
    const caseCount = raw.caseIds.length;
    const firstTime = new Float64Array(caseCount).fill(Infinity);
    for (let i = 0; i < n; i++) {
      const c = raw.caseIdx[i];
      const t = key(i);
      if (t < firstTime[c]) firstTime[c] = t;
    }
    const caseOrder = Array.from({ length: caseCount }, (_, i) => i).sort(
      (a, b) => firstTime[a] - firstTime[b] || a - b,
    );
    const rank = new Uint32Array(caseCount);
    caseOrder.forEach((c, i) => (rank[c] = i));
    const counts = new Uint32Array(caseCount);
    for (let i = 0; i < n; i++) counts[rank[raw.caseIdx[i]]]++;
    const caseOffsets = new Uint32Array(caseCount + 1);
    for (let c = 0; c < caseCount; c++) caseOffsets[c + 1] = caseOffsets[c] + counts[c];
    const cursor = caseOffsets.slice(0, caseCount);
    const finalOrder = new Uint32Array(n);
    for (let k = 0; k < n; k++) {
      const i = order[k];
      const c = rank[raw.caseIdx[i]];
      finalOrder[cursor[c]++] = i;
    }
    const act = new Uint32Array(n);
    const res = new Int32Array(n);
    const dep = new Int32Array(n);
    const start = new Float64Array(n);
    const end = new Float64Array(n);
    const attrs = raw.attrs.map(() => new Int32Array(n));
    for (let k = 0; k < n; k++) {
      const i = finalOrder[k];
      act[k] = raw.act[i];
      res[k] = raw.res[i];
      dep[k] = raw.dep[i];
      start[k] = raw.start[i];
      end[k] = raw.end[i];
      for (let a = 0; a < attrs.length; a++) attrs[a][k] = raw.attrs[a][i];
    }
    return {
      caseIds: caseOrder.map((c) => raw.caseIds[c]),
      activities: raw.activities,
      resources: raw.resources,
      departments: raw.departments,
      attrNames: raw.attrNames,
      attrDicts: raw.attrDicts,
      caseOffsets,
      act,
      res,
      dep,
      start,
      end,
      attrs,
    };
  }
}

/** Convenience for tests and small logs: builds from a list of events. */
export function buildLogData(events: MiningEventInput[], attrNames: string[] = []): LogData {
  const b = new LogDataBuilder(attrNames);
  for (const e of events) b.add(e);
  return b.build();
}

/**
 * Builds a log from traces of activity names (tests, published examples): each trace (repeated
 * `count` times) becomes cases whose activities are one minute apart, cases one hour apart.
 */
export function logFromTraces(
  traces: (string[] | { trace: string[]; count: number })[],
  t0 = Date.UTC(2026, 0, 1),
): LogData {
  const events: MiningEventInput[] = [];
  let n = 0;
  for (const tr of traces) {
    const { trace, count } = Array.isArray(tr) ? { trace: tr, count: 1 } : tr;
    for (let k = 0; k < count; k++) {
      const id = `c${++n}`;
      trace.forEach((a, i) =>
        events.push({ caseId: id, activity: a, start: null, end: t0 + n * 3_600_000 + i * 60_000 }),
      );
    }
  }
  return buildLogData(events);
}

export const caseCount = (log: LogData) => log.caseIds.length;
export const eventCount = (log: LogData) => log.act.length;
/** Time used for ordering and durations: start when known, else end. */
export const eventTime = (log: LogData, i: number) =>
  Number.isNaN(log.start[i]) ? log.end[i] : log.start[i];
/** First event time and last end time of a case. */
export function caseSpan(log: LogData, c: number): [number, number] {
  const a = log.caseOffsets[c];
  const b = log.caseOffsets[c + 1];
  let first = Infinity;
  let last = -Infinity;
  for (let i = a; i < b; i++) {
    const t = eventTime(log, i);
    if (t < first) first = t;
    if (log.end[i] > last) last = log.end[i];
  }
  return [first, last];
}
export const hasStartTimes = (log: LogData) => {
  for (let i = 0; i < log.start.length; i++) if (!Number.isNaN(log.start[i])) return true;
  return false;
};

// ---------- Binary form ----------

const MAGIC = 0x50484c31; // "PHL1"

interface Header {
  v: 1;
  caseIds: string[];
  activities: string[];
  resources: string[];
  departments: string[];
  attrNames: string[];
  attrDicts: string[][];
  n: number;
  cases: number;
}

/** Binary form: magic, header length, JSON header (dictionaries), padding, typed arrays. */
export function encodeLogData(log: LogData): Uint8Array {
  const header: Header = {
    v: 1,
    caseIds: log.caseIds,
    activities: log.activities,
    resources: log.resources,
    departments: log.departments,
    attrNames: log.attrNames,
    attrDicts: log.attrDicts,
    n: log.act.length,
    cases: log.caseIds.length,
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const headLen = 8 + json.length;
  const pad = (8 - (headLen % 8)) % 8;
  const arrays: ArrayBufferView[] = [
    log.start,
    log.end,
    log.caseOffsets,
    log.act,
    log.res,
    log.dep,
    ...log.attrs,
  ];
  const size = headLen + pad + arrays.reduce((s, a) => s + a.byteLength, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC);
  view.setUint32(4, json.length);
  out.set(json, 8);
  let off = headLen + pad;
  for (const a of arrays) {
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), off);
    off += a.byteLength;
  }
  return out;
}

export function decodeLogData(bytes: Uint8Array): LogData {
  // Copy into an 8-byte aligned buffer so the typed arrays can view it directly.
  const buf = bytes.byteOffset % 8 === 0 ? bytes : bytes.slice();
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0) !== MAGIC) throw new Error('Not a ProcessHub event log snapshot');
  const jsonLen = view.getUint32(4);
  const header = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + jsonLen))) as Header;
  const headLen = 8 + jsonLen;
  let off = buf.byteOffset + headLen + ((8 - (headLen % 8)) % 8);
  const take = <T>(
    Ctor: new (b: ArrayBufferLike, o: number, l: number) => T,
    len: number,
    bytesPer: number,
  ) => {
    const arr = new Ctor(buf.buffer, off, len);
    off += len * bytesPer;
    return arr;
  };
  const n = header.n;
  const start = take(Float64Array, n, 8);
  const end = take(Float64Array, n, 8);
  const caseOffsets = take(Uint32Array, header.cases + 1, 4);
  const act = take(Uint32Array, n, 4);
  const res = take(Int32Array, n, 4);
  const dep = take(Int32Array, n, 4);
  const attrs = header.attrNames.map(() => take(Int32Array, n, 4));
  return {
    caseIds: header.caseIds,
    activities: header.activities,
    resources: header.resources,
    departments: header.departments,
    attrNames: header.attrNames,
    attrDicts: header.attrDicts,
    caseOffsets,
    act,
    res,
    dep,
    start,
    end,
    attrs,
  };
}

export interface LogSummary {
  cases: number;
  events: number;
  activities: { name: string; events: number; cases: number }[];
  resources: number;
  departments: number;
  hasStartTimes: boolean;
  periodStart: number | null;
  periodEnd: number | null;
}

/** Counts per activity (events, cases), resources, period. */
export function summariseLog(log: LogData): LogSummary {
  const nAct = log.activities.length;
  const events = new Uint32Array(nAct);
  const cases = new Uint32Array(nAct);
  const lastCase = new Int32Array(nAct).fill(-1);
  let min = Infinity;
  let max = -Infinity;
  for (let c = 0; c < log.caseIds.length; c++) {
    for (let i = log.caseOffsets[c]; i < log.caseOffsets[c + 1]; i++) {
      const a = log.act[i];
      events[a]++;
      if (lastCase[a] !== c) {
        lastCase[a] = c;
        cases[a]++;
      }
      const t = eventTime(log, i);
      if (t < min) min = t;
      if (log.end[i] > max) max = log.end[i];
    }
  }
  return {
    cases: log.caseIds.length,
    events: log.act.length,
    activities: log.activities.map((name, a) => ({ name, events: events[a], cases: cases[a] })),
    resources: log.resources.length,
    departments: log.departments.length,
    hasStartTimes: hasStartTimes(log),
    periodStart: Number.isFinite(min) ? min : null,
    periodEnd: Number.isFinite(max) ? max : null,
  };
}
