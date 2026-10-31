import type { ConformanceResult } from '@processhub/shared';
import { bandOf, type ColourByMode, type MetricValues } from '@/features/modeler/colour-by';

/**
 * Values of the "Colour by → mining" views from a conformance result (D-135): cases per step,
 * mean waiting + processing time per step, deviation share per step; cases per sequence flow.
 */
export function miningMetric(
  mode: ColourByMode,
  r: ConformanceResult | undefined,
  fmt: {
    number: (n: number) => string;
    duration: (ms: number) => string;
    percent: (v: number) => string;
  },
): MetricValues | undefined {
  if (!r || !mode.startsWith('mining')) return undefined;
  const elements: MetricValues['elements'] = new Map();
  const entries = Object.entries(r.elements);
  const time = (s: ConformanceResult['elements'][string]) =>
    (s.waiting?.mean ?? 0) + (s.processing?.mean ?? 0);
  const maxCases = Math.max(1, ...entries.map(([, s]) => s.cases));
  const maxTime = Math.max(1, ...entries.map(([, s]) => time(s)));
  for (const [id, s] of entries) {
    if (mode === 'miningFrequency')
      elements.set(id, { band: bandOf(s.cases, maxCases), label: fmt.number(s.cases) });
    else if (mode === 'miningDuration')
      elements.set(id, { band: bandOf(time(s), maxTime), label: fmt.duration(time(s)) });
    else {
      const share = s.cases ? s.deviations / s.cases : 0;
      elements.set(id, {
        band: share === 0 ? 'low' : share < 0.1 ? 'medium' : 'high',
        label: s.deviations ? `${fmt.number(s.deviations)} (${fmt.percent(share)})` : '',
      });
    }
  }
  const maxFlow = Math.max(1, ...Object.values(r.flows));
  const flows: MetricValues['flows'] = new Map(
    Object.entries(r.flows).map(([id, n]) => [id, { weight: n / maxFlow, label: fmt.number(n) }]),
  );
  return { elements, flows };
}
