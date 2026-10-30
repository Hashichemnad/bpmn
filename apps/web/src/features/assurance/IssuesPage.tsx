import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Button,
  Card,
  Checkbox,
  Flex,
  Input,
  Progress,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { AGE_BUCKETS, ISSUE_SOURCES, ISSUE_STATUSES, PERMISSIONS } from '@processhub/shared';
import { useAssuranceSettings, useIssues } from '@/api/assurance';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/states';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { IssueFormModal } from './IssueFormModal';
import { IssueStatusTag, SeverityTag } from './assurance-tags';

const KEYS = [
  'q',
  'status',
  'severity',
  'sourceType',
  'open',
  'overdue',
  'mine',
  'ageBucket',
  'processId',
  'controlId',
  'riskId',
  'departmentId',
  'ownerId',
  'page',
];

/** Issue register with filters in the URL (dashboard tiles link here). */
export function IssuesPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [raising, setRaising] = useState(false);
  const settings = useAssuranceSettings();
  const q = Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? undefined]));
  const list = useIssues({ pageSize: 20, ...q });
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
      {t(`assurance:issues.filters.${k}`)}
    </Checkbox>
  );
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <>
      <PageHeader
        crumbs={[{ title: t('nav.grcGroup') }, { title: t('assurance:issues.title') }]}
        title={t('assurance:issues.title')}
        subtitle={t('assurance:issues.subtitle')}
        extra={
          can(PERMISSIONS.ISSUES_MANAGE) && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setRaising(true)}>
              {t('assurance:issues.raise')}
            </Button>
          )
        }
      />
      <Card>
        <Flex gap={12} wrap="wrap" style={{ marginBlockEnd: 16 }}>
          <Input.Search
            allowClear
            style={{ width: 220 }}
            placeholder={t('assurance:issues.search')}
            defaultValue={q.q}
            onSearch={(v) => set('q', v || undefined)}
          />
          <Select
            allowClear
            style={{ width: 200 }}
            placeholder={t('assurance:issues.statusLabel')}
            value={q.status}
            onChange={(v) => set('status', v)}
            options={ISSUE_STATUSES.map((s) => ({
              value: s,
              label: t(`assurance:issues.status.${s}`),
            }))}
          />
          <Select
            allowClear
            style={{ width: 150 }}
            placeholder={t('assurance:issues.severity')}
            value={q.severity}
            onChange={(v) => set('severity', v)}
            options={(settings.data?.severities ?? []).map((s) => ({
              value: s.key,
              label: loc(s),
            }))}
          />
          <Select
            allowClear
            style={{ width: 190 }}
            placeholder={t('assurance:issues.source')}
            value={q.sourceType}
            onChange={(v) => set('sourceType', v)}
            options={ISSUE_SOURCES.map((s) => ({
              value: s,
              label: t(`assurance:issues.sources.${s}`),
            }))}
          />
          <Select
            allowClear
            style={{ width: 150 }}
            placeholder={t('assurance:issues.age')}
            value={q.ageBucket}
            onChange={(v) => set('ageBucket', v)}
            options={AGE_BUCKETS.map((b) => ({
              value: b,
              label: t('assurance:issues.ageBucket', { range: b }),
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
          data-testid="issues"
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
              title: t('assurance:issues.code'),
              render: (_, r) => (
                <Link to={`/grc/issues/${r.id}`} dir="ltr">
                  {r.code}
                </Link>
              ),
            },
            {
              title: t('assurance:issues.titleLabel'),
              render: (_, r) => <Link to={`/grc/issues/${r.id}`}>{loc(r, 'title')}</Link>,
            },
            {
              title: t('assurance:issues.severity'),
              render: (_, r) => <SeverityTag value={r.severity} />,
            },
            {
              title: t('assurance:issues.statusLabel'),
              render: (_, r) => <IssueStatusTag status={r.status} />,
            },
            {
              title: t('assurance:issues.owner'),
              render: (_, r) => (r.owner ? loc(r.owner) || r.owner.email : '—'),
            },
            {
              title: t('assurance:issues.actions'),
              render: (_, r) =>
                r.actionCount ? (
                  <Progress
                    percent={r.progress}
                    size="small"
                    style={{ minWidth: 90 }}
                    format={() => `${r.actionsDone}/${r.actionCount}`}
                  />
                ) : (
                  '—'
                ),
            },
            {
              title: t('assurance:issues.due'),
              render: (_, r) => (
                <Typography.Text type={r.overdue ? 'danger' : undefined}>
                  {formatDate(r.dueAt, false)}
                </Typography.Text>
              ),
            },
            {
              title: t('assurance:issues.age'),
              render: (_, r) => t('assurance:issues.days', { count: r.ageDays }),
            },
          ]}
        />
      </Card>
      {raising && (
        <IssueFormModal prefill={{ sourceType: 'MANUAL' }} onClose={() => setRaising(false)} />
      )}
    </>
  );
}
