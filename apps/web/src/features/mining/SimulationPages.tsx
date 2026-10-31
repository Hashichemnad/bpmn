import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  BulbOutlined,
  CalendarOutlined,
  CaretRightOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AiScenarioProposal,
  ScenarioDto,
  SimIssue,
  SimulationDto,
  SimulationListItemDto,
  SimulationResult,
} from '@processhub/shared';
import {
  exportSimulation,
  useCreateSimulation,
  useDeleteScenario,
  useDeleteSimulation,
  useRunSimulation,
  useSaveScenario,
  useSimulation,
  useSimulationAi,
  useSimulations,
} from '@/api/simulation';
import { useProcessLogs } from '@/api/mining';
import { useProcessTree } from '@/api/hooks';
import { useLocale } from '@/app/LocaleProvider';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import {
  useErrorMessage,
  useFormatDate,
  useFormatNumber,
  useLocalized,
} from '@/components/i18n-helpers';
import { pickLabel } from '@/features/modeler/labels';
import { useAi } from '@/features/ai/useAi';
import { JobProgress } from './mining-helpers';
import { useMiningAccess, usePercent } from './mining-utils';
import { ScenarioDrawer } from './ScenarioDrawer';
import { HolidaysModal } from './HolidaysModal';
import { useAuth } from '@/auth/AuthProvider';
import { PERMISSIONS } from '@processhub/shared';

const COLOURS = ['#2563EB', '#16A34A', '#D97706', '#7C3AED', '#DC2626', '#0891B2'];

/** Simulations of all processes (or one, `?processId=`). */
export function SimulationsPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const fmtDate = useFormatDate();
  const access = useMiningAccess();
  const list = useSimulations();
  const [creating, setCreating] = useState(false);
  const [holidays, setHolidays] = useState(false);
  const { can } = useAuth();
  const canHolidays = can(PERMISSIONS.SETTINGS_MANAGE) || can(PERMISSIONS.DEPARTMENTS_MANAGE);
  return (
    <>
      <PageHeader
        title={t('mining:sim.title')}
        subtitle={t('mining:sim.subtitle')}
        extra={
          <>
            <Button
              icon={<CalendarOutlined />}
              onClick={() => setHolidays(true)}
              data-testid="sim-holidays"
            >
              {t('mining:holidays.button')}
            </Button>
            {access.canManage && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setCreating(true)}
                data-testid="new-simulation"
              >
                {t('mining:sim.new')}
              </Button>
            )}
          </>
        }
      />
      {holidays && <HolidaysModal readOnly={!canHolidays} onClose={() => setHolidays(false)} />}
      <Card>
        {list.isError ? (
          <ErrorState error={list.error} />
        ) : (
          <Table<SimulationListItemDto>
            rowKey="id"
            loading={list.isLoading}
            dataSource={list.data ?? []}
            locale={{ emptyText: <EmptyState description={t('mining:sim.empty')} /> }}
            columns={[
              { title: t('mining:fields.code'), dataIndex: 'code', width: 100 },
              {
                title: t('mining:fields.name'),
                render: (_, s) => <Link to={`/mining/simulations/${s.id}`}>{loc(s)}</Link>,
              },
              {
                title: t('mining:fields.process'),
                render: (_, s) => `${s.process.code} ${loc(s.process)}`,
              },
              {
                title: t('mining:sim.scenarios'),
                dataIndex: 'scenarios',
                width: 110,
                align: 'end',
              },
              {
                title: t('mining:sim.lastRun'),
                width: 200,
                render: (_, s) => fmtDate(s.lastRunAt),
              },
            ]}
          />
        )}
      </Card>
      {creating && <CreateSimulationModal onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateSimulationModal({
  onClose,
  processId,
}: {
  onClose: () => void;
  processId?: string;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const create = useCreateSimulation();
  const processes = useProcessTree();
  const [form] = Form.useForm();
  const chosen = Form.useWatch('processId', form) as string | undefined;
  const logs = useProcessLogs(chosen);
  const options = useMemo(
    () =>
      (processes.data ?? [])
        .slice()
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((p) => ({ value: p.id, label: `${p.code} ${loc(p)}` })),
    [processes.data, loc],
  );
  return (
    <Modal
      open
      title={t('mining:sim.new')}
      confirmLoading={create.isPending}
      onCancel={onClose}
      onOk={() =>
        void form.validateFields().then((v) =>
          create
            .mutateAsync({ ...v, logId: v.logId ?? null })
            .then((s) => navigate(`/mining/simulations/${s.id}`))
            .catch((e: unknown) => void message.error(errorMessage(e))),
        )
      }
    >
      <Typography.Paragraph type="secondary">{t('mining:sim.newHelp')}</Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ processId }}>
        <Form.Item
          name="processId"
          label={t('mining:fields.process')}
          rules={[{ required: true, message: t('validation.required') }]}
        >
          <Select showSearch optionFilterProp="label" options={options} data-testid="sim-process" />
        </Form.Item>
        <Form.Item
          name="nameEn"
          label={t('mining:fields.nameEn')}
          rules={[{ required: true, message: t('validation.required') }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="nameAr" label={t('mining:fields.nameAr')}>
          <Input dir="rtl" />
        </Form.Item>
        {(logs.data?.length ?? 0) > 0 && (
          <Form.Item
            name="logId"
            label={t('mining:sim.defaultsFrom')}
            extra={t('mining:sim.defaultsHelp')}
          >
            <Select
              allowClear
              options={logs.data!.map((l) => ({ value: l.id, label: `${l.code} ${loc(l)}` }))}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

function IssueList({ sim, issues }: { sim: SimulationDto; issues: SimIssue[] }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const name = (id: string | null) => {
    if (!id) return '';
    const x =
      sim.model.steps.find((s) => s.id === id) ??
      sim.model.lanes.find((l) => l.id === id) ??
      sim.model.gateways.find((g) => g.id === id);
    return x ? pickLabel(x, locale) || id : id;
  };
  if (!issues.length) return null;
  return (
    <ul style={{ margin: 0, paddingInlineStart: 18 }} data-testid="sim-issues">
      {issues.map((i, k) => (
        <li key={k}>
          <Typography.Text type={i.severity === 'error' ? 'danger' : 'warning'}>
            {t(`mining:sim.issues.${i.code}`, { name: name(i.elementId), value: i.value })}
          </Typography.Text>
        </li>
      ))}
    </ul>
  );
}

/** Simulation page: scenarios with parameters and validation, run, comparison, AI. */
export function SimulationPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { locale } = useLocale();
  const loc = useLocalized();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const fmtDate = useFormatDate();
  const sim = useSimulation(id);
  const run = useRunSimulation(id);
  const saveScenario = useSaveScenario(id);
  const deleteScenario = useDeleteScenario(id);
  const deleteSim = useDeleteSimulation();
  const ai = useSimulationAi(id);
  const { available: aiAvailable } = useAi();
  const [editing, setEditing] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [proposals, setProposals] = useState<AiScenarioProposal[] | null>(null);

  if (sim.isLoading) return <LoadingState />;
  if (sim.isError || !sim.data) return <ErrorState error={sim.error} />;
  const s = sim.data;
  const name = (x: { nameEn: string; nameAr: string }) => pickLabel(x, locale);
  const ran = s.scenarios.filter((x) => x.result);
  const editingScenario = s.scenarios.find((x) => x.id === editing);
  const fail = (e: unknown) => void message.error(errorMessage(e));

  return (
    <>
      <PageHeader
        title={`${s.code} · ${loc(s)}`}
        subtitle={
          <Link to={`/processes/${s.process.id}`}>
            {s.process.code} {loc(s.process)}
          </Link>
        }
        crumbs={[{ title: t('mining:sim.title'), to: '/mining/simulations' }, { title: s.code }]}
        extra={
          <>
            {ran.length > 0 && (
              <Button
                icon={<DownloadOutlined />}
                onClick={() => void exportSimulation(id).catch(fail)}
              >
                {t('mining:analysis.excel')}
              </Button>
            )}
            {ran.length > 0 && (
              <Link
                to={`/processes/${s.process.id}/model?view=1&colourBy=simUtilisation&sim=${(ran.find((x) => x.kind === 'AS_IS') ?? ran[0]).id}`}
              >
                <Button icon={<EyeOutlined />} data-testid="sim-on-model">
                  {t('mining:sim.onModel')}
                </Button>
              </Link>
            )}
            {s.canManage && (
              <>
                <Button
                  type="primary"
                  icon={<CaretRightOutlined />}
                  loading={run.isPending}
                  disabled={!!s.job}
                  onClick={() => run.mutateAsync(undefined).catch(fail)}
                  data-testid="sim-run"
                >
                  {t('mining:sim.runAll')}
                </Button>
                <Popconfirm
                  title={t('mining:sim.deleteConfirm')}
                  okButtonProps={{ danger: true }}
                  onConfirm={() =>
                    deleteSim
                      .mutateAsync(id)
                      .then(() => navigate('/mining/simulations'))
                      .catch(fail)
                  }
                >
                  <Button danger icon={<DeleteOutlined />} aria-label={t('mining:log.delete')} />
                </Popconfirm>
              </>
            )}
          </>
        }
      />
      {s.job && (
        <Card size="small" style={{ marginBlockEnd: 12 }}>
          <JobProgress job={s.job} />
        </Card>
      )}
      <Row gutter={[12, 12]} style={{ marginBlockEnd: 12 }}>
        {s.scenarios.map((sc, i) => (
          <Col xs={24} md={12} xl={8} key={sc.id}>
            <Card
              size="small"
              data-testid="sim-scenario"
              title={
                <Space>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      background: COLOURS[i % COLOURS.length],
                    }}
                  />
                  {name(sc)}
                  <Tag color={sc.kind === 'AS_IS' ? 'blue' : 'purple'}>
                    {t(`mining:sim.kinds.${sc.kind}`)}
                  </Tag>
                </Space>
              }
              extra={
                s.canManage && (
                  <Space size={4}>
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => setEditing(sc.id)}
                      aria-label={t('mining:log.edit')}
                      data-testid="sim-edit"
                    />
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      aria-label={t('mining:sim.copy')}
                      title={t('mining:sim.copy')}
                      data-testid="sim-copy"
                      onClick={() =>
                        saveScenario
                          .mutateAsync({
                            body: {
                              copyFrom: sc.id,
                              kind: 'TO_BE',
                              nameEn: `${sc.nameEn} (2)`,
                              nameAr: sc.nameAr ? `${sc.nameAr} (2)` : '',
                            },
                          })
                          .catch(fail)
                      }
                    />
                    {s.scenarios.length > 1 && (
                      <Popconfirm
                        title={t('mining:sim.deleteScenario')}
                        onConfirm={() => deleteScenario.mutateAsync(sc.id).catch(fail)}
                      >
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={t('mining:log.delete')}
                        />
                      </Popconfirm>
                    )}
                  </Space>
                )
              }
            >
              <Typography.Text type="secondary">
                {sc.processVersion ? `v${sc.processVersion}` : t('mining:sim.workingModel')} ·{' '}
                {t('mining:sim.daysShort', { days: sc.params.days })} ·{' '}
                {t(
                  `mining:sim.weeks.${sc.params.calendar.alwaysOpen ? 'ALL' : sc.params.calendar.week}`,
                )}
              </Typography.Text>
              <div style={{ marginBlockStart: 6 }}>
                {Object.entries(sc.params.resources).map(([lane, r]) => {
                  const l = s.model.lanes.find((x) => x.id === lane);
                  return (
                    <Tag key={lane}>
                      {l ? name(l) : lane}: {r.capacity}
                    </Tag>
                  );
                })}
              </div>
              <IssueList sim={s} issues={sc.issues} />
              <Typography.Text type="secondary" style={{ display: 'block', marginBlockStart: 6 }}>
                {sc.ranAt
                  ? `${t('mining:sim.ranAt', { date: fmtDate(sc.ranAt) })}${sc.stale ? ` · ${t('mining:sim.stale')}` : ''}`
                  : t('mining:sim.notRun')}
              </Typography.Text>
            </Card>
          </Col>
        ))}
        {s.canManage && (
          <Col xs={24} md={12} xl={8}>
            <Button
              block
              type="dashed"
              icon={<PlusOutlined />}
              style={{ height: '100%', minHeight: 120 }}
              data-testid="sim-add-scenario"
              onClick={() =>
                saveScenario
                  .mutateAsync({
                    body: { kind: 'TO_BE', nameEn: 'To-be', nameAr: 'الوضع المستقبلي' },
                  })
                  .catch(fail)
              }
            >
              {t('mining:sim.addScenario')}
            </Button>
          </Col>
        )}
      </Row>
      {ran.length === 0 ? (
        <Card>
          <Empty description={t('mining:sim.noResults')} />
        </Card>
      ) : (
        <Comparison sim={s} />
      )}
      {ran.length > 0 && aiAvailable && (
        <Card size="small" title={t('mining:sim.ai')} style={{ marginBlockStart: 12 }}>
          <Space wrap>
            <Button
              icon={<RobotOutlined />}
              loading={ai.explain.isPending}
              onClick={() =>
                ai.explain
                  .mutateAsync()
                  .then((r) => setExplanation(r.text))
                  .catch(fail)
              }
              data-testid="sim-ai-explain"
            >
              {t('mining:sim.explain')}
            </Button>
            {s.canManage && (
              <Button
                icon={<BulbOutlined />}
                loading={ai.suggest.isPending}
                onClick={() =>
                  ai.suggest
                    .mutateAsync()
                    .then((r) => setProposals(r.proposals))
                    .catch(fail)
                }
              >
                {t('mining:sim.suggest')}
              </Button>
            )}
          </Space>
          {explanation && (
            <Alert
              style={{ marginBlockStart: 12 }}
              type="info"
              message={t('mining:sim.aiNotice')}
              description={
                <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                  {explanation}
                </Typography.Paragraph>
              }
            />
          )}
          {proposals && (
            <List
              style={{ marginBlockStart: 12 }}
              header={
                <Typography.Text type="secondary">
                  {t('mining:sim.proposalsNotice')}
                </Typography.Text>
              }
              dataSource={proposals}
              renderItem={(p) => (
                <List.Item
                  actions={[
                    <Button
                      key="add"
                      size="small"
                      onClick={() => {
                        const base = s.scenarios.find((x) => x.kind === 'AS_IS') ?? s.scenarios[0];
                        const params = structuredClone(base.params);
                        for (const [lane, c] of Object.entries(p.capacities))
                          params.resources[lane] = {
                            costPerHour: params.resources[lane]?.costPerHour ?? 0,
                            capacity: c,
                          };
                        for (const [step, m] of Object.entries(p.durations))
                          params.steps[step] = {
                            ...params.steps[step],
                            duration: { type: 'fixed', mean: m },
                          };
                        saveScenario
                          .mutateAsync({
                            body: {
                              copyFrom: base.id,
                              kind: 'TO_BE',
                              nameEn: p.nameEn,
                              nameAr: p.nameAr,
                              params,
                            },
                          })
                          .then(() => void message.success(t('mining:sim.proposalAdded')))
                          .catch(fail);
                      }}
                    >
                      {t('mining:sim.createScenario')}
                    </Button>,
                  ]}
                >
                  <List.Item.Meta title={pickLabel(p, locale)} description={p.rationale} />
                </List.Item>
              )}
            />
          )}
        </Card>
      )}
      {editingScenario && (
        <ScenarioDrawer sim={s} scenario={editingScenario} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

/** Side-by-side comparison of the scenarios with results: table + charts. */
function Comparison({ sim }: { sim: SimulationDto }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const fmtN = useFormatNumber();
  const pct = usePercent();
  const ran = sim.scenarios.filter((x) => x.result) as (ScenarioDto & {
    result: SimulationResult;
  })[];
  const name = (x: { nameEn: string; nameAr: string }) => pickLabel(x, locale);
  const h = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : t('mining:units.h', { n: fmtN(Math.round(v * 10) / 10) });
  const money = (v: number) => fmtN(Math.round(v));
  const rows: { key: string; label: string; values: string[] }[] = [
    {
      key: 'completed',
      label: t('mining:sim.m.completed'),
      values: ran.map((s) => fmtN(s.result.cases.completed)),
    },
    {
      key: 'inProgress',
      label: t('mining:sim.m.inProgress'),
      values: ran.map((s) => fmtN(s.result.cases.inProgress)),
    },
    {
      key: 'mean',
      label: t('mining:sim.m.mean'),
      values: ran.map((s) => h(s.result.throughput?.mean)),
    },
    {
      key: 'p90',
      label: t('mining:sim.m.p90'),
      values: ran.map((s) => h(s.result.throughput?.p90)),
    },
    {
      key: 'costCase',
      label: t('mining:sim.m.costPerCase'),
      values: ran.map((s) => money(s.result.costPerCase)),
    },
    {
      key: 'cost',
      label: t('mining:sim.m.totalCost'),
      values: ran.map((s) => money(s.result.totalCost)),
    },
    { key: 'sla', label: t('mining:sim.m.sla'), values: ran.map((s) => pct(s.result.slaShare)) },
    {
      key: 'stepSla',
      label: t('mining:sim.m.stepSla'),
      values: ran.map((s) => pct(s.result.stepSlaShare)),
    },
    ...sim.model.lanes.map((l) => ({
      key: `u-${l.id}`,
      label: t('mining:sim.m.utilisation', { lane: name(l) }),
      values: ran.map((s) => pct(s.result.resources.find((r) => r.laneId === l.id)?.utilisation)),
    })),
    ...sim.model.lanes.map((l) => ({
      key: `q-${l.id}`,
      label: t('mining:sim.m.queue', { lane: name(l) }),
      values: ran.map((s) => {
        const r = s.result.resources.find((x) => x.laneId === l.id);
        return r ? `${fmtN(Math.round(r.meanQueue * 10) / 10)} / ${fmtN(r.maxQueue)}` : '—';
      }),
    })),
  ];
  const chart = (key: 'mean' | 'p90' | 'cost') =>
    ran.map((s) => ({
      name: name(s),
      value:
        key === 'cost'
          ? Math.round(s.result.costPerCase)
          : Math.round((s.result.throughput?.[key] ?? 0) * 10) / 10,
    }));
  const util = sim.model.lanes.map((l) => ({
    lane: name(l),
    ...Object.fromEntries(
      ran.map((s) => [
        name(s),
        Math.round((s.result.resources.find((r) => r.laneId === l.id)?.utilisation ?? 0) * 100),
      ]),
    ),
  }));
  return (
    <Flex vertical gap={12}>
      <Card size="small" title={t('mining:sim.comparison')}>
        <Table
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={rows}
          data-testid="sim-comparison"
          scroll={{ x: true }}
          columns={[
            { title: t('mining:sim.measure'), dataIndex: 'label', fixed: 'left', width: 260 },
            ...ran.map((s, i) => ({
              title: (
                <Space>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      background: COLOURS[i % COLOURS.length],
                    }}
                  />
                  {name(s)}
                  {s.stale && <Tag color="orange">{t('mining:sim.stale')}</Tag>}
                </Space>
              ),
              key: s.id,
              align: 'end' as const,
              render: (_: unknown, r: (typeof rows)[number]) => r.values[i],
            })),
          ]}
        />
      </Card>
      <Row gutter={[12, 12]}>
        {(['mean', 'p90', 'cost'] as const).map((k) => (
          <Col xs={24} md={8} key={k}>
            <Card size="small" title={t(`mining:sim.chart.${k}`)}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chart(k)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" reversed={locale === 'ar'} fontSize={11} />
                  <YAxis orientation={locale === 'ar' ? 'right' : 'left'} fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#6366F1" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </Col>
        ))}
        <Col span={24}>
          <Card size="small" title={t('mining:sim.chart.utilisation')}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={util}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="lane" reversed={locale === 'ar'} fontSize={11} />
                <YAxis
                  orientation={locale === 'ar' ? 'right' : 'left'}
                  fontSize={11}
                  unit="%"
                  domain={[0, 100]}
                />
                <Tooltip />
                <Legend />
                {ran.map((s, i) => (
                  <Bar key={s.id} dataKey={name(s)} fill={COLOURS[i % COLOURS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>
    </Flex>
  );
}
