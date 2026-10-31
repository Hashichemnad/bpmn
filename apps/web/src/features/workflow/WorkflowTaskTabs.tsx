import { Badge, type TabsProps } from 'antd';
import { useTranslation } from 'react-i18next';
import { useWfTaskCounts } from '@/api/workflow';
import { WorkflowTaskTable } from './WorkflowTaskTable';

/** "My tasks" tab with workflow tasks (workspace and portal). */
export function useWorkflowTaskTabs(portal = false): {
  items: NonNullable<TabsProps['items']>;
  count: number;
} {
  const { t } = useTranslation();
  const counts = useWfTaskCounts();
  const count = (counts.data?.mine ?? 0) + (counts.data?.group ?? 0);
  return {
    count,
    items: [
      {
        key: 'workflow',
        label: (
          <span>
            {t('workflow:tasks.tab')}{' '}
            <Badge
              count={count}
              size="small"
              color={counts.data?.overdue ? '#dc2626' : '#1d4ed8'}
              showZero
            />
          </span>
        ),
        children: <WorkflowTaskTable portal={portal} />,
      },
    ],
  };
}
