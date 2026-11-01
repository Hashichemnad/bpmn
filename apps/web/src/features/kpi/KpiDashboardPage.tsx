import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  Flex,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  TreeSelect,
  Typography,
} from 'antd';
import { DownloadOutlined, FilePptOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { ExportDialog, type ExportRequest } from '@/features/exports/ExportDialog';
import type { KpiDto, KpiRag } from '@processhub/shared';
import { useKpi, useScorecard } from '@/api/kpi';
import { apiDownload } from '@/api/client';
import { useLocale } from '@/app/LocaleProvider';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { UserSelect } from '@/features/governance/UserSelect';
import { downloadBlob } from '@/features/modeler/export';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';
import { KpiChart } from './KpiChart';
import { RagTag, Sparkline } from './kpi-components';
import { NO_RAG_HEX, RAG_HEX, kpiPath, useFormatPeriod, useFormatValue } from './kpi-helpers';

const KEYS = ['departmentId', 'processId', 'ownerId', 'asOf'] as const;

/** KPI dashboard: scorecard by objective with traffic lights and trends, filters, drill-down, Excel. */
export function KpiDashboardPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { locale } = useLocale();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const formatValue = useFormatValue();
  const formatPeriod = useFormatPeriod();
  const departments = useDepartmentTreeData();
  const processes = useProcessTreeOptions('');
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<string | null>(null);
  const [exportReq, setExportReq] = useState<ExportRequest | null>(null);
  const q: Record<string, string | undefined> = {};
  for (const k of KEYS) q[k] = params.get(k) ?? undefined;
  const card = useScorecard(q);
  const set = (k: string, v: string | null | undefined) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const exportExcel = async () => {
    try {
      const f = await apiDownload(
        '/kpis/scorecard/export',
        { query: { ...q, locale } },
        'kpi-scorecard.xlsx',
      );
      downloadBlob(f.blob, f.fileName);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };
  const registerLink = (extra: Record<string, string>) =>
    `/kpis?${new URLSearchParams({
      ...Object.fromEntries(Object.entries(q).filter(([k, v]) => !!v && k !== 'asOf')),
      ...extra,
    } as Record<string, string>).toString()}`;

  const tiles: { key: string; label: string; value: number; colour: string; to: string }[] =
    card.data
      ? [
          {
            key: 'RED',
            label: t('kpi:rag.RED'),
            value: card.data.summary.RED,
            colour: RAG_HEX.RED,
            to: registerLink({ rag: 'RED' }),
          },
          {
            key: 'AMBER',
            label: t('kpi:rag.AMBER'),
            value: card.data.summary.AMBER,
            colour: RAG_HEX.AMBER,
            to: registerLink({ rag: 'AMBER' }),
          },
          {
            key: 'GREEN',
            label: t('kpi:rag.GREEN'),
            value: card.data.summary.GREEN,
            colour: RAG_HEX.GREEN,
            to: registerLink({ rag: 'GREEN' }),
          },
          {
            key: 'none',
            label: t('kpi:rag.none'),
            value: card.data.summary.none,
            colour: NO_RAG_HEX,
            to: registerLink({}),
          },
          {
            key: 'due',
            label: t('kpi:register.dueOnly'),
            value: card.data.summary.due,
            colour: '#1d4ed8',
            to: registerLink({ due: 'true' }),
          },
        ]
      : [];

  return (
    <>
      <PageHeader
        title={t('kpi:dashboard.title')}
        subtitle={t('kpi:dashboard.subtitle')}
        extra={
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={() => void exportExcel()}>
              {t('grc:excel.export')}
            </Button>
            <Button
              icon={<FilePptOutlined />}
              onClick={() =>
                setExportReq({
                  format: 'pptx',
                  scope: 'KPI_SUMMARY',
                  id: q.departmentId,
                  title: t('integrations:export.kpiSummary'),
                })
              }
            >
              {t('integrations:export.menuPptx')}
            </Button>
          </Space>
        }
      />
      <ExportDialog request={exportReq} onClose={() => setExportReq(null)} />
      <Card style={{ marginBlockEnd: 16 }}>
        <Flex gap={8} wrap="wrap">
          <TreeSelect
            allowClear
            placeholder={t('kpi:fields.department')}
            value={q.departmentId}
            onChange={(v) => set('departmentId', v)}
            treeData={departments}
            treeDefaultExpandAll
            style={{ width: 200 }}
          />
          <TreeSelect
            allowClear
            showSearch
            treeNodeFilterProp="title"
            placeholder={t('kpi:fields.process')}
            value={q.processId}
            onChange={(v) => set('processId', v)}
            treeData={processes.options}
            treeDefaultExpandAll
            style={{ width: 260 }}
          />
          <UserSelect
            allowClear
            placeholder={t('kpi:fields.owner')}
            value={q.ownerId}
            onChange={(v) => set('ownerId', v)}
            style={{ width: 220 }}
          />
          <DatePicker
            picker="month"
            allowClear
            placeholder={t('kpi:dashboard.asOf')}
            value={q.asOf ? dayjs(`${q.asOf}-01`) : null}
            onChange={(d) => set('asOf', d ? d.format('YYYY-MM') : null)}
            disabledDate={(d) => d.isAfter(dayjs(), 'month')}
          />
        </Flex>
      </Card>
      {card.isLoading ? (
        <LoadingState />
      ) : card.isError || !card.data ? (
        <ErrorState error={card.error} onRetry={() => void card.refetch()} />
      ) : (
        <>
          <Row gutter={[12, 12]} style={{ marginBlockEnd: 16 }}>
            {tiles.map((s) => (
              <Col key={s.key} xs={12} md={8} lg={4}>
                <Link to={s.to}>
                  <Card
                    size="small"
                    hoverable
                    style={{ borderInlineStart: `4px solid ${s.colour}` }}
                  >
                    <Statistic title={s.label} value={s.value} data-testid={`kpi-tile-${s.key}`} />
                  </Card>
                </Link>
              </Col>
            ))}
          </Row>
          {!card.data.objectives.length ? (
            <EmptyState description={t('kpi:register.empty')} />
          ) : (
            <Space
              direction="vertical"
              size={16}
              style={{ width: '100%' }}
              data-testid="kpi-scorecard"
            >
              {card.data.objectives.map((o) => (
                <Card
                  key={o.objective?.id ?? 'none'}
                  size="small"
                  style={{ marginInlineStart: (o.level - 1) * 24 }}
                  title={
                    <Space wrap>
                      <span>
                        {o.objective
                          ? [o.objective.code, loc(o.objective)].filter(Boolean).join(' · ')
                          : t('kpi:dashboard.noObjective')}
                      </span>
                      {o.kpis.length > 0 && <RagTag rag={o.worst} />}
                    </Space>
                  }
                  extra={
                    o.kpis.length > 0 && (
                      <Space size={4}>
                        {(['RED', 'AMBER', 'GREEN'] as KpiRag[]).map((r) =>
                          o.counts[r] ? (
                            <Tag
                              key={r}
                              color={r === 'RED' ? 'red' : r === 'AMBER' ? 'orange' : 'green'}
                            >
                              {o.counts[r]}
                            </Tag>
                          ) : null,
                        )}
                      </Space>
                    )
                  }
                >
                  {o.kpis.length > 0 ? (
                    <Table<KpiDto>
                      size="small"
                      rowKey="id"
                      pagination={false}
                      dataSource={o.kpis}
                      onRow={(k) => ({
                        onClick: () => setOpen(k.id),
                        style: { cursor: 'pointer' },
                      })}
                      columns={[
                        {
                          title: t('kpi:fields.name'),
                          key: 'n',
                          render: (_, k) => (
                            <Typography.Link onClick={() => setOpen(k.id)}>
                              {[k.code, loc(k)].filter(Boolean).join(' · ')}
                            </Typography.Link>
                          ),
                        },
                        {
                          title: t('kpi:fields.status'),
                          key: 's',
                          width: 150,
                          render: (_, k) => <RagTag rag={k.latest?.rag} />,
                        },
                        {
                          title: t('kpi:fields.actual'),
                          key: 'v',
                          width: 160,
                          render: (_, k) =>
                            k.latest ? (
                              <Space direction="vertical" size={0}>
                                <Typography.Text strong>
                                  {formatValue(k.latest.value, k.unit)}
                                </Typography.Text>
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  {formatPeriod(k.latest.period)}
                                </Typography.Text>
                              </Space>
                            ) : (
                              '—'
                            ),
                        },
                        {
                          title: t('kpi:fields.target'),
                          key: 't',
                          width: 110,
                          render: (_, k) => formatValue(k.latest?.target ?? k.target, k.unit),
                        },
                        {
                          title: t('kpi:fields.trend'),
                          key: 'trend',
                          width: 120,
                          render: (_, k) => <Sparkline points={k.trend} />,
                        },
                        {
                          title: t('kpi:fields.owner'),
                          key: 'o',
                          width: 170,
                          render: (_, k) => (k.owner ? loc(k.owner) || k.owner.email : '—'),
                        },
                      ]}
                    />
                  ) : (
                    <Typography.Text type="secondary">{t('kpi:dashboard.rollUp')}</Typography.Text>
                  )}
                </Card>
              ))}
            </Space>
          )}
        </>
      )}
      <KpiDrawer id={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** Drill-down: chart of actuals vs target and thresholds, link to the KPI page. */
function KpiDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const detail = useKpi(id ?? undefined);
  const k = detail.data?.item;
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      width={720}
      title={k ? [k.code, loc(k)].filter(Boolean).join(' · ') : ''}
      extra={
        k && (
          <Link to={kpiPath(k.id)}>
            <Button type="primary">{t('kpi:dashboard.openKpi')}</Button>
          </Link>
        )
      }
    >
      {detail.isLoading || !detail.data ? (
        <LoadingState />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }} data-testid="kpi-drawer">
          {loc(detail.data.item, 'description') && (
            <Typography.Paragraph>{loc(detail.data.item, 'description')}</Typography.Paragraph>
          )}
          <KpiChart kpi={detail.data.item} measurements={detail.data.measurements} />
        </Space>
      )}
    </Drawer>
  );
}
