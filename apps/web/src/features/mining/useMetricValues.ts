import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PERMISSIONS } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useConformance, useProcessLogs } from '@/api/mining';
import { useSimulation, useSimulations } from '@/api/simulation';
import { useFormatNumber } from '@/components/i18n-helpers';
import { bandOf, type ColourByMode, type MetricValues } from '@/features/modeler/colour-by';
import { miningMetric } from './metric';
import { useFormatDuration, usePercent } from './mining-utils';

/**
 * Data of the metric "Colour by" views of a process (Phase 5.1): the conformance result of an event
 * log linked to the process (`?log=` or the most recent one) for the mining views; the last result of
 * a simulation scenario (`?sim=` or the as-is scenario of the latest simulation) for the simulation
 * views. View only.
 */
export function useMetricValues(
  processId: string,
  mode: ColourByMode,
): { metric?: MetricValues; note?: string; available: ColourByMode[]; loading: boolean } {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const fmtN = useFormatNumber();
  const fmtD = useFormatDuration();
  const pct = usePercent();
  const canMining = can(PERMISSIONS.MINING_READ);
  const logs = useProcessLogs(processId, canMining);
  const log = logs.data?.find((l) => l.id === params.get('log')) ?? logs.data?.[0];
  const isMining = mode.startsWith('mining');
  const conformance = useConformance(isMining ? log?.id : undefined);
  const metric = useMemo(
    () =>
      miningMetric(mode, conformance.data, {
        number: fmtN,
        duration: (ms) => fmtD(ms),
        percent: (v) => pct(v, 0),
      }),
    [mode, conformance.data, fmtN, fmtD, pct],
  );
  // Simulation views.
  const sims = useSimulations(processId, canMining && can(PERMISSIONS.PROCESSES_READ));
  const isSim = mode.startsWith('sim');
  const simList = sims.data ?? [];
  const wantScenario = params.get('sim');
  const simDetail = useSimulation(
    isSim || wantScenario ? simList.find((x) => x.lastRunAt)?.id : undefined,
  );
  const scenario = (() => {
    const sc = simDetail.data?.scenarios.filter((x) => x.result) ?? [];
    return sc.find((x) => x.id === wantScenario) ?? sc.find((x) => x.kind === 'AS_IS') ?? sc[0];
  })();
  const simMetric = useMemo((): MetricValues | undefined => {
    if (!isSim || !scenario?.result || !simDetail.data) return undefined;
    const r = scenario.result;
    const elements: MetricValues['elements'] = new Map();
    const laneOf = new Map(simDetail.data.model.steps.map((st) => [st.id, st.laneId]));
    const maxWait = Math.max(1, ...r.steps.map((st) => st.meanWaiting));
    for (const st of r.steps) {
      if (mode === 'simUtilisation') {
        const res = r.resources.find((x) => x.laneId === laneOf.get(st.elementId));
        if (!res) continue;
        elements.set(st.elementId, {
          band: res.utilisation > 0.85 ? 'high' : res.utilisation > 0.6 ? 'medium' : 'low',
          label: pct(res.utilisation, 0),
        });
      } else
        elements.set(st.elementId, {
          band: bandOf(st.meanWaiting, maxWait),
          label: fmtD(st.meanWaiting * 60_000),
        });
    }
    return { elements, flows: new Map() };
  }, [isSim, scenario, simDetail.data, mode, pct, fmtD]);
  const available: ColourByMode[] = [
    ...(log ? (['miningFrequency', 'miningDuration', 'miningDeviations'] as const) : []),
    ...(simList.some((x) => x.lastRunAt) ? (['simUtilisation', 'simWaiting'] as const) : []),
  ];
  return {
    metric: isMining ? metric : isSim ? simMetric : undefined,
    note:
      isMining && log
        ? `${log.code} · ${log.caseCount}`
        : isSim && scenario && simDetail.data
          ? `${simDetail.data.code} · ${scenario.nameEn || scenario.nameAr}`
          : undefined,
    available,
    loading:
      (isMining && conformance.isFetching) || (isSim && simDetail.isFetching && !simDetail.data),
  };
}
