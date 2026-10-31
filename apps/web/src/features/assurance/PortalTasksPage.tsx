import { Card, Empty, Tabs, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAssuranceTaskTabs } from './AssuranceTaskTabs';
import { useWorkflowTaskTabs } from '@/features/workflow/WorkflowTaskTabs';

/** Portal → My tasks: workflow tasks, actions, issues and questionnaires for people without the workspace. */
export function PortalTasksPage() {
  const { t } = useTranslation();
  const tabs = useAssuranceTaskTabs(true);
  // Workflow tasks first (Phase 5.2): people without the workspace approve requests here.
  const workflow = useWorkflowTaskTabs(true);
  const items = [...workflow.items, ...tabs.items];
  return (
    <Card>
      <Typography.Title level={3}>{t('assurance:portal.tasks')}</Typography.Title>
      {items.length ? (
        <Tabs items={items} />
      ) : (
        <Empty description={t('assurance:portal.noTasks')} />
      )}
    </Card>
  );
}
