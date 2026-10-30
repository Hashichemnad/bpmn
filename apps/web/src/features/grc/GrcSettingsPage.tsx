import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Card,
  Checkbox,
  Col,
  ColorPicker,
  Input,
  InputNumber,
  Radio,
  Select,
  Switch,
  Row,
  Space,
  Table,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_GRC_SETTINGS,
  GRC_PORTAL_VISIBILITY,
  type GrcBand,
  type GrcSettings,
} from '@processhub/shared';
import { useGrcSettings, useSaveGrcSettings } from '@/api/grc';
import { useWorkflows } from '@/api/governance';
import { useLocalized } from '@/components/i18n-helpers';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage } from '@/components/i18n-helpers';
import { RiskMatrix } from './RiskMatrix';

/** Settings → Risk & Compliance: categories, matrix labels and bands, portal, reminders. */
export function GrcSettingsPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const query = useGrcSettings();
  const save = useSaveGrcSettings();
  const workflows = useWorkflows();
  const loc = useLocalized();
  const [value, setValue] = useState<GrcSettings | null>(null);

  useEffect(() => {
    if (query.data) setValue(query.data);
  }, [query.data]);

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !value) return <ErrorState error={query.error} />;

  const patch = (p: Partial<GrcSettings>) => setValue((v) => (v ? { ...v, ...p } : v));
  const setBand = (i: number, p: Partial<GrcBand>) =>
    patch({ bands: value.bands.map((b, j) => (j === i ? { ...b, ...p } : b)) });
  const submit = async () => {
    try {
      await save.mutateAsync(value);
      message.success(t('grc:settings.saved'));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const labelsTable = (key: 'likelihoodLabels' | 'impactLabels') => (
    <Table
      size="small"
      pagination={false}
      rowKey={(_, i) => String(i)}
      dataSource={value[key]}
      columns={[
        { title: '#', width: 40, render: (_, __, i) => i + 1 },
        {
          title: t('grc:settings.nameEn'),
          render: (_, l, i) => (
            <Input
              dir="ltr"
              value={l.en}
              maxLength={60}
              onChange={(e) =>
                patch({
                  [key]: value[key].map((x, j) => (j === i ? { ...x, en: e.target.value } : x)),
                })
              }
            />
          ),
        },
        {
          title: t('grc:settings.nameAr'),
          render: (_, l, i) => (
            <Input
              dir="rtl"
              value={l.ar}
              maxLength={60}
              onChange={(e) =>
                patch({
                  [key]: value[key].map((x, j) => (j === i ? { ...x, ar: e.target.value } : x)),
                })
              }
            />
          ),
        },
      ]}
    />
  );

  return (
    <>
      <PageHeader
        title={t('grc:settings.title')}
        subtitle={t('grc:settings.subtitle')}
        extra={
          <Space>
            <Button onClick={() => setValue(DEFAULT_GRC_SETTINGS)}>
              {t('grc:settings.reset')}
            </Button>
            <Button type="primary" loading={save.isPending} onClick={() => void submit()}>
              {t('save')}
            </Button>
          </Space>
        }
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title={t('grc:settings.bands')} style={{ marginBlockEnd: 16 }}>
            <Typography.Paragraph type="secondary">
              {t('grc:settings.alertHint')}
            </Typography.Paragraph>
            <Table
              size="small"
              pagination={false}
              rowKey={(_, i) => String(i)}
              dataSource={value.bands}
              columns={[
                {
                  title: t('grc:settings.key'),
                  width: 120,
                  render: (_, b, i) => (
                    <Input
                      dir="ltr"
                      value={b.key}
                      onChange={(e) => setBand(i, { key: e.target.value.toUpperCase() })}
                    />
                  ),
                },
                {
                  title: t('grc:settings.nameEn'),
                  render: (_, b, i) => (
                    <Input
                      dir="ltr"
                      value={b.nameEn}
                      onChange={(e) => setBand(i, { nameEn: e.target.value })}
                    />
                  ),
                },
                {
                  title: t('grc:settings.nameAr'),
                  render: (_, b, i) => (
                    <Input
                      dir="rtl"
                      value={b.nameAr}
                      onChange={(e) => setBand(i, { nameAr: e.target.value })}
                    />
                  ),
                },
                {
                  title: t('grc:settings.minScore'),
                  width: 90,
                  render: (_, b, i) => (
                    <InputNumber
                      min={1}
                      max={25}
                      value={b.minScore}
                      disabled={i === 0}
                      onChange={(n) => setBand(i, { minScore: n ?? 1 })}
                    />
                  ),
                },
                {
                  title: t('grc:settings.colour'),
                  width: 70,
                  render: (_, b, i) => (
                    <ColorPicker
                      value={b.colour}
                      disabledAlpha
                      onChangeComplete={(c) => setBand(i, { colour: c.toHexString() })}
                    />
                  ),
                },
                {
                  title: t('grc:settings.alert'),
                  width: 90,
                  render: (_, b, i) => (
                    <Checkbox
                      checked={b.alert}
                      onChange={(e) => setBand(i, { alert: e.target.checked })}
                    />
                  ),
                },
                {
                  width: 40,
                  render: (_, __, i) =>
                    value.bands.length > 2 && i > 0 ? (
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t('delete')}
                        onClick={() => patch({ bands: value.bands.filter((_, j) => j !== i) })}
                      />
                    ) : null,
                },
              ]}
            />
            {value.bands.length < 6 && (
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                style={{ marginBlockStart: 8 }}
                onClick={() =>
                  patch({
                    bands: [
                      ...value.bands,
                      {
                        key: `BAND_${value.bands.length + 1}`,
                        nameEn: '',
                        nameAr: '',
                        colour: '#8c8c8c',
                        minScore: Math.min(25, (value.bands.at(-1)?.minScore ?? 1) + 1),
                        alert: true,
                      },
                    ],
                  })
                }
              >
                {t('grc:settings.add')}
              </Button>
            )}
          </Card>
          <Card title={t('grc:settings.matrix')} style={{ marginBlockEnd: 16 }}>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Typography.Title level={5}>{t('grc:settings.likelihoodLabels')}</Typography.Title>
                {labelsTable('likelihoodLabels')}
              </Col>
              <Col xs={24} md={12}>
                <Typography.Title level={5}>{t('grc:settings.impactLabels')}</Typography.Title>
                {labelsTable('impactLabels')}
              </Col>
            </Row>
          </Card>
          <Card title={t('grc:settings.categories')}>
            <Table
              size="small"
              pagination={false}
              rowKey={(_, i) => String(i)}
              dataSource={value.categories}
              columns={[
                {
                  title: t('grc:settings.key'),
                  width: 160,
                  render: (_, c, i) => (
                    <Input
                      dir="ltr"
                      value={c.key}
                      onChange={(e) =>
                        patch({
                          categories: value.categories.map((x, j) =>
                            j === i ? { ...x, key: e.target.value.toUpperCase() } : x,
                          ),
                        })
                      }
                    />
                  ),
                },
                ...(['nameEn', 'nameAr'] as const).map((f) => ({
                  title: t(`grc:settings.${f}`),
                  render: (_: unknown, c: GrcSettings['categories'][number], i: number) => (
                    <Input
                      dir={f === 'nameAr' ? 'rtl' : 'ltr'}
                      value={c[f]}
                      onChange={(e) =>
                        patch({
                          categories: value.categories.map((x, j) =>
                            j === i ? { ...x, [f]: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  ),
                })),
                {
                  width: 40,
                  render: (_: unknown, __: unknown, i: number) =>
                    value.categories.length > 1 ? (
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t('delete')}
                        onClick={() =>
                          patch({ categories: value.categories.filter((_, j) => j !== i) })
                        }
                      />
                    ) : null,
                },
              ]}
            />
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              style={{ marginBlockStart: 8 }}
              onClick={() =>
                patch({
                  categories: [
                    ...value.categories,
                    { key: `CATEGORY_${value.categories.length + 1}`, nameEn: '', nameAr: '' },
                  ],
                })
              }
            >
              {t('grc:settings.add')}
            </Button>
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title={t('grc:settings.preview')} style={{ marginBlockEnd: 16 }}>
            <RiskMatrixPreview settings={value} />
          </Card>
          <Card title={t('grc:settings.portal')}>
            <Typography.Paragraph strong>{t('grc:settings.portalVisibility')}</Typography.Paragraph>
            <Radio.Group
              value={value.portalVisibility}
              onChange={(e) => patch({ portalVisibility: e.target.value })}
            >
              <Space direction="vertical">
                {GRC_PORTAL_VISIBILITY.map((v) => (
                  <Radio key={v} value={v}>
                    {t(`grc:settings.portalOption.${v}`)}
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
            <Typography.Paragraph strong style={{ marginBlockStart: 16 }}>
              {t('grc:settings.reminderDays')}
            </Typography.Paragraph>
            <InputNumber
              min={0}
              max={90}
              value={value.reminderDaysBefore}
              onChange={(n) => patch({ reminderDaysBefore: n ?? 0 })}
            />
          </Card>
          <Card title={t('assurance:changes.settingsTitle')} style={{ marginBlockStart: 16 }}>
            <Typography.Paragraph type="secondary">
              {t('assurance:changes.settingsHint')}
            </Typography.Paragraph>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space>
                <Switch
                  data-testid="change-approval-switch"
                  checked={value.changeApproval.enabled}
                  onChange={(enabled) =>
                    patch({ changeApproval: { ...value.changeApproval, enabled } })
                  }
                />
                {t('assurance:changes.enable')}
              </Space>
              <Checkbox.Group
                disabled={!value.changeApproval.enabled}
                value={value.changeApproval.types}
                onChange={(types) =>
                  patch({
                    changeApproval: {
                      ...value.changeApproval,
                      types: types as GrcSettings['changeApproval']['types'],
                    },
                  })
                }
                options={(['RISK', 'CONTROL'] as const).map((k) => ({
                  value: k,
                  label: t(`grc:types.${k}`),
                }))}
              />
              <Select
                allowClear
                style={{ width: '100%' }}
                disabled={!value.changeApproval.enabled}
                placeholder={t('assurance:changes.defaultWorkflow')}
                value={value.changeApproval.workflowId ?? undefined}
                onChange={(workflowId) =>
                  patch({
                    changeApproval: { ...value.changeApproval, workflowId: workflowId ?? null },
                  })
                }
                options={(workflows.data ?? []).map((w) => ({ value: w.id, label: loc(w) }))}
              />
            </Space>
          </Card>
        </Col>
      </Row>
    </>
  );
}

/** The matrix drawn with the unsaved settings. */
function RiskMatrixPreview({ settings }: { settings: GrcSettings }) {
  return <RiskMatrix key={JSON.stringify(settings)} settingsOverride={settings} />;
}
