import { describe, expect, it } from 'vitest';
import {
  WorkCalendar,
  parseBpmnGraph,
  rng,
  sample,
  scenarioParamsSchema,
  simulate,
  validateScenario,
  DEFAULT_UAE_HOLIDAYS,
  holidayListSchema,
  resolveHolidays,
} from '../index';

const PH = 'xmlns:ph="http://processhub.io/schema/bpmn"';
const def = (body: string, lanes = '') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ${PH} id="D"><bpmn:process id="P">${lanes}${body}</bpmn:process></bpmn:definitions>`;
const flow = (id: string, a: string, b: string) =>
  `<bpmn:sequenceFlow id="${id}" sourceRef="${a}" targetRef="${b}" />`;
const lane = (id: string, refs: string[]) =>
  `<bpmn:lane id="${id}" name="${id}">${refs.map((r) => `<bpmn:flowNodeRef>${r}</bpmn:flowNodeRef>`).join('')}</bpmn:lane>`;

/** start → T (lane L) → end */
const single = parseBpmnGraph(
  def(
    `<bpmn:startEvent id="S" /><bpmn:task id="T" /><bpmn:endEvent id="E" />${flow('f1', 'S', 'T')}${flow('f2', 'T', 'E')}`,
    `<bpmn:laneSet id="LS">${lane('L', ['S', 'T', 'E'])}</bpmn:laneSet>`,
  ),
);

const queueing = (perMinute: number, capacity: number, days = 150) =>
  simulate(single, {
    arrival: { unit: 'day', rate: perMinute * 1440 },
    calendar: { alwaysOpen: true },
    days,
    warmupDays: 2,
    seed: 7,
    steps: { T: { duration: { type: 'exponential', mean: 1 } } },
    resources: { L: { capacity, costPerHour: 60 } },
  });

describe('discrete-event simulation — analytical queues', () => {
  it('M/M/1 (λ = 0.5, μ = 1): Wq = 1 min, Lq = 0.5, ρ = 0.5 within tolerance', () => {
    const r = queueing(0.5, 1);
    const t = r.steps.find((s) => s.elementId === 'T')!;
    expect(t.executions).toBeGreaterThan(100_000);
    expect(t.meanWaiting).toBeGreaterThan(0.95);
    expect(t.meanWaiting).toBeLessThan(1.05);
    expect(t.meanProcessing).toBeCloseTo(1, 1);
    expect(r.resources[0].utilisation).toBeCloseTo(0.5, 1);
    expect(r.resources[0].meanQueue).toBeGreaterThan(0.45);
    expect(r.resources[0].meanQueue).toBeLessThan(0.55);
    // W = Wq + 1/μ = 2 min.
    expect(r.throughput!.mean * 60).toBeGreaterThan(1.9);
    expect(r.throughput!.mean * 60).toBeLessThan(2.1);
  });

  it('M/M/2 (λ = 1.5, μ = 1): Erlang C gives Wq = 9/7 min', () => {
    const t = queueing(1.5, 2).steps.find((s) => s.elementId === 'T')!;
    expect(t.meanWaiting).toBeGreaterThan((9 / 7) * 0.93);
    expect(t.meanWaiting).toBeLessThan((9 / 7) * 1.07);
  });

  it('is reproducible with a seed', () => {
    expect(queueing(0.5, 1, 5)).toEqual(queueing(0.5, 1, 5));
  });
});

describe('simulation — model semantics', () => {
  const xor = parseBpmnGraph(
    def(
      `<bpmn:startEvent id="S" /><bpmn:task id="A" ph:durationMinutes="10" ph:costPerExecution="5" /><bpmn:exclusiveGateway id="X" />` +
        `<bpmn:task id="B" ph:durationMinutes="20" ph:costPerExecution="10" /><bpmn:task id="C" ph:durationMinutes="30" /><bpmn:endEvent id="E" />` +
        flow('f1', 'S', 'A') +
        flow('f2', 'A', 'X') +
        flow('f3', 'X', 'B') +
        flow('f4', 'X', 'C') +
        flow('f5', 'B', 'E') +
        flow('f6', 'C', 'E'),
    ),
  );

  it('branches by probability and adds the step costs', () => {
    const r = simulate(xor, {
      arrival: { unit: 'day', rate: 200 },
      calendar: { alwaysOpen: true },
      days: 60,
      warmupDays: 0,
      probabilities: { f3: 70, f4: 30 },
    });
    const b = r.steps.find((s) => s.elementId === 'B')!.executions;
    const c = r.steps.find((s) => s.elementId === 'C')!.executions;
    expect(b / (b + c)).toBeCloseTo(0.7, 1);
    // Cost per case = 5 + 0.7 × 10.
    expect(r.costPerCase).toBeCloseTo(12, 0);
    // No lanes: no queues; throughput 10 + 20 or 10 + 30 minutes.
    expect(r.throughput!.max * 60).toBeCloseTo(40, 5);
  });

  it('forks and joins parallel branches; a case ends once', () => {
    const and = parseBpmnGraph(
      def(
        `<bpmn:startEvent id="S" /><bpmn:parallelGateway id="G1" /><bpmn:task id="A" ph:durationMinutes="15" /><bpmn:task id="B" ph:durationMinutes="45" />` +
          `<bpmn:parallelGateway id="G2" /><bpmn:task id="D" ph:durationMinutes="5" /><bpmn:endEvent id="E" />` +
          flow('f1', 'S', 'G1') +
          flow('f2', 'G1', 'A') +
          flow('f3', 'G1', 'B') +
          flow('f4', 'A', 'G2') +
          flow('f5', 'B', 'G2') +
          flow('f6', 'G2', 'D') +
          flow('f7', 'D', 'E'),
      ),
    );
    const r = simulate(and, {
      arrival: { unit: 'day', rate: 50 },
      calendar: { alwaysOpen: true },
      days: 20,
      warmupDays: 0,
    });
    expect(r.cases.completed).toBeGreaterThan(900);
    const d = r.steps.find((s) => s.elementId === 'D')!;
    // A case still in flight at the end may have done A but not yet D.
    expect(r.steps.find((s) => s.elementId === 'A')!.executions - d.executions).toBeLessThanOrEqual(
      1,
    );
    expect(r.throughput!.mean * 60).toBeCloseTo(50, 5);
  });

  it('works in the working calendar (Sun–Thu, 07:30–15:30, holidays)', () => {
    const p = scenarioParamsSchema.parse({
      startDate: '2026-03-01',
      calendar: { holidays: ['2026-03-02'] },
    });
    const cal = new WorkCalendar(p);
    // 2026-03-01 is a Sunday; 07:30 + 600 working minutes → Monday is a holiday → Tuesday 09:30.
    const end = cal.add(450, 600);
    expect(end).toBe(2 * 1440 + 9.5 * 60);
    expect(cal.isWorkDay(5)).toBe(false); // Friday
    expect(cal.between(0, 3 * 1440)).toBe(960);
    // Outside working hours the next opening is used.
    expect(cal.next(16 * 60)).toBe(2 * 1440 + 450);
  });

  it('samples distributions', () => {
    const r = rng(1);
    const tri = Array.from({ length: 20_000 }, () =>
      sample({ type: 'triangular', min: 10, mode: 20, max: 60 }, r),
    );
    expect(tri.reduce((s, x) => s + x, 0) / tri.length).toBeCloseTo(30, 0);
    expect(Math.min(...tri)).toBeGreaterThanOrEqual(10);
    const norm = Array.from({ length: 20_000 }, () =>
      sample({ type: 'normal', mean: 50, sd: 5 }, r),
    );
    expect(norm.reduce((s, x) => s + x, 0) / norm.length).toBeCloseTo(50, 0);
  });

  it('validates before a run', () => {
    const issues = validateScenario(xor, {
      arrival: { unit: 'model' },
      probabilities: { f3: 60, f4: 30 },
    });
    expect(issues.map((i) => i.code).sort()).toEqual(['NO_ARRIVALS', 'PROBABILITIES_SUM']);
    expect(issues.find((i) => i.code === 'PROBABILITIES_SUM')).toMatchObject({
      elementId: 'X',
      value: 90,
    });
    expect(
      validateScenario(single, { arrival: { unit: 'day', rate: 5 } })
        .map((i) => i.code)
        .sort(),
    ).toEqual(['LANE_WITHOUT_CAPACITY', 'MISSING_DURATION']);
  });
});

describe('central holiday list (D-143)', () => {
  it('marks the Islamic holidays as expected and rejects duplicate dates', () => {
    const eid = DEFAULT_UAE_HOLIDAYS.filter((h) => h.nameEn === 'Eid al-Fitr');
    expect(eid.length).toBeGreaterThan(0);
    expect(eid.every((h) => h.expected)).toBe(true);
    expect(DEFAULT_UAE_HOLIDAYS.find((h) => h.date === '2026-12-02')).toMatchObject({
      nameEn: 'National Day',
      expected: false,
    });
    expect(
      holidayListSchema.safeParse({ holidays: [{ date: '2026-01-01' }, { date: '2026-01-01' }] })
        .success,
    ).toBe(false);
  });

  it('every scenario uses the central list unless it overrides it', () => {
    const central = [{ date: '2026-03-02', nameEn: 'Test', nameAr: '', expected: true }];
    const byDefault = resolveHolidays({ calendar: { holidays: ['2026-01-05'] } }, central);
    expect(byDefault.calendar!.holidays).toEqual(['2026-03-02']);
    const own = resolveHolidays(
      { calendar: { useCentralHolidays: false, holidays: ['2026-01-05'] } },
      central,
    );
    expect(own.calendar!.holidays).toEqual(['2026-01-05']);
    // The working calendar skips the central holiday (2026-03-02, a Monday).
    const cal = new WorkCalendar(
      scenarioParamsSchema.parse({ ...byDefault, startDate: '2026-03-01' }),
    );
    expect(cal.isWorkDay(1)).toBe(false);
  });
});
