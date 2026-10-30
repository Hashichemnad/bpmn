import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  App,
  Breadcrumb,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  TreeSelect,
  Typography,
} from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  PROCESS_ELEMENT_ID,
  type GrcBreakdownRow,
  type RiskDto,
  type UncoveredStepDto,
} from '@processhub/shared';
import { apiDownload } from '@/api/client';
import { useGrcDashboard, useGrcList, useUncoveredSteps, type GrcScope } from '@/api/grc';
import { useDepartments, useProcess } from '@/api/hooks';
import { useLocale } from '@/app/LocaleProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { downloadBlob } from '@/features/modeler/export';
import { RiskMatrix } from './RiskMatrix';
import { grcItemPath, stepHref } from './grc-helpers';
import { RatingTag } from './grc-tags';

type Matrix = 'inherent' | 'residual';

/**
 * Risk dashboard (Phase 4.1): inherent and residual heat maps, coverage tiles linking to filtered
 * registers, drill-down organisation → department → process → step, steps with risks but no
 * control, and the risk–control matrix export.
 */
export function GrcDashboardPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const scope: GrcScope = {
    departmentId: params.get('departmentId') ?? undefined,
    processId: params.get('processId') ?? undefined,
  };
  const dashboard = useGrcDashboard(scope);
  const uncovered = useUncoveredSteps(scope);
  const departments = useDepartments();
  const deptTree = useDepartmentTreeData();
  const process = useProcess(scope.processId);
  const [cell, setCell] = useState<{ matrix: Matrix; likelihood: number; impact: number } | null>(
    null,
  );

  /** Register filters for the current scope. */
  const scopeQuery = useMemo(() => {
    const q = new URLSearchParams();
    if (scope.processId) q.set('processId', scope.processId);
    else if (scope.departmentId) q.set('scopeDepartmentId', scope.departmentId);
    return q;
  }, [scope.processId, scope.departmentId]);
  const registerLink = (path: string, extra: Record<string, string>) => {
    const q = new URLSearchParams(scopeQuery);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return `${path}?${q.toString()}`;
  };
  const cellRisks = useGrcList(
    'RISK',
    {
      ...Object.fromEntries(scopeQuery),
      status: 'ACTIVE',
      cell: cell ? `${cell.likelihood},${cell.impact}` : undefined,
      matrix: cell?.matrix,
      pageSize: 100,
      sort: 'residualScore',
      order: 'desc',
    },
    !!cell,
  );

  const setScope = (next: GrcScope) => {
    const p = new URLSearchParams();
    if (next.departmentId) p.set('departmentId', next.departmentId);
    if (next.processId) p.set('processId', next.processId);
    setCell(null);
    setParams(p);
  };

  const exportRcm = async () => {
    try {
      const file = await apiDownload(
        '/grc/rcm',
        { query: { ...scope, locale } },
        'risk-control-matrix.xlsx',
      );
      downloadBlob(file.blob, file.fileName);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  if (dashboard.isLoading) return <LoadingState />;
  if (dashboard.isError || !dashboard.data)
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  const d = dashboard.data;
  const dept = departments.data?.find((x) => x.id === scope.departmentId);

  const tiles: { key: string; value: number; to?: string; anchor?: boolean; danger?: boolean }[] = [
    {
      key: 'alertRisksWithoutEffectiveControl',
      value: d.coverage.alertRisksWithoutEffectiveControl,
      to: registerLink('/grc/risks', { alertWithoutEffectiveControl: 'true', status: 'ACTIVE' }),
      danger: true,
    },
    {
      key: 'alertRisks',
      value: d.coverage.alertRisks,
      to: registerLink('/grc/risks', { alert: 'true', status: 'ACTIVE' }),
    },
    {
      key: 'risksWithoutControls',
      value: d.coverage.risksWithoutControls,
      to: registerLink('/grc/risks', { withoutControls: 'true', status: 'ACTIVE' }),
    },
    {
      key: 'keyControlsAttention',
      value: d.coverage.keyControlsAttention,
      to: registerLink('/grc/controls', { keyAttention: 'true', status: 'ACTIVE' }),
    },
    {
      key: 'requirementsWithoutControls',
      value: d.coverage.requirementsWithoutControls,
      to: registerLink('/grc/requirements', { withoutControls: 'true', status: 'ACTIVE' }),
    },
    { key: 'stepsWithRiskNoControl', value: d.coverage.stepsWithRiskNoControl, anchor: true },
    {
      key: 'processesWithRiskNoControl',
      value: d.coverage.processesWithRiskNoControl,
      anchor: true,
    },
    {
      key: 'overdueReviews',
      value: d.coverage.overdueReviews,
      to: registerLink('/grc/risks', { overdue: 'true', status: 'ACTIVE' }),
    },
  ];

  const openRow = (r: GrcBreakdownRow) => {
    if (d.breakdown.level === 'department') setScope({ departmentId: r.id });
    else if (d.breakdown.level === 'process')
      setScope({ departmentId: scope.departmentId, processId: r.id });
    else if (scope.processId)
      navigate(stepHref({ process: { id: scope.processId } as never, bpmnElementId: r.id }));
  };

  return (
    <>
      <PageHeader
        crumbs={[{ title: t('nav.grcGroup') }, { title: t('grc:dashboard.title') }]}
        title={t('grc:dashboard.title')}
        subtitle={t('grc:dashboard.subtitle')}
        extra={
          <Space wrap>
            <TreeSelect
              allowClear
              style={{ inlineSize: 220 }}
              placeholder={t('grc:dashboard.allDepartments')}
              treeData={deptTree}
              value={scope.departmentId}
              onChange={(v: string | undefined) => setScope({ departmentId: v })}
              treeDefaultExpandAll
            />
            <Button icon={<DownloadOutlined />} onClick={() => void exportRcm()}>
              {t('grc:dashboard.exportRcm')}
            </Button>
          </Space>
        }
      />
      <Breadcrumb
        style={{ marginBlockEnd: 16 }}
        items={[
          {
            title: (
              <a onClick={() => setScope({})} role="button">
                {t('grc:dashboard.organisation')}
              </a>
            ),
          },
          ...(scope.departmentId
            ? [
                {
                  title: (
                    <a onClick={() => setScope({ departmentId: scope.departmentId })} role="button">
                      {dept ? loc(dept) : '…'}
                    </a>
                  ),
                },
              ]
            : []),
          ...(scope.processId && process.data
            ? [{ title: `${process.data.code} ${loc(process.data)}` }]
            : []),
        ]}
      />
      <Row gutter={[16, 16]} style={{ marginBlockEnd: 16 }}>
        {tiles.map((tile) => (
          <Col key={tile.key} xs={12} md={8} xl={6}>
            <Card
              size="small"
              hoverable
              data-testid={`grc-tile-${tile.key}`}
              onClick={() =>
                tile.anchor
                  ? document.getElementById('grc-uncovered')?.scrollIntoView({ behavior: 'smooth' })
                  : tile.to && navigate(tile.to)
              }
            >
              <Statistic
                title={t(`grc:dashboard.tiles.${tile.key}`)}
                value={tile.value}
                valueStyle={tile.danger && tile.value ? { color: '#dc2626' } : undefined}
              />
            </Card>
          </Col>
        ))}
      </Row>
      <Card style={{ marginBlockEnd: 16 }}>
        <Typography.Paragraph type="secondary">
          {t('grc:dashboard.heatHint', { count: d.heatMap.total })}
        </Typography.Paragraph>
        <div className="ph-grc-matrices">
          {(['inherent', 'residual'] as const).map((m) => (
            <RiskMatrix
              key={m}
              testId={`grc-heatmap-${m}`}
              title={t(`grc:matrix.${m}`)}
              cells={d.heatMap[m]}
              selected={cell?.matrix === m ? cell : null}
              onCell={(likelihood, impact) => setCell({ matrix: m, likelihood, impact })}
            />
          ))}
        </div>
        {cell && (
          <div style={{ marginBlockStart: 16 }} data-testid="grc-cell-risks">
            <Typography.Title level={5}>
              {t('grc:filters.cell', {
                likelihood: cell.likelihood,
                impact: cell.impact,
                matrix: t(`grc:matrix.${cell.matrix}`),
              })}
            </Typography.Title>
            <Table<RiskDto>
              size="small"
              rowKey="id"
              loading={cellRisks.isFetching}
              dataSource={cellRisks.data?.items}
              pagination={false}
              columns={[
                {
                  title: t('grc:fields.title'),
                  render: (_, r) => (
                    <Link to={grcItemPath('RISK', r.id)}>
                      {r.code && (
                        <>
                          <bdi>{r.code}</bdi>
                          {' · '}
                        </>
                      )}
                      {loc(r)}
                    </Link>
                  ),
                },
                {
                  title: t('grc:fields.inherentRating'),
                  width: 150,
                  render: (_, r) => (
                    <RatingTag score={r.rating.inherentScore} band={r.rating.inherentBand} />
                  ),
                },
                {
                  title: t('grc:fields.residualRating'),
                  width: 150,
                  render: (_, r) => (
                    <RatingTag score={r.rating.residualScore} band={r.rating.residualBand} />
                  ),
                },
              ]}
            />
          </div>
        )}
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card title={t(`grc:dashboard.breakdown.${d.breakdown.level}`)}>
            <Table<GrcBreakdownRow>
              size="small"
              rowKey="id"
              dataSource={d.breakdown.rows}
              pagination={false}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              onRow={(r) => ({ onClick: () => openRow(r), style: { cursor: 'pointer' } })}
              columns={[
                {
                  title: t(`grc:dashboard.level.${d.breakdown.level}`),
                  render: (_, r) => (
                    <a>
                      {r.code && <span dir="ltr">{r.code} </span>}
                      {loc(r)}
                    </a>
                  ),
                },
                { title: t('grc:fields.risks'), dataIndex: 'risks', width: 80 },
                {
                  title: t('grc:dashboard.alerts'),
                  dataIndex: 'alerts',
                  width: 110,
                  render: (n: number) => (n ? <Tag color="red">{n}</Tag> : 0),
                },
                {
                  title: t('grc:dashboard.withoutControls'),
                  dataIndex: 'withoutControls',
                  width: 140,
                  render: (n: number) => (n ? <Tag color="orange">{n}</Tag> : 0),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title={t('grc:dashboard.uncovered')} id="grc-uncovered">
            <Table<UncoveredStepDto>
              size="small"
              rowKey={(s) => `${s.process.id}-${s.bpmnElementId}`}
              dataSource={uncovered.data}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              columns={[
                {
                  title: t('grc:dashboard.step'),
                  render: (_, s) => (
                    <Space direction="vertical" size={0}>
                      <Link
                        to={stepHref({
                          process: s.process as never,
                          bpmnElementId: s.bpmnElementId,
                        })}
                      >
                        {s.bpmnElementId === PROCESS_ELEMENT_ID
                          ? t('grc:detail.wholeProcess')
                          : (s.element && loc(s.element)) || s.bpmnElementId}
                      </Link>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        <span dir="ltr">{s.process.code}</span> {loc(s.process)}
                      </Typography.Text>
                    </Space>
                  ),
                },
                {
                  title: t('grc:fields.risks'),
                  render: (_, s) => (
                    <Space size={4} wrap>
                      {s.risks.map((r) => (
                        <Link key={r.id} to={grcItemPath('RISK', r.id)}>
                          <Tag>{r.code || loc(r)}</Tag>
                        </Link>
                      ))}
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
