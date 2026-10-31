import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { CASE_STATUSES, type CaseStatus, type CaseSummaryDto } from '@processhub/shared';
import { useCases } from '@/api/workflow';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { CaseStatusTag } from './wf-helpers';
import { casePath } from './wf-paths';

/** Case table shared by "My requests" and the monitor. */
export function CaseTable({
  scope,
  portal = false,
  processId,
  stuck,
}: {
  scope: 'mine' | 'involved' | 'monitor';
  portal?: boolean;
  processId?: string;
  stuck?: boolean;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const [status, setStatus] = useState<CaseStatus | undefined>();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const cases = useCases({
    scope,
    status,
    q: q || undefined,
    page,
    pageSize: 20,
    processId,
    stuck,
  });
  return (
    <>
      <Flex gap={8} wrap style={{ marginBlockEnd: 12 }}>
        <Select
          allowClear
          placeholder={t('workflow:requests.status')}
          style={{ minWidth: 160 }}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={CASE_STATUSES.map((s) => ({ value: s, label: t(`workflow:caseStatus.${s}`) }))}
        />
        <Input.Search
          allowClear
          placeholder={t('workflow:requests.search')}
          style={{ maxWidth: 280 }}
          onSearch={(v) => setQ(v)}
        />
      </Flex>
      <Table<CaseSummaryDto>
        rowKey="id"
        size="middle"
        loading={cases.isLoading}
        dataSource={cases.data?.items ?? []}
        pagination={{
          current: page,
          pageSize: 20,
          total: cases.data?.total ?? 0,
          onChange: setPage,
          hideOnSinglePage: true,
        }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('workflow:requests.empty')}
            />
          ),
        }}
        scroll={{ x: 820 }}
        data-testid="wf-cases"
        columns={[
          {
            title: t('workflow:requests.number'),
            key: 'n',
            render: (_, r) => (
              <Link to={casePath(r.id, portal)} dir="ltr">
                {r.number}
              </Link>
            ),
          },
          { title: t('workflow:requests.title'), key: 't', render: (_, r) => loc(r, 'title') },
          { title: t('workflow:tasks.process'), key: 'p', render: (_, r) => loc(r, 'processName') },
          {
            title: t('workflow:requests.status'),
            key: 's',
            render: (_, r) => (
              <Space size={4} wrap>
                <CaseStatusTag status={r.status} outcome={r.outcome} />
                {r.stuck && <Tag color="red">{t('workflow:requests.stuck')}</Tag>}
                {r.overdue && <Tag color="orange">{t('workflow:tasks.overdue')}</Tag>}
              </Space>
            ),
          },
          {
            title: t('workflow:requests.current'),
            key: 'c',
            render: (_, r) => r.currentSteps.map((s) => loc(s)).join(', ') || '—',
          },
          ...(scope !== 'mine'
            ? [
                {
                  title: t('workflow:tasks.requester'),
                  key: 'i',
                  render: (_: unknown, r: CaseSummaryDto) =>
                    r.initiator ? loc(r.initiator) || r.initiator.email : '—',
                },
              ]
            : []),
          {
            title: t('workflow:requests.started'),
            key: 'd',
            render: (_, r) => formatDate(r.startedAt),
          },
        ]}
      />
    </>
  );
}

/** "My requests": the requests a user started (portal and workspace) and those they worked on. */
export function MyRequestsPage({ portal = false }: { portal?: boolean }) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<'mine' | 'involved'>('mine');
  return (
    <Card>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('workflow:requests.title')}
        </Typography.Title>
        <Link to="/portal/services">
          <Button type="primary" icon={<PlusOutlined />}>
            {t('workflow:requests.new')}
          </Button>
        </Link>
      </Flex>
      <Segmented
        style={{ marginBlock: 16 }}
        value={scope}
        onChange={(v) => setScope(v as 'mine' | 'involved')}
        options={[
          { value: 'mine', label: t('workflow:requests.mine') },
          { value: 'involved', label: t('workflow:requests.involved') },
        ]}
      />
      <CaseTable key={scope} scope={scope} portal={portal} />
    </Card>
  );
}
