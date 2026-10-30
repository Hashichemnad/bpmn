import { Link, useSearchParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  TreeSelect,
  Typography,
} from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { ENGAGEMENT_STATUSES, type TestBreakdownRow } from '@processhub/shared';
import { useAssuranceDashboard, useAssuranceSettings } from '@/api/assurance';
import { apiDownload } from '@/api/client';
import { downloadBlob } from '@/features/modeler/export';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';
import { CampaignStatusTag, EngagementStatusTag, SeverityTag } from './assurance-tags';

/** A tile: a figure that opens the matching filtered list. */
function Tile({
  testId,
  title,
  value,
  to,
  danger,
  suffix,
}: {
  testId: string;
  title: string;
  value: number | null;
  to?: string;
  danger?: boolean;
  suffix?: string;
}) {
  const body = (
    <Card size="small" hoverable={!!to} data-testid={testId}>
      <Statistic
        title={title}
        value={value ?? '—'}
        suffix={value === null ? undefined : suffix}
        valueStyle={danger && value ? { color: '#dc2626' } : undefined}
      />
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

/** Assurance dashboard: control testing, issues and actions, audits, surveys; drill-down and Excel. */
export function AssuranceDashboardPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const departments = useDepartmentTreeData();
  const processes = useProcessTreeOptions('');
  const settings = useAssuranceSettings();
  const scope = {
    departmentId: params.get('departmentId') ?? undefined,
    processId: params.get('processId') ?? undefined,
    year: Number(params.get('year')) || new Date().getFullYear(),
  };
  const q = useAssuranceDashboard(scope);
  const set = (k: string, v: string | undefined) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === 'departmentId' && v) next.delete('processId');
    if (k === 'processId' && v) next.delete('departmentId');
    setParams(next);
  };
  const filter = (base: string, extra: Record<string, string>) => {
    const p = new URLSearchParams(extra);
    if (scope.processId) p.set('processId', scope.processId);
    else if (scope.departmentId) p.set('departmentId', scope.departmentId);
    return `${base}?${p.toString()}`;
  };
  const exportXlsx = async (locale: 'en' | 'ar') => {
    try {
      const file = await apiDownload(
        '/assurance/dashboard/export',
        { query: { ...scope, locale } },
        `assurance-${locale}.xlsx`,
      );
      downloadBlob(file.blob, file.fileName);
    } catch (e) {
      message.error(errorMessage(e));
    }
  };
  if (q.isLoading) return <LoadingState />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const breakdown = (rows: TestBreakdownRow[], kind: 'department' | 'process') => (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={rows}
      data-testid={`tests-by-${kind}`}
      locale={{ emptyText: t('assurance:dashboard.noTests') }}
      columns={[
        {
          title: t(`assurance:dashboard.${kind}`),
          render: (_, r) => (
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() => set(kind === 'department' ? 'departmentId' : 'processId', r.id)}
            >
              {[r.code, loc(r)].filter(Boolean).join(' ')}
            </Button>
          ),
        },
        { title: t('assurance:dashboard.done'), dataIndex: 'done' },
        { title: t('assurance:dashboard.due'), dataIndex: 'due' },
        {
          title: t('assurance:dashboard.overdue'),
          render: (_, r) => (
            <Typography.Text type={r.overdue ? 'danger' : undefined}>{r.overdue}</Typography.Text>
          ),
        },
        {
          title: t('assurance:dashboard.effective'),
          render: (_, r) =>
            r.effectivePercent === null ? (
              '—'
            ) : (
              <Progress size="small" percent={r.effectivePercent} style={{ minWidth: 90 }} />
            ),
        },
      ]}
    />
  );
  const maxSeverity = Math.max(1, ...Object.values(d.issues.bySeverity));
  const maxAge = Math.max(1, ...Object.values(d.issues.byAge));

  return (
    <>
      <PageHeader
        crumbs={[{ title: t('nav.grcGroup') }, { title: t('assurance:dashboard.title') }]}
        title={t('assurance:dashboard.title')}
        subtitle={t('assurance:dashboard.subtitle')}
        extra={
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={() => void exportXlsx('en')}>
              Excel (EN)
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => void exportXlsx('ar')}>
              Excel (AR)
            </Button>
          </Space>
        }
      />
      <Card size="small" style={{ marginBlockEnd: 16 }}>
        <Space wrap>
          {t('assurance:audits.year')}
          <InputNumber
            min={2000}
            max={2100}
            value={scope.year}
            onChange={(v) => v && set('year', String(v))}
          />
          <TreeSelect
            allowClear
            style={{ width: 260 }}
            placeholder={t('assurance:dashboard.allDepartments')}
            value={scope.departmentId}
            treeData={departments}
            treeDefaultExpandAll
            onChange={(v) => set('departmentId', v)}
          />
          <TreeSelect
            allowClear
            showSearch
            treeNodeFilterProp="title"
            style={{ width: 320 }}
            placeholder={t('assurance:dashboard.allProcesses')}
            value={scope.processId}
            treeData={processes.options}
            onChange={(v) => set('processId', v)}
          />
        </Space>
      </Card>

      <Typography.Title level={4}>{t('assurance:nav.tests')}</Typography.Title>
      <Row gutter={[12, 12]} style={{ marginBlockEnd: 16 }}>
        <Col xs={12} md={6} xl={4}>
          <Tile
            testId="tile-tests-done"
            title={t('assurance:dashboard.done')}
            value={d.tests.done}
            to={filter('/grc/tests', { open: 'false' })}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <Tile
            testId="tile-tests-due"
            title={t('assurance:dashboard.due')}
            value={d.tests.due}
            to={filter('/grc/tests', { open: 'true' })}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <Tile
            testId="tile-tests-overdue"
            title={t('assurance:dashboard.overdue')}
            value={d.tests.overdue}
            danger
            to={filter('/grc/tests', { overdue: 'true' })}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <Tile
            testId="tile-tests-review"
            title={t('assurance:dashboard.awaitingReview')}
            value={d.tests.awaitingReview}
            to={filter('/grc/tests', { status: 'SUBMITTED' })}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <Tile
            testId="tile-tests-effective"
            title={t('assurance:dashboard.effective')}
            value={d.tests.effectivePercent}
            suffix="%"
            to={filter('/grc/tests', { conclusion: 'NOT_EFFECTIVE' })}
          />
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginBlockEnd: 16 }}>
        <Col xs={24} xl={12}>
          <Card size="small" title={t('assurance:dashboard.byDepartment')}>
            {breakdown(d.tests.byDepartment, 'department')}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title={t('assurance:dashboard.byProcess')}>
            {breakdown(d.tests.byProcess, 'process')}
          </Card>
        </Col>
      </Row>

      <Typography.Title level={4}>{t('assurance:nav.issues')}</Typography.Title>
      <Row gutter={[12, 12]} style={{ marginBlockEnd: 16 }}>
        <Col xs={12} md={6} xl={4}>
          <Tile
            testId="tile-issues-open"
            title={t('assurance:dashboard.openIssues')}
            value={d.issues.open}
            to={filter('/grc/issues', { open: 'true' })}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <Tile
            testId="tile-issues-overdue"
            title={t('assurance:dashboard.overdueIssues')}
            value={d.issues.overdue}
            danger
            to={filter('/grc/issues', { overdue: 'true' })}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <Tile
            testId="tile-actions-overdue"
            title={t('assurance:dashboard.overdueActions')}
            value={d.issues.actionsOverdue}
            danger
            to={filter('/grc/issues', { open: 'true', overdue: 'true' })}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <Tile
            testId="tile-accepted"
            title={t('assurance:dashboard.acceptedRisks')}
            value={d.issues.acceptedRisks}
            to={filter('/grc/issues', { status: 'ACCEPTED_RISK' })}
          />
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginBlockEnd: 16 }}>
        <Col xs={24} xl={12}>
          <Card
            size="small"
            title={t('assurance:dashboard.bySeverity')}
            data-testid="issues-by-severity"
          >
            {(settings.data?.severities ?? []).map((s) => (
              <Link
                key={s.key}
                to={filter('/grc/issues', { open: 'true', severity: s.key })}
                style={{ display: 'flex', gap: 8, alignItems: 'center', marginBlockEnd: 6 }}
              >
                <span style={{ minWidth: 110 }}>
                  <SeverityTag value={s.key} />
                </span>
                <Progress
                  percent={Math.round(((d.issues.bySeverity[s.key] ?? 0) / maxSeverity) * 100)}
                  strokeColor={s.colour}
                  format={() => d.issues.bySeverity[s.key] ?? 0}
                  style={{ flex: 1 }}
                />
              </Link>
            ))}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title={t('assurance:dashboard.byAge')} data-testid="issues-by-age">
            {Object.entries(d.issues.byAge).map(([k, n]) => (
              <Link
                key={k}
                to={filter('/grc/issues', { open: 'true', ageBucket: k })}
                style={{ display: 'flex', gap: 8, alignItems: 'center', marginBlockEnd: 6 }}
              >
                <span style={{ minWidth: 110 }}>
                  {t('assurance:issues.ageBucket', { range: k })}
                </span>
                <Progress
                  percent={Math.round((n / maxAge) * 100)}
                  format={() => n}
                  style={{ flex: 1 }}
                />
              </Link>
            ))}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card
            size="small"
            title={t('assurance:dashboard.auditPlan', { year: d.year })}
            extra={<Link to={`/grc/audits?year=${d.year}`}>{t('assurance:dashboard.open')}</Link>}
            data-testid="audit-progress"
          >
            <Progress percent={d.audits.progressPercent} style={{ marginBlockEnd: 12 }} />
            <Space wrap style={{ marginBlockEnd: 12 }}>
              {ENGAGEMENT_STATUSES.map((s) => (
                <span key={s}>
                  <EngagementStatusTag status={s} /> {d.audits.byStatus[s] ?? 0}
                </span>
              ))}
            </Space>
            <Typography.Paragraph type="secondary">
              {t('assurance:dashboard.findingsPending', {
                count: d.audits.findingsPendingResponse,
              })}
              {d.audits.late
                ? ` · ${t('assurance:dashboard.lateEngagements', { count: d.audits.late })}`
                : ''}
            </Typography.Paragraph>
            <Typography.Text strong>{t('assurance:dashboard.findingsByRating')}</Typography.Text>
            <div style={{ marginBlockStart: 8 }}>
              {Object.keys(d.audits.findingsByRating).length
                ? Object.entries(d.audits.findingsByRating).map(([k, n]) => (
                    <span key={k} style={{ marginInlineEnd: 12 }}>
                      <SeverityTag value={k} />×{n}
                    </span>
                  ))
                : '—'}
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card
            size="small"
            title={t('assurance:dashboard.surveys')}
            extra={`${t('assurance:surveys.responseRate')}: ${d.surveys.responseRate}%`}
            data-testid="survey-rates"
          >
            {!d.surveys.campaigns.length ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              d.surveys.campaigns.slice(0, 8).map((c) => (
                <Link
                  key={c.id}
                  to={`/grc/surveys/campaigns/${c.id}`}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', marginBlockEnd: 6 }}
                >
                  <span style={{ minWidth: 200 }}>
                    {loc(c, 'title')} <CampaignStatusTag status={c.status} />
                  </span>
                  <Progress percent={c.responseRate} style={{ flex: 1 }} />
                </Link>
              ))
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}
