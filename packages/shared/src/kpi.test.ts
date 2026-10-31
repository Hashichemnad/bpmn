import { describe, expect, it } from 'vitest';
import {
  duePeriod,
  isPeriod,
  kpiRag,
  periodOf,
  periodRange,
  periodStart,
  shiftPeriod,
  thresholdsFor,
  worstRag,
} from './kpi';

describe('KPI periods', () => {
  it('builds, checks and shifts monthly, quarterly and annual periods', () => {
    const d = new Date(Date.UTC(2026, 9, 30));
    expect(periodOf(d, 'MONTHLY')).toBe('2026-10');
    expect(periodOf(d, 'QUARTERLY')).toBe('2026-Q4');
    expect(periodOf(d, 'ANNUAL')).toBe('2026');
    expect(duePeriod(d, 'MONTHLY')).toBe('2026-09');
    expect(duePeriod(d, 'QUARTERLY')).toBe('2026-Q3');
    expect(duePeriod(d, 'ANNUAL')).toBe('2025');
    expect(shiftPeriod('2026-01', 'MONTHLY', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-Q1', 'QUARTERLY', -1)).toBe('2025-Q4');
    expect(periodRange('2026-03', 'MONTHLY', 3)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(periodStart('2026-Q2').toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(isPeriod('2026-13', 'MONTHLY')).toBe(false);
    expect(isPeriod('2026-Q1', 'MONTHLY')).toBe(false);
    expect(isPeriod('2026-Q4', 'QUARTERLY')).toBe(true);
    // Half years (Salesforce "First Half" / "Second Half" results).
    expect(periodOf(d, 'SEMI_ANNUAL')).toBe('2026-H2');
    expect(duePeriod(d, 'SEMI_ANNUAL')).toBe('2026-H1');
    expect(shiftPeriod('2026-H1', 'SEMI_ANNUAL', -1)).toBe('2025-H2');
    expect(periodStart('2026-H2').toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(isPeriod('2026-H2', 'SEMI_ANNUAL')).toBe(true);
    expect(isPeriod('2026-H2', 'QUARTERLY')).toBe(false);
  });
});

describe('KPI status', () => {
  const higher = {
    direction: 'HIGHER_IS_BETTER' as const,
    target: 90,
    greenThreshold: null,
    redThreshold: 80,
  };
  const lower = {
    direction: 'LOWER_IS_BETTER' as const,
    target: 5,
    greenThreshold: 6,
    redThreshold: 10,
  };

  it('green / amber / red in both directions', () => {
    expect([95, 90, 85, 80, 70].map((v) => kpiRag(v, higher))).toEqual([
      'GREEN',
      'GREEN',
      'AMBER',
      'RED',
      'RED',
    ]);
    expect([4, 6, 8, 10, 12].map((v) => kpiRag(v, lower))).toEqual([
      'GREEN',
      'GREEN',
      'AMBER',
      'RED',
      'RED',
    ]);
    // No red threshold: short of green is red; no target: no status.
    expect(kpiRag(85, { ...higher, redThreshold: null })).toBe('RED');
    expect(kpiRag(85, { ...higher, target: null })).toBeNull();
    expect(kpiRag(null, higher)).toBeNull();
  });

  it('a period target overrides the KPI thresholds; the worst status wins', () => {
    const t = thresholdsFor(higher, '2026-03', [
      { period: '2026-03', target: 70, greenThreshold: null, redThreshold: null },
    ]);
    expect(t).toMatchObject({ target: 70, greenThreshold: null, redThreshold: 80 });
    expect(kpiRag(75, t)).toBe('GREEN');
    expect(kpiRag(65, t)).toBe('RED');
    expect(thresholdsFor(higher, '2026-04', [])).toBe(higher);
    expect(worstRag(['GREEN', null, 'AMBER'])).toBe('AMBER');
    expect(worstRag([])).toBeNull();
  });
});
