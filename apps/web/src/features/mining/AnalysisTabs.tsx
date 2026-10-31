import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Drawer,
  Flex,
  Form,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  Slider,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  TreeSelect,
  Typography,
} from 'antd';
import { ApartmentOutlined, DownloadOutlined, NodeIndexOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  PERMISSIONS,
  PROCESS_CATEGORIES,
  type CaseDuration,
  type DfgNode,
  type EventLogDto,
  type LogAnalysis,
  type MiningExportKind,
  type VariantDto,
} from '@processhub/shared';
import { exportAnalysis, useAnalysis, useCaseEvents, useDiscover } from '@/api/mining';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/app/LocaleProvider';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useFormatNumber } from '@/components/i18n-helpers';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';
import { useAnalysisState } from './analysis-state';
import { FilterBar } from './FilterBar';
import { MapModeSwitch, ProcessMap, type MapMode } from './ProcessMap';
import { JobProgress } from './mining-helpers';
import { useFormatDuration, usePercent } from './mining-utils';

/** Runs the analysis for the current filters and renders a tab body with it. */
function WithAnalysis({
  log,
  children,
  extra,
}: {
  log: EventLogDto;
  children: (a: LogAnalysis) => ReactNode;
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const fmtN = useFormatNumber();
  const { filters, activityLevel } = useAnalysisState();
  const q = useAnalysis(log.id, { filters, activityLevel });
  return (
    <Flex vertical gap={12}>
      <Card size="small">
        <Flex justify="space-between" align="center" wrap="wrap" gap={8}>
          <FilterBar logId={log.id} analysis={q.data} />
          <Flex gap={8} align="center">
            {q.data && (
              <Typography.Text type="secondary" data-testid="filtered-cases">
                {t('mining:analysis.cases', {
                  cases: fmtN(q.data.cases),
                  total: fmtN(q.data.totalCases),
                })}
              </Typography.Text>
            )}
            {extra}
          </Flex>
        </Flex>
      </Card>
      {q.job && (q.job.status === 'QUEUED' || q.job.status === 'RUNNING') && (
        <Card size="small">
          <JobProgress job={q.job} canCancel={false} />
        </Card>
      )}
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <LoadingState />
      ) : (
        <div style={{ opacity: q.isFetching ? 0.6 : 1 }}>{children(q.data)}</div>
      )}
    </Flex>
  );
}

function ExportButton({ logId, kind }: { logId: string; kind: MiningExportKind }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const { filters, activityLevel } = useAnalysisState();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="small"
      icon={<DownloadOutlined />}
      loading={busy}
      onClick={() => {
        setBusy(true);
        exportAnalysis(logId, kind, { filters, activityLevel })
          .catch((e: unknown) => void message.error(errorMessage(e)))
          .finally(() => setBusy(false));
      }}
    >
      {t('mining:analysis.excel')}
    </Button>
  );
}

// ---------- Map ----------

export function MapTab({ log }: { log: EventLogDto }) {
  const { t } = useTranslation();
  const { activityLevel, setActivityLevel, highlight, setHighlight } = useAnalysisState();
  const { can } = useAuth();
  const [mode, setMode] = useState<MapMode>('frequency');
  const [level, setLevel] = useState(Math.round(activityLevel * 100));
  const [discover, setDiscover] = useState(false);
  const canDiscover =
    log.canManage &&
    can(PERMISSIONS.PROCESSES_CREATE) &&
    (can(PERMISSIONS.MODELS_EDIT) || can(PERMISSIONS.MODELS_EDIT_OWN));
  return (
    <>
      <WithAnalysis
        log={log}
        extra={
          canDiscover && (
            <Button
              size="small"
              icon={<ApartmentOutlined />}
              onClick={() => setDiscover(true)}
              data-testid="discover-bpmn"
            >
              {t('mining:discover.button')}
            </Button>
          )
        }
      >
        {(a) => (
          <Card>
            <Flex gap={16} align="center" wrap="wrap" style={{ marginBlockEnd: 8 }}>
              <MapModeSwitch value={mode} onChange={setMode} />
              <Flex align="center" gap={8} style={{ minWidth: 280 }}>
                <Typography.Text type="secondary">{t('mining:map.activities')}</Typography.Text>
                <Slider
                  style={{ flex: 1, minWidth: 140 }}
                  min={10}
                  max={100}
                  value={level}
                  onChange={setLevel}
                  onChangeComplete={(v) => setActivityLevel(v / 100)}
                  tooltip={{ formatter: (v) => `${v}%` }}
                  data-testid="map-activity-slider"
                />
              </Flex>
              {highlight && (
                <Tag color="purple" closable onClose={() => setHighlight(null)}>
                  {t('mining:map.variantShown')}
                </Tag>
              )}
              {mode === 'performance' && !a.hasStartTimes && (
                <Typography.Text type="secondary">{t('mining:map.noStartTimes')}</Typography.Text>
              )}
            </Flex>
            <ProcessMap nodes={a.map.nodes} edges={a.map.edges} mode={mode} highlight={highlight} />
          </Card>
        )}
      </WithAnalysis>
      {discover && <DiscoverModal log={log} onClose={() => setDiscover(false)} />}
    </>
  );
}

// ---------- Variants ----------

/** Positions of steps that differ between two variants (longest common subsequence). */
function diffSteps(a: string[], b: string[]): [Set<number>, Set<number>] {
  const m = a.length;
  const n = b.length;
  const L = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ka = new Set<number>();
  const kb = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ka.add(i++);
      kb.add(j++);
    } else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  const da = new Set([...Array(m).keys()].filter((x) => !ka.has(x)));
  const db = new Set([...Array(n).keys()].filter((x) => !kb.has(x)));
  return [da, db];
}

function Path({ acts, diff }: { acts: string[]; diff?: Set<number> }) {
  return (
    <Flex wrap="wrap" gap={4} align="center">
      {acts.map((x, i) => (
        <Space key={i} size={4}>
          {i > 0 && <span aria-hidden>{'→'}</span>}
          <Tag color={diff?.has(i) ? 'orange' : undefined} style={{ marginInlineEnd: 0 }}>
            {x}
          </Tag>
        </Space>
      ))}
    </Flex>
  );
}

export function VariantsTab({ log, onShowOnMap }: { log: EventLogDto; onShowOnMap: () => void }) {
  const { t } = useTranslation();
  const fmtN = useFormatNumber();
  const fmtD = useFormatDuration();
  const pct = usePercent();
  const { setHighlight } = useAnalysisState();
  const [selected, setSelected] = useState<string[]>([]);
  const [caseId, setCaseId] = useState<string | null>(null);
  return (
    <WithAnalysis log={log} extra={<ExportButton logId={log.id} kind="variants" />}>
      {(a) => {
        const chosen = selected
          .map((id) => a.variants.items.find((v) => v.id === id))
          .filter(Boolean) as VariantDto[];
        const [d1, d2] =
          chosen.length === 2
            ? diffSteps(chosen[0].activities, chosen[1].activities)
            : [undefined, undefined];
        return (
          <Flex vertical gap={12}>
            {chosen.length === 2 && (
              <Card title={t('mining:variants.compare')} size="small" data-testid="variant-compare">
                {chosen.map((v, k) => (
                  <Flex key={v.id} vertical gap={4} style={{ marginBlockEnd: 12 }}>
                    <Typography.Text strong>
                      {t('mining:variants.variant', { n: a.variants.items.indexOf(v) + 1 })} ·{' '}
                      {fmtN(v.count)} · {pct(v.share)} · {fmtD(v.meanMs)}
                    </Typography.Text>
                    <Path acts={v.activities} diff={k === 0 ? d1 : d2} />
                  </Flex>
                ))}
                <Typography.Text type="secondary">
                  {t('mining:variants.difference', {
                    time: fmtD(Math.abs(chosen[0].meanMs - chosen[1].meanMs)),
                    steps: Math.abs(chosen[0].activities.length - chosen[1].activities.length),
                  })}
                </Typography.Text>
              </Card>
            )}
            <Card size="small">
              <Typography.Paragraph type="secondary">
                {t('mining:variants.summary', {
                  total: fmtN(a.variants.total),
                  shown: a.variants.items.length,
                })}
              </Typography.Paragraph>
              <Table<VariantDto>
                rowKey="id"
                size="small"
                data-testid="variants-table"
                dataSource={a.variants.items}
                pagination={{ pageSize: 20, hideOnSinglePage: true }}
                rowSelection={{
                  selectedRowKeys: selected,
                  onChange: (keys) => setSelected((keys as string[]).slice(-2)),
                }}
                expandable={{
                  expandedRowRender: (v) => (
                    <Flex vertical gap={8}>
                      <Path acts={v.activities} />
                      <Space wrap>
                        <Typography.Text type="secondary">
                          {t('mining:variants.examples')}
                        </Typography.Text>
                        {v.exampleCases.map((c) => (
                          <Typography.Link key={c} onClick={() => setCaseId(c)}>
                            {c}
                          </Typography.Link>
                        ))}
                      </Space>
                    </Flex>
                  ),
                }}
                columns={[
                  { title: '#', width: 50, render: (_, __, i) => i + 1 },
                  {
                    title: t('mining:fields.cases'),
                    align: 'end',
                    width: 90,
                    render: (_, v) => fmtN(v.count),
                  },
                  {
                    title: t('mining:variants.share'),
                    width: 160,
                    render: (_, v) => (
                      <Progress percent={Math.round(v.share * 1000) / 10} size="small" />
                    ),
                  },
                  {
                    title: t('mining:variants.mean'),
                    width: 110,
                    render: (_, v) => fmtD(v.meanMs),
                  },
                  {
                    title: t('mining:variants.median'),
                    width: 110,
                    render: (_, v) => fmtD(v.medianMs),
                  },
                  {
                    title: t('mining:variants.steps'),
                    width: 70,
                    align: 'end',
                    dataIndex: ['activities', 'length'],
                  },
                  {
                    title: t('mining:variants.path'),
                    render: (_, v) => (
                      <Typography.Text ellipsis style={{ maxWidth: 420 }}>
                        {v.activities.join(' → ')}
                      </Typography.Text>
                    ),
                  },
                  {
                    title: '',
                    width: 120,
                    render: (_, v) => (
                      <Button
                        size="small"
                        icon={<NodeIndexOutlined />}
                        onClick={() => {
                          setHighlight(v.activities);
                          onShowOnMap();
                        }}
                      >
                        {t('mining:variants.onMap')}
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
            <CaseDrawer logId={log.id} caseId={caseId} onClose={() => setCaseId(null)} />
          </Flex>
        );
      }}
    </WithAnalysis>
  );
}

// ---------- Statistics ----------

export function StatsTab({ log }: { log: EventLogDto }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const fmtN = useFormatNumber();
  const fmtD = useFormatDuration();
  const pct = usePercent();
  const hours = (ms: number | null) =>
    ms === null ? null : Math.round((ms / 3_600_000) * 10) / 10;
  return (
    <WithAnalysis log={log}>
      {(a) => {
        const s = a.stats;
        const handoverNodes: DfgNode[] = [
          ...new Set(s.handovers.slice(0, 30).flatMap((h) => [h.from, h.to])),
        ].map((r) => ({
          activity: r,
          events: s.resources.find((x) => x.resource === r)?.events ?? 0,
          cases: 0,
          starts: 0,
          ends: 0,
          processing: null,
          waiting: null,
        }));
        return (
          <Flex vertical gap={12} data-testid="mining-stats">
            <Row gutter={[12, 12]}>
              {[
                [t('mining:fields.cases'), fmtN(a.cases)],
                [t('mining:fields.events'), fmtN(a.events)],
                [t('mining:stats.variants'), fmtN(a.variants.total)],
                [t('mining:stats.mean'), fmtD(s.throughput?.mean)],
                [t('mining:stats.median'), fmtD(s.throughput?.median)],
                [t('mining:stats.p90'), fmtD(s.throughput?.p90)],
                [t('mining:stats.rework'), pct(s.rework.share)],
                [t('mining:stats.eventsPerCase'), fmtN(Math.round(s.eventsPerCase * 10) / 10)],
              ].map(([title, value]) => (
                <Col xs={12} md={6} xl={3} key={title}>
                  <Card size="small">
                    <Statistic title={title} value={value} />
                  </Card>
                </Col>
              ))}
            </Row>
            <Row gutter={[12, 12]}>
              <Col xs={24} xl={14}>
                <Card size="small" title={t(`mining:stats.trend.${s.granularity}`)}>
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={s.trend.map((p) => ({ ...p, hours: hours(p.meanMs) }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="period" reversed={locale === 'ar'} fontSize={11} />
                      <YAxis
                        yAxisId="c"
                        orientation={locale === 'ar' ? 'right' : 'left'}
                        fontSize={11}
                      />
                      <YAxis
                        yAxisId="h"
                        orientation={locale === 'ar' ? 'left' : 'right'}
                        fontSize={11}
                      />
                      <ChartTooltip />
                      <Bar
                        yAxisId="c"
                        dataKey="started"
                        name={t('mining:stats.started')}
                        fill="#93C5FD"
                      />
                      <Line
                        yAxisId="h"
                        dataKey="hours"
                        name={t('mining:stats.meanHours')}
                        stroke="#DC2626"
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col xs={24} xl={10}>
                <Card size="small" title={t('mining:stats.histogram')}>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={s.histogram.map((b) => ({ label: fmtD(b.to), count: b.count }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" reversed={locale === 'ar'} fontSize={10} />
                      <YAxis orientation={locale === 'ar' ? 'right' : 'left'} fontSize={11} />
                      <ChartTooltip />
                      <Bar dataKey="count" name={t('mining:fields.cases')} fill="#6366F1" />
                    </BarChart>
                  </ResponsiveContainer>
                  <Typography.Text type="secondary">
                    P10 {fmtD(s.p10)} · P25 {fmtD(s.p25)} · P75 {fmtD(s.p75)} · P95 {fmtD(s.p95)} ·{' '}
                    {t('mining:stats.max')} {fmtD(s.throughput?.max)}
                  </Typography.Text>
                </Card>
              </Col>
            </Row>
            <Row gutter={[12, 12]}>
              <Col xs={24} xl={10}>
                <Card size="small" title={t('mining:stats.reworkTitle')}>
                  <Table
                    size="small"
                    rowKey="activity"
                    pagination={false}
                    dataSource={s.rework.byActivity}
                    columns={[
                      { title: t('mining:activities.activity'), dataIndex: 'activity' },
                      {
                        title: t('mining:fields.cases'),
                        align: 'end',
                        render: (_, r) => fmtN(r.cases),
                      },
                      {
                        title: t('mining:stats.repeats'),
                        align: 'end',
                        render: (_, r) => fmtN(r.repeats),
                      },
                    ]}
                  />
                </Card>
              </Col>
              <Col xs={24} xl={14}>
                <Card
                  size="small"
                  title={t('mining:stats.resources')}
                  extra={<ExportButton logId={log.id} kind="resources" />}
                >
                  <Table
                    size="small"
                    rowKey="resource"
                    pagination={{ pageSize: 8, hideOnSinglePage: true }}
                    dataSource={s.resources}
                    columns={[
                      { title: t('mining:fields.resources'), dataIndex: 'resource' },
                      {
                        title: t('mining:fields.events'),
                        align: 'end',
                        render: (_, r) => fmtN(r.events),
                      },
                      {
                        title: t('mining:fields.cases'),
                        align: 'end',
                        render: (_, r) => fmtN(r.cases),
                      },
                      {
                        title: t('mining:fields.activities'),
                        render: (_, r) =>
                          r.activities
                            .slice(0, 3)
                            .map((x) => `${x.activity} (${fmtN(x.events)})`)
                            .join(', '),
                      },
                    ]}
                  />
                </Card>
              </Col>
            </Row>
            <Card
              size="small"
              title={t('mining:stats.handovers')}
              extra={<ExportButton logId={log.id} kind="handovers" />}
            >
              {s.handovers.length === 0 ? (
                <Typography.Text type="secondary">{t('mining:stats.noHandovers')}</Typography.Text>
              ) : (
                <Row gutter={[12, 12]}>
                  <Col xs={24} xl={14}>
                    <ProcessMap
                      generic
                      mode="frequency"
                      height={380}
                      nodes={handoverNodes}
                      edges={s.handovers
                        .slice(0, 30)
                        .map((h) => ({ ...h, cases: h.count, duration: null }))}
                    />
                  </Col>
                  <Col xs={24} xl={10}>
                    <Table
                      size="small"
                      rowKey={(r) => `${r.from}>${r.to}`}
                      pagination={{ pageSize: 8, hideOnSinglePage: true }}
                      dataSource={
                        s.departmentHandovers.length ? s.departmentHandovers : s.handovers
                      }
                      title={() =>
                        s.departmentHandovers.length
                          ? t('mining:stats.departmentHandovers')
                          : t('mining:stats.resourceHandovers')
                      }
                      columns={[
                        { title: t('mining:filters.from'), dataIndex: 'from' },
                        { title: t('mining:filters.to'), dataIndex: 'to' },
                        {
                          title: t('mining:stats.count'),
                          align: 'end',
                          render: (_, r) => fmtN(r.count),
                        },
                      ]}
                    />
                  </Col>
                </Row>
              )}
            </Card>
          </Flex>
        );
      }}
    </WithAnalysis>
  );
}

// ---------- Bottlenecks ----------

function SlowCases({ cases, onOpen }: { cases: CaseDuration[]; onOpen: (c: string) => void }) {
  const fmtD = useFormatDuration();
  return (
    <Space wrap size={4}>
      {cases.map((c) => (
        <Typography.Link key={c.caseId} onClick={() => onOpen(c.caseId)}>
          {c.caseId} ({fmtD(c.ms)})
        </Typography.Link>
      ))}
    </Space>
  );
}

export function BottlenecksTab({ log }: { log: EventLogDto }) {
  const { t } = useTranslation();
  const fmtN = useFormatNumber();
  const fmtD = useFormatDuration();
  const [caseId, setCaseId] = useState<string | null>(null);
  return (
    <WithAnalysis log={log} extra={<ExportButton logId={log.id} kind="bottlenecks" />}>
      {(a) => (
        <Flex vertical gap={12} data-testid="mining-bottlenecks">
          {!a.hasStartTimes && (
            <Alert type="info" showIcon message={t('mining:bottlenecks.noStart')} />
          )}
          <Card size="small" title={t('mining:bottlenecks.edges')}>
            <Table
              size="small"
              rowKey={(e) => `${e.from}>${e.to}`}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              dataSource={a.bottlenecks.edges}
              columns={[
                {
                  title: t('mining:bottlenecks.transition'),
                  render: (_, e) => `${e.from} → ${e.to}`,
                },
                {
                  title: t('mining:stats.count'),
                  align: 'end',
                  width: 90,
                  render: (_, e) => fmtN(e.count),
                },
                {
                  title: t('mining:variants.mean'),
                  width: 110,
                  render: (_, e) => fmtD(e.duration?.mean),
                },
                {
                  title: t('mining:variants.median'),
                  width: 110,
                  render: (_, e) => fmtD(e.duration?.median),
                },
                {
                  title: t('mining:stats.max'),
                  width: 110,
                  render: (_, e) => fmtD(e.duration?.max),
                },
                {
                  title: t('mining:bottlenecks.slowCases'),
                  render: (_, e) => <SlowCases cases={e.slowCases} onOpen={setCaseId} />,
                },
              ]}
            />
          </Card>
          <Card size="small" title={t('mining:bottlenecks.activities')}>
            <Table
              size="small"
              rowKey="activity"
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              dataSource={a.bottlenecks.activities}
              columns={[
                { title: t('mining:activities.activity'), dataIndex: 'activity' },
                {
                  title: t('mining:fields.events'),
                  align: 'end',
                  width: 90,
                  render: (_, n) => fmtN(n.events),
                },
                {
                  title: t('mining:bottlenecks.waiting'),
                  width: 130,
                  render: (_, n) => fmtD(n.waiting?.mean),
                },
                {
                  title: t('mining:bottlenecks.processing'),
                  width: 130,
                  render: (_, n) => fmtD(n.processing?.mean),
                },
                {
                  title: t('mining:bottlenecks.waitShare'),
                  width: 150,
                  render: (_, n) => {
                    const w = n.waiting?.mean ?? 0;
                    const p = n.processing?.mean ?? 0;
                    return (
                      <Progress
                        size="small"
                        percent={w + p ? Math.round((w / (w + p)) * 100) : 0}
                        strokeColor="#F97316"
                      />
                    );
                  },
                },
                {
                  title: t('mining:bottlenecks.slowCases'),
                  render: (_, n) => <SlowCases cases={n.slowCases} onOpen={setCaseId} />,
                },
              ]}
            />
          </Card>
          <CaseDrawer logId={log.id} caseId={caseId} onClose={() => setCaseId(null)} />
        </Flex>
      )}
    </WithAnalysis>
  );
}

// ---------- Case drill-down ----------

export function CaseDrawer({
  logId,
  caseId,
  onClose,
}: {
  logId: string;
  caseId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fmtDate = useFormatDate();
  const fmtD = useFormatDuration();
  const events = useCaseEvents(logId, caseId);
  return (
    <Drawer
      open={!!caseId}
      onClose={onClose}
      width={720}
      title={t('mining:case.title', { id: caseId ?? '' })}
    >
      {events.isLoading ? (
        <LoadingState />
      ) : (
        <Table
          size="small"
          rowKey={(_, i) => String(i)}
          pagination={false}
          dataSource={events.data ?? []}
          columns={[
            { title: t('mining:activities.activity'), dataIndex: 'activity' },
            { title: t('mining:mapping.startColumn'), render: (_, e) => fmtDate(e.startAt) },
            { title: t('mining:case.end'), render: (_, e) => fmtDate(e.endAt) },
            {
              title: t('mining:bottlenecks.processing'),
              render: (_, e) =>
                e.startAt ? fmtD(Date.parse(e.endAt) - Date.parse(e.startAt)) : '—',
            },
            { title: t('mining:mapping.resourceColumn'), render: (_, e) => e.resource ?? '—' },
            { title: t('mining:mapping.departmentColumn'), render: (_, e) => e.department ?? '—' },
          ]}
        />
      )}
    </Drawer>
  );
}

// ---------- Generate BPMN from log ----------

function DiscoverModal({ log, onClose }: { log: EventLogDto; onClose: () => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const discover = useDiscover(log.id);
  const { filters } = useAnalysisState();
  const processes = useProcessTreeOptions('');
  const [form] = Form.useForm();
  const [result, setResult] = useState<{ processId: string; code: string } | null>(null);
  const initial = useMemo(
    () => ({
      nameEn: log.nameEn,
      nameAr: log.nameAr,
      category: 'CORE',
      dependency: 90,
      lanes: true,
    }),
    [log],
  );
  return (
    <Modal
      open
      title={t('mining:discover.title')}
      onCancel={onClose}
      okText={result ? t('mining:discover.open') : t('mining:discover.generate')}
      confirmLoading={discover.isPending}
      onOk={() => {
        if (result) return navigate(`/processes/${result.processId}/model`);
        void form.validateFields().then((v: Record<string, unknown>) =>
          discover
            .mutateAsync({
              code: v.code as string,
              category: v.category as never,
              parentId: (v.parentId as string) ?? null,
              nameEn: (v.nameEn as string) ?? '',
              nameAr: (v.nameAr as string) ?? '',
              lanes: !!v.lanes,
              options: { filters, dependency: (v.dependency as number) / 100 },
            })
            .then((r) => setResult(r))
            .catch((e: unknown) => void message.error(errorMessage(e))),
        );
      }}
      destroyOnHidden
    >
      {result ? (
        <Alert
          type="success"
          showIcon
          data-testid="discover-result"
          message={
            <span>
              {t('mining:discover.done', { code: result.code })}{' '}
              <Link to={`/processes/${result.processId}/model`}>{t('mining:discover.open')}</Link>
            </span>
          }
          description={t('mining:discover.review')}
        />
      ) : (
        <>
          <Typography.Paragraph type="secondary">{t('mining:discover.help')}</Typography.Paragraph>
          <Form form={form} layout="vertical" initialValues={initial}>
            <Form.Item
              name="code"
              label={t('fields.code')}
              rules={[
                { required: true, message: t('validation.required') },
                { pattern: /^[A-Za-z0-9]+([.-][A-Za-z0-9]+)*$/, message: t('validation.code') },
              ]}
            >
              <Input dir="ltr" maxLength={30} placeholder="C.02.03" />
            </Form.Item>
            <Form.Item name="nameEn" label={t('fields.nameEn')}>
              <Input maxLength={200} />
            </Form.Item>
            <Form.Item name="nameAr" label={t('fields.nameAr')}>
              <Input dir="rtl" maxLength={200} />
            </Form.Item>
            <Form.Item name="category" label={t('fields.category')}>
              <Select
                options={PROCESS_CATEGORIES.map((c) => ({
                  value: c,
                  label: t(`processes:category.${c}`),
                }))}
              />
            </Form.Item>
            <Form.Item name="parentId" label={t('diagrams:epc.parent')}>
              <TreeSelect
                allowClear
                showSearch
                treeNodeFilterProp="title"
                treeData={processes.options}
                placeholder={t('none')}
              />
            </Form.Item>
            <Form.Item
              name="dependency"
              label={t('mining:discover.dependency')}
              extra={t('mining:discover.dependencyHint')}
            >
              <Slider min={10} max={100} tooltip={{ formatter: (v) => `${(v ?? 0) / 100}` }} />
            </Form.Item>
            <Form.Item name="lanes" label={t('mining:discover.lanes')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Form>
        </>
      )}
    </Modal>
  );
}
