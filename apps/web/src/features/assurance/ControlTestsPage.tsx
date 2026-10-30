import { Link, useSearchParams } from 'react-router-dom';
import { Card, Checkbox, Flex, Input, Select, Space, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { CONTROL_TEST_STATUSES, TEST_CONCLUSIONS } from '@processhub/shared';
import { useControlTests } from '@/api/assurance';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/states';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { AssigneeLabel, ConclusionTag, TestStatusTag } from './assurance-tags';

const KEYS = [
  'q',
  'status',
  'conclusion',
  'overdue',
  'open',
  'mine',
  'controlId',
  'departmentId',
  'processId',
  'page',
  'sort',
  'order',
];

/** Control tests across all controls (filters in the URL, so dashboard tiles can link here). */
export function ControlTestsPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const [params, setParams] = useSearchParams();
  const q = Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? undefined]));
  const list = useControlTests({ pageSize: 20, ...q });
  const set = (k: string, v: string | undefined) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next);
  };
  const toggle = (k: string) => (
    <Checkbox
      checked={params.get(k) === 'true'}
      onChange={(e) => set(k, e.target.checked ? 'true' : undefined)}
    >
      {t(`assurance:tests.filters.${k}`)}
    </Checkbox>
  );
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <>
      <PageHeader
        crumbs={[{ title: t('nav.grcGroup') }, { title: t('assurance:tests.title') }]}
        title={t('assurance:tests.title')}
        subtitle={t('assurance:tests.subtitle')}
      />
      <Card>
        <Flex gap={12} wrap="wrap" style={{ marginBlockEnd: 16 }}>
          <Input.Search
            allowClear
            style={{ width: 240 }}
            placeholder={t('assurance:tests.search')}
            defaultValue={q.q}
            onSearch={(v) => set('q', v || undefined)}
          />
          <Select
            allowClear
            style={{ width: 180 }}
            placeholder={t('assurance:tests.statusLabel')}
            value={q.status}
            onChange={(v) => set('status', v)}
            options={CONTROL_TEST_STATUSES.map((s) => ({
              value: s,
              label: t(`assurance:tests.status.${s}`),
            }))}
          />
          <Select
            allowClear
            style={{ width: 220 }}
            placeholder={t('assurance:tests.conclusionLabel')}
            value={q.conclusion}
            onChange={(v) => set('conclusion', v)}
            options={TEST_CONCLUSIONS.map((s) => ({
              value: s,
              label: t(`assurance:tests.conclusion.${s}`),
            }))}
          />
          <Space wrap>
            {toggle('open')}
            {toggle('overdue')}
            {toggle('mine')}
          </Space>
        </Flex>
        <Table
          rowKey="id"
          data-testid="control-tests"
          loading={list.isFetching}
          dataSource={list.data?.items ?? []}
          pagination={{
            current: list.data?.page ?? 1,
            pageSize: 20,
            total: list.data?.total ?? 0,
            onChange: (p) => set('page', String(p)),
          }}
          columns={[
            {
              title: t('assurance:tests.control'),
              render: (_, r) => (
                <Link to={`/grc/tests/${r.id}`}>
                  {r.control.code && <span dir="ltr">{r.control.code} </span>}
                  {loc(r.control)}
                </Link>
              ),
            },
            { title: t('assurance:tests.period'), dataIndex: 'period' },
            {
              title: t('assurance:tests.type'),
              render: (_, r) => t(`assurance:tests.types.${r.testType}`),
            },
            {
              title: t('assurance:tests.statusLabel'),
              render: (_, r) => <TestStatusTag status={r.status} />,
            },
            {
              title: t('assurance:tests.conclusionLabel'),
              render: (_, r) => <ConclusionTag value={r.conclusion} />,
            },
            {
              title: t('assurance:tests.tester'),
              render: (_, r) => <AssigneeLabel value={r.tester} />,
            },
            {
              title: t('assurance:tests.due'),
              render: (_, r) => (
                <Typography.Text type={r.overdue ? 'danger' : undefined}>
                  {formatDate(r.dueAt, false)}
                  {r.overdue && ` · ${t('assurance:overdue')}`}
                </Typography.Text>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
