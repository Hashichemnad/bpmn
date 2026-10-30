import { Card, Empty, Tabs, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAssuranceTaskTabs } from './AssuranceTaskTabs';

/** Portal → My tasks: actions, issues and questionnaires for people without the workspace. */
export function PortalTasksPage() {
  const { t } = useTranslation();
  const tabs = useAssuranceTaskTabs(true);
  return (
    <Card>
      <Typography.Title level={3}>{t('assurance:portal.tasks')}</Typography.Title>
      {tabs.items.length ? (
        <Tabs items={tabs.items} />
      ) : (
        <Empty description={t('assurance:portal.noTasks')} />
      )}
    </Card>
  );
}
