import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  TreeSelect,
  Typography,
} from 'antd';
import { KeyOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import {
  API_RATE_LIMIT_DEFAULT,
  API_RATE_LIMIT_MAX,
  API_SCOPES,
  DEFAULT_API_SCOPES,
  PERMISSIONS,
  type ApiKeyContent,
  type ApiKeyDto,
  type ApiKeySecretDto,
  type ApiKeyStatus,
  type ApiScope,
} from '@processhub/shared';
import {
  useApiKeyUsage,
  useApiKeys,
  useApiSettings,
  useCreateApiKey,
  useRevokeApiKey,
  useRotateApiKey,
  useUpdateApiKey,
} from '@/api/integrations';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { UserSelect } from '@/features/governance/UserSelect';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';

const STATUS_COLOR: Record<ApiKeyStatus, string> = {
  ACTIVE: 'green',
  EXPIRED: 'default',
  REVOKED: 'red',
};

interface FormValues {
  name: string;
  description: string;
  ownerId: string;
  scopes: ApiScope[];
  content: ApiKeyContent;
  departmentIds: string[];
  ipAllowList: string[];
  rateLimitPerMinute: number;
  expiresAt: Dayjs;
}

/** The full key, shown once after create / rotate, with a copy button. */
function SecretModal({ secret, onClose }: { secret: ApiKeySecretDto | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal
      open={!!secret}
      title={t('integrations:apiKeys.secretTitle')}
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onClose}>
          {t('integrations:apiKeys.secretDone')}
        </Button>
      }
      maskClosable={false}
    >
      <Alert type="warning" showIcon message={t('integrations:apiKeys.secretOnce')} />
      <Typography.Paragraph
        copyable={{ text: secret?.secret }}
        code
        style={{ marginTop: 16, wordBreak: 'break-all' }}
        data-testid="api-key-secret"
      >
        <span dir="ltr">{secret?.secret}</span>
      </Typography.Paragraph>
      <Typography.Text type="secondary">{t('integrations:apiKeys.secretHint')}</Typography.Text>
    </Modal>
  );
}

function KeyFormModal({
  open,
  editing,
  onClose,
  onCreated,
}: {
  open: boolean;
  editing: ApiKeyDto | null;
  onClose: () => void;
  onCreated: (s: ApiKeySecretDto) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [form] = Form.useForm<FormValues>();
  const create = useCreateApiKey();
  const update = useUpdateApiKey();
  const settings = useApiSettings();
  const departments = useDepartmentTreeData();
  const maxDays = settings.data?.maxKeyDays ?? 730;

  const submit = async (v: FormValues) => {
    const body = {
      name: v.name,
      description: v.description ?? '',
      ownerId: v.ownerId,
      scopes: v.scopes,
      content: v.content,
      departmentIds: v.departmentIds ?? [],
      ipAllowList: (v.ipAllowList ?? []).map((s) => s.trim()).filter(Boolean),
      rateLimitPerMinute: v.rateLimitPerMinute,
      expiresAt: v.expiresAt.endOf('day').toISOString(),
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, body });
        message.success(t('saved'));
      } else {
        onCreated(await create.mutateAsync(body));
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
      width={720}
      title={editing ? t('integrations:apiKeys.edit') : t('integrations:apiKeys.create')}
      okText={editing ? t('save') : t('integrations:apiKeys.createOk')}
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
            ? { ...editing, ownerId: editing.owner?.id, expiresAt: dayjs(editing.expiresAt) }
            : {
                scopes: DEFAULT_API_SCOPES,
                content: 'PUBLISHED',
                departmentIds: [],
                ipAllowList: [],
                rateLimitPerMinute: API_RATE_LIMIT_DEFAULT,
                expiresAt: dayjs().add(Math.min(365, maxDays), 'day'),
              }
        }
      >
        <Form.Item
          name="name"
          label={t('integrations:apiKeys.name')}
          rules={[{ required: true, max: 120 }]}
        >
          <Input placeholder={t('integrations:apiKeys.namePlaceholder')} />
        </Form.Item>
        <Form.Item
          name="description"
          label={t('integrations:apiKeys.description')}
          rules={[{ max: 500 }]}
        >
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item
          name="ownerId"
          label={t('integrations:apiKeys.owner')}
          extra={t('integrations:apiKeys.ownerHint')}
          rules={[{ required: true }]}
        >
          <UserSelect known={editing?.owner ? [editing.owner] : []} />
        </Form.Item>
        <Form.Item
          name="scopes"
          label={t('integrations:apiKeys.scopes')}
          extra={t('integrations:apiKeys.scopesHint')}
          rules={[{ required: true, type: 'array', min: 1 }]}
        >
          <Checkbox.Group style={{ display: 'grid', gap: 6 }}>
            {API_SCOPES.map((s) => (
              <Checkbox key={s} value={s}>
                <code dir="ltr">{s}</code> — {t(`integrations:scope.${s}`)}
              </Checkbox>
            ))}
          </Checkbox.Group>
        </Form.Item>
        <Form.Item name="content" label={t('integrations:apiKeys.content')}>
          <Radio.Group>
            <Radio value="PUBLISHED">{t('integrations:content.PUBLISHED')}</Radio>
            <Radio value="WORKSPACE">{t('integrations:content.WORKSPACE')}</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          name="departmentIds"
          label={t('integrations:apiKeys.departments')}
          extra={t('integrations:apiKeys.departmentsHint')}
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
        <Flex gap={16} wrap>
          <Form.Item
            name="expiresAt"
            label={t('integrations:apiKeys.expiresAt')}
            extra={t('integrations:apiKeys.expiresHint', { count: maxDays })}
            rules={[{ required: true }]}
          >
            <DatePicker
              disabledDate={(d) =>
                d.isBefore(dayjs(), 'day') || d.isAfter(dayjs().add(maxDays, 'day'))
              }
            />
          </Form.Item>
          <Form.Item
            name="rateLimitPerMinute"
            label={t('integrations:apiKeys.rateLimit')}
            rules={[{ required: true }]}
          >
            <InputNumber
              min={1}
              max={API_RATE_LIMIT_MAX}
              addonAfter={t('integrations:apiKeys.perMinute')}
            />
          </Form.Item>
        </Flex>
        <Form.Item
          name="ipAllowList"
          label={t('integrations:apiKeys.ipAllowList')}
          extra={t('integrations:apiKeys.ipHint')}
        >
          <Select
            mode="tags"
            tokenSeparators={[',', ' ']}
            open={false}
            style={{ direction: 'ltr' }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function UsageDrawer({ apiKey, onClose }: { apiKey: ApiKeyDto | null; onClose: () => void }) {
  const { t } = useTranslation();
  const formatDate = useFormatDate();
  const [errors, setErrors] = useState(false);
  const usage = useApiKeyUsage(apiKey?.id, errors);
  return (
    <Drawer
      open={!!apiKey}
      width={760}
      onClose={onClose}
      title={t('integrations:apiKeys.usageTitle', { name: apiKey?.name ?? '' })}
      destroyOnHidden
    >
      {usage.isLoading ? (
        <LoadingState />
      ) : usage.isError || !usage.data ? (
        <ErrorState error={usage.error} />
      ) : (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Card size="small" title={t('integrations:apiKeys.byEndpoint')}>
            <Table
              size="small"
              rowKey={(r) => `${r.method} ${r.path}`}
              pagination={false}
              dataSource={usage.data.endpoints}
              locale={{ emptyText: t('integrations:apiKeys.noCalls') }}
              columns={[
                {
                  title: t('integrations:apiKeys.endpoint'),
                  render: (_, r) => (
                    <code dir="ltr">
                      {r.method} {r.path}
                    </code>
                  ),
                },
                { title: t('integrations:apiKeys.calls'), dataIndex: 'calls', align: 'end' },
                { title: t('integrations:apiKeys.errors'), dataIndex: 'errors', align: 'end' },
                { title: t('integrations:apiKeys.avgMs'), dataIndex: 'avgMs', align: 'end' },
              ]}
            />
          </Card>
          <Card
            size="small"
            title={t('integrations:apiKeys.recent')}
            extra={
              <Segmented
                size="small"
                value={errors ? 'errors' : 'all'}
                onChange={(v) => setErrors(v === 'errors')}
                options={[
                  { value: 'all', label: t('integrations:apiKeys.allCalls') },
                  { value: 'errors', label: t('integrations:apiKeys.onlyErrors') },
                ]}
              />
            }
          >
            <Table
              size="small"
              rowKey="id"
              pagination={{ pageSize: 20 }}
              dataSource={usage.data.recent}
              locale={{ emptyText: t('integrations:apiKeys.noCalls') }}
              columns={[
                {
                  title: t('integrations:apiKeys.when'),
                  render: (_, r) => formatDate(r.createdAt),
                },
                {
                  title: t('integrations:apiKeys.endpoint'),
                  render: (_, r) => (
                    <code dir="ltr">
                      {r.method} {r.path}
                    </code>
                  ),
                },
                {
                  title: t('integrations:apiKeys.status'),
                  render: (_, r) => <Tag color={r.status >= 400 ? 'red' : 'green'}>{r.status}</Tag>,
                },
                {
                  title: t('integrations:apiKeys.durationMs'),
                  dataIndex: 'durationMs',
                  align: 'end',
                },
                {
                  title: t('integrations:apiKeys.ip'),
                  render: (_, r) => <span dir="ltr">{r.ip}</span>,
                },
              ]}
            />
          </Card>
        </Space>
      )}
    </Drawer>
  );
}

/** Settings → Integrations → API keys. */
export function ApiKeysTab() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const formatDate = useFormatDate();
  const loc = useLocalized();
  const { can } = useAuth();
  const manage = can(PERMISSIONS.SETTINGS_MANAGE);
  const keys = useApiKeys();
  const rotate = useRotateApiKey();
  const revoke = useRevokeApiKey();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApiKeyDto | null>(null);
  const [secret, setSecret] = useState<ApiKeySecretDto | null>(null);
  const [usageKey, setUsageKey] = useState<ApiKeyDto | null>(null);

  if (keys.isLoading) return <LoadingState />;
  if (keys.isError) return <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />;

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Typography.Text type="secondary">
          {t('integrations:apiKeys.intro')}{' '}
          <a href="/api/public/docs" target="_blank" rel="noreferrer">
            {t('integrations:apiKeys.docsLink')}
          </a>
        </Typography.Text>
        {manage && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t('integrations:apiKeys.create')}
          </Button>
        )}
      </Flex>
      <Table<ApiKeyDto>
        rowKey="id"
        dataSource={keys.data}
        pagination={false}
        scroll={{ x: 900 }}
        locale={{ emptyText: t('integrations:apiKeys.empty') }}
        expandable={{
          expandedRowRender: (k) => (
            <Descriptions size="small" column={{ xs: 1, md: 2 }}>
              <Descriptions.Item label={t('integrations:apiKeys.description')}>
                {k.description || '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('integrations:apiKeys.content')}>
                {t(`integrations:content.${k.content}`)}
              </Descriptions.Item>
              <Descriptions.Item label={t('integrations:apiKeys.rateLimit')}>
                {t('integrations:apiKeys.perMinuteValue', { count: k.rateLimitPerMinute })}
              </Descriptions.Item>
              <Descriptions.Item label={t('integrations:apiKeys.ipAllowList')}>
                <span dir="ltr">
                  {k.ipAllowList.join(', ') || t('integrations:apiKeys.anyAddress')}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label={t('integrations:apiKeys.departments')}>
                {k.departmentIds.length
                  ? t('integrations:apiKeys.departmentCount', { count: k.departmentIds.length })
                  : t('integrations:apiKeys.allDepartments')}
              </Descriptions.Item>
              <Descriptions.Item label={t('integrations:apiKeys.createdBy')}>
                {k.createdBy ? loc(k.createdBy) : '—'} · {formatDate(k.createdAt)}
              </Descriptions.Item>
              {k.rotatedAt && (
                <Descriptions.Item label={t('integrations:apiKeys.rotatedAt')}>
                  {formatDate(k.rotatedAt)}
                </Descriptions.Item>
              )}
            </Descriptions>
          ),
        }}
        columns={[
          {
            title: t('integrations:apiKeys.name'),
            render: (_, k) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>
                  <KeyOutlined /> {k.name}
                </Typography.Text>
                <Typography.Text type="secondary" code dir="ltr">
                  {k.prefix}…
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: t('integrations:apiKeys.status'),
            render: (_, k) => (
              <Tag color={STATUS_COLOR[k.status]}>{t(`integrations:status.${k.status}`)}</Tag>
            ),
          },
          {
            title: t('integrations:apiKeys.owner'),
            render: (_, k) => (k.owner ? loc(k.owner) : '—'),
          },
          {
            title: t('integrations:apiKeys.scopes'),
            render: (_, k) => (
              <Flex wrap gap={4}>
                {k.scopes.map((s) => (
                  <Tag key={s} dir="ltr">
                    {s}
                  </Tag>
                ))}
              </Flex>
            ),
          },
          {
            title: t('integrations:apiKeys.expiresAt'),
            render: (_, k) => formatDate(k.expiresAt, false),
          },
          {
            title: t('integrations:apiKeys.lastUsed'),
            render: (_, k) =>
              k.lastUsedAt ? (
                <Space direction="vertical" size={0}>
                  {formatDate(k.lastUsedAt)}
                  <Typography.Text type="secondary" dir="ltr">
                    {k.lastUsedIp}
                  </Typography.Text>
                </Space>
              ) : (
                t('integrations:apiKeys.never')
              ),
          },
          {
            title: t('actions'),
            render: (_, k) => (
              <Space wrap size={4}>
                <Button size="small" onClick={() => setUsageKey(k)}>
                  {t('integrations:apiKeys.usage')}
                </Button>
                {manage && k.status !== 'REVOKED' && (
                  <>
                    <Button
                      size="small"
                      onClick={() => {
                        setEditing(k);
                        setFormOpen(true);
                      }}
                    >
                      {t('edit')}
                    </Button>
                    <Popconfirm
                      title={t('integrations:apiKeys.rotateConfirm')}
                      onConfirm={() =>
                        rotate.mutate(k.id, {
                          onSuccess: setSecret,
                          onError: (err) => message.error(errorMessage(err)),
                        })
                      }
                    >
                      <Button size="small">{t('integrations:apiKeys.rotate')}</Button>
                    </Popconfirm>
                    <Popconfirm
                      title={t('integrations:apiKeys.revokeConfirm')}
                      okButtonProps={{ danger: true }}
                      onConfirm={() =>
                        revoke.mutate(k.id, {
                          onSuccess: () => message.success(t('integrations:apiKeys.revoked')),
                          onError: (err) => message.error(errorMessage(err)),
                        })
                      }
                    >
                      <Button size="small" danger>
                        {t('integrations:apiKeys.revoke')}
                      </Button>
                    </Popconfirm>
                  </>
                )}
              </Space>
            ),
          },
        ]}
      />
      <KeyFormModal
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onCreated={setSecret}
      />
      <SecretModal secret={secret} onClose={() => setSecret(null)} />
      <UsageDrawer apiKey={usageKey} onClose={() => setUsageKey(null)} />
    </Space>
  );
}
