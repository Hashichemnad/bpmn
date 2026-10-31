import { WORK_WEEKS } from '../mining/simulation';
import { z } from 'zod';

/**
 * Business calendar for due times and SLAs (D-150): a central working week (Setting `workflow`) and the
 * central public holiday list of Phase 5.1 (Setting `mining.holidays`). Times are computed in the
 * organisation's time zone, so "07:30" means 07:30 in Dubai whatever the server's zone.
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const workCalendarSchema = z.object({
  week: z.enum(WORK_WEEKS).default('SUN_THU'),
  start: hhmm.default('07:30'),
  end: hhmm.default('15:30'),
  timeZone: z.string().min(1).max(64).default('Asia/Dubai'),
});
export type WorkCalendarSettings = z.infer<typeof workCalendarSchema>;

const MIN = 60_000;
const DAY = 1440;
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** Offset of a time zone at an instant, in minutes (Dubai: +240). */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  let f = fmtCache.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
    fmtCache.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / MIN);
}

export class BusinessCalendar {
  private readonly open: number;
  private readonly close: number;
  private readonly holidays: Set<string>;
  constructor(
    private readonly s: WorkCalendarSettings,
    holidays: string[] = [],
  ) {
    this.open = hm(s.start);
    this.close = Math.max(this.open + 1, hm(s.end));
    this.holidays = new Set(holidays);
  }

  /** Wall-clock minutes since 1970 in the calendar's zone. */
  private wall(d: Date): number {
    return d.getTime() / MIN + zoneOffsetMinutes(this.s.timeZone, d);
  }
  private instant(wall: number): Date {
    const guess = new Date(wall * MIN);
    const off = zoneOffsetMinutes(this.s.timeZone, guess);
    return new Date((wall - off) * MIN);
  }

  isWorkDay(dayIndex: number): boolean {
    if (this.s.week === 'ALL') return !this.holidays.has(this.dateOf(dayIndex));
    const dow = new Date(dayIndex * 86_400_000).getUTCDay();
    if (this.s.week === 'SUN_THU' && (dow === 5 || dow === 6)) return false;
    if (this.s.week === 'MON_FRI' && (dow === 0 || dow === 6)) return false;
    return !this.holidays.has(this.dateOf(dayIndex));
  }
  private dateOf(dayIndex: number) {
    return new Date(dayIndex * 86_400_000).toISOString().slice(0, 10);
  }

  /** The instant `minutes` working minutes after `from`. */
  addWorkingMinutes(from: Date, minutes: number): Date {
    let cur = this.wall(from);
    let left = Math.max(0, minutes);
    for (let guard = 0; guard < 5000; guard++) {
      const day = Math.floor(cur / DAY);
      const m = cur - day * DAY;
      if (!this.isWorkDay(day) || m >= this.close) {
        cur = (day + 1) * DAY;
        continue;
      }
      if (m < this.open) cur = day * DAY + this.open;
      const avail = day * DAY + this.close - cur;
      if (left <= avail) return this.instant(cur + left);
      left -= avail;
      cur = (day + 1) * DAY;
    }
    return this.instant(cur);
  }

  /** Working minutes between two instants (0 when b ≤ a). */
  workingMinutesBetween(a: Date, b: Date): number {
    const wa = this.wall(a);
    const wb = this.wall(b);
    if (wb <= wa) return 0;
    let total = 0;
    for (let day = Math.floor(wa / DAY); day * DAY < wb && total < 1e9; day++) {
      if (!this.isWorkDay(day)) continue;
      const lo = Math.max(wa, day * DAY + this.open);
      const hi = Math.min(wb, day * DAY + this.close);
      if (hi > lo) total += hi - lo;
    }
    return Math.round(total);
  }

  /** Minutes in one working day. */
  get dayMinutes() {
    return this.close - this.open;
  }
}
