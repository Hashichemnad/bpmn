import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { App, Badge, Button, Card, Form, InputNumber, Space, Tabs, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS, type ApiSettings } from '@processhub/shared';
import { useApiSettings, useRendererStatus, useUpdateApiSettings } from '@/api/integrations';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { useErrorMessage } from '@/components/i18n-helpers';
import { ApiKeysTab } from './ApiKeysTab';

function ApiSettingsCard() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const { can } = useAuth();
  const settings = useApiSettings();
  const update = useUpdateApiSettings();
  const [form] = Form.useForm<ApiSettings>();
  useEffect(() => {
    if (settings.data) form.setFieldsValue(settings.data);
  }, [settings.data, form]);
  const manage = can(PERMISSIONS.SETTINGS_MANAGE);
  return (
    <Card size="small" title={t('integrations:apiSettings.title')}>
      <Form<ApiSettings>
        form={form}
        layout="inline"
        disabled={!manage}
        onFinish={(v) =>
          update.mutate(v, {
            onSuccess: () => message.success(t('saved')),
            onError: (err) => message.error(errorMessage(err)),
          })
        }
      >
        <Form.Item
          name="maxKeyDays"
          label={t('integrations:apiSettings.maxKeyDays')}
          rules={[{ required: true }]}
        >
          <InputNumber min={1} max={3650} />
        </Form.Item>
        <Form.Item
          name="usageRetentionDays"
          label={t('integrations:apiSettings.retention')}
          rules={[{ required: true }]}
        >
          <InputNumber min={7} max={730} />
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

function RendererStatus() {
  const { t } = useTranslation();
  const status = useRendererStatus();
  const s = status.data?.status;
  return (
    <Space>
      <Typography.Text type="secondary">{t('integrations:renderer.label')}</Typography.Text>
      <Badge
        status={s === 'OK' ? 'success' : s === 'DOWN' ? 'error' : 'default'}
        text={s ? t(`integrations:renderer.${s}`) : '…'}
      />
    </Space>
  );
}

/** Settings → Integrations (Phase 4.4): API keys, webhooks, Microsoft Teams. */
export function IntegrationsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'api-keys';
  return (
    <>
      <PageHeader
        crumbs={[{ title: t('nav.settings'), to: '/settings' }, { title: t('integrations:title') }]}
        title={t('integrations:title')}
        subtitle={t('integrations:subtitle')}
        extra={<RendererStatus />}
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => setParams({ tab: k }, { replace: true })}
        items={[
          {
            key: 'api-keys',
            label: t('integrations:tabs.apiKeys'),
            children: (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <ApiKeysTab />
                <ApiSettingsCard />
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}
