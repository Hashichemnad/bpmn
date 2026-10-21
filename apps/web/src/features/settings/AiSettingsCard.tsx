import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Flex,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { BarChartOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  AI_DEFAULT_FAST_MODEL,
  AI_DEFAULT_MODEL,
  AI_MAX_SUGGESTIONS,
  AI_PROVIDERS,
  AI_SUGGESTION_FEATURES,
  SYSTEM_ROLE_KEYS,
  type AiSettingsInput,
} from '@processhub/shared';
import { useAiSettings, useTestAi, useUpdateAiSettings } from '@/api/ai';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage } from '@/components/i18n-helpers';
import { AiIcon } from '@/features/ai/AiParts';

type Values = Omit<AiSettingsInput, 'clearApiKey'>;

const isValidation = (err: unknown) => !!err && typeof err === 'object' && 'errorFields' in err;

/**
 * Settings → AI (Super Admin): provider, models, encrypted API key, roles, limits, the data
 * notice and the suggestion chips shown to users. Disabled by default.
 */
export function AiSettingsCard() {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const errorMessage = useErrorMessage();
  const settings = useAiSettings();
  const save = useUpdateAiSettings();
  const test = useTestAi();
  const [form] = Form.useForm<Values>();

  useEffect(() => {
    if (!settings.data) return;
    const { hasApiKey: _h, encryptionAvailable: _e, ...rest } = settings.data;
    form.setFieldsValue({ ...rest, apiKey: '' });
  }, [settings.data, form]);

  if (settings.isLoading) return <LoadingState />;
  if (settings.isError || !settings.data)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  const s = settings.data;

  const values = async (): Promise<AiSettingsInput> => {
    const v = await form.validateFields();
    // Rows left empty in the suggestions editor are dropped.
    const suggestions = Object.fromEntries(
      Object.entries(v.suggestions ?? s.suggestions).map(([f, list]) => [
        f,
        (list ?? []).filter((x) => x?.en?.trim() || x?.ar?.trim()),
      ]),
    );
    return { ...v, apiKey: v.apiKey?.trim() || undefined, suggestions };
  };

  const submit = async () => {
    try {
      await save.mutateAsync(await values());
      form.setFieldValue('apiKey', '');
      message.success(t('saved'));
    } catch (err) {
      if (!isValidation(err)) message.error(errorMessage(err));
    }
  };

  const runTest = async () => {
    try {
      const res = await test.mutateAsync(await values());
      if (res.ok) message.success(t('ai:settings.testOk', { model: res.model }));
      else
        modal.error({
          title: t(`errors:${res.code ?? 'AI_PROVIDER_ERROR'}`),
          content: res.message && <Typography.Text code>{res.message}</Typography.Text>,
        });
    } catch (err) {
      if (!isValidation(err)) message.error(errorMessage(err));
    }
  };

  const removeKey = () =>
    modal.confirm({
      title: t('ai:settings.removeKeyTitle'),
      content: t('ai:settings.removeKeyText'),
      okText: t('delete'),
      okButtonProps: { danger: true },
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          const v = form.getFieldsValue();
          await save.mutateAsync({
            ...v,
            suggestions: v.suggestions ?? {},
            enabled: false,
            apiKey: undefined,
            clearApiKey: true,
          });
          message.success(t('saved'));
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });

  return (
    <Card
      title={
        <Space>
          <AiIcon />
          {t('ai:settings.title')}
        </Space>
      }
      extra={
        <Space>
          <Tag color={s.enabled ? 'green' : 'default'}>
            {s.enabled ? t('ai:settings.enabled') : t('admin:settings.disabled')}
          </Tag>
          <Link to="/admin/ai-usage">
            <Button size="small" icon={<BarChartOutlined />}>
              {t('ai:usage.title')}
            </Button>
          </Link>
        </Space>
      }
    >
      {!s.encryptionAvailable && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('ai:settings.noEncryptionKey')}
        />
      )}
      <Typography.Paragraph type="secondary">{t('ai:settings.intro')}</Typography.Paragraph>
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="enabled" valuePropName="checked" label={t('ai:settings.enable')}>
          <Switch />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item
              name="provider"
              label={t('ai:settings.provider')}
              rules={[{ required: true }]}
            >
              <Select
                options={AI_PROVIDERS.map((p) => ({
                  value: p,
                  label: t(`ai:settings.providers.${p}`),
                }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="model"
              label={t('ai:settings.model')}
              extra={t('ai:settings.modelHint', { model: AI_DEFAULT_MODEL })}
              rules={[{ required: true, whitespace: true }, { pattern: /^[A-Za-z0-9._:@/-]+$/ }]}
            >
              <Input dir="ltr" placeholder={AI_DEFAULT_MODEL} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="fastModel"
              label={t('ai:settings.fastModel')}
              extra={t('ai:settings.fastModelHint', { model: AI_DEFAULT_FAST_MODEL })}
              rules={[{ required: true, whitespace: true }, { pattern: /^[A-Za-z0-9._:@/-]+$/ }]}
            >
              <Input dir="ltr" placeholder={AI_DEFAULT_FAST_MODEL} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          label={t('ai:settings.apiKey')}
          extra={s.hasApiKey ? t('ai:settings.apiKeyStored') : t('ai:settings.apiKeyHint')}
        >
          <Flex gap={8} wrap>
            <Form.Item name="apiKey" noStyle>
              <Input.Password
                dir="ltr"
                autoComplete="new-password"
                placeholder={s.hasApiKey ? '••••••••••••' : 'sk-ant-…'}
                style={{ maxInlineSize: 420 }}
                disabled={!s.encryptionAvailable}
              />
            </Form.Item>
            {s.hasApiKey && (
              <Button danger icon={<DeleteOutlined />} onClick={removeKey}>
                {t('ai:settings.removeKey')}
              </Button>
            )}
          </Flex>
        </Form.Item>
        <Form.Item
          name="allowedRoles"
          label={t('ai:settings.roles')}
          extra={t('ai:settings.rolesHint')}
        >
          <Checkbox.Group
            options={SYSTEM_ROLE_KEYS.map((r) => ({ value: r, label: t(`admin:roles.${r}`) }))}
          />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item
              name="userDailyLimit"
              label={t('ai:settings.userDailyLimit')}
              extra={t('ai:settings.zeroUnlimited')}
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={100000} style={{ inlineSize: 180 }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="orgMonthlyLimit"
              label={t('ai:settings.orgMonthlyLimit')}
              extra={t('ai:settings.zeroUnlimited')}
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={10000000} style={{ inlineSize: 180 }} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="noticeEn" label={t('ai:settings.noticeEn')} rules={[{ max: 1000 }]}>
              <Input.TextArea dir="ltr" lang="en" rows={3} maxLength={1000} showCount />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="noticeAr" label={t('ai:settings.noticeAr')} rules={[{ max: 1000 }]}>
              <Input.TextArea dir="rtl" lang="ar" rows={3} maxLength={1000} showCount />
            </Form.Item>
          </Col>
        </Row>
        <Collapse
          ghost
          items={[
            {
              key: 'suggestions',
              // Mounted while collapsed, so saving never drops the suggestions.
              forceRender: true,
              label: t('ai:settings.suggestions'),
              children: (
                <>
                  <Typography.Paragraph type="secondary">
                    {t('ai:settings.suggestionsHint')}
                  </Typography.Paragraph>
                  {AI_SUGGESTION_FEATURES.map((f) => (
                    <div key={f} className="ph-ai-suggestion-group">
                      <Typography.Text strong>{t(`ai:features.${f}`)}</Typography.Text>
                      <Form.List name={['suggestions', f]}>
                        {(fields, { add, remove }) => (
                          <>
                            {fields.map((field) => (
                              <Flex
                                key={field.key}
                                gap={8}
                                align="start"
                                className="ph-ai-suggestion-row"
                              >
                                <Form.Item
                                  name={[field.name, 'en']}
                                  style={{ flex: 1, marginBottom: 8 }}
                                  rules={[{ max: 300 }]}
                                >
                                  <Input
                                    dir="ltr"
                                    lang="en"
                                    placeholder="English"
                                    maxLength={300}
                                  />
                                </Form.Item>
                                <Form.Item
                                  name={[field.name, 'ar']}
                                  style={{ flex: 1, marginBottom: 8 }}
                                  rules={[{ max: 300 }]}
                                >
                                  <Input
                                    dir="rtl"
                                    lang="ar"
                                    placeholder="العربية"
                                    maxLength={300}
                                  />
                                </Form.Item>
                                <Button
                                  type="text"
                                  icon={<DeleteOutlined />}
                                  onClick={() => remove(field.name)}
                                  aria-label={t('delete')}
                                />
                              </Flex>
                            ))}
                            {fields.length < AI_MAX_SUGGESTIONS && (
                              <Button
                                size="small"
                                type="dashed"
                                icon={<PlusOutlined />}
                                onClick={() => add({ en: '', ar: '' })}
                                style={{ marginBottom: 12 }}
                              >
                                {t('ai:settings.addSuggestion')}
                              </Button>
                            )}
                          </>
                        )}
                      </Form.List>
                    </div>
                  ))}
                </>
              ),
            },
          ]}
        />
        <Space wrap style={{ marginTop: 12 }}>
          <Button type="primary" onClick={() => void submit()} loading={save.isPending}>
            {t('save')}
          </Button>
          <Button onClick={() => void runTest()} loading={test.isPending}>
            {t('ai:settings.test')}
          </Button>
        </Space>
      </Form>
    </Card>
  );
}
