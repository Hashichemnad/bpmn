import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Flex,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { DownloadOutlined, RedoOutlined, StopOutlined, SwapOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS, type WfTaskSummaryDto } from '@processhub/shared';
import { apiDownload } from '@/api/client';
import {
  useCaseAction,
  useTaskAction,
  useWorkflowDashboard,
  useWorkflowMonitor,
} from '@/api/workflow';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/app/LocaleProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatNumber, useLocalized } from '@/components/i18n-helpers';
import { downloadBlob } from '@/features/modeler/export';
import { CaseTable } from './MyRequestsPage';
import { UserPicker } from './WorkflowForm';
import { DueTag } from './wf-helpers';
import { casePath, taskPath } from './wf-paths';

function RetryCancel({ id }: { id: string }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const act = useCaseAction(id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Space>
      <Button
        size="small"
        icon={<RedoOutlined />}
        loading={act.isPending}
        onClick={() =>
          act.mutate(
            { action: 'retry' },
            {
              onSuccess: () => message.success(t('workflow:case.retryDone')),
              onError: (e) => message.error(errorMessage(e)),
            },
          )
        }
      >
        {t('workflow:case.retry')}
      </Button>
      <Button size="small" danger icon={<StopOutlined />} onClick={() => setCancelOpen(true)}>
        {t('workflow:case.cancel')}
      </Button>
      <Modal
        open={cancelOpen}
        title={t('workflow:case.cancel')}
        onCancel={() => setCancelOpen(false)}
        okButtonProps={{ danger: true, disabled: !reason.trim() }}
        onOk={() =>
          act.mutate(
            { action: 'cancel', reason: reason.trim() },
            {
              onSuccess: () => {
                setCancelOpen(false);
                message.success(t('workflow:case.cancelDone'));
              },
              onError: (e) => message.error(errorMessage(e)),
            },
          )
        }
      >
        <Input.TextArea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('workflow:case.reason')}
        />
      </Modal>
    </Space>
  );
}

function ReassignButton({ task }: { task: WfTaskSummaryDto }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const act = useTaskAction(task.id);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  return (
    <>
      <Button size="small" icon={<SwapOutlined />} onClick={() => setOpen(true)}>
        {t('workflow:task.reassign')}
      </Button>
      <Modal
        open={open}
        title={t('workflow:task.reassign')}
        onCancel={() => setOpen(false)}
        okButtonProps={{ disabled: !userId, loading: act.isPending }}
        onOk={() =>
          act.mutate(
            { action: 'reassign', userId: userId!, comment: '' },
            {
              onSuccess: () => {
                setOpen(false);
                message.success(t('workflow:task.reassignDone'));
              },
              onError: (e) => message.error(errorMessage(e)),
            },
          )
        }
      >
        <UserPicker value={userId ?? undefined} onChange={setUserId} />
      </Modal>
    </>
  );
}

/** Workflow monitor (workflow.monitor / workflow.admin, step 4): cases per process, overdue, stuck. */
export function WorkflowMonitorPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { can } = useAuth();
  const admin = can(PERMISSIONS.WORKFLOW_ADMIN);
  const monitor = useWorkflowMonitor();
  const [processId, setProcessId] = useState<string | undefined>();
  if (monitor.isLoading) return <LoadingState />;
  if (monitor.isError || !monitor.data) return <ErrorState error={monitor.error} />;
  const m = monitor.data;
  return (
    <>
      <PageHeader
        title={t('workflow:monitor.title')}
        subtitle={t('workflow:monitor.subtitle')}
        extra={
          <Link to="/workflow/dashboard">
            <Button>{t('workflow:dashboard.title')}</Button>
          </Link>
        }
      />
      <Card>
        <Table
          rowKey="processId"
          size="small"
          pagination={false}
          dataSource={m.processes}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('workflow:monitor.noProcesses')}
              />
            ),
          }}
          data-testid="wf-monitor-processes"
          columns={[
            {
              title: t('workflow:tasks.process'),
              key: 'p',
              render: (_, p) => (
                <Space>
                  <Tag dir="ltr">{p.code}</Tag>
                  {loc(p)}
                </Space>
              ),
            },
            { title: t('workflow:caseStatus.RUNNING'), dataIndex: 'running' },
            { title: t('workflow:caseStatus.COMPLETED'), dataIndex: 'completed' },
            { title: t('workflow:monitor.cancelled'), dataIndex: 'cancelled' },
            {
              title: t('workflow:requests.stuck'),
              key: 's',
              render: (_, p) => (p.stuck ? <Tag color="red">{p.stuck}</Tag> : 0),
            },
            {
              title: t('workflow:monitor.overdueTasks'),
              key: 'o',
              render: (_, p) => (p.overdueTasks ? <Tag color="orange">{p.overdueTasks}</Tag> : 0),
            },
            {
              key: 'f',
              render: (_, p) => (
                <Button size="small" type="link" onClick={() => setProcessId(p.processId)}>
                  {t('workflow:monitor.showCases')}
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Card style={{ marginBlockStart: 16 }}>
        <Tabs
          items={[
            {
              key: 'stuck',
              label: (
                <span>
                  {t('workflow:monitor.stuck')}{' '}
                  <Tag color={m.stuckCases.length ? 'red' : 'default'}>{m.stuckCases.length}</Tag>
                </span>
              ),
              children: (
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={m.stuckCases}
                  locale={{ emptyText: t('workflow:monitor.noStuck') }}
                  data-testid="wf-stuck"
                  columns={[
                    {
                      title: t('workflow:requests.number'),
                      key: 'n',
                      render: (_, c) => (
                        <Link to={casePath(c.id)} dir="ltr">
                          {c.number}
                        </Link>
                      ),
                    },
                    {
                      title: t('workflow:tasks.process'),
                      key: 'p',
                      render: (_, c) => loc(c, 'processName'),
                    },
                    {
                      title: t('workflow:monitor.problem'),
                      key: 'i',
                      render: (_, c) =>
                        c.incidents.map((i) => (
                          <div key={i.tokenId}>
                            <strong>{loc(i)}</strong>:{' '}
                            {t(`errors:${i.code}`, { defaultValue: i.message || i.code })}
                          </div>
                        )),
                    },
                    ...(admin
                      ? [
                          {
                            key: 'a',
                            render: (_: unknown, c: { id: string }) => <RetryCancel id={c.id} />,
                          },
                        ]
                      : []),
                  ]}
                />
              ),
            },
            {
              key: 'overdue',
              label: (
                <span>
                  {t('workflow:monitor.overdueTasks')}{' '}
                  <Tag color={m.overdueTasks.length ? 'orange' : 'default'}>
                    {m.overdueTasks.length}
                  </Tag>
                </span>
              ),
              children: (
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={m.overdueTasks}
                  locale={{ emptyText: t('workflow:monitor.noOverdue') }}
                  columns={[
                    {
                      title: t('workflow:tasks.step'),
                      key: 's',
                      render: (_, r) => <Link to={taskPath(r.id)}>{loc(r)}</Link>,
                    },
                    {
                      title: t('workflow:tasks.request'),
                      key: 'c',
                      render: (_, r) => (
                        <Link to={casePath(r.caseId)} dir="ltr">
                          {r.caseNumber}
                        </Link>
                      ),
                    },
                    {
                      title: t('workflow:task.assignee'),
                      key: 'a',
                      render: (_, r) =>
                        r.assignee
                          ? loc(r.assignee) || r.assignee.email
                          : t('workflow:tasks.groupTag', { count: r.candidateCount }),
                    },
                    {
                      title: t('workflow:tasks.due'),
                      key: 'd',
                      render: (_, r) => <DueTag due={r.dueAt} />,
                    },
                    ...(admin
                      ? [
                          {
                            key: 'r',
                            render: (_: unknown, r: WfTaskSummaryDto) => (
                              <ReassignButton task={r} />
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              ),
            },
            {
              key: 'cases',
              label: t('workflow:monitor.cases'),
              children: (
                <>
                  <Select
                    allowClear
                    placeholder={t('workflow:monitor.allProcesses')}
                    value={processId}
                    onChange={setProcessId}
                    style={{ minWidth: 280, marginBlockEnd: 12 }}
                    options={m.processes.map((p) => ({
                      value: p.processId,
                      label: `${p.code} ${loc(p)}`,
                    }))}
                  />
                  <CaseTable key={processId ?? 'all'} scope="monitor" processId={processId} />
                </>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}

/** Workflow dashboard (step 4): started / completed, throughput, SLA per step, workload, overdue. */
export function WorkflowDashboardPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { locale } = useLocale();
  const fmt = useFormatNumber();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const monitor = useWorkflowMonitor();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [processId, setProcessId] = useState<string | undefined>();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [workload, setWorkload] = useState<'USER' | 'ROLE' | 'DEPARTMENT'>('USER');
  const q = {
    from: range?.[0].format('YYYY-MM-DD'),
    to: range?.[1].format('YYYY-MM-DD'),
    processId,
    period,
  };
  const dash = useWorkflowDashboard(q);
  const d = dash.data;
  const exportExcel = async () => {
    try {
      const file = await apiDownload(
        '/workflow/dashboard/export',
        { query: { ...q, locale } },
        'workflow.xlsx',
      );
      downloadBlob(file.blob, file.fileName);
    } catch (e) {
      message.error(errorMessage(e));
    }
  };
  const hours = (v: number | null) =>
    v === null ? '—' : t('workflow:dashboard.hours', { n: fmt(v) });
  return (
    <>
      <PageHeader
        title={t('workflow:dashboard.title')}
        subtitle={t('workflow:dashboard.subtitle')}
        extra={
          <Button icon={<DownloadOutlined />} onClick={() => void exportExcel()}>
            {t('workflow:dashboard.excel')}
          </Button>
        }
      />
      <Flex gap={8} wrap style={{ marginBlockEnd: 16 }}>
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)}
        />
        <Select
          allowClear
          placeholder={t('workflow:monitor.allProcesses')}
          value={processId}
          onChange={setProcessId}
          style={{ minWidth: 260 }}
          options={(monitor.data?.processes ?? []).map((p) => ({
            value: p.processId,
            label: `${p.code} ${loc(p)}`,
          }))}
        />
        <Segmented
          value={period}
          onChange={(v) => setPeriod(v as 'week' | 'month')}
          options={[
            { value: 'week', label: t('workflow:dashboard.week') },
            { value: 'month', label: t('workflow:dashboard.month') },
          ]}
        />
      </Flex>
      {dash.isError && <ErrorState error={dash.error} />}
      {d && (
        <>
          <Row gutter={[16, 16]} data-testid="wf-dashboard-tiles">
            {[
              ['started', fmt(d.started)],
              ['completed', fmt(d.completed)],
              ['running', fmt(d.running)],
              ['throughput', hours(d.throughput.mean)],
              ['p90', hours(d.throughput.p90)],
              ['sla', d.slaCompliance === null ? '—' : `${fmt(d.slaCompliance)} %`],
            ].map(([k, v]) => (
              <Col key={k} xs={12} md={8} xl={4}>
                <Card size="small">
                  <Statistic title={t(`workflow:dashboard.tiles.${k}`)} value={v} />
                </Card>
              </Col>
            ))}
          </Row>
          <Card title={t('workflow:dashboard.trend')} style={{ marginBlockStart: 16 }}>
            {d.series.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div style={{ inlineSize: '100%', blockSize: 280 }} dir="ltr">
                <ResponsiveContainer>
                  <BarChart data={d.series}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" reversed={locale === 'ar'} />
                    <YAxis
                      yAxisId="n"
                      allowDecimals={false}
                      orientation={locale === 'ar' ? 'right' : 'left'}
                    />
                    <YAxis yAxisId="h" orientation={locale === 'ar' ? 'left' : 'right'} />
                    <Tooltip />
                    <Legend />
                    <Bar
                      yAxisId="n"
                      dataKey="started"
                      name={t('workflow:dashboard.tiles.started')}
                      fill="#93c5fd"
                    />
                    <Bar
                      yAxisId="n"
                      dataKey="completed"
                      name={t('workflow:dashboard.tiles.completed')}
                      fill="#1d4ed8"
                    />
                    <Line
                      yAxisId="h"
                      dataKey="meanHours"
                      name={t('workflow:dashboard.meanHours')}
                      stroke="#b45309"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
          <Row gutter={[16, 16]} style={{ marginBlockStart: 16 }}>
            <Col xs={24} xl={14}>
              <Card title={t('workflow:dashboard.steps')}>
                <Table
                  rowKey={(s) => `${s.processId}:${s.elementId}`}
                  size="small"
                  pagination={{ pageSize: 10, hideOnSinglePage: true }}
                  dataSource={d.steps}
                  data-testid="wf-dashboard-steps"
                  columns={[
                    { title: t('workflow:tasks.step'), key: 's', render: (_, s) => loc(s) },
                    { title: t('workflow:dashboard.completedCol'), dataIndex: 'completed' },
                    {
                      title: t('workflow:dashboard.onTime'),
                      key: 'o',
                      render: (_, s) =>
                        s.completed ? `${Math.round((s.onTime / s.completed) * 100)} %` : '—',
                    },
                    {
                      title: t('workflow:dashboard.meanHours'),
                      key: 'm',
                      render: (_, s) => (s.meanHours === null ? '—' : fmt(s.meanHours)),
                    },
                    { title: t('workflow:dashboard.open'), dataIndex: 'open' },
                    {
                      title: t('workflow:tasks.overdue'),
                      key: 'v',
                      render: (_, s) => (s.overdue ? <Tag color="red">{s.overdue}</Tag> : 0),
                    },
                  ]}
                />
              </Card>
            </Col>
            <Col xs={24} xl={10}>
              <Card
                title={t('workflow:dashboard.workload')}
                extra={
                  <Segmented
                    size="small"
                    value={workload}
                    onChange={(v) => setWorkload(v as typeof workload)}
                    options={(['USER', 'ROLE', 'DEPARTMENT'] as const).map((k) => ({
                      value: k,
                      label: t(`workflow:dashboard.by.${k}`),
                    }))}
                  />
                }
              >
                <Table
                  rowKey={(w) => `${w.kind}:${w.id}`}
                  size="small"
                  pagination={{ pageSize: 10, hideOnSinglePage: true }}
                  dataSource={d.workload.filter((w) => w.kind === workload)}
                  columns={[
                    {
                      title: t('workflow:dashboard.who'),
                      key: 'n',
                      render: (_, w) => loc(w) || '—',
                    },
                    { title: t('workflow:dashboard.open'), dataIndex: 'open' },
                    { title: t('workflow:tasks.overdue'), dataIndex: 'overdue' },
                    { title: t('workflow:dashboard.completedCol'), dataIndex: 'completed' },
                  ]}
                />
              </Card>
            </Col>
          </Row>
          <Card title={t('workflow:dashboard.topOverdue')} style={{ marginBlockStart: 16 }}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={d.topOverdue}
              locale={{ emptyText: t('workflow:monitor.noOverdue') }}
              columns={[
                {
                  title: t('workflow:tasks.step'),
                  key: 's',
                  render: (_, r) => <Link to={taskPath(r.id)}>{loc(r)}</Link>,
                },
                {
                  title: t('workflow:tasks.request'),
                  key: 'c',
                  render: (_, r) => (
                    <Link to={casePath(r.caseId)} dir="ltr">
                      {r.caseNumber}
                    </Link>
                  ),
                },
                {
                  title: t('workflow:task.assignee'),
                  key: 'a',
                  render: (_, r) => (r.assignee ? loc(r.assignee) || r.assignee.email : '—'),
                },
                {
                  title: t('workflow:tasks.due'),
                  key: 'd',
                  render: (_, r) => <DueTag due={r.dueAt} />,
                },
              ]}
            />
          </Card>
          <Typography.Paragraph type="secondary" style={{ marginBlockStart: 12, fontSize: 12 }}>
            {t('workflow:dashboard.note')}
          </Typography.Paragraph>
        </>
      )}
      {!d && dash.isLoading && <LoadingState />}
    </>
  );
}
