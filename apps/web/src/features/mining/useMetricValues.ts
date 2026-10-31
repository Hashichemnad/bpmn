import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PERMISSIONS } from '@processhub/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useConformance, useProcessLogs } from '@/api/mining';
import { useFormatNumber } from '@/components/i18n-helpers';
import type { ColourByMode, MetricValues } from '@/features/modeler/colour-by';
import { miningMetric } from './metric';
import { useFormatDuration, usePercent } from './mining-utils';

/**
 * Data of the metric "Colour by" views of a process (Phase 5.1): the conformance result of an event
 * log linked to the process (`?log=` or the most recent one) for the mining views. View only.
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
  const available: ColourByMode[] = log
    ? ['miningFrequency', 'miningDuration', 'miningDeviations']
    : [];
  return {
    metric: isMining ? metric : undefined,
    note: isMining && log ? `${log.code} · ${log.caseCount}` : undefined,
    available,
    loading: isMining && conformance.isFetching,
  };
}
