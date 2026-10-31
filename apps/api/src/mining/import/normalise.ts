import { createHmac, randomBytes } from 'node:crypto';
import {
  detectTimestampFormat,
  parseTimestamp,
  type ImportIssueSample,
  type ImportReportDto,
  type MiningEventInput,
  type MiningMapping,
  type TimestampFormat,
} from '@processhub/shared';
import type { CellValue, Row } from './file-readers';

/**
 * Turns rows into events following a mapping and collects the validation report (D-129):
 * missing case / activity / timestamp, unparsable timestamps, start after end, duplicates.
 * Invalid rows are skipped (reported with up to 50 examples); duplicates are skipped when the
 * mapping says so.
 */
const MAX_SAMPLES = 50;

const text = (v: CellValue | undefined): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
};

/** FNV-1a over a string, two lanes combined into one safe integer (duplicate detection). */
function hash53(s: string): number {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h2 >>> 0) * 2097152 + ((h1 >>> 0) & 0x1fffff);
}

/** Keyed pseudonyms; the key is random per import and never stored, so they cannot be reversed. */
export class Pseudonymiser {
  private readonly key = randomBytes(32);
  private readonly cache = new Map<string, string>();
  constructor(private readonly prefix: string) {}
  map(v: string): string {
    let out = this.cache.get(v);
    if (!out) {
      out = `${this.prefix}-${createHmac('sha256', this.key).update(v).digest('hex').slice(0, 12)}`;
      if (this.cache.size < 500_000) this.cache.set(v, out);
    }
    return out;
  }
}

export function detectFormatFromRows(rows: Row[], mapping: MiningMapping) {
  const samples: CellValue[] = [];
  for (const r of rows) {
    if (mapping.startColumn) samples.push(r.values[mapping.startColumn]);
    if (mapping.endColumn) samples.push(r.values[mapping.endColumn]);
  }
  return detectTimestampFormat(samples);
}

export class RowNormaliser {
  readonly report: ImportReportDto = {
    rows: 0,
    events: 0,
    cases: 0,
    activities: 0,
    resources: 0,
    missingCase: 0,
    missingActivity: 0,
    missingTimestamp: 0,
    unparsableTimestamp: 0,
    startAfterEnd: 0,
    duplicates: 0,
    skipped: 0,
    timestampFormat: null,
    ambiguousFormat: false,
    periodStart: null,
    periodEnd: null,
    samples: [],
  };
  private readonly seen = new Set<number>();
  private readonly cases = new Set<string>();
  private readonly activities = new Set<string>();
  private readonly resources = new Set<string>();
  private min = Infinity;
  private max = -Infinity;
  private readonly casePseudo = new Pseudonymiser('C');
  private readonly resPseudo = new Pseudonymiser('R');

  constructor(
    private readonly mapping: MiningMapping,
    private readonly format: TimestampFormat | null,
    ambiguous: boolean,
  ) {
    this.report.timestampFormat = format;
    this.report.ambiguousFormat = ambiguous;
  }

  private issue(
    kind: keyof ImportReportDto,
    row: number,
    column: string,
    value: CellValue | undefined,
  ) {
    (this.report[kind] as number)++;
    if (this.report.samples.length < MAX_SAMPLES)
      this.report.samples.push({
        row,
        column,
        value: text(value).slice(0, 100),
      } as ImportIssueSample);
  }

  private time(v: CellValue | undefined): number | null | 'bad' {
    const s = v instanceof Date ? v : text(v);
    if (s === '') return null;
    if (!this.format && !(v instanceof Date)) return 'bad';
    const t = parseTimestamp(s, this.format ?? 'iso', this.mapping.timeZone);
    return Number.isNaN(t) ? 'bad' : t;
  }

  /** The event of a row, or null (counted in the report). */
  next(row: Row): MiningEventInput | null {
    const m = this.mapping;
    this.report.rows++;
    const caseRaw = text(row.values[m.caseColumn]);
    const activity = text(row.values[m.activityColumn]);
    if (!caseRaw)
      return this.skip(this.issue('missingCase', row.n, m.caseColumn, row.values[m.caseColumn]));
    if (!activity)
      return this.skip(
        this.issue('missingActivity', row.n, m.activityColumn, row.values[m.activityColumn]),
      );
    const start = m.startColumn ? this.time(row.values[m.startColumn]) : null;
    const end = m.endColumn ? this.time(row.values[m.endColumn]) : null;
    if (start === 'bad')
      return this.skip(
        this.issue('unparsableTimestamp', row.n, m.startColumn!, row.values[m.startColumn!]),
      );
    if (end === 'bad')
      return this.skip(
        this.issue('unparsableTimestamp', row.n, m.endColumn!, row.values[m.endColumn!]),
      );
    if (start === null && end === null)
      return this.skip(
        this.issue('missingTimestamp', row.n, m.endColumn ?? m.startColumn ?? '', null),
      );
    const endAt = end ?? start!;
    const startAt = m.startColumn && m.endColumn ? start : null;
    if (startAt !== null && startAt > endAt)
      return this.skip(
        this.issue('startAfterEnd', row.n, m.startColumn!, row.values[m.startColumn!]),
      );
    let resource = m.resourceColumn ? text(row.values[m.resourceColumn]) || null : null;
    const department = m.departmentColumn ? text(row.values[m.departmentColumn]) || null : null;
    const caseId = m.pseudonymise ? this.casePseudo.map(caseRaw) : caseRaw;
    if (resource && m.pseudonymise) resource = this.resPseudo.map(resource);
    const key = hash53(`${caseId}\u0001${activity}\u0001${startAt}\u0001${endAt}\u0001${resource}`);
    if (this.seen.has(key)) {
      this.report.duplicates++;
      if (m.dropDuplicates) {
        this.report.skipped++;
        return null;
      }
    } else this.seen.add(key);
    const attrs: Record<string, string> = {};
    for (const a of m.attributeColumns) {
      const v = text(row.values[a]);
      if (v) attrs[a] = v.slice(0, 500);
    }
    this.report.events++;
    this.cases.add(caseId);
    this.activities.add(activity);
    if (resource) this.resources.add(resource);
    const first = startAt ?? endAt;
    if (first < this.min) this.min = first;
    if (endAt > this.max) this.max = endAt;
    return {
      caseId: caseId.slice(0, 200),
      activity: activity.slice(0, 500),
      start: startAt,
      end: endAt,
      resource: resource?.slice(0, 200) ?? null,
      department: department?.slice(0, 200) ?? null,
      attrs,
    };
  }

  private skip(_: void): null {
    this.report.skipped++;
    return null;
  }

  finish(): ImportReportDto {
    this.report.cases = this.cases.size;
    this.report.activities = this.activities.size;
    this.report.resources = this.resources.size;
    this.report.periodStart = Number.isFinite(this.min) ? new Date(this.min).toISOString() : null;
    this.report.periodEnd = Number.isFinite(this.max) ? new Date(this.max).toISOString() : null;
    return this.report;
  }
}
