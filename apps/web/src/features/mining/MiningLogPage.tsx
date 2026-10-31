import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogPage } from './LogPage';
import { AnalysisStateProvider } from './analysis-state';
import { BottlenecksTab, MapTab, StatsTab, VariantsTab } from './AnalysisTabs';
import { logPath } from './mining-utils';

/** Event log page with the analysis tabs (map, variants, statistics, bottlenecks). */
export function MiningLogPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  return (
    <AnalysisStateProvider key={id}>
      <LogPage
        tabs={[
          { key: 'map', label: t('mining:tabs.map'), render: (log) => <MapTab log={log} /> },
          {
            key: 'variants',
            label: t('mining:tabs.variants'),
            render: (log) => (
              <VariantsTab
                log={log}
                onShowOnMap={() => navigate(logPath(log.id, 'map'), { replace: true })}
              />
            ),
          },
          {
            key: 'statistics',
            label: t('mining:tabs.statistics'),
            render: (log) => <StatsTab log={log} />,
          },
          {
            key: 'bottlenecks',
            label: t('mining:tabs.bottlenecks'),
            render: (log) => <BottlenecksTab log={log} />,
          },
        ]}
      />
    </AnalysisStateProvider>
  );
}
