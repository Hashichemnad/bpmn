import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  App,
  Badge,
  Button,
  Empty,
  Flex,
  Input,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  type TabsProps,
} from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { WfTaskSummaryDto } from '@processhub/shared';
import { useTaskAction, useWfTaskCounts, useWfTasks } from '@/api/workflow';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { DueTag } from './wf-helpers';
import { caseTitle, taskPath } from './wf-paths';

function ClaimButton({ id }: { id: string }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const act = useTaskAction(id);
  return (
    <Button
      size="small"
      loading={act.isPending}
      onClick={() =>
        act.mutate({ action: 'claim' }, { onError: (e) => message.error(errorMessage(e)) })
      }
    >
      {t('workflow:tasks.claim')}
    </Button>
  );
}

/** Workflow tasks table with filters (inbox, Phase 5.2 step 2). */
function WorkflowTaskTable({ portal = false }: { portal?: boolean }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const [scope, setScope] = useState<'mine' | 'group'>('mine');
  const [due, setDue] = useState<'overdue' | 'soon' | undefined>();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const tasks = useWfTasks({ scope, due, q: q || undefined, page, pageSize: 20 });
  const counts = useWfTaskCounts();
  return (
    <>
      <Flex gap={8} wrap style={{ marginBlockEnd: 12 }}>
        <Segmented
          value={scope}
          onChange={(v) => {
            setScope(v as 'mine' | 'group');
            setPage(1);
          }}
          options={[
            {
              value: 'mine',
              label: (
                <span>
                  {t('workflow:tasks.mine')}{' '}
                  <Badge count={counts.data?.mine ?? 0} size="small" color="#1d4ed8" />
                </span>
              ),
            },
            {
              value: 'group',
              label: (
                <span>
                  {t('workflow:tasks.group')}{' '}
                  <Badge count={counts.data?.group ?? 0} size="small" color="#64748b" />
                </span>
              ),
            },
          ]}
          data-testid="wf-scope"
        />
        <Select
          allowClear
          placeholder={t('workflow:tasks.dueFilter')}
          style={{ minWidth: 160 }}
          value={due}
          onChange={(v) => setDue(v)}
          options={[
            { value: 'overdue', label: t('workflow:tasks.overdue') },
            { value: 'soon', label: t('workflow:tasks.dueSoon') },
          ]}
        />
        <Input.Search
          allowClear
          placeholder={t('workflow:tasks.search')}
          style={{ maxWidth: 280 }}
          onSearch={(v) => setQ(v)}
        />
      </Flex>
      <Table<WfTaskSummaryDto>
        rowKey="id"
        size="middle"
        loading={tasks.isLoading}
        dataSource={tasks.data?.items ?? []}
        locale={{
          emptyText: (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('workflow:tasks.empty')} />
          ),
        }}
        pagination={{
          current: page,
          pageSize: 20,
          total: tasks.data?.total ?? 0,
          onChange: setPage,
          hideOnSinglePage: true,
        }}
        scroll={{ x: 760 }}
        data-testid="wf-tasks"
        columns={[
          {
            title: t('workflow:tasks.step'),
            key: 'step',
            render: (_, r) => (
              <Space direction="vertical" size={0}>
                <Link to={taskPath(r.id, portal)}>{loc(r)}</Link>
                <span>
                  {r.approval && <Tag color="purple">{t('workflow:tasks.approval')}</Tag>}
                  {r.onBehalfOf && (
                    <Tag>
                      {t('workflow:tasks.onBehalfOf', {
                        name: loc(r.onBehalfOf) || r.onBehalfOf.email,
                      })}
                    </Tag>
                  )}
                  {r.unclaimed && (
                    <Tag icon={<TeamOutlined />}>
                      {t('workflow:tasks.groupTag', { count: r.candidateCount })}
                    </Tag>
                  )}
                </span>
              </Space>
            ),
          },
          {
            title: t('workflow:tasks.request'),
            key: 'case',
            render: (_, r) => (
              <Space direction="vertical" size={0}>
                <span dir="ltr">{r.caseNumber}</span>
                <span style={{ color: '#64748b' }}>{caseTitle(r, loc)}</span>
              </Space>
            ),
          },
          { title: t('workflow:tasks.process'), key: 'p', render: (_, r) => loc(r, 'processName') },
          {
            title: t('workflow:tasks.requester'),
            key: 'i',
            render: (_, r) => (r.initiator ? loc(r.initiator) || r.initiator.email : '—'),
          },
          {
            title: t('workflow:tasks.due'),
            key: 'due',
            render: (_, r) => <DueTag due={r.dueAt} />,
          },
          {
            key: 'a',
            width: 110,
            render: (_, r) =>
              r.unclaimed ? (
                <ClaimButton id={r.id} />
              ) : (
                <Link to={taskPath(r.id, portal)}>
                  <Button size="small" type="primary">
                    {t('workflow:tasks.open')}
                  </Button>
                </Link>
              ),
          },
        ]}
      />
    </>
  );
}

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
