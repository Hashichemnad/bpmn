import { describe, expect, it } from 'vitest';
import { hostMatches, nextReportRun, reportSubscriptionSchema } from './integrations';

const base = {
  frequency: 'WEEKLY' as const,
  weekday: 7,
  monthDay: 1,
  time: '07:00',
  skipHolidays: false,
};
// Dubai is UTC+4 all year: 07:00 Dubai = 03:00 UTC.

describe('nextReportRun (Asia/Dubai)', () => {
  it('daily: the same day when the time is still ahead, otherwise the next day', () => {
    const s = { ...base, frequency: 'DAILY' as const };
    expect(nextReportRun(s, new Date('2026-11-01T02:00:00Z')).toISOString()).toBe(
      '2026-11-01T03:00:00.000Z',
    );
    expect(nextReportRun(s, new Date('2026-11-01T03:00:00Z')).toISOString()).toBe(
      '2026-11-02T03:00:00.000Z',
    );
  });

  it('uses the Dubai date near midnight UTC', () => {
    // 22:30 UTC on 31 Oct is already 02:30 on 1 Nov in Dubai.
    const s = { ...base, frequency: 'DAILY' as const, time: '01:00' };
    expect(nextReportRun(s, new Date('2026-10-31T22:30:00Z')).toISOString()).toBe(
      '2026-11-01T21:00:00.000Z',
    );
  });

  it('weekly on the ISO weekday (2026-11-01 is a Sunday)', () => {
    expect(nextReportRun(base, new Date('2026-10-28T00:00:00Z')).toISOString()).toBe(
      '2026-11-01T03:00:00.000Z',
    );
    expect(
      nextReportRun({ ...base, weekday: 1 }, new Date('2026-11-01T04:00:00Z')).toISOString(),
    ).toBe('2026-11-02T03:00:00.000Z');
  });

  it('monthly on the day of the month', () => {
    const s = { ...base, frequency: 'MONTHLY' as const, monthDay: 15, time: '09:30' };
    expect(nextReportRun(s, new Date('2026-11-20T00:00:00Z')).toISOString()).toBe(
      '2026-12-15T05:30:00.000Z',
    );
  });

  it('skips holidays: weekly / monthly move to the next working day, daily skips the day', () => {
    const work = (d: string) =>
      !['2026-11-01', '2026-11-02'].includes(d) && ![5, 6].includes(new Date(d).getUTCDay());
    expect(
      nextReportRun(
        { ...base, skipHolidays: true },
        new Date('2026-10-30T00:00:00Z'),
        work,
      ).toISOString(),
    ).toBe('2026-11-03T03:00:00.000Z');
    const daily = { ...base, frequency: 'DAILY' as const, skipHolidays: true };
    // Friday 30 Oct and Saturday 31 Oct are weekend days, 1 and 2 Nov holidays.
    expect(nextReportRun(daily, new Date('2026-10-29T04:00:00Z'), work).toISOString()).toBe(
      '2026-11-03T03:00:00.000Z',
    );
  });
});

describe('subscription schema', () => {
  it('needs a process for the handbook and a role / department for group audiences', () => {
    expect(
      reportSubscriptionSchema.safeParse({ name: 'x', report: 'PROCESS_HANDBOOK' }).success,
    ).toBe(false);
    expect(
      reportSubscriptionSchema.safeParse({ name: 'x', report: 'KPI_DASHBOARD', audience: 'ROLE' })
        .success,
    ).toBe(false);
    const ok = reportSubscriptionSchema.parse({ name: 'x', report: 'KPI_DASHBOARD' });
    expect(ok).toMatchObject({
      format: 'LINK',
      frequency: 'WEEKLY',
      weekday: 7,
      time: '07:00',
      audience: 'SELF',
      skipHolidays: true,
    });
  });
});

describe('hostMatches', () => {
  it('matches exact hosts and sub-domains only', () => {
    expect(hostMatches('a.b.example.com', '*.example.com')).toBe(true);
    expect(hostMatches('example.com', '*.example.com')).toBe(false);
    expect(hostMatches('badexample.com', '*.example.com')).toBe(false);
  });
});
