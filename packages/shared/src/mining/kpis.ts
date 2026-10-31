import { periodOf, type KpiFrequency, type MiningMetric } from '../kpi';
import { caseSpan, eventTime, type LogData } from './log-data';

/**
 * KPIs calculated from an event log (Phase 5.1, D-136), one value per KPI period; a case counts in
 * the period in which it was completed:
 * - MINING_THROUGHPUT_HOURS: mean throughput time (hours);
 * - MINING_SLA_SHARE: % of step executions (waiting + processing) within the step's `ph:slaMinutes`;
 * - MINING_REWORK_RATE: % of cases with a repeated activity;
 * - MINING_CASES: cases completed.
 */
export function miningKpiSeries(
  log: LogData,
  metric: MiningMetric,
  frequency: KpiFrequency,
  /** SLA minutes per activity (from the mapped step), for MINING_SLA_SHARE. */
  slaByActivity: Record<string, number> = {},
): Record<string, { value: number; cases: number }> {
  const acc = new Map<string, { sum: number; n: number; cases: number }>();
  const sla = log.activities.map((a) => slaByActivity[a] ?? null);
  const seen = new Int32Array(log.activities.length).fill(-1);
  for (let c = 0; c < log.caseIds.length; c++) {
    const [s, e] = caseSpan(log, c);
    const period = periodOf(new Date(e), frequency);
    const a = acc.get(period) ?? { sum: 0, n: 0, cases: 0 };
    a.cases++;
    const a0 = log.caseOffsets[c];
    const a1 = log.caseOffsets[c + 1];
    if (metric === 'MINING_THROUGHPUT_HOURS') {
      a.sum += (e - s) / 3_600_000;
      a.n++;
    } else if (metric === 'MINING_CASES') {
      a.sum++;
      a.n = 1;
    } else if (metric === 'MINING_REWORK_RATE') {
      let rework = false;
      for (let i = a0; i < a1 && !rework; i++) {
        if (seen[log.act[i]] === c) rework = true;
        seen[log.act[i]] = c;
      }
      a.sum += rework ? 100 : 0;
      a.n++;
    } else {
      for (let i = a0; i < a1; i++) {
        const limit = sla[log.act[i]];
        if (limit === null) continue;
        const from = i > a0 ? log.end[i - 1] : eventTime(log, i);
        const took = (log.end[i] - Math.min(from, eventTime(log, i))) / 60_000;
        a.sum += took <= limit ? 100 : 0;
        a.n++;
      }
    }
    acc.set(period, a);
  }
  const out: Record<string, { value: number; cases: number }> = {};
  for (const [p, a] of acc) {
    if (!a.n) continue;
    out[p] = {
      value: metric === 'MINING_CASES' ? a.sum : Math.round((a.sum / a.n) * 100) / 100,
      cases: a.cases,
    };
  }
  return out;
}
