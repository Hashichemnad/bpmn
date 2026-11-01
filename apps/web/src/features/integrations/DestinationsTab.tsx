import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Checkbox,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  TreeSelect,
  Typography,
} from 'antd';
import { PlusOutlined, SendOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  PERMISSIONS,
  TEAMS_DEFAULT_HOSTS,
  WEBHOOK_EVENTS,
  type TeamsLanguage,
  type WebhookDeliveryDto,
  type WebhookDeliveryStatus,
  type WebhookDto,
  type WebhookEventType,
  type WebhookKind,
  type WebhookSecretDto,
  type WebhookSettings,
} from '@processhub/shared';
import {
  useCreateWebhook,
  useDeleteWebhook,
  useResendDelivery,
  useRotateWebhookSecret,
  useTestWebhook,
  useUpdateWebhook,
  useUpdateWebhookSettings,
  useWebhookDeliveries,
  useWebhookSettings,
  useWebhooks,
} from '@/api/integrations';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';

/** An absolute http(s) URL without credentials. */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
  } catch {
    return false;
  }
}

const DELIVERY_COLOR: Record<WebhookDeliveryStatus, string> = {
  PENDING: 'gold',
  SUCCEEDED: 'green',
  FAILED: 'red',
  GAVE_UP: 'red',
};

/** Event groups for the checkbox list. */
const GROUPS: { key: string; events: WebhookEventType[] }[] = [
  {
    key: 'content',
    events: WEBHOOK_EVENTS.filter((e) => /^(process|page|diagram)\./.test(e)),
  },
  { key: 'reviews', events: WEBHOOK_EVENTS.filter((e) => e.startsWith('review.')) },
  { key: 'workflow', events: WEBHOOK_EVENTS.filter((e) => e.startsWith('workflow.')) },
  {
    key: 'other',
    events: WEBHOOK_EVENTS.filter((e) => /^(issue|kpi|import)\./.test(e)),
  },
];

interface FormValues {
  name: string;
  url?: string;
  events: WebhookEventType[];
  departmentIds: string[];
  processBranchId: string | null;
  language: TeamsLanguage;
  active: boolean;
}

function SecretModal({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal
      open={!!secret}
      title={t('integrations:webhooks.secretTitle')}
      onCancel={onClose}
      maskClosable={false}
      footer={
        <Button type="primary" onClick={onClose}>
          {t('integrations:apiKeys.secretDone')}
        </Button>
      }
    >
      <Alert type="warning" showIcon message={t('integrations:webhooks.secretOnce')} />
      <Typography.Paragraph
        copyable={{ text: secret ?? '' }}
        code
        style={{ marginTop: 16, wordBreak: 'break-all' }}
        data-testid="webhook-secret"
      >
        <span dir="ltr">{secret}</span>
      </Typography.Paragraph>
      <Typography.Text type="secondary">{t('integrations:webhooks.secretHint')}</Typography.Text>
    </Modal>
  );
}

function DestinationForm({
  kind,
  open,
  editing,
  onClose,
  onSecret,
}: {
  kind: WebhookKind;
  open: boolean;
  editing: WebhookDto | null;
  onClose: () => void;
  onSecret: (s: WebhookSecretDto) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [form] = Form.useForm<FormValues>();
  const create = useCreateWebhook();
  const update = useUpdateWebhook();
  const departments = useDepartmentTreeData();
  const processes = useProcessTreeOptions('');

  const submit = async (v: FormValues) => {
    const body = {
      name: v.name,
      events: v.events,
      departmentIds: v.departmentIds ?? [],
      processBranchId: v.processBranchId ?? null,
      language: v.language ?? 'BOTH',
      active: v.active,
      ...(v.url ? { url: v.url.trim() } : {}),
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, body });
        message.success(t('saved'));
      } else {
        const res = await create.mutateAsync({ ...body, kind, url: v.url!.trim() });
        if (res.secret) onSecret(res);
        else message.success(t('saved'));
      }
      onClose();
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      destroyOnHidden
      width={760}
      title={
        editing
          ? t(`integrations:${kind === 'TEAMS' ? 'teams' : 'webhooks'}.edit`)
          : t(`integrations:${kind === 'TEAMS' ? 'teams' : 'webhooks'}.create`)
      }
      okText={t('save')}
      onOk={() => form.submit()}
      confirmLoading={create.isPending || update.isPending}
      onCancel={onClose}
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={
          editing
            ? {
                name: editing.name,
                events: editing.events,
                departmentIds: editing.departmentIds,
                processBranchId: editing.processBranch?.id ?? null,
                language: editing.language,
                active: editing.active,
              }
            : {
                events: ['process.published'],
                departmentIds: [],
                processBranchId: null,
                language: 'BOTH',
                active: true,
              }
        }
      >
        <Form.Item
          name="name"
          label={t('integrations:webhooks.name')}
          rules={[{ required: true, max: 120 }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="url"
          label={t(kind === 'TEAMS' ? 'integrations:teams.url' : 'integrations:webhooks.url')}
          extra={
            editing
              ? t('integrations:webhooks.urlKeep', { url: editing.urlDisplay })
              : t(kind === 'TEAMS' ? 'integrations:teams.urlHint' : 'integrations:webhooks.urlHint')
          }
          rules={[
            { required: !editing },
            { max: 2000 },
            {
              // Not Ant Design's `type: 'url'`: it refuses host names without a dot (internal
              // hosts of OUTBOUND_ALLOWED_HOSTS); the server checks the destination fully.
              validator: (_, value?: string) =>
                !value || isHttpUrl(value)
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('errors:WEBHOOK_URL_INVALID'))),
            },
          ]}
        >
          <Input dir="ltr" placeholder="https://" />
        </Form.Item>
        <Form.Item
          name="events"
          label={t('integrations:webhooks.events')}
          rules={[{ required: true, type: 'array', min: 1 }]}
        >
          <Checkbox.Group style={{ width: '100%' }}>
            <Flex vertical gap={8}>
              {GROUPS.map((g) => (
                <div key={g.key}>
                  <Typography.Text type="secondary">
                    {t(`integrations:eventGroups.${g.key}`)}
                  </Typography.Text>
                  <Flex wrap gap={8} style={{ marginTop: 4 }}>
                    {g.events.map((e) => (
                      <Checkbox key={e} value={e}>
                        {t(`integrations:events.${e}`)}
                      </Checkbox>
                    ))}
                  </Flex>
                </div>
              ))}
            </Flex>
          </Checkbox.Group>
        </Form.Item>
        <Form.Item
          name="departmentIds"
          label={t('integrations:apiKeys.departments')}
          extra={t('integrations:webhooks.departmentsHint')}
        >
          <TreeSelect
            treeData={departments}
            multiple
            allowClear
            treeDefaultExpandAll
            showSearch
            treeNodeFilterProp="title"
          />
        </Form.Item>
        <Form.Item
          name="processBranchId"
          label={t('integrations:webhooks.branch')}
          extra={t('integrations:webhooks.branchHint')}
        >
          <TreeSelect
            treeData={processes.options}
            allowClear
            showSearch
            treeNodeFilterProp="title"
            loading={processes.loading}
          />
        </Form.Item>
        {kind === 'TEAMS' && (
          <Form.Item name="language" label={t('integrations:teams.language')}>
            <Radio.Group>
              <Radio value="EN">English</Radio>
              <Radio value="AR">العربية</Radio>
              <Radio value="BOTH">{t('integrations:teams.both')}</Radio>
            </Radio.Group>
          </Form.Item>
        )}
        <Form.Item name="active" label={t('integrations:webhooks.active')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function DeliveriesDrawer({ hook, onClose }: { hook: WebhookDto | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const formatDate = useFormatDate();
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();
  const deliveries = useWebhookDeliveries(hook?.id, page, status);
  const resend = useResendDelivery();
  useEffect(() => {
    setPage(1);
  }, [hook?.id, status]);

  const statusLabel = (d: WebhookDeliveryDto) =>
    d.status === 'PENDING' && d.attempts > 0
      ? t('integrations:delivery.RETRYING')
      : t(`integrations:delivery.${d.status}`);

  return (
    <Drawer
      open={!!hook}
      width={860}
      onClose={onClose}
      destroyOnHidden
      title={t('integrations:webhooks.logTitle', { name: hook?.name ?? '' })}
      extra={
        <Select
          allowClear
          style={{ width: 180 }}
          placeholder={t('integrations:webhooks.allStatuses')}
          value={status}
          onChange={setStatus}
          options={(['PENDING', 'SUCCEEDED', 'GAVE_UP'] as const).map((s) => ({
            value: s,
            label: t(`integrations:delivery.${s}`),
          }))}
        />
      }
    >
      {deliveries.isError ? (
        <ErrorState error={deliveries.error} />
      ) : (
        <Table<WebhookDeliveryDto>
          rowKey="id"
          size="small"
          loading={deliveries.isLoading}
          dataSource={deliveries.data?.items}
          locale={{ emptyText: t('integrations:webhooks.noDeliveries') }}
          pagination={{
            current: page,
            pageSize: 20,
            total: deliveries.data?.total,
            onChange: setPage,
          }}
          expandable={{
            expandedRowRender: (d) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                {d.responseSnippet && (
                  <Typography.Text type="secondary">
                    {t('integrations:webhooks.response')}:{' '}
                    <code dir="ltr">{d.responseSnippet.slice(0, 300)}</code>
                  </Typography.Text>
                )}
                <pre
                  dir="ltr"
                  className="ph-code-block"
                  style={{ maxHeight: 280, overflow: 'auto' }}
                >
                  {JSON.stringify(d.payload, null, 2)}
                </pre>
              </Space>
            ),
          }}
          columns={[
            { title: t('integrations:apiKeys.when'), render: (_, d) => formatDate(d.createdAt) },
            {
              title: t('integrations:webhooks.event'),
              render: (_, d) => (
                <Space size={4}>
                  {d.eventType === 'test'
                    ? t('integrations:webhooks.testEvent')
                    : t(`integrations:events.${d.eventType}`)}
                  {d.test && d.eventType !== 'test' && (
                    <Tag>{t('integrations:webhooks.manual')}</Tag>
                  )}
                </Space>
              ),
            },
            {
              title: t('integrations:apiKeys.status'),
              render: (_, d) => (
                <Space direction="vertical" size={0}>
                  <Tag color={DELIVERY_COLOR[d.status]}>{statusLabel(d)}</Tag>
                  {d.nextAttemptAt && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t('integrations:webhooks.nextAttempt', {
                        when: formatDate(d.nextAttemptAt),
                      })}
                    </Typography.Text>
                  )}
                </Space>
              ),
            },
            { title: t('integrations:webhooks.attempts'), dataIndex: 'attempts', align: 'end' },
            {
              title: t('integrations:webhooks.code'),
              render: (_, d) => (
                <Space direction="vertical" size={0}>
                  <span dir="ltr">{d.lastStatusCode ?? '—'}</span>
                  {d.lastError && (
                    <Typography.Text type="danger" style={{ fontSize: 12 }} dir="ltr">
                      {d.lastError}
                    </Typography.Text>
                  )}
                </Space>
              ),
            },
            {
              title: t('actions'),
              render: (_, d) =>
                can(PERMISSIONS.SETTINGS_MANAGE) && (
                  <Button
                    size="small"
                    loading={resend.isPending && resend.variables?.deliveryId === d.id}
                    onClick={() =>
                      resend.mutate(
                        { id: hook!.id, deliveryId: d.id },
                        {
                          onSuccess: (r) =>
                            r.status === 'SUCCEEDED'
                              ? message.success(t('integrations:webhooks.resent'))
                              : message.warning(
                                  t('integrations:webhooks.resendFailed', {
                                    error: r.lastError ?? '',
                                  }),
                                ),
                          onError: (err) => message.error(errorMessage(err)),
                        },
                      )
                    }
                  >
                    {t('integrations:webhooks.resend')}
                  </Button>
                ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}

function SettingsCard({ kind }: { kind: WebhookKind }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const { can } = useAuth();
  const settings = useWebhookSettings();
  const update = useUpdateWebhookSettings();
  const [form] = Form.useForm<WebhookSettings>();
  useEffect(() => {
    if (settings.data) form.setFieldsValue(settings.data);
  }, [settings.data, form]);
  const manage = can(PERMISSIONS.SETTINGS_MANAGE);
  return (
    <Card size="small" title={t('integrations:webhookSettings.title')}>
      <Form<WebhookSettings>
        form={form}
        layout="vertical"
        disabled={!manage}
        onFinish={(v) =>
          update.mutate(v, {
            onSuccess: () => message.success(t('saved')),
            onError: (err) => message.error(errorMessage(err)),
          })
        }
      >
        {kind === 'WEBHOOK' ? (
          <Form.Item
            name="allowedHosts"
            label={t('integrations:webhookSettings.allowedHosts')}
            extra={t('integrations:webhookSettings.allowedHostsHint')}
          >
            <Select mode="tags" open={false} tokenSeparators={[',', ' ']} />
          </Form.Item>
        ) : (
          <Form.Item
            name="teamsHosts"
            label={t('integrations:webhookSettings.teamsHosts')}
            extra={t('integrations:webhookSettings.teamsHostsHint', {
              hosts: TEAMS_DEFAULT_HOSTS.join(', '),
            })}
          >
            <Select mode="tags" open={false} tokenSeparators={[',', ' ']} />
          </Form.Item>
        )}
        <Form.Item
          name="retentionDays"
          label={t('integrations:webhookSettings.retention')}
          rules={[{ required: true }]}
        >
          <InputNumber min={7} max={365} />
        </Form.Item>
        {/* Keep the other kind's list when saving. */}
        <Form.Item name={kind === 'WEBHOOK' ? 'teamsHosts' : 'allowedHosts'} hidden>
          <Select mode="tags" />
        </Form.Item>
        {manage && (
          <Button htmlType="submit" loading={update.isPending}>
            {t('save')}
          </Button>
        )}
      </Form>
    </Card>
  );
}

/** Settings → Integrations → Webhooks / Microsoft Teams: destinations and their delivery log. */
export function DestinationsTab({ kind }: { kind: WebhookKind }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const formatDate = useFormatDate();
  const loc = useLocalized();
  const { can } = useAuth();
  const manage = can(PERMISSIONS.SETTINGS_MANAGE);
  const hooks = useWebhooks(kind);
  const test = useTestWebhook();
  const rotate = useRotateWebhookSecret();
  const remove = useDeleteWebhook();
  const update = useUpdateWebhook();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WebhookDto | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [logOf, setLogOf] = useState<WebhookDto | null>(null);
  const ns = kind === 'TEAMS' ? 'teams' : 'webhooks';

  if (hooks.isLoading) return <LoadingState />;
  if (hooks.isError) return <ErrorState error={hooks.error} onRetry={() => void hooks.refetch()} />;

  const sendTest = (h: WebhookDto) =>
    test.mutate(h.id, {
      onSuccess: (d) =>
        d.status === 'SUCCEEDED'
          ? message.success(t('integrations:webhooks.testOk', { code: d.lastStatusCode ?? '' }))
          : message.error(t('integrations:webhooks.testFailed', { error: d.lastError ?? '' })),
      onError: (err) => message.error(errorMessage(err)),
    });

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Text type="secondary">{t(`integrations:${ns}.intro`)}</Typography.Text>
        {manage && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t(`integrations:${ns}.create`)}
          </Button>
        )}
      </Flex>
      <Table<WebhookDto>
        rowKey="id"
        dataSource={hooks.data}
        pagination={false}
        scroll={{ x: 900 }}
        locale={{ emptyText: t(`integrations:${ns}.empty`) }}
        columns={[
          {
            title: t('integrations:webhooks.name'),
            render: (_, h) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>{h.name}</Typography.Text>
                <Typography.Text type="secondary" dir="ltr" style={{ fontSize: 12 }}>
                  {h.urlDisplay}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: t('integrations:apiKeys.status'),
            render: (_, h) =>
              h.disabledAt ? (
                <Space direction="vertical" size={0}>
                  <Badge status="error" text={t('integrations:webhooks.switchedOff')} />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }} dir="ltr">
                    {h.disabledReason}
                  </Typography.Text>
                </Space>
              ) : h.active ? (
                <Badge status="success" text={t('integrations:webhooks.on')} />
              ) : (
                <Badge status="default" text={t('integrations:webhooks.off')} />
              ),
          },
          {
            title: t('integrations:webhooks.events'),
            render: (_, h) => (
              <Flex wrap gap={4}>
                {h.events.map((e) => (
                  <Tag key={e}>{t(`integrations:events.${e}`)}</Tag>
                ))}
              </Flex>
            ),
          },
          {
            title: t('integrations:webhooks.filters'),
            render: (_, h) => (
              <Space direction="vertical" size={0}>
                {h.departmentIds.length > 0 && (
                  <span>
                    {t('integrations:apiKeys.departmentCount', { count: h.departmentIds.length })}
                  </span>
                )}
                {h.processBranch && (
                  <span>
                    <span dir="ltr">{h.processBranch.code}</span> {loc(h.processBranch)}
                  </span>
                )}
                {kind === 'TEAMS' && <span>{t(`integrations:teams.lang.${h.language}`)}</span>}
                {!h.departmentIds.length && !h.processBranch && kind !== 'TEAMS' && '—'}
              </Space>
            ),
          },
          {
            title: t('integrations:webhooks.lastDelivery'),
            render: (_, h) =>
              h.lastDelivery ? (
                <Space direction="vertical" size={0}>
                  <Tag color={DELIVERY_COLOR[h.lastDelivery.status]}>
                    {t(`integrations:delivery.${h.lastDelivery.status}`)}
                    {h.lastDelivery.statusCode ? ` · ${h.lastDelivery.statusCode}` : ''}
                  </Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatDate(h.lastDelivery.at)}
                  </Typography.Text>
                </Space>
              ) : (
                '—'
              ),
          },
          {
            title: t('actions'),
            render: (_, h) => (
              <Space wrap size={4}>
                <Button size="small" onClick={() => setLogOf(h)}>
                  {t('integrations:webhooks.log')}
                </Button>
                {manage && (
                  <>
                    <Button
                      size="small"
                      icon={<SendOutlined />}
                      loading={test.isPending && test.variables === h.id}
                      onClick={() => sendTest(h)}
                    >
                      {t('integrations:webhooks.test')}
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        setEditing(h);
                        setFormOpen(true);
                      }}
                    >
                      {t('edit')}
                    </Button>
                    {h.disabledAt && (
                      <Button
                        size="small"
                        onClick={() =>
                          update.mutate(
                            { id: h.id, body: { active: true } },
                            { onError: (err) => message.error(errorMessage(err)) },
                          )
                        }
                      >
                        {t('integrations:webhooks.switchOn')}
                      </Button>
                    )}
                    {kind === 'WEBHOOK' && (
                      <Popconfirm
                        title={t('integrations:webhooks.rotateConfirm')}
                        onConfirm={() =>
                          rotate.mutate(h.id, {
                            onSuccess: (r) => setSecret(r.secret),
                            onError: (err) => message.error(errorMessage(err)),
                          })
                        }
                      >
                        <Button size="small">{t('integrations:apiKeys.rotate')}</Button>
                      </Popconfirm>
                    )}
                    <Popconfirm
                      title={t('integrations:webhooks.deleteConfirm')}
                      okButtonProps={{ danger: true }}
                      onConfirm={() =>
                        remove.mutate(h.id, { onError: (err) => message.error(errorMessage(err)) })
                      }
                    >
                      <Button size="small" danger>
                        {t('delete')}
                      </Button>
                    </Popconfirm>
                  </>
                )}
              </Space>
            ),
          },
        ]}
      />
      <SettingsCard kind={kind} />
      <DestinationForm
        kind={kind}
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSecret={(s) => setSecret(s.secret)}
      />
      <SecretModal secret={secret} onClose={() => setSecret(null)} />
      <DeliveriesDrawer hook={logOf} onClose={() => setLogOf(null)} />
    </Space>
  );
}
