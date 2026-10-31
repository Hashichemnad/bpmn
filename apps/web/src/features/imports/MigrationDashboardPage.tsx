import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Col,
  Flex,
  Progress,
  Row,
  Segmented,
  Statistic,
  Table,
  Tabs,
  Typography,
} from 'antd';
import { DownloadOutlined, OrderedListOutlined, RobotOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { MigrationCounts, MigrationGroupDto, MigrationScope } from '@processhub/shared';
import { useMigrationDashboard } from '@/api/imports';
import { apiDownload } from '@/api/client';
import { useLocale } from '@/app/LocaleProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatNumber, useLocalized } from '@/components/i18n-helpers';
import { downloadBlob } from '@/features/modeler/export';

const COLS: (keyof MigrationCounts)[] = [
  'total',
  'draft',
  'inReview',
  'approved',
  'published',
  'noOwner',
  'missingEn',
  'missingAr',
  'conventions',
];
const PROBLEM_OF: Partial<Record<keyof MigrationCounts, string>> = {
  noOwner: 'NO_OWNER',
  missingEn: 'MISSING_EN',
  missingAr: 'MISSING_AR',
  conventions: 'CONVENTIONS',
};

/** Migration dashboard (M15 step 6): how far the content phase is, per department and branch. */
export function MigrationDashboardPage() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const formatNumber = useFormatNumber();
  const loc = useLocalized();
  const navigate = useNavigate();
  const [scope, setScope] = useState<MigrationScope>('IMPORTED');
  const dash = useMigrationDashboard(scope);
  const exportExcel = async () => {
    try {
      const f = await apiDownload(
        '/migration/dashboard/export',
        { query: { scope, locale } },
        'migration.xlsx',
      );
      downloadBlob(f.blob, f.fileName);
    } catch (e) {
      message.error(errorMessage(e));
    }
  };
  if (dash.isLoading) return <LoadingState />;
  if (dash.isError || !dash.data)
    return <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />;
  const d = dash.data;
  const open = (filter: Record<string, string>) =>
    navigate(`/admin/imports/review?${new URLSearchParams({ scope, ...filter }).toString()}`);
  const table = (rows: MigrationGroupDto[], key: 'departmentId' | 'branchId') => (
    <Table<MigrationGroupDto>
      rowKey={(g) => g.id ?? 'none'}
      size="small"
      pagination={false}
      dataSource={rows}
      scroll={{ x: 1400 }}
      data-testid={`migration-${key}`}
      columns={[
        {
          title: t(
            key === 'departmentId' ? 'imports:dashboard.department' : 'imports:dashboard.branch',
          ),
          render: (_, g) => (
            <Typography.Link onClick={() => open({ [key]: g.id ?? 'none' })}>
              {g.id ? `${g.code ? `${g.code} ` : ''}${loc(g)}` : t('imports:dashboard.none')}
            </Typography.Link>
          ),
        },
        {
          title: t('imports:dashboard.progress'),
          width: 160,
          render: (_, g) => (
            <Progress
              size="small"
              percent={
                g.counts.total
                  ? Math.round(((g.counts.published + g.counts.approved) / g.counts.total) * 100)
                  : 0
              }
              success={{
                percent: g.counts.total
                  ? Math.round((g.counts.published / g.counts.total) * 100)
                  : 0,
              }}
            />
          ),
        },
        ...COLS.map((c) => ({
          title: t(`imports:dashboard.col.${c}`),
          width: 100,
          align: 'end' as const,
          render: (_: unknown, g: MigrationGroupDto) => {
            const v = g.counts[c];
            const problem = PROBLEM_OF[c];
            return problem && v ? (
              <Typography.Link
                type="danger"
                onClick={() => open({ [key]: g.id ?? 'none', problem })}
              >
                {formatNumber(v)}
              </Typography.Link>
            ) : (
              formatNumber(v)
            );
          },
        })),
      ]}
    />
  );
  const tile = (k: keyof MigrationCounts, danger = false) => (
    <Col xs={12} md={8} xl={4} key={k}>
      <Card size="small">
        <Statistic
          title={t(`imports:dashboard.col.${k}`)}
          value={d.totals[k]}
          valueStyle={danger && d.totals[k] ? { color: 'var(--ant-color-error)' } : undefined}
        />
      </Card>
    </Col>
  );
  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('imports:center.title'), to: '/admin/imports' },
          { title: t('imports:dashboard.title') },
        ]}
        title={t('imports:dashboard.title')}
        subtitle={t('imports:dashboard.subtitle')}
        extra={
          <>
            <Segmented<MigrationScope>
              value={scope}
              onChange={setScope}
              options={[
                { value: 'IMPORTED', label: t('imports:dashboard.scope.IMPORTED') },
                { value: 'ALL', label: t('imports:dashboard.scope.ALL') },
              ]}
            />
            <Link to="/admin/imports/review">
              <Button icon={<OrderedListOutlined />}>{t('imports:review.title')}</Button>
            </Link>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => void exportExcel()}
              data-testid="migration-export"
            >
              {t('imports:dashboard.export')}
            </Button>
          </>
        }
      />
      <Row gutter={[12, 12]} style={{ marginBlockEnd: 16 }} data-testid="migration-tiles">
        {tile('total')}
        {tile('draft')}
        {tile('inReview')}
        {tile('published')}
        {tile('noOwner', true)}
        {tile('conventions', true)}
      </Row>
      <Flex gap={16} wrap="wrap" style={{ marginBlockEnd: 16 }}>
        <Typography.Text type="secondary">
          {t('imports:dashboard.batches', d.batches)}
        </Typography.Text>
        {d.proposalsPending > 0 && (
          <Link to="/admin/imports/ai">
            <RobotOutlined /> {t('imports:dashboard.proposals', { count: d.proposalsPending })}
          </Link>
        )}
      </Flex>
      <Card>
        <Tabs
          items={[
            {
              key: 'dep',
              label: t('imports:dashboard.byDepartment'),
              children: table(d.departments, 'departmentId'),
            },
            {
              key: 'branch',
              label: t('imports:dashboard.byBranch'),
              children: table(d.branches, 'branchId'),
            },
            {
              key: 'type',
              label: t('imports:dashboard.byType'),
              children: (
                <Table
                  size="small"
                  pagination={false}
                  rowKey="type"
                  dataSource={(['PROCESS', 'PAGE', 'DIAGRAM'] as const).map((type) => ({
                    type,
                    ...d.byType[type],
                  }))}
                  columns={[
                    {
                      title: t('imports:fields.entity'),
                      render: (_, r) => t(`imports:entity.${r.type}`),
                    },
                    ...COLS.map((c) => ({
                      title: t(`imports:dashboard.col.${c}`),
                      align: 'end' as const,
                      render: (_: unknown, r: MigrationCounts) => formatNumber(r[c]),
                    })),
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}
