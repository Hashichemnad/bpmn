/**
 * Timestamp parsing for event log import (Phase 5.1, D-129): detection of the format of a column
 * from sample values and conversion of local wall-clock times in an IANA time zone to UTC.
 * No dependencies: the offset of a zone comes from `Intl.DateTimeFormat` and is cached per hour.
 */

export const TIMESTAMP_FORMATS = [
  /** ISO 8601: 2026-03-01, 2026-03-01T08:15, 2026-03-01 08:15:30.250, with optional Z / ±hh:mm. */
  'iso',
  /** Day first: 01/03/2026 08:15, 01.03.2026, 01-03-2026 (optional seconds and AM / PM). */
  'dmy',
  /** Month first: 03/01/2026 8:15 AM. */
  'mdy',
  /** Year first with slashes: 2026/03/01 08:15:30. */
  'ymd',
  /** Excel serial date (days since 1899-12-30, fraction = time of day). */
  'excel',
  /** Unix time in seconds. */
  'epochSeconds',
  /** Unix time in milliseconds. */
  'epochMillis',
] as const;
export type TimestampFormat = (typeof TIMESTAMP_FORMATS)[number];

export const DEFAULT_MINING_TIME_ZONE = 'Asia/Dubai';

/** True when the runtime knows the IANA zone. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number>();

/** Offset of `tz` (ms, local − UTC) at the UTC instant `utcMs`. */
export function zoneOffset(utcMs: number, tz: string): number {
  if (tz === 'UTC' || tz === 'Etc/UTC') return 0;
  const hour = Math.floor(utcMs / 3_600_000);
  const key = `${tz}|${hour}`;
  const cached = offsets.get(key);
  if (cached !== undefined) return cached;
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(hour * 3_600_000)))
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  const local = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour === 24 ? 0 : parts.hour,
    parts.minute,
    parts.second,
  );
  const off = local - hour * 3_600_000;
  if (offsets.size > 50_000) offsets.clear();
  offsets.set(key, off);
  return off;
}

/** UTC instant of a wall-clock time in `tz` (DST gaps resolve forwards, overlaps to the first). */
export function zonedTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  ms: number,
  tz: string,
): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  if (Number.isNaN(guess)) return NaN;
  const first = guess - zoneOffset(guess, tz);
  const second = guess - zoneOffset(first, tz);
  return second;
}

const ISO =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const DAY_FIRST =
  /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?\s*(AM|PM|ص|م)?)?$/i;
const YEAR_SLASH =
  /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?)?$/;

const validDate = (y: number, mo: number, d: number, h: number, mi: number, s: number) =>
  mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h <= 24 && mi < 60 && s < 61 && y > 1900;

const fraction = (f: string | undefined) => (f ? Math.round(Number(`0.${f}`) * 1000) : 0);

function hour12(h: number, ampm: string | undefined): number {
  if (!ampm) return h;
  const pm = /^(pm|م)$/i.test(ampm);
  if (h === 12) return pm ? 12 : 0;
  return pm ? h + 12 : h;
}

/**
 * Parses one value. Strings follow `format`; `Date` values (Excel date cells) carry the wall-clock
 * time in their UTC fields and are read in `tz`. Returns epoch milliseconds or NaN.
 */
export function parseTimestamp(
  value: unknown,
  format: TimestampFormat,
  tz: string = DEFAULT_MINING_TIME_ZONE,
): number {
  if (value === null || value === undefined) return NaN;
  if (value instanceof Date) {
    const t = value.getTime();
    if (Number.isNaN(t)) return NaN;
    return zonedTimeToUtc(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
      value.getUTCMilliseconds(),
      tz,
    );
  }
  const raw = typeof value === 'number' ? String(value) : String(value).trim();
  if (!raw) return NaN;
  switch (format) {
    case 'iso': {
      const m = ISO.exec(raw);
      if (!m) return NaN;
      const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x ?? 0));
      if (!validDate(y, mo, d, h, mi, s)) return NaN;
      const ms = fraction(m[7]);
      if (m[8]) {
        const utc = Date.UTC(y, mo - 1, d, h, mi, s, ms);
        if (/^z$/i.test(m[8])) return utc;
        const sign = m[8][0] === '-' ? -1 : 1;
        const digits = m[8].slice(1).replace(':', '');
        const off = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60_000;
        return utc - off;
      }
      return zonedTimeToUtc(y, mo, d, h, mi, s, ms, tz);
    }
    case 'dmy':
    case 'mdy': {
      const m = DAY_FIRST.exec(raw);
      if (!m) return NaN;
      const a = Number(m[1]);
      const b = Number(m[2]);
      const [d, mo] = format === 'dmy' ? [a, b] : [b, a];
      const y = Number(m[3]);
      const h = hour12(Number(m[4] ?? 0), m[8]);
      const mi = Number(m[5] ?? 0);
      const s = Number(m[6] ?? 0);
      if (!validDate(y, mo, d, h, mi, s)) return NaN;
      return zonedTimeToUtc(y, mo, d, h, mi, s, fraction(m[7]), tz);
    }
    case 'ymd': {
      const m = YEAR_SLASH.exec(raw);
      if (!m) return NaN;
      const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x ?? 0));
      if (!validDate(y, mo, d, h, mi, s)) return NaN;
      return zonedTimeToUtc(y, mo, d, h, mi, s, fraction(m[7]), tz);
    }
    case 'excel': {
      if (!/^\d+(\.\d+)?$/.test(raw)) return NaN;
      const serial = Number(raw);
      if (serial < 1 || serial > 2_958_465) return NaN;
      const wall = Math.round((serial - 25569) * 86_400_000);
      const w = new Date(wall);
      return zonedTimeToUtc(
        w.getUTCFullYear(),
        w.getUTCMonth() + 1,
        w.getUTCDate(),
        w.getUTCHours(),
        w.getUTCMinutes(),
        w.getUTCSeconds(),
        w.getUTCMilliseconds(),
        tz,
      );
    }
    case 'epochSeconds':
      return /^\d{9,11}(\.\d+)?$/.test(raw) ? Math.round(Number(raw) * 1000) : NaN;
    case 'epochMillis':
      return /^\d{12,14}$/.test(raw) ? Number(raw) : NaN;
  }
}

export interface TimestampDetection {
  /** Best format, or null when no format parses most samples. */
  format: TimestampFormat | null;
  /** Share of non-empty samples the format parses (0–1). */
  share: number;
  /** Day / month order could not be decided from the samples (all parts ≤ 12): day first assumed. */
  ambiguous: boolean;
}

/** Picks the format that parses the most samples (day first wins ties, the UAE convention). */
export function detectTimestampFormat(samples: unknown[]): TimestampDetection {
  const values = samples.filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
  if (!values.length) return { format: null, share: 0, ambiguous: false };
  if (values.every((v) => v instanceof Date)) return { format: 'iso', share: 1, ambiguous: false };
  const order: TimestampFormat[] = [
    'iso',
    'dmy',
    'mdy',
    'ymd',
    'epochMillis',
    'epochSeconds',
    'excel',
  ];
  let best: TimestampFormat | null = null;
  let bestCount = 0;
  for (const f of order) {
    const n = values.filter((v) => !Number.isNaN(parseTimestamp(v, f, 'UTC'))).length;
    if (n > bestCount) {
      best = f;
      bestCount = n;
    }
  }
  const share = bestCount / values.length;
  if (!best || share < 0.5) return { format: null, share, ambiguous: false };
  let ambiguous = false;
  if (best === 'dmy' || best === 'mdy') {
    const dmy = values.filter((v) => !Number.isNaN(parseTimestamp(v, 'dmy', 'UTC'))).length;
    const mdy = values.filter((v) => !Number.isNaN(parseTimestamp(v, 'mdy', 'UTC'))).length;
    ambiguous = dmy === mdy;
    best = mdy > dmy ? 'mdy' : 'dmy';
  }
  return { format: best, share, ambiguous };
}
