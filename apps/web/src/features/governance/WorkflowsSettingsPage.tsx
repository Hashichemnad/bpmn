import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Card,
  Col,
  Drawer,
  Form,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  PROCESS_CATEGORIES,
  type GovernanceSettingsInput,
  type WorkflowDto,
} from '@processhub/shared';
import {
  useDeleteWorkflow,
  useGovernanceSettings,
  useSaveGovernanceSettings,
  useSaveWorkflow,
  useSetSpaceWorkflow,
  useWorkflows,
} from '@/api/governance';
import { useSpaces } from '@/api/docs';
import { PageHeader } from '@/components/PageHeader';
import { BilingualFields } from '@/components/BilingualFields';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { WorkflowSummary } from './WorkflowSummary';
import { WorkflowStepsEditor } from './WorkflowStepsEditor';
import { knownUsers, workflowToForm, type WorkflowFormValues } from './workflow-form';

function WorkflowDrawer({
  workflow,
  onClose,
}: {
  workflow: WorkflowDto | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const save = useSaveWorkflow();
  const [form] = Form.useForm<WorkflowFormValues>();
  const submit = async () => {
    const values = await form.validateFields();
    try {
      await save.mutateAsync({ id: workflow?.id, body: values });
      message.success(t('saved'));
      onClose();
    } catch (err) {
      message.error(errorMessage(err));
    }
  };
  return (
    <Drawer
      open
      width={720}
      title={workflow ? t('governance:workflows.edit') : t('governance:workflows.new')}
      onClose={onClose}
      extra={
        <Button type="primary" loading={save.isPending} onClick={() => void submit()}>
          {t('save')}
        </Button>
      }
    >
      <Form form={form} layout="vertical" initialValues={workflowToForm(workflow)}>
        <BilingualFields description />
        <Form.Item
          name="autoPublish"
          valuePropName="checked"
          label={t('governance:workflows.autoPublish')}
          extra={t('governance:workflows.autoPublishHint')}
        >
          <Switch />
        </Form.Item>
        <Typography.Title level={5}>{t('governance:workflows.steps')}</Typography.Title>
        <Typography.Paragraph type="secondary">
          {t('governance:workflows.stepsHint')}
        </Typography.Paragraph>
        <WorkflowStepsEditor known={knownUsers(workflow)} />
      </Form>
    </Drawer>
  );
}

/** Approval workflows, governance defaults (review interval, reminders) and space defaults. */
export function WorkflowsSettingsPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const workflows = useWorkflows();
  const settings = useGovernanceSettings();
  const saveSettings = useSaveGovernanceSettings();
  const remove = useDeleteWorkflow();
  const spaces = useSpaces();
  const setSpaceWorkflow = useSetSpaceWorkflow();
  const [editing, setEditing] = useState<WorkflowDto | null | 'new'>(null);
  const [form] = Form.useForm<GovernanceSettingsInput>();

  useEffect(() => {
    // '' stands for "none / use the default" in the selects.
    if (settings.data) {
      const c = settings.data.categoryWorkflows;
      form.setFieldsValue({
        ...settings.data,
        defaultWorkflowId: settings.data.defaultWorkflowId ?? '',
        categoryWorkflows: {
          MANAGEMENT: c.MANAGEMENT ?? '',
          CORE: c.CORE ?? '',
          SUPPORT: c.SUPPORT ?? '',
        },
      } as unknown as GovernanceSettingsInput);
    }
  }, [settings.data, form]);

  if (workflows.isLoading || settings.isLoading) return <LoadingState />;
  if (workflows.isError)
    return <ErrorState error={workflows.error} onRetry={() => void workflows.refetch()} />;

  const options = [
    { value: '', label: t('governance:workflows.noneOption') },
    ...(workflows.data ?? []).map((w) => ({ value: w.id, label: loc(w) })),
  ];

  const saveDefaults = async (values: GovernanceSettingsInput) => {
    try {
      await saveSettings.mutateAsync({
        ...values,
        defaultWorkflowId: values.defaultWorkflowId || null,
        categoryWorkflows: {
          MANAGEMENT: values.categoryWorkflows?.MANAGEMENT || null,
          CORE: values.categoryWorkflows?.CORE || null,
          SUPPORT: values.categoryWorkflows?.SUPPORT || null,
        },
      });
      message.success(t('saved'));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title={t('governance:workflows.title')}
        subtitle={t('governance:workflows.subtitle')}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            {t('governance:workflows.new')}
          </Button>
        }
      />
      <Card title={t('governance:workflows.templates')}>
        <Table
          rowKey="id"
          pagination={false}
          dataSource={workflows.data}
          scroll={{ x: 760 }}
          columns={[
            {
              title: t('fields.name'),
              key: 'name',
              width: 260,
              render: (_, w) => (
                <>
                  <Typography.Text strong>{loc(w)}</Typography.Text>
                  <div className="ph-muted" style={{ fontSize: 12 }}>
                    {loc(w, 'description')}
                  </div>
                </>
              ),
            },
            {
              title: t('governance:workflows.steps'),
              key: 'steps',
              render: (_, w) => <WorkflowSummary workflow={w} />,
            },
            {
              title: t('governance:workflows.usage'),
              key: 'usage',
              width: 110,
              render: (_, w) => <Tag>{w.usage}</Tag>,
            },
            {
              key: 'actions',
              width: 100,
              render: (_, w) => (
                <>
                  <Button
                    type="text"
                    icon={<EditOutlined />}
                    aria-label={t('edit')}
                    onClick={() => setEditing(w)}
                  />
                  <Popconfirm
                    title={t('governance:workflows.deleteConfirm')}
                    okText={t('delete')}
                    cancelText={t('cancel')}
                    okButtonProps={{ danger: true }}
                    disabled={w.usage > 0}
                    onConfirm={() =>
                      remove.mutate(w.id, { onError: (e) => message.error(errorMessage(e)) })
                    }
                  >
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      disabled={w.usage > 0}
                      aria-label={t('delete')}
                    />
                  </Popconfirm>
                </>
              ),
            },
          ]}
        />
      </Card>

      <Row gutter={[24, 24]} style={{ marginBlockStart: 24 }}>
        <Col xs={24} xl={12}>
          <Card title={t('governance:settings.title')}>
            <Form form={form} layout="vertical" onFinish={(v) => void saveDefaults(v)}>
              <Form.Item
                name="defaultWorkflowId"
                label={t('governance:settings.defaultWorkflow')}
                extra={t('governance:settings.defaultWorkflowHint')}
              >
                <Select options={options} />
              </Form.Item>
              {PROCESS_CATEGORIES.map((c) => (
                <Form.Item
                  key={c}
                  name={['categoryWorkflows', c]}
                  label={t('governance:settings.categoryWorkflow', {
                    category: t(`processes:category.${c}`),
                  })}
                >
                  <Select
                    options={[
                      {
                        value: null as unknown as string,
                        label: t('governance:settings.useDefault'),
                      },
                      ...options.slice(1),
                    ]}
                  />
                </Form.Item>
              ))}
              <Row gutter={12}>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="reviewIntervalMonths"
                    label={t('governance:settings.interval')}
                    rules={[{ required: true }]}
                  >
                    <InputNumber
                      min={1}
                      max={60}
                      suffix={t('governance:settings.months')}
                      style={{ inlineSize: '100%' }}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="reminderDays"
                    label={t('governance:settings.reminder')}
                    rules={[{ required: true }]}
                  >
                    <InputNumber
                      min={0}
                      max={90}
                      suffix={t('governance:settings.days')}
                      style={{ inlineSize: '100%' }}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="reviewDueDays"
                    label={t('governance:settings.dueDays')}
                    rules={[{ required: true }]}
                  >
                    <InputNumber
                      min={1}
                      max={60}
                      suffix={t('governance:settings.days')}
                      style={{ inlineSize: '100%' }}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Button type="primary" htmlType="submit" loading={saveSettings.isPending}>
                {t('save')}
              </Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title={t('governance:settings.spaces')}>
            <Typography.Paragraph type="secondary">
              {t('governance:settings.spacesHint')}
            </Typography.Paragraph>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              loading={spaces.isLoading}
              dataSource={spaces.data}
              columns={[
                {
                  title: t('governance:settings.space'),
                  key: 'name',
                  render: (_, s) => `${s.key} · ${loc(s)}`,
                },
                {
                  title: t('governance:panel.workflow'),
                  key: 'wf',
                  width: 260,
                  render: (_, s) => (
                    <Select
                      size="small"
                      style={{ inlineSize: '100%' }}
                      value={s.workflowId ?? ''}
                      options={[
                        {
                          value: null as unknown as string,
                          label: t('governance:settings.useDefault'),
                        },
                        ...options.slice(1),
                      ]}
                      onChange={(workflowId: string) =>
                        setSpaceWorkflow.mutate(
                          { spaceId: s.id, workflowId: workflowId || null },
                          {
                            onSuccess: () => {
                              message.success(t('saved'));
                              void spaces.refetch();
                            },
                            onError: (e) => message.error(errorMessage(e)),
                          },
                        )
                      }
                    />
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
      {editing && (
        <WorkflowDrawer
          workflow={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
