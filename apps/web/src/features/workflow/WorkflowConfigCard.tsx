import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CloudUploadOutlined, ExperimentOutlined, LineChartOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  PERMISSIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_KEYS,
  type ExecIssue,
  type UserRef,
  type WorkflowConfigInput,
} from '@processhub/shared';
import { ApiError } from '@/api/client';
import {
  checkExecutableOnServer,
  searchWorkflowUsers,
  useDeployWorkflow,
  useSaveWorkflowConfig,
  useWorkflowConfig,
  useWorkflowDepartments,
} from '@/api/workflow';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/app/LocaleProvider';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { ExecIssueList } from './ExecIssueList';
import { useUserNames } from './form-utils';

function UsersSelect({
  value = [],
  onChange,
  disabled,
}: {
  value?: string[];
  onChange?: (v: string[]) => void;
  disabled?: boolean;
}) {
  const loc = useLocalized();
  const [q, setQ] = useState('');
  const found = useQuery({
    queryKey: ['workflow', 'user-search', q],
    queryFn: () => searchWorkflowUsers(q),
    enabled: q.length >= 2,
  });
  const known = useUserNames(value);
  const options = useMemo(() => {
    const m = new Map<string, UserRef>();
    for (const u of [...(known.data ?? []), ...(found.data ?? [])]) m.set(u.id, u);
    return [...m.values()].map((u) => ({ value: u.id, label: loc(u) || u.email }));
  }, [known.data, found.data, loc]);
  return (
    <Select
      mode="multiple"
      value={value}
      onChange={onChange}
      onSearch={setQ}
      filterOption={false}
      options={options}
      disabled={disabled}
    />
  );
}

/**
 * Execution settings of a process (Phase 5.2 step 1): executable on / off, case number prefix, start
 * rights, withdraw, monitors, form data retention, live event log; deployment of the published version.
 */
export function WorkflowConfigCard({ processId }: { processId: string }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { can } = useAuth();
  const { locale } = useLocale();
  const errorMessage = useErrorMessage();
  const formatDate = useFormatDate();
  const config = useWorkflowConfig(processId);
  const save = useSaveWorkflowConfig(processId);
  const deploy = useDeployWorkflow(processId);
  const departments = useWorkflowDepartments();
  const [form] = Form.useForm<
    WorkflowConfigInput & {
      keepForever: boolean;
      reminderHours: number | null;
      escalationHours: number | null;
    }
  >();
  const [issues, setIssues] = useState<ExecIssue[] | null>(null);
  const [checking, setChecking] = useState(false);
  const startMode = Form.useWatch('startMode', form);
  const keepForever = Form.useWatch('keepForever', form);
  const c = config.data;
  useEffect(() => {
    if (c)
      form.setFieldsValue({
        ...c,
        keepForever: c.retentionDays === null,
        retentionDays: c.retentionDays ?? 730,
        reminderHours: c.reminderMinutesBefore === null ? null : c.reminderMinutesBefore / 60,
        escalationHours: c.escalationDelayMinutes === null ? null : c.escalationDelayMinutes / 60,
      });
  }, [c, form]);
  if (!c) return <Card loading />;
  const disabled = !c.canDesign;

  const onSave = async () => {
    const v = await form.validateFields();
    const { keepForever: keep, reminderHours, escalationHours, ...rest } = v;
    const minutes = (h: number | null | undefined) =>
      h === null || h === undefined ? null : Math.round(h * 60);
    try {
      await save.mutateAsync({
        ...rest,
        retentionDays: keep ? null : (rest.retentionDays ?? null),
        reminderMinutesBefore: minutes(reminderHours),
        escalationDelayMinutes: minutes(escalationHours),
      });
      message.success(t('workflow:config.saved'));
    } catch (e) {
      message.error(errorMessage(e));
    }
  };
  const runCheck = async () => {
    setChecking(true);
    try {
      const r = await checkExecutableOnServer(processId, { source: 'published' });
      setIssues(r.issues);
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };
  const onDeploy = async () => {
    try {
      await deploy.mutateAsync();
      setIssues(null);
      message.success(t('workflow:config.deployedOk'));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EXECUTABLE_CHECK_FAILED' && Array.isArray(e.details))
        setIssues(e.details as ExecIssue[]);
      message.error(errorMessage(e));
    }
  };

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={14}>
        <Card
          title={t('workflow:config.title')}
          extra={
            !disabled && (
              <Button
                type="primary"
                onClick={() => void onSave()}
                loading={save.isPending}
                data-testid="wf-config-save"
              >
                {t('save')}
              </Button>
            )
          }
        >
          <Form form={form} layout="vertical" disabled={disabled}>
            <Form.Item
              name="enabled"
              valuePropName="checked"
              label={t('workflow:config.enabled')}
              extra={t('workflow:config.enabledHint')}
            >
              <Switch data-testid="wf-enabled" />
            </Form.Item>
            <Form.Item
              name="casePrefix"
              label={t('workflow:config.prefix')}
              extra={t('workflow:config.prefixHint', {
                example: `${form.getFieldValue('casePrefix') ?? c.casePrefix}-${new Date().getFullYear()}-00012`,
              })}
              rules={[
                {
                  required: true,
                  pattern: /^[A-Z][A-Z0-9]{0,9}$/,
                  message: t('workflow:config.prefixRule'),
                },
              ]}
            >
              <Input dir="ltr" maxLength={10} style={{ maxWidth: 200 }} />
            </Form.Item>
            <Form.Item name="startMode" label={t('workflow:config.startRights')}>
              <Radio.Group
                options={(['ALL', 'RESTRICTED'] as const).map((m) => ({
                  value: m,
                  label: t(`workflow:config.startMode.${m}`),
                }))}
              />
            </Form.Item>
            {startMode === 'RESTRICTED' && (
              <>
                <Form.Item name="startRoles" label={t('workflow:config.startRoles')}>
                  <Select
                    mode="multiple"
                    options={SYSTEM_ROLE_KEYS.map((k) => ({
                      value: k,
                      label: locale === 'ar' ? SYSTEM_ROLES[k].nameAr : SYSTEM_ROLES[k].nameEn,
                    }))}
                  />
                </Form.Item>
                <Form.Item name="startDepartmentIds" label={t('workflow:config.startDepartments')}>
                  <Select
                    mode="multiple"
                    optionFilterProp="label"
                    options={(departments.data ?? []).map((d) => ({
                      value: d.id,
                      label:
                        (locale === 'ar' ? d.nameAr || d.nameEn : d.nameEn || d.nameAr) || d.id,
                    }))}
                  />
                </Form.Item>
              </>
            )}
            <Form.Item name="allowWithdraw" valuePropName="checked">
              <Checkbox>{t('workflow:config.allowWithdraw')}</Checkbox>
            </Form.Item>
            <Form.Item
              name="monitorUserIds"
              label={t('workflow:config.monitors')}
              extra={t('workflow:config.monitorsHint')}
            >
              <UsersSelect disabled={disabled} />
            </Form.Item>
            <Form.Item
              label={t('workflow:config.retention')}
              extra={t('workflow:config.retentionHint')}
            >
              <Space>
                <Form.Item name="keepForever" valuePropName="checked" noStyle>
                  <Checkbox>{t('workflow:config.keepForever')}</Checkbox>
                </Form.Item>
                {!keepForever && (
                  <Form.Item name="retentionDays" noStyle>
                    <InputNumber min={30} max={36500} addonAfter={t('workflow:config.days')} />
                  </Form.Item>
                )}
              </Space>
            </Form.Item>
            <Form.Item label={t('workflow:config.delays')} extra={t('workflow:config.delaysHint')}>
              <Space wrap>
                <Form.Item name="reminderHours" noStyle>
                  <InputNumber
                    min={0}
                    max={168}
                    step={0.5}
                    placeholder={t('workflow:config.default')}
                    addonBefore={t('workflow:config.reminder')}
                    addonAfter={t('workflow:settings.workingHours')}
                  />
                </Form.Item>
                <Form.Item name="escalationHours" noStyle>
                  <InputNumber
                    min={0}
                    max={168}
                    step={0.5}
                    placeholder={t('workflow:config.default')}
                    addonBefore={t('workflow:config.escalateAfter')}
                    addonAfter={t('workflow:settings.workingHours')}
                  />
                </Form.Item>
              </Space>
            </Form.Item>
            <Form.Item
              name="eventLog"
              valuePropName="checked"
              extra={t('workflow:config.eventLogHint')}
            >
              <Checkbox>{t('workflow:config.eventLog')}</Checkbox>
            </Form.Item>
            <Form.Item name="pseudonymiseLog" valuePropName="checked">
              <Checkbox>{t('workflow:config.pseudonymise')}</Checkbox>
            </Form.Item>
          </Form>
        </Card>
      </Col>
      <Col xs={24} xl={10}>
        <Card title={t('workflow:config.deployment')}>
          <Descriptions size="small" column={1}>
            <Descriptions.Item label={t('workflow:config.published')}>
              {c.publishedVersion ? (
                `v${c.publishedVersion}`
              ) : (
                <Tag>{t('workflow:config.notPublished')}</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('workflow:config.active')}>
              {c.activeDeployment ? (
                <Tag color="green">v{c.activeDeployment.versionNumber}</Tag>
              ) : (
                <Tag>{t('workflow:config.none')}</Tag>
              )}
            </Descriptions.Item>
          </Descriptions>
          {!c.enabled && (
            <Alert
              type="info"
              showIcon
              message={t('workflow:config.enableFirst')}
              style={{ marginBlock: 8 }}
            />
          )}
          <Space wrap style={{ marginBlock: 8 }}>
            <Button
              icon={<ExperimentOutlined />}
              onClick={() => void runCheck()}
              loading={checking}
              disabled={!c.publishedVersion}
            >
              {t('workflow:config.checkPublished')}
            </Button>
            {c.canDesign && !c.canDeploy && c.publishedVersion && (
              <Typography.Text type="secondary">
                {t('workflow:config.deployOwnerOnly')}
              </Typography.Text>
            )}
            {c.canDeploy && (
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                onClick={() => void onDeploy()}
                loading={deploy.isPending}
                disabled={c.activeDeployment?.versionNumber === c.publishedVersion}
                data-testid="wf-deploy"
              >
                {t('workflow:config.deploy', { version: c.publishedVersion })}
              </Button>
            )}
            {c.eventLogId && can(PERMISSIONS.MINING_READ) && (
              <Link to={`/mining/logs/${c.eventLogId}`}>
                <LineChartOutlined /> {t('workflow:config.openLog')}
              </Link>
            )}
          </Space>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            {t('workflow:config.pinningHint')}
          </Typography.Paragraph>
          {issues && issues.length === 0 && (
            <Alert type="success" showIcon message={t('workflow:check.ok')} />
          )}
          {issues && <ExecIssueList issues={issues} />}
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={c.deployments}
            style={{ marginBlockStart: 12 }}
            columns={[
              {
                title: t('workflow:config.version'),
                render: (_, d) => (
                  <Space>
                    v{d.versionNumber}
                    {d.active && <Tag color="green">{t('workflow:config.activeTag')}</Tag>}
                  </Space>
                ),
              },
              {
                title: t('workflow:config.deployedAt'),
                render: (_, d) => formatDate(d.deployedAt),
              },
              { title: t('workflow:config.runningCases'), dataIndex: 'runningCases' },
            ]}
          />
        </Card>
      </Col>
    </Row>
  );
}
