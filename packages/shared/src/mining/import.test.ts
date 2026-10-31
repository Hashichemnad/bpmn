import { describe, expect, it } from 'vitest';
import {
  detectTimestampFormat,
  parseTimestamp,
  zonedTimeToUtc,
  buildLogData,
  decodeLogData,
  encodeLogData,
  logFromTraces,
  autoMatchActivities,
  normaliseLabel,
  miningMappingSchema,
} from '../index';

describe('timestamps', () => {
  it('reads wall-clock times in Asia/Dubai (UTC+4) and honours explicit offsets', () => {
    expect(new Date(parseTimestamp('2026-03-01 08:15', 'iso', 'Asia/Dubai')).toISOString()).toBe(
      '2026-03-01T04:15:00.000Z',
    );
    expect(
      new Date(parseTimestamp('2026-03-01T08:15:00Z', 'iso', 'Asia/Dubai')).toISOString(),
    ).toBe('2026-03-01T08:15:00.000Z');
    expect(
      new Date(parseTimestamp('2026-03-01T08:15:00.5+02:00', 'iso', 'Asia/Dubai')).toISOString(),
    ).toBe('2026-03-01T06:15:00.500Z');
    expect(new Date(parseTimestamp('01/03/2026 13:05', 'dmy', 'UTC')).toISOString()).toBe(
      '2026-03-01T13:05:00.000Z',
    );
    expect(new Date(parseTimestamp('03/01/2026 1:05 PM', 'mdy', 'UTC')).toISOString()).toBe(
      '2026-03-01T13:05:00.000Z',
    );
    expect(new Date(parseTimestamp('2026/03/01 13:05:09', 'ymd', 'UTC')).toISOString()).toBe(
      '2026-03-01T13:05:09.000Z',
    );
    expect(new Date(parseTimestamp('46082.5', 'excel', 'UTC')).toISOString()).toBe(
      '2026-03-01T12:00:00.000Z',
    );
    expect(parseTimestamp('1772323200', 'epochSeconds')).toBe(1772323200000);
    expect(parseTimestamp('31/02/2026', 'mdy')).toBeNaN();
    expect(parseTimestamp('', 'iso')).toBeNaN();
    // Excel date cells: wall-clock time in the UTC fields.
    expect(
      new Date(
        parseTimestamp(new Date(Date.UTC(2026, 2, 1, 8)), 'iso', 'Asia/Dubai'),
      ).toISOString(),
    ).toBe('2026-03-01T04:00:00.000Z');
  });

  it('handles daylight saving time zones', () => {
    // Berlin: CET (+1) in winter, CEST (+2) in summer.
    expect(new Date(zonedTimeToUtc(2026, 1, 15, 12, 0, 0, 0, 'Europe/Berlin')).toISOString()).toBe(
      '2026-01-15T11:00:00.000Z',
    );
    expect(new Date(zonedTimeToUtc(2026, 7, 15, 12, 0, 0, 0, 'Europe/Berlin')).toISOString()).toBe(
      '2026-07-15T10:00:00.000Z',
    );
  });

  it('detects the format from samples, day first when ambiguous', () => {
    expect(detectTimestampFormat(['2026-01-02 10:00', '2026-01-03T11:00:00Z'])).toMatchObject({
      format: 'iso',
      share: 1,
    });
    expect(detectTimestampFormat(['13/01/2026 10:00', '02/01/2026'])).toMatchObject({
      format: 'dmy',
      ambiguous: false,
    });
    expect(detectTimestampFormat(['01/13/2026 10:00 AM', '02/01/2026'])).toMatchObject({
      format: 'mdy',
      ambiguous: false,
    });
    expect(detectTimestampFormat(['01/02/2026'])).toMatchObject({ format: 'dmy', ambiguous: true });
    expect(detectTimestampFormat(['hello', 'world']).format).toBeNull();
  });
});

describe('log data', () => {
  it('sorts by case and time, renumbers cases chronologically and round-trips', () => {
    const t = (h: number) => Date.UTC(2026, 0, 1, h);
    const log = buildLogData(
      [
        { caseId: 'B', activity: 'x', start: null, end: t(5), resource: 'r1' },
        { caseId: 'A', activity: 'y', start: null, end: t(9), department: 'd' },
        { caseId: 'A', activity: 'x', start: t(1), end: t(2), attrs: { amount: '10' } },
        { caseId: 'B', activity: 'y', start: null, end: t(4) },
      ],
      ['amount'],
    );
    expect(log.caseIds).toEqual(['A', 'B']);
    expect([...log.caseOffsets]).toEqual([0, 2, 4]);
    expect([...log.act].map((a) => log.activities[a])).toEqual(['x', 'y', 'y', 'x']);
    expect(log.attrs[0][0]).toBe(0);
    expect(log.attrs[0][1]).toBe(-1);
    const back = decodeLogData(encodeLogData(log));
    expect(back.caseIds).toEqual(log.caseIds);
    expect([...back.end]).toEqual([...log.end]);
    expect(Number.isNaN(back.start[1])).toBe(true);
    expect([...back.res]).toEqual([...log.res]);
    expect(back.attrDicts).toEqual([['10']]);
  });

  it('builds logs from traces', () => {
    const log = logFromTraces([['a', 'b'], { trace: ['a', 'c'], count: 2 }]);
    expect(log.caseIds).toHaveLength(3);
    expect(log.act).toHaveLength(6);
  });
});

describe('activity matching', () => {
  it('normalises English and Arabic labels', () => {
    expect(normaliseLabel('  Approve   Request! ')).toBe('approve request');
    expect(normaliseLabel('الموافقةُ على الطلب')).toBe(normaliseLabel('الموافقه علي الطلب'));
  });

  it('matches by label first, then synonyms', () => {
    const m = autoMatchActivities(
      ['approve request', 'اعتماد الطلب', 'Sign off', 'Unknown'],
      [
        { id: 'T1', nameEn: 'Approve request', nameAr: 'اعتماد الطلب', synonyms: ['Sign-off'] },
        { id: 'T2', nameEn: 'Check', nameAr: '' },
      ],
    );
    expect(m.get('approve request')).toEqual({ elementId: 'T1', match: 'LABEL' });
    expect(m.get('اعتماد الطلب')).toEqual({ elementId: 'T1', match: 'LABEL' });
    expect(m.get('Sign off')).toEqual({ elementId: 'T1', match: 'SYNONYM' });
    expect(m.has('Unknown')).toBe(false);
  });
});

describe('mapping schema', () => {
  it('requires a timestamp column and a known time zone', () => {
    expect(miningMappingSchema.safeParse({ caseColumn: 'c', activityColumn: 'a' }).success).toBe(
      false,
    );
    const ok = miningMappingSchema.parse({ caseColumn: 'c', activityColumn: 'a', endColumn: 't' });
    expect(ok.timeZone).toBe('Asia/Dubai');
    expect(
      miningMappingSchema.safeParse({
        caseColumn: 'c',
        activityColumn: 'a',
        endColumn: 't',
        timeZone: 'Mars/Base',
      }).success,
    ).toBe(false);
  });
});
