import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  ImportOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { EventLogDto, MiningActivityDto, UserRef } from '@processhub/shared';
import {
  useAutoMatch,
  useDeleteLog,
  useEventLog,
  useLogActivities,
  useLogGrants,
  useMapActivities,
  useSetGrants,
  useUpdateLog,
} from '@/api/mining';
import { useProcessTree } from '@/api/hooks';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import {
  useErrorMessage,
  useFormatDate,
  useFormatNumber,
  useLocalized,
} from '@/components/i18n-helpers';
import { UserSelect } from '@/features/governance/UserSelect';
import { useLocale } from '@/app/LocaleProvider';
import { pickLabel } from '@/features/modeler/labels';
import { ImportReport } from './ImportWizard';
import { JobProgress, LogStatusTag } from './mining-helpers';
import { logPath } from './mining-utils';

/** Analysis tabs registered by later steps (map, variants, statistics, …). */
export interface LogTab {
  key: string;
  label: string;
  render: (log: EventLogDto) => ReactNode;
}

/** Event log page: overview, activity mapping, access (+ analysis tabs). */
export function LogPage({ tabs = [] }: { tabs?: LogTab[] }) {
  const { id = '', tab = 'overview' } = useParams();
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const log = useEventLog(id);
  const remove = useDeleteLog();
  const [editing, setEditing] = useState(false);

  if (log.isLoading) return <LoadingState />;
  if (log.isError || !log.data) return <ErrorState error={log.error} />;
  const l = log.data;
  const ready = l.status === 'READY';
  const items = [
    { key: 'overview', label: t('mining:tabs.overview'), children: <Overview log={l} /> },
    ...(ready ? tabs.map((x) => ({ key: x.key, label: x.label, children: x.render(l) })) : []),
    ...(ready
      ? [
          {
            key: 'activities',
            label: t('mining:tabs.activities'),
            children: <Activities log={l} />,
          },
        ]
      : []),
    { key: 'access', label: t('mining:tabs.access'), children: <Access log={l} /> },
  ];

  return (
    <>
      <PageHeader
        title={`${l.code} · ${loc(l)}`}
        subtitle={
          <Space size={8} wrap>
            <LogStatusTag status={l.status} />
            {l.process && (
              <Link to={`/processes/${l.process.id}`}>
                {l.process.code} {loc(l.process)}
              </Link>
            )}
            {l.pseudonymised && <Tag>{t('mining:fields.pseudonymised')}</Tag>}
          </Space>
        }
        crumbs={[{ title: t('mining:logs.title'), to: '/mining/logs' }, { title: l.code }]}
        extra={
          l.canManage && (
            <>
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {t('mining:log.edit')}
              </Button>
              {l.source === 'FILE' && l.fileName && (
                <Button
                  icon={<ImportOutlined />}
                  onClick={() => navigate(`${logPath(l.id)}/import`)}
                >
                  {l.status === 'DRAFT' ? t('mining:log.continueImport') : t('mining:log.reimport')}
                </Button>
              )}
              <Popconfirm
                title={t('mining:log.deleteConfirm')}
                description={t('mining:log.deleteHint')}
                okButtonProps={{ danger: true }}
                onConfirm={() =>
                  remove
                    .mutateAsync(l.id)
                    .then(() => navigate('/mining/logs'))
                    .catch((e: unknown) => void message.error(errorMessage(e)))
                }
              >
                <Button danger icon={<DeleteOutlined />}>
                  {t('mining:log.delete')}
                </Button>
              </Popconfirm>
            </>
          )
        }
      />
      {l.job && (
        <Card style={{ marginBlockEnd: 16 }}>
          <JobProgress job={l.job} canCancel={l.canManage} />
        </Card>
      )}
      <Tabs
        activeKey={items.some((i) => i.key === tab) ? tab : 'overview'}
        onChange={(k) =>
          navigate(logPath(l.id, k === 'overview' ? undefined : k), { replace: true })
        }
        items={items}
        destroyInactiveTabPane
      />
      {editing && <EditLogModal log={l} onClose={() => setEditing(false)} />}
    </>
  );
}

function Overview({ log }: { log: EventLogDto }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const formatNumber = useFormatNumber();
  return (
    <Flex vertical gap={16}>
      <Card>
        <Descriptions
          size="small"
          column={{ xs: 1, md: 2, xl: 3 }}
          items={[
            {
              key: 'source',
              label: t('mining:fields.source'),
              children: t(`mining:source.${log.source}`),
            },
            { key: 'file', label: t('mining:fields.file'), children: log.fileName ?? '—' },
            {
              key: 'cases',
              label: t('mining:fields.cases'),
              children: formatNumber(log.caseCount),
            },
            {
              key: 'events',
              label: t('mining:fields.events'),
              children: formatNumber(log.eventCount),
            },
            {
              key: 'activities',
              label: t('mining:fields.activities'),
              children: formatNumber(log.activityCount),
            },
            {
              key: 'resources',
              label: t('mining:fields.resources'),
              children: formatNumber(log.resourceCount),
            },
            {
              key: 'period',
              label: t('mining:fields.period'),
              children: log.periodStart
                ? `${formatDate(log.periodStart)} – ${formatDate(log.periodEnd)}`
                : '—',
            },
            {
              key: 'times',
              label: t('mining:fields.timestamps'),
              children: log.hasStartTimes
                ? t('mining:fields.startAndEnd')
                : t('mining:fields.endOnly'),
            },
            { key: 'tz', label: t('mining:mapping.timeZone'), children: log.timeZone },
            {
              key: 'attrs',
              label: t('mining:mapping.attributes'),
              children: log.attributeNames.join(', ') || '—',
            },
            {
              key: 'owner',
              label: t('mining:fields.owner'),
              children: log.owner ? loc(log.owner) : '—',
            },
            {
              key: 'department',
              label: t('mining:fields.department'),
              children: log.department ? loc(log.department) : '—',
            },
            {
              key: 'imported',
              label: t('mining:fields.importedAt'),
              children: formatDate(log.importedAt),
            },
          ]}
        />
        {loc(log, 'description') && (
          <Typography.Paragraph style={{ marginBlockStart: 12 }}>
            {loc(log, 'description')}
          </Typography.Paragraph>
        )}
      </Card>
      {log.status === 'FAILED' && <Alert type="error" showIcon message={t('mining:log.failed')} />}
      {log.importReport && (
        <Card title={t('mining:log.report')}>
          <ImportReport report={log.importReport} />
        </Card>
      )}
    </Flex>
  );
}

function Activities({ log }: { log: EventLogDto }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const formatNumber = useFormatNumber();
  const acts = useLogActivities(log.id);
  const map = useMapActivities(log.id);
  const auto = useAutoMatch(log.id);
  const steps = acts.data?.steps ?? [];
  const options = steps.map((s) => ({ value: s.id, label: pickLabel(s, locale) || s.id }));
  const mapped = (acts.data?.items ?? []).filter((a) => a.elementId).length;
  if (acts.isLoading) return <LoadingState />;
  return (
    <Card
      title={t('mining:activities.title')}
      extra={
        log.canManage &&
        log.process && (
          <Button
            icon={<ThunderboltOutlined />}
            loading={auto.isPending}
            onClick={() =>
              auto
                .mutateAsync()
                .then(
                  (r) => void message.success(t('mining:activities.matched', { count: r.matched })),
                )
                .catch((e: unknown) => void message.error(errorMessage(e)))
            }
          >
            {t('mining:activities.autoMatch')}
          </Button>
        )
      }
    >
      {!log.process ? (
        <Alert
          type="info"
          showIcon
          message={t('mining:activities.noProcess')}
          style={{ marginBlockEnd: 12 }}
        />
      ) : (
        <Typography.Paragraph type="secondary">
          {t('mining:activities.summary', { mapped, total: acts.data?.items.length ?? 0 })}
        </Typography.Paragraph>
      )}
      <Table<MiningActivityDto>
        rowKey="name"
        size="small"
        data-testid="mining-activities"
        dataSource={acts.data?.items ?? []}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        columns={[
          { title: t('mining:activities.activity'), dataIndex: 'name' },
          {
            title: t('mining:fields.events'),
            align: 'end',
            width: 100,
            render: (_, a) => formatNumber(a.eventCount),
          },
          {
            title: t('mining:fields.cases'),
            align: 'end',
            width: 100,
            render: (_, a) => formatNumber(a.caseCount),
          },
          ...(log.process
            ? [
                {
                  title: t('mining:activities.step'),
                  width: 320,
                  render: (_: unknown, a: MiningActivityDto) =>
                    log.canManage ? (
                      <Select
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        size="small"
                        style={{ width: '100%' }}
                        value={a.elementId ?? undefined}
                        placeholder={t('mining:activities.unmapped')}
                        options={options}
                        onChange={(v) =>
                          map
                            .mutateAsync({ items: [{ activity: a.name, elementId: v ?? null }] })
                            .catch((e: unknown) => void message.error(errorMessage(e)))
                        }
                      />
                    ) : (
                      (options.find((o) => o.value === a.elementId)?.label ?? '—')
                    ),
                },
                {
                  title: t('mining:activities.match'),
                  width: 140,
                  render: (_: unknown, a: MiningActivityDto) =>
                    a.match ? <Tag>{t(`mining:activities.matchKind.${a.match}`)}</Tag> : null,
                },
              ]
            : []),
        ]}
      />
    </Card>
  );
}

function Access({ log }: { log: EventLogDto }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const grants = useLogGrants(log.id);
  const save = useSetGrants(log.id);
  const [adding, setAdding] = useState<string | null>(null);
  const users: UserRef[] = (grants.data ?? []).map((g) => g.user);
  const update = (ids: string[]) =>
    save.mutateAsync(ids).catch((e: unknown) => void message.error(errorMessage(e)));
  return (
    <Card title={t('mining:access.title')}>
      <Typography.Paragraph type="secondary">{t('mining:access.help')}</Typography.Paragraph>
      {log.canManage && (
        <Flex gap={8} style={{ marginBlockEnd: 12, maxWidth: 480 }}>
          <UserSelect value={adding} onChange={setAdding} />
          <Button
            disabled={!adding}
            onClick={() => {
              if (adding)
                void update([...users.map((u) => u.id), adding]).then(() => setAdding(null));
            }}
          >
            {t('mining:access.grant')}
          </Button>
        </Flex>
      )}
      <Table<UserRef>
        rowKey="id"
        size="small"
        dataSource={users}
        pagination={false}
        columns={[
          { title: t('mining:access.user'), render: (_, u) => loc(u) || u.email },
          { title: t('mining:access.email'), dataIndex: 'email' },
          ...(log.canManage
            ? [
                {
                  title: '',
                  width: 80,
                  render: (_: unknown, u: UserRef) => (
                    <Button
                      size="small"
                      danger
                      type="link"
                      onClick={() =>
                        void update(users.filter((x) => x.id !== u.id).map((x) => x.id))
                      }
                    >
                      {t('mining:access.revoke')}
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
    </Card>
  );
}

function EditLogModal({ log, onClose }: { log: EventLogDto; onClose: () => void }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const update = useUpdateLog(log.id);
  const processes = useProcessTree();
  const [form] = Form.useForm();
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
      title={t('mining:log.edit')}
      confirmLoading={update.isPending}
      onCancel={onClose}
      onOk={() =>
        void form.validateFields().then((v) =>
          update
            .mutateAsync({ ...v, processId: v.processId ?? null })
            .then(onClose)
            .catch((e: unknown) => void message.error(errorMessage(e))),
        )
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          nameEn: log.nameEn,
          nameAr: log.nameAr,
          descriptionEn: log.descriptionEn,
          descriptionAr: log.descriptionAr,
          processId: log.process?.id,
        }}
      >
        <Form.Item name="nameEn" label={t('mining:fields.nameEn')}>
          <Input />
        </Form.Item>
        <Form.Item name="nameAr" label={t('mining:fields.nameAr')}>
          <Input dir="rtl" />
        </Form.Item>
        <Form.Item name="descriptionEn" label={t('mining:fields.descriptionEn')}>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="descriptionAr" label={t('mining:fields.descriptionAr')}>
          <Input.TextArea rows={2} dir="rtl" />
        </Form.Item>
        <Form.Item
          name="processId"
          label={t('mining:fields.process')}
          extra={t('mining:log.processHint')}
        >
          <Select allowClear showSearch optionFilterProp="label" options={options} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
