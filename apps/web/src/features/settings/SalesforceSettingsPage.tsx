import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Col,
  Collapse,
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
import {
  ApiOutlined,
  CloudSyncOutlined,
  DeleteOutlined,
  EyeOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  OBJECTIVE_SOURCES,
  PERMISSIONS,
  SALESFORCE_SCHEDULES,
  type SalesforceChange,
  type SalesforceFieldDto,
  type SalesforceMapping,
  type SalesforcePreviewDto,
  type SalesforceRunDto,
  type SalesforceSettingsInput,
} from '@processhub/shared';
import {
  useDescribeSalesforce,
  usePreviewSalesforce,
  useRunSalesforce,
  useSalesforceRuns,
  useSalesforceSettings,
  useSaveSalesforce,
  useTestSalesforce,
} from '@/api/salesforce';
import { useObjectives } from '@/api/kpi';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';

type Group = keyof SalesforceMapping;
/** Field rows of each mapping group (key → label key); value maps are edited as text. */
const GROUPS: Record<Group, string[]> = {
  objectives: ['code', 'nameEn', 'nameAr', 'descriptionEn', 'descriptionAr'],
  kpis: [
    'code',
    'nameEn',
    'nameAr',
    'descriptionEn',
    'descriptionAr',
    'unit',
    'direction',
    'frequency',
    'target',
    'status',
    'objective',
  ],
  measures: ['kpi', 'year', 'target', 'value'],
  results: [
    'kpi',
    'year',
    'period',
    'value',
    'target',
    'comment',
    'causality',
    'correctiveActions',
    'approved',
  ],
};
const VALUE_MAPS: Record<string, string[]> = {
  kpis: ['directionValues', 'frequencyValues', 'statusValues'],
  results: ['periodValues'],
};
const toText = (m: Record<string, string> | undefined) =>
  Object.entries(m ?? {})
    .map(([k, v]) => `${k} = ${v}`)
    .join('\n');
const fromText = (s: string | undefined) =>
  Object.fromEntries(
    (s ?? '')
      .split('\n')
      .map((l) => l.split('='))
      .filter((p) => p.length >= 2 && p[0].trim())
      .map(([k, ...v]) => [k.trim(), v.join('=').trim()]),
  );

/**
 * Settings → Integrations → Salesforce (Super Admin): connection with a read-only integration
 * user, field mapping of the PMS KPI objects, preview of the differences, sync and sync log.
 * Performance Officers (`kpi.sync`, D-118) see the settings read-only, preview and run the sync.
 */
export function SalesforceSettingsPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const formatDate = useFormatDate();
  const loc = useLocalized();
  const { can } = useAuth();
  const canConfigure = can(PERMISSIONS.SETTINGS_MANAGE);
  const objectives = useObjectives(can(PERMISSIONS.KPI_READ));
  const settings = useSalesforceSettings();
  const runs = useSalesforceRuns();
  const save = useSaveSalesforce();
  const test = useTestSalesforce();
  const describe = useDescribeSalesforce();
  const preview = usePreviewSalesforce();
  const run = useRunSalesforce();
  const [form] = Form.useForm();
  const [fields, setFields] = useState<Record<string, SalesforceFieldDto[]>>({});
  const flow = Form.useWatch('authFlow', form) as string | undefined;
  const objectiveSource = Form.useWatch(['mapping', 'objectives', 'source'], form) as
    string | undefined;

  useEffect(() => {
    if (!settings.data) return;
    const {
      hasClientSecret: _a,
      hasPrivateKey: _b,
      encryptionReady: _c,
      lastSync: _d,
      mapping,
      ...rest
    } = settings.data;
    const maps: Record<string, string> = {};
    for (const [g, keys] of Object.entries(VALUE_MAPS))
      for (const k of keys)
        maps[`${g}.${k}`] = toText(
          (mapping[g as Group] as unknown as Record<string, Record<string, string>>)[k],
        );
    const valueLinks = Object.entries(mapping.objectives.valueLinks ?? {}).map(
      ([value, objectiveId]) => ({ value, objectiveId }),
    );
    form.setFieldsValue({
      ...rest,
      mapping,
      maps,
      valueLinks,
      clientSecret: '',
      privateKey: '',
    });
  }, [settings.data, form]);

  if (settings.isLoading) return <LoadingState />;
  if (settings.isError || !settings.data)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  const s = settings.data;

  const values = async (): Promise<SalesforceSettingsInput> => {
    const v = await form.validateFields();
    const mapping = structuredClone(v.mapping) as SalesforceMapping;
    for (const [g, keys] of Object.entries(VALUE_MAPS))
      for (const k of keys)
        (mapping[g as Group] as unknown as Record<string, Record<string, string>>)[k] = fromText(
          v.maps?.[`${g}.${k}`],
        );
    mapping.objectives.valueLinks = Object.fromEntries(
      ((v.valueLinks ?? []) as { value?: string; objectiveId?: string }[])
        .filter((l) => l.value?.trim() && l.objectiveId)
        .map((l) => [l.value!.trim(), l.objectiveId!]),
    );
    return {
      ...v,
      maps: undefined,
      valueLinks: undefined,
      mapping,
      clientSecret: v.clientSecret?.trim() || undefined,
      privateKey: v.privateKey?.trim() || undefined,
    } as SalesforceSettingsInput;
  };
  const submit = async () => {
    try {
      await save.mutateAsync(await values());
      form.setFieldsValue({ clientSecret: '', privateKey: '' });
      message.success(t('saved'));
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(errorMessage(err));
    }
  };
  const loadFields = (object: string) => {
    if (!object) return;
    describe.mutate(object, {
      onSuccess: (f) => setFields((cur) => ({ ...cur, [object]: f })),
      onError: (err) => message.error(errorMessage(err)),
    });
  };
  const mappingGroup = (group: Group) => {
    const object = (form.getFieldValue(['mapping', group, 'object']) as string) || '';
    const options = (fields[object] ?? []).map((f) => ({
      value: f.name,
      label: `${f.name} · ${f.label}`,
    }));
    return (
      <>
        <Row gutter={12}>
          {group !== 'objectives' || objectiveSource === 'OBJECT' ? (
            <Col xs={24} md={12}>
              <Form.Item name={['mapping', group, 'object']} label={t('admin:salesforce.object')}>
                <Input
                  dir="ltr"
                  addonAfter={
                    <Typography.Link
                      onClick={() => loadFields(form.getFieldValue(['mapping', group, 'object']))}
                    >
                      {canConfigure ? t('admin:salesforce.loadFields') : null}
                    </Typography.Link>
                  }
                />
              </Form.Item>
            </Col>
          ) : null}
        </Row>
        {(group !== 'objectives' || objectiveSource === 'OBJECT') && (
          <Row gutter={12}>
            {GROUPS[group].map((f) => (
              <Col xs={24} md={8} key={f}>
                <Form.Item
                  name={['mapping', group, f]}
                  label={t(`admin:salesforce.fields.${group}.${f}`)}
                >
                  <AutoComplete options={options} filterOption allowClear>
                    <Input dir="ltr" />
                  </AutoComplete>
                </Form.Item>
              </Col>
            ))}
          </Row>
        )}
        {(VALUE_MAPS[group] ?? []).length > 0 && (
          <Row gutter={12}>
            {VALUE_MAPS[group].map((k) => (
              <Col xs={24} md={8} key={k}>
                <Form.Item
                  name={['maps', `${group}.${k}`]}
                  label={t(`admin:salesforce.valueMaps.${k}`)}
                  extra={t('admin:salesforce.valueMapHint')}
                >
                  <Input.TextArea dir="ltr" rows={4} />
                </Form.Item>
              </Col>
            ))}
          </Row>
        )}
      </>
    );
  };

  // Picklist values linked to existing ProcessHub objectives; other values become objectives.
  const valueLinksEditor = (
    <Form.Item
      label={t('admin:salesforce.valueLinks')}
      extra={t('admin:salesforce.valueLinksHint')}
    >
      <Form.List name="valueLinks">
        {(items, { add, remove }) => (
          <>
            {items.map((item) => (
              <Space key={item.key} align="baseline" wrap>
                <Form.Item name={[item.name, 'value']} rules={[{ required: true, message: '' }]}>
                  <Input dir="ltr" placeholder={t('admin:salesforce.picklistValue')} />
                </Form.Item>
                <Form.Item
                  name={[item.name, 'objectiveId']}
                  rules={[{ required: true, message: '' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    style={{ minWidth: 260 }}
                    placeholder={t('admin:salesforce.objective')}
                    options={(objectives.data ?? []).map((o) => ({
                      value: o.id,
                      label: [o.code, loc(o)].filter(Boolean).join(' · '),
                    }))}
                  />
                </Form.Item>
                <Button
                  type="text"
                  icon={<DeleteOutlined />}
                  aria-label={t('delete')}
                  onClick={() => remove(item.name)}
                />
              </Space>
            ))}
            <Button icon={<PlusOutlined />} onClick={() => add()}>
              {t('admin:salesforce.addValueLink')}
            </Button>
          </>
        )}
      </Form.List>
    </Form.Item>
  );

  const changeList = (list: SalesforceChange[]) =>
    list.length ? (
      <ul style={{ margin: 0, paddingInlineStart: 18 }}>
        {list.slice(0, 15).map((c) => (
          <li key={`${c.salesforceId}|${c.name}`}>
            <span dir="ltr">{[c.code, c.name].filter(Boolean).join(' · ')}</span>
            {c.changes &&
              Object.entries(c.changes).map(([k, v]) => (
                <Typography.Text
                  key={k}
                  type="secondary"
                  style={{ display: 'block', fontSize: 12 }}
                  dir="ltr"
                >
                  {k}: {String(v.from ?? '—')} → {String(v.to ?? '—')}
                </Typography.Text>
              ))}
          </li>
        ))}
      </ul>
    ) : null;
  const p: SalesforcePreviewDto | undefined = preview.data;

  return (
    <>
      <PageHeader
        crumbs={[{ title: t('admin:settings.title'), to: '/settings' }, { title: 'Salesforce' }]}
        title={t('admin:salesforce.title')}
        subtitle={t('admin:salesforce.subtitle')}
        extra={
          canConfigure ? (
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={save.isPending}
              onClick={() => void submit()}
            >
              {t('save')}
            </Button>
          ) : null
        }
      />
      {!canConfigure && (
        <Alert
          type="info"
          showIcon
          style={{ marginBlockEnd: 16 }}
          message={t('admin:salesforce.syncOnly')}
          data-testid="salesforce-sync-only"
        />
      )}
      {!s.encryptionReady && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBlockEnd: 16 }}
          message={t('admin:salesforce.noKey')}
        />
      )}
      <Form form={form} layout="vertical" data-testid="salesforce-form" disabled={!canConfigure}>
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card title={t('admin:salesforce.connection')}>
              <Form.Item
                name="enabled"
                label={t('admin:salesforce.enabled')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                name="instanceUrl"
                label={t('admin:salesforce.instanceUrl')}
                extra="https://example.my.salesforce.com"
              >
                <Input dir="ltr" />
              </Form.Item>
              <Form.Item name="authFlow" label={t('admin:salesforce.authFlow')}>
                <Radio.Group>
                  <Radio value="CLIENT_CREDENTIALS">
                    {t('admin:salesforce.flows.CLIENT_CREDENTIALS')}
                  </Radio>
                  <Radio value="JWT_BEARER">{t('admin:salesforce.flows.JWT_BEARER')}</Radio>
                </Radio.Group>
              </Form.Item>
              <Form.Item name="clientId" label={t('admin:salesforce.clientId')}>
                <Input dir="ltr" autoComplete="off" />
              </Form.Item>
              {flow === 'JWT_BEARER' ? (
                <>
                  <Form.Item name="loginUrl" label={t('admin:salesforce.loginUrl')}>
                    <Input dir="ltr" />
                  </Form.Item>
                  <Form.Item name="username" label={t('admin:salesforce.username')}>
                    <Input dir="ltr" autoComplete="off" />
                  </Form.Item>
                  <Form.Item
                    name="privateKey"
                    label={t('admin:salesforce.privateKey')}
                    extra={s.hasPrivateKey ? t('admin:salesforce.secretStored') : undefined}
                  >
                    <Input.TextArea
                      dir="ltr"
                      rows={3}
                      autoComplete="off"
                      placeholder="-----BEGIN PRIVATE KEY-----"
                    />
                  </Form.Item>
                </>
              ) : (
                <Form.Item
                  name="clientSecret"
                  label={t('admin:salesforce.clientSecret')}
                  extra={s.hasClientSecret ? t('admin:salesforce.secretStored') : undefined}
                >
                  <Input.Password dir="ltr" autoComplete="new-password" />
                </Form.Item>
              )}
              <Form.Item name="apiVersion" label={t('admin:salesforce.apiVersion')}>
                <Input dir="ltr" style={{ width: 120 }} />
              </Form.Item>
              <Space wrap>
                {canConfigure && (
                  <Button
                    icon={<ApiOutlined />}
                    loading={test.isPending}
                    onClick={() =>
                      test.mutate(undefined, {
                        onSuccess: (r) =>
                          r.ok
                            ? message.success(t('admin:salesforce.testOk'))
                            : message.error(r.error ?? ''),
                        onError: (err) => message.error(errorMessage(err)),
                      })
                    }
                  >
                    {t('admin:salesforce.test')}
                  </Button>
                )}
                {test.data?.ok && (
                  <Typography.Text type="secondary" data-testid="salesforce-test">
                    {test.data.userName} · {test.data.organizationId}{' '}
                    {Object.entries(test.data.objects ?? {}).map(([o, found]) => (
                      <Tag key={o} color={found ? 'green' : 'red'}>
                        {o}
                      </Tag>
                    ))}
                  </Typography.Text>
                )}
              </Space>
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card title={t('admin:salesforce.scheduleTitle')}>
              <Row gutter={12}>
                <Col xs={12}>
                  <Form.Item name="schedule" label={t('admin:salesforce.schedule')}>
                    <Select
                      options={SALESFORCE_SCHEDULES.map((v) => ({
                        value: v,
                        label: t(`admin:salesforce.schedules.${v}`),
                      }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={12}>
                  <Form.Item name="scheduleHour" label={t('admin:salesforce.hour')}>
                    <InputNumber min={0} max={23} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item
                name="syncValues"
                label={t('admin:salesforce.syncValues')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                name="includeUnapproved"
                label={t('admin:salesforce.includeUnapproved')}
                extra={t('admin:salesforce.includeUnapprovedHint')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
              <Alert type="info" showIcon message={t('admin:salesforce.readOnly')} />
            </Card>
            <Card title={t('admin:salesforce.syncTitle')} style={{ marginBlockStart: 16 }}>
              <Space wrap style={{ marginBlockEnd: 12 }}>
                <Button
                  icon={<EyeOutlined />}
                  disabled={!s.enabled}
                  loading={preview.isPending}
                  onClick={() =>
                    preview.mutate(undefined, {
                      onError: (err) => message.error(errorMessage(err)),
                    })
                  }
                >
                  {t('admin:salesforce.preview')}
                </Button>
                <Button
                  type="primary"
                  icon={<CloudSyncOutlined />}
                  disabled={!s.enabled}
                  loading={run.isPending}
                  onClick={() =>
                    run.mutate(undefined, {
                      onSuccess: (r) => {
                        if (r.status === 'SUCCESS') message.success(t('admin:salesforce.synced'));
                        else message.error(r.error ?? t('admin:salesforce.failed'));
                        preview.reset();
                      },
                      onError: (err) => message.error(errorMessage(err)),
                    })
                  }
                >
                  {t('admin:salesforce.syncNow')}
                </Button>
              </Space>
              {p && (
                <Descriptions size="small" column={1} bordered data-testid="salesforce-preview">
                  <Descriptions.Item label={t('admin:salesforce.objectives')}>
                    {t('admin:salesforce.counts', {
                      create: p.objectives.create.length,
                      update: p.objectives.update.length,
                      unchanged: p.objectives.unchanged,
                    })}
                    {changeList([...p.objectives.create, ...p.objectives.update])}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('admin:salesforce.kpis')}>
                    {t('admin:salesforce.counts', {
                      create: p.kpis.create.length,
                      update: p.kpis.update.length,
                      unchanged: p.kpis.unchanged,
                    })}
                    {changeList([...p.kpis.create, ...p.kpis.update])}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('admin:salesforce.values')}>
                    {t('admin:salesforce.counts', p.measurements)}
                    {changeList(p.measurements.samples)}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('admin:salesforce.warnings')}>
                    {p.warnings.length
                      ? p.warnings.slice(0, 10).map((w) => (
                          <Typography.Text
                            key={`${w.record}${w.code}`}
                            style={{ display: 'block', fontSize: 12 }}
                            dir="ltr"
                          >
                            {w.record}: {w.code} {w.detail ?? ''}
                          </Typography.Text>
                        ))
                      : '—'}
                  </Descriptions.Item>
                </Descriptions>
              )}
            </Card>
          </Col>
          <Col span={24}>
            <Card
              title={t('admin:salesforce.mapping')}
              extra={
                <Typography.Text type="secondary">
                  {t('admin:salesforce.mappingHint')}
                </Typography.Text>
              }
            >
              <Collapse
                defaultActiveKey={['kpis']}
                items={[
                  {
                    key: 'objectives',
                    label: t('admin:salesforce.objectives'),
                    forceRender: true,
                    children: (
                      <>
                        <Form.Item
                          name={['mapping', 'objectives', 'source']}
                          label={t('admin:salesforce.objectiveSource')}
                        >
                          <Radio.Group>
                            {OBJECTIVE_SOURCES.map((v) => (
                              <Radio key={v} value={v}>
                                {t(`admin:salesforce.objectiveSources.${v}`)}
                              </Radio>
                            ))}
                          </Radio.Group>
                        </Form.Item>
                        {mappingGroup('objectives')}
                        {objectiveSource === 'KPI_FIELD' && valueLinksEditor}
                      </>
                    ),
                  },
                  {
                    key: 'kpis',
                    label: t('admin:salesforce.kpis'),
                    forceRender: true,
                    children: mappingGroup('kpis'),
                  },
                  {
                    key: 'measures',
                    label: t('admin:salesforce.measures'),
                    forceRender: true,
                    children: mappingGroup('measures'),
                  },
                  {
                    key: 'results',
                    label: t('admin:salesforce.values'),
                    forceRender: true,
                    children: mappingGroup('results'),
                  },
                ]}
              />
            </Card>
          </Col>
          <Col span={24}>
            <Card title={t('admin:salesforce.log')}>
              <Table<SalesforceRunDto>
                size="small"
                rowKey="id"
                data-testid="salesforce-runs"
                dataSource={runs.data ?? []}
                pagination={false}
                columns={[
                  {
                    title: t('admin:salesforce.started'),
                    key: 's',
                    render: (_, r) => formatDate(r.startedAt),
                  },
                  {
                    title: t('admin:salesforce.trigger'),
                    key: 't',
                    render: (_, r) => t(`admin:salesforce.triggers.${r.trigger}`),
                  },
                  {
                    title: t('admin:salesforce.status'),
                    key: 'st',
                    render: (_, r) => (
                      <Tag
                        color={
                          r.status === 'SUCCESS' ? 'green' : r.status === 'FAILED' ? 'red' : 'blue'
                        }
                      >
                        {t(`admin:salesforce.statuses.${r.status}`)}
                      </Tag>
                    ),
                  },
                  {
                    title: t('admin:salesforce.result'),
                    key: 'c',
                    render: (_, r) =>
                      r.error ? (
                        <Typography.Text type="danger">{r.error}</Typography.Text>
                      ) : (
                        <span dir="ltr">
                          {Object.entries(r.counts)
                            .filter(([, n]) => n)
                            .map(([k, n]) => `${k}: ${n}`)
                            .join(' · ') || '—'}
                          {r.warnings ? ` · ${t('admin:salesforce.warnings')}: ${r.warnings}` : ''}
                        </span>
                      ),
                  },
                  {
                    title: t('admin:salesforce.by'),
                    key: 'u',
                    render: (_, r) =>
                      r.user ? loc(r.user) || r.user.email : t('admin:salesforce.systemActor'),
                  },
                  {
                    title: t('admin:salesforce.configuredBy'),
                    key: 'cb',
                    render: (_, r) =>
                      r.configuredBy ? loc(r.configuredBy) || r.configuredBy.email : '—',
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      </Form>
    </>
  );
}
