import { useState } from 'react';
import {
  App,
  Button,
  Card,
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
  TimePicker,
  TreeSelect,
  Typography,
} from 'antd';
import { MailOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import {
  PERMISSIONS,
  REPORT_FORMATS,
  SCHEDULED_REPORTS,
  type ReportDeliveryDto,
  type ReportSettings,
  type ReportSubscriptionDto,
  type ReportSubscriptionInput,
} from '@processhub/shared';
import { api } from '@/api/client';
import { useRoles } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';

const KEY = ['report-subscriptions'] as const;

const STATUS_COLOR: Record<ReportDeliveryDto['status'], string> = {
  SENT: 'green',
  FAILED: 'red',
  SKIPPED: 'default',
};

type FormValues = Omit<ReportSubscriptionInput, 'time'> & { time: dayjs.Dayjs };

function SubscriptionForm({
  open,
  editing,
  onClose,
}: {
  open: boolean;
  editing: ReportSubscriptionDto | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const loc = useLocalized();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const departments = useDepartmentTreeData();
  const processes = useProcessTreeOptions('');
  const admin = can(PERMISSIONS.USERS_MANAGE);
  const roles = useRoles();
  const report = Form.useWatch('report', form);
  const frequency = Form.useWatch('frequency', form);
  const audience = Form.useWatch('audience', form);
  const save = useMutation({
    mutationFn: (body: ReportSubscriptionInput) =>
      editing
        ? api<ReportSubscriptionDto>(`/report-subscriptions/${editing.id}`, { method: 'PUT', body })
        : api<ReportSubscriptionDto>('/report-subscriptions', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const submit = (v: FormValues) =>
    save.mutate(
      {
        ...v,
        time: v.time.format('HH:mm'),
        filters: {
          departmentId: v.filters?.departmentId ?? null,
          processId: v.filters?.processId ?? null,
        },
        locale: v.locale ?? null,
        roleId: v.roleId ?? null,
        audienceDepartmentId: v.audienceDepartmentId ?? null,
      },
      {
        onSuccess: () => {
          message.success(t('saved'));
          onClose();
        },
        onError: (err) => message.error(errorMessage(err)),
      },
    );

  return (
    <Modal
      open={open}
      destroyOnHidden
      width={720}
      title={
        editing ? t('integrations:subscriptions.edit') : t('integrations:subscriptions.create')
      }
      okText={t('save')}
      confirmLoading={save.isPending}
      onOk={() => form.submit()}
      onCancel={onClose}
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={
          editing
            ? { ...editing, time: dayjs(`2000-01-01T${editing.time}`) }
            : {
                report: 'KPI_DASHBOARD',
                format: 'LINK',
                frequency: 'WEEKLY',
                weekday: 7,
                monthDay: 1,
                time: dayjs('2000-01-01T07:00'),
                skipHolidays: true,
                locale: null,
                audience: 'SELF',
                active: true,
                filters: {},
              }
        }
      >
        <Form.Item
          name="name"
          label={t('integrations:subscriptions.name')}
          rules={[{ required: true, max: 120 }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="report"
          label={t('integrations:subscriptions.report')}
          rules={[{ required: true }]}
        >
          <Select
            options={SCHEDULED_REPORTS.map((r) => ({
              value: r,
              label: t(`integrations:reports.${r}`),
            }))}
          />
        </Form.Item>
        <Flex gap={16} wrap>
          <Form.Item
            name={['filters', 'departmentId']}
            label={t('integrations:subscriptions.department')}
            style={{ minWidth: 260, flex: 1 }}
          >
            <TreeSelect
              treeData={departments}
              allowClear
              treeDefaultExpandAll
              showSearch
              treeNodeFilterProp="title"
            />
          </Form.Item>
          {report === 'PROCESS_HANDBOOK' && (
            <Form.Item
              name={['filters', 'processId']}
              label={t('integrations:subscriptions.branch')}
              rules={[{ required: true }]}
              style={{ minWidth: 260, flex: 1 }}
            >
              <TreeSelect treeData={processes.options} showSearch treeNodeFilterProp="title" />
            </Form.Item>
          )}
        </Flex>
        <Form.Item name="format" label={t('integrations:subscriptions.format')}>
          <Radio.Group>
            {REPORT_FORMATS.map((f) => (
              <Radio key={f} value={f}>
                {t(`integrations:formats.${f}`)}
              </Radio>
            ))}
          </Radio.Group>
        </Form.Item>
        <Flex gap={16} wrap align="flex-end">
          <Form.Item name="frequency" label={t('integrations:subscriptions.frequency')}>
            <Select
              style={{ width: 160 }}
              options={(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((f) => ({
                value: f,
                label: t(`integrations:frequency.${f}`),
              }))}
            />
          </Form.Item>
          {frequency === 'WEEKLY' && (
            <Form.Item name="weekday" label={t('integrations:subscriptions.weekday')}>
              <Select
                style={{ width: 160 }}
                options={[7, 1, 2, 3, 4, 5, 6].map((d) => ({
                  value: d,
                  label: t(`integrations:weekdays.${d}`),
                }))}
              />
            </Form.Item>
          )}
          {frequency === 'MONTHLY' && (
            <Form.Item name="monthDay" label={t('integrations:subscriptions.monthDay')}>
              <InputNumber min={1} max={28} />
            </Form.Item>
          )}
          <Form.Item
            name="time"
            label={t('integrations:subscriptions.time')}
            extra={t('integrations:subscriptions.timeZone')}
          >
            <TimePicker format="HH:mm" minuteStep={15} allowClear={false} />
          </Form.Item>
        </Flex>
        <Form.Item
          name="skipHolidays"
          valuePropName="checked"
          label={t('integrations:subscriptions.skipHolidays')}
        >
          <Switch />
        </Form.Item>
        <Form.Item name="locale" label={t('integrations:subscriptions.language')}>
          <Radio.Group>
            <Radio value={null}>{t('integrations:subscriptions.recipientLanguage')}</Radio>
            <Radio value="en">English</Radio>
            <Radio value="ar">العربية</Radio>
          </Radio.Group>
        </Form.Item>
        {admin && (
          <>
            <Form.Item name="audience" label={t('integrations:subscriptions.audience')}>
              <Radio.Group>
                <Radio value="SELF">{t('integrations:audience.SELF')}</Radio>
                <Radio value="ROLE">{t('integrations:audience.ROLE')}</Radio>
                <Radio value="DEPARTMENT">{t('integrations:audience.DEPARTMENT')}</Radio>
              </Radio.Group>
            </Form.Item>
            {audience === 'ROLE' && (
              <Form.Item
                name="roleId"
                label={t('integrations:audience.ROLE')}
                rules={[{ required: true }]}
              >
                <Select options={(roles.data ?? []).map((r) => ({ value: r.id, label: loc(r) }))} />
              </Form.Item>
            )}
            {audience === 'DEPARTMENT' && (
              <Form.Item
                name="audienceDepartmentId"
                label={t('integrations:audience.DEPARTMENT')}
                rules={[{ required: true }]}
              >
                <TreeSelect
                  treeData={departments}
                  treeDefaultExpandAll
                  showSearch
                  treeNodeFilterProp="title"
                />
              </Form.Item>
            )}
          </>
        )}
        <Form.Item name="active" valuePropName="checked" label={t('integrations:webhooks.active')}>
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function DeliveriesDrawer({
  sub,
  onClose,
}: {
  sub: ReportSubscriptionDto | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const formatDate = useFormatDate();
  const loc = useLocalized();
  const log = useQuery({
    queryKey: [...KEY, 'deliveries', sub?.id],
    queryFn: () => api<ReportDeliveryDto[]>(`/report-subscriptions/${sub!.id}/deliveries`),
    enabled: !!sub,
  });
  return (
    <Drawer
      open={!!sub}
      width={760}
      onClose={onClose}
      destroyOnHidden
      title={t('integrations:subscriptions.logTitle', { name: sub?.name ?? '' })}
    >
      {log.isError ? (
        <ErrorState error={log.error} />
      ) : (
        <Table<ReportDeliveryDto>
          rowKey="id"
          size="small"
          loading={log.isLoading}
          dataSource={log.data}
          locale={{ emptyText: t('integrations:webhooks.noDeliveries') }}
          columns={[
            { title: t('integrations:apiKeys.when'), render: (_, d) => formatDate(d.createdAt) },
            {
              title: t('integrations:subscriptions.recipient'),
              render: (_, d) => (d.user ? loc(d.user) || d.user.email : '—'),
            },
            {
              title: t('integrations:apiKeys.status'),
              render: (_, d) => (
                <Tag color={STATUS_COLOR[d.status]}>
                  {t(`integrations:deliveryStatus.${d.status}`)}
                </Tag>
              ),
            },
            {
              title: t('integrations:subscriptions.format'),
              render: (_, d) => t(`integrations:formats.${d.format}`),
            },
            {
              title: t('integrations:subscriptions.note'),
              render: (_, d) => (
                <Typography.Text type={d.status === 'FAILED' ? 'danger' : 'secondary'} dir="ltr">
                  {d.error
                    ? t(`integrations:deliveryErrors.${d.error}`, { defaultValue: d.error })
                    : d.attached
                      ? t('integrations:subscriptions.attached')
                      : ''}
                </Typography.Text>
              ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}

function ReportSettingsCard() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: [...KEY, 'settings'],
    queryFn: () => api<ReportSettings>('/report-subscriptions/settings'),
  });
  const save = useMutation({
    mutationFn: (body: ReportSettings) =>
      api<ReportSettings>('/report-subscriptions/settings', { method: 'PUT', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  if (!settings.data) return null;
  return (
    <Card size="small" title={t('integrations:subscriptions.settingsTitle')}>
      <Form<ReportSettings>
        layout="inline"
        initialValues={settings.data}
        onFinish={(v) =>
          save.mutate(v, {
            onSuccess: () => message.success(t('saved')),
            onError: (err) => message.error(errorMessage(err)),
          })
        }
      >
        <Form.Item
          name="allowAttachments"
          valuePropName="checked"
          label={t('integrations:subscriptions.allowAttachments')}
        >
          <Switch />
        </Form.Item>
        <Form.Item name="linkDays" label={t('integrations:subscriptions.linkDays')}>
          <InputNumber min={1} max={90} />
        </Form.Item>
        <Button htmlType="submit" loading={save.isPending}>
          {t('save')}
        </Button>
      </Form>
    </Card>
  );
}

/** Reports → Subscriptions: scheduled report e-mails of the user (all for Admins). */
export function SubscriptionsPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const formatDate = useFormatDate();
  const loc = useLocalized();
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: KEY,
    queryFn: () => api<ReportSubscriptionDto[]>('/report-subscriptions'),
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ReportSubscriptionDto | null>(null);
  const [logOf, setLogOf] = useState<ReportSubscriptionDto | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });
  const sendNow = useMutation({
    mutationFn: (id: string) =>
      api<ReportDeliveryDto>(`/report-subscriptions/${id}/send-now`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/report-subscriptions/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const resubscribe = useMutation({
    mutationFn: (id: string) => api(`/report-subscriptions/${id}/resubscribe`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  if (list.isLoading) return <LoadingState />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const schedule = (s: ReportSubscriptionDto) =>
    s.frequency === 'DAILY'
      ? t('integrations:schedule.daily', { time: s.time })
      : s.frequency === 'WEEKLY'
        ? t('integrations:schedule.weekly', {
            day: t(`integrations:weekdays.${s.weekday}`),
            time: s.time,
          })
        : t('integrations:schedule.monthly', { day: s.monthDay, time: s.time });

  return (
    <>
      <PageHeader
        title={t('integrations:subscriptions.title')}
        subtitle={t('integrations:subscriptions.subtitle')}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t('integrations:subscriptions.create')}
          </Button>
        }
      />
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Table<ReportSubscriptionDto>
          rowKey="id"
          dataSource={list.data}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{ emptyText: t('integrations:subscriptions.empty') }}
          columns={[
            {
              title: t('integrations:subscriptions.name'),
              render: (_, s) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>
                    <MailOutlined /> {s.name}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {t(`integrations:reports.${s.report}`)}
                  </Typography.Text>
                </Space>
              ),
            },
            { title: t('integrations:subscriptions.schedule'), render: (_, s) => schedule(s) },
            {
              title: t('integrations:subscriptions.format'),
              render: (_, s) => t(`integrations:formats.${s.format}`),
            },
            {
              title: t('integrations:subscriptions.audience'),
              render: (_, s) => (
                <Space direction="vertical" size={0}>
                  {t(`integrations:audience.${s.audience}`)}
                  {s.owner && <Typography.Text type="secondary">{loc(s.owner)}</Typography.Text>}
                </Space>
              ),
            },
            {
              title: t('integrations:subscriptions.nextRun'),
              render: (_, s) =>
                s.unsubscribed ? (
                  <Tag>{t('integrations:subscriptions.unsubscribedTag')}</Tag>
                ) : s.active ? (
                  formatDate(s.nextRunAt)
                ) : (
                  <Tag>{t('integrations:webhooks.off')}</Tag>
                ),
            },
            {
              title: t('actions'),
              render: (_, s) => (
                <Space wrap size={4}>
                  <Button
                    size="small"
                    icon={<SendOutlined />}
                    loading={sendNow.isPending && sendNow.variables === s.id}
                    onClick={() =>
                      sendNow.mutate(s.id, {
                        onSuccess: (d) =>
                          d.status === 'SENT'
                            ? message.success(t('integrations:subscriptions.sent'))
                            : message.warning(
                                t(`integrations:deliveryErrors.${d.error}`, {
                                  defaultValue: d.error ?? '',
                                }),
                              ),
                        onError: (err) => message.error(errorMessage(err)),
                      })
                    }
                  >
                    {t('integrations:subscriptions.sendNow')}
                  </Button>
                  <Button size="small" onClick={() => setLogOf(s)}>
                    {t('integrations:webhooks.log')}
                  </Button>
                  {s.canEdit && (
                    <>
                      <Button
                        size="small"
                        onClick={() => {
                          setEditing(s);
                          setFormOpen(true);
                        }}
                      >
                        {t('edit')}
                      </Button>
                      <Popconfirm
                        title={t('integrations:subscriptions.deleteConfirm')}
                        okButtonProps={{ danger: true }}
                        onConfirm={() =>
                          remove.mutate(s.id, {
                            onError: (err) => message.error(errorMessage(err)),
                          })
                        }
                      >
                        <Button size="small" danger>
                          {t('delete')}
                        </Button>
                      </Popconfirm>
                    </>
                  )}
                  {s.unsubscribed && (
                    <Button size="small" onClick={() => resubscribe.mutate(s.id)}>
                      {t('integrations:subscriptions.resubscribe')}
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
        {can(PERMISSIONS.SETTINGS_MANAGE) && <ReportSettingsCard />}
      </Space>
      <SubscriptionForm open={formOpen} editing={editing} onClose={() => setFormOpen(false)} />
      <DeliveriesDrawer sub={logOf} onClose={() => setLogOf(null)} />
    </>
  );
}
