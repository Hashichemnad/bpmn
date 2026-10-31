import { useSearchParams } from 'react-router-dom';
import { Card, Empty, Tabs, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAssuranceTaskTabs } from './AssuranceTaskTabs';
import { useWorkflowTaskTabs } from '@/features/workflow/WorkflowTaskTabs';

/**
 * Portal → My tasks: actions, issues, questionnaires and workflow tasks for people without the
 * workspace. `?tab=workflow` (or another tab key) opens that tab.
 */
export function PortalTasksPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tabs = useAssuranceTaskTabs(true);
  const workflow = useWorkflowTaskTabs(true);
  const items = [...tabs.items, ...workflow.items];
  const requested = params.get('tab');
  const active = items.some((i) => i.key === requested) ? requested! : items[0]?.key;
  return (
    <Card>
      <Typography.Title level={3}>{t('assurance:portal.tasks')}</Typography.Title>
      {items.length ? (
        <Tabs
          activeKey={active}
          onChange={(k) => setParams({ tab: k }, { replace: true })}
          items={items}
        />
      ) : (
        <Empty description={t('assurance:portal.noTasks')} />
      )}
    </Card>
  );
}
