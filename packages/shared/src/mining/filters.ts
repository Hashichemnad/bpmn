import { z } from 'zod';
import { caseSpan, type LogData } from './log-data';

/**
 * Stackable case filters (Phase 5.1, D-133). Every filter keeps or drops whole cases; filters are
 * combined with AND. Applied in the worker before any analysis.
 */
const names = z.array(z.string().max(500)).max(500);

export const miningFilterSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('period'),
    from: z.string().max(40).nullable().optional(),
    to: z.string().max(40).nullable().optional(),
    /** started: case starts in the range; completed: ends in it; contained: both; intersecting: overlaps. */
    mode: z.enum(['started', 'completed', 'contained', 'intersecting']).default('intersecting'),
  }),
  z.object({
    type: z.literal('attribute'),
    name: z.string().max(200),
    values: names,
    exclude: z.boolean().default(false),
  }),
  z.object({ type: z.literal('variant'), ids: names, exclude: z.boolean().default(false) }),
  z.object({
    type: z.literal('throughput'),
    /** Milliseconds. */
    min: z.number().min(0).nullable().optional(),
    max: z.number().min(0).nullable().optional(),
  }),
  z.object({
    type: z.literal('activity'),
    activities: names,
    mode: z.enum(['contains', 'notContains']).default('contains'),
  }),
  z.object({
    type: z.literal('follows'),
    from: z.string().max(500),
    to: z.string().max(500),
    /** true: b directly after a; false: b somewhere after a. */
    directly: z.boolean().default(false),
    exclude: z.boolean().default(false),
  }),
  z.object({ type: z.literal('resource'), values: names, exclude: z.boolean().default(false) }),
  z.object({ type: z.literal('department'), values: names, exclude: z.boolean().default(false) }),
  z.object({ type: z.literal('cases'), ids: z.array(z.string().max(200)).max(1000) }),
]);
export type MiningFilter = z.infer<typeof miningFilterSchema>;
export const miningFiltersSchema = z.array(miningFilterSchema).max(20).default([]);

export const filterPresetSchema = z.object({
  name: z.string().trim().min(1).max(200),
  filters: miningFiltersSchema,
  /** Saved for this log only (default) or for any log. */
  global: z.boolean().default(false),
});
export type FilterPresetInput = z.infer<typeof filterPresetSchema>;

export interface FilterPresetDto {
  id: string;
  name: string;
  filters: MiningFilter[];
  logId: string | null;
}

/** Stable id of a variant (activity sequence): FNV-1a hex of the names. */
export function variantId(activities: string[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const s = activities.join('\u001f');
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Activity index sequence of a case. */
export function caseTrace(log: LogData, c: number): number[] {
  const out: number[] = [];
  for (let i = log.caseOffsets[c]; i < log.caseOffsets[c + 1]; i++) out.push(log.act[i]);
  return out;
}

const parseTime = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

/** 1 = case kept. */
export function applyFilters(log: LogData, filters: MiningFilter[]): Uint8Array {
  const n = log.caseIds.length;
  const keep = new Uint8Array(n).fill(1);
  const actIdx = new Map(log.activities.map((a, i) => [a, i]));
  const resIdx = new Map(log.resources.map((a, i) => [a, i]));
  const depIdx = new Map(log.departments.map((a, i) => [a, i]));
  for (const f of filters) {
    let test: (c: number) => boolean;
    switch (f.type) {
      case 'period': {
        const from = parseTime(f.from);
        const to = parseTime(f.to);
        const lo = Number.isNaN(from) ? -Infinity : from;
        const hi = Number.isNaN(to) ? Infinity : to;
        test = (c) => {
          const [s, e] = caseSpan(log, c);
          if (f.mode === 'started') return s >= lo && s <= hi;
          if (f.mode === 'completed') return e >= lo && e <= hi;
          if (f.mode === 'contained') return s >= lo && e <= hi;
          return s <= hi && e >= lo;
        };
        break;
      }
      case 'attribute': {
        const a = log.attrNames.indexOf(f.name);
        const dict = log.attrDicts[a] ?? [];
        const wanted = new Set(f.values.map((v) => dict.indexOf(v)).filter((i) => i >= 0));
        const has = (c: number) => {
          if (a < 0) return false;
          for (let i = log.caseOffsets[c]; i < log.caseOffsets[c + 1]; i++)
            if (wanted.has(log.attrs[a][i])) return true;
          return false;
        };
        test = f.exclude ? (c) => !has(c) : has;
        break;
      }
      case 'variant': {
        const ids = new Set(f.ids);
        const has = (c: number) =>
          ids.has(variantId(caseTrace(log, c).map((x) => log.activities[x])));
        test = f.exclude ? (c) => !has(c) : has;
        break;
      }
      case 'throughput': {
        const lo = f.min ?? 0;
        const hi = f.max ?? Infinity;
        test = (c) => {
          const [s, e] = caseSpan(log, c);
          const d = e - s;
          return d >= lo && d <= hi;
        };
        break;
      }
      case 'activity': {
        const wanted = new Set(
          f.activities.map((a) => actIdx.get(a)).filter((x) => x !== undefined),
        );
        const has = (c: number) => {
          for (let i = log.caseOffsets[c]; i < log.caseOffsets[c + 1]; i++)
            if (wanted.has(log.act[i])) return true;
          return false;
        };
        test = f.mode === 'notContains' ? (c) => !has(c) : has;
        break;
      }
      case 'follows': {
        const a = actIdx.get(f.from) ?? -1;
        const b = actIdx.get(f.to) ?? -1;
        const has = (c: number) => {
          let seenA = false;
          for (let i = log.caseOffsets[c]; i < log.caseOffsets[c + 1]; i++) {
            const x = log.act[i];
            if (f.directly) {
              if (x === b && i > log.caseOffsets[c] && log.act[i - 1] === a) return true;
            } else {
              if (x === b && seenA) return true;
              if (x === a) seenA = true;
            }
          }
          return false;
        };
        test = f.exclude ? (c) => !has(c) : has;
        break;
      }
      case 'resource':
      case 'department': {
        const idx = f.type === 'resource' ? resIdx : depIdx;
        const col = f.type === 'resource' ? log.res : log.dep;
        const wanted = new Set(f.values.map((v) => idx.get(v)).filter((x) => x !== undefined));
        const has = (c: number) => {
          for (let i = log.caseOffsets[c]; i < log.caseOffsets[c + 1]; i++)
            if (wanted.has(col[i])) return true;
          return false;
        };
        test = f.exclude ? (c) => !has(c) : has;
        break;
      }
      case 'cases': {
        const ids = new Set(f.ids);
        test = (c) => ids.has(log.caseIds[c]);
        break;
      }
    }
    for (let c = 0; c < n; c++) if (keep[c] && !test(c)) keep[c] = 0;
  }
  return keep;
}
