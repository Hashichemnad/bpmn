import { Badge, Button, Table, Tag, type TabsProps } from 'antd';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS } from '@processhub/shared';
import { useKpiTasks } from '@/api/kpi';
import { useAuth } from '@/auth/AuthProvider';
import { useLocalized } from '@/components/i18n-helpers';
import { kpiPath, useFormatPeriod } from './kpi-helpers';

/** My tasks: KPI values the user (KPI owner) still has to enter. */
export function useKpiTaskTabs(): { items: NonNullable<TabsProps['items']>; count: number } {
  const { t } = useTranslation();
  const { canAny } = useAuth();
  const loc = useLocalized();
  const formatPeriod = useFormatPeriod();
  const enabled = canAny(PERMISSIONS.KPI_MEASURE, PERMISSIONS.KPI_EDIT);
  const tasks = useKpiTasks(enabled);
  const list = tasks.data ?? [];
  if (!enabled || !list.length) return { items: [], count: 0 };
  return {
    count: list.length,
    items: [
      {
        key: 'kpis',
        label: (
          <span>
            {t('kpi:tasks.tab')} <Badge count={list.length} size="small" color="#1d4ed8" />
          </span>
        ),
        children: (
          <Table
            size="small"
            rowKey={(r) => r.kpi.id}
            dataSource={list}
            pagination={false}
            data-testid="kpi-tasks"
            columns={[
              {
                title: t('kpi:fields.name'),
                key: 'k',
                render: (_, r) => (
                  <Link to={kpiPath(r.kpi.id)}>
                    {[r.kpi.code, loc(r.kpi)].filter(Boolean).join(' · ')}
                  </Link>
                ),
              },
              {
                title: t('kpi:tasks.period'),
                key: 'p',
                render: (_, r) => (
                  <>
                    {formatPeriod(r.period)}{' '}
                    {r.overdue && <Tag color="red">{t('kpi:tasks.overdue')}</Tag>}
                  </>
                ),
              },
              {
                key: 'a',
                width: 140,
                render: (_, r) => (
                  <Link to={kpiPath(r.kpi.id)}>
                    <Button size="small" type="primary">
                      {t('kpi:tasks.enter')}
                    </Button>
                  </Link>
                ),
              },
            ]}
          />
        ),
      },
    ],
  };
}
