import { App, Card, Form, Space, Switch, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ImportSettings } from '@processhub/shared';
import { useImportSettings, useSaveImportSettings } from '@/api/imports';
import { useErrorMessage } from '@/components/i18n-helpers';

/**
 * Import settings (D-164), for settings managers: the welcome e-mail of SSO-only installations and
 * "Allow AI on imported documents" (off by default; needs DOF approval — the text leaves the UAE).
 */
export function ImportSettingsCard() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const settings = useImportSettings();
  const save = useSaveImportSettings();
  if (!settings.data) return null;
  const change = (patch: Partial<ImportSettings>) =>
    save.mutate(
      { ...settings.data!, ...patch },
      {
        onSuccess: () => message.success(t('imports:settings.saved')),
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  return (
    <Card
      size="small"
      title={
        <Space>
          <SettingOutlined />
          {t('imports:settings.title')}
        </Space>
      }
      style={{ marginBlockEnd: 16 }}
      data-testid="import-settings"
    >
      <Form layout="vertical">
        <Form.Item
          label={t('imports:settings.ssoWelcomeEmail')}
          extra={t('imports:settings.ssoWelcomeEmailHelp')}
        >
          <Switch
            checked={settings.data.ssoWelcomeEmail}
            loading={save.isPending}
            onChange={(v) => change({ ssoWelcomeEmail: v })}
          />
        </Form.Item>
        <Form.Item
          label={t('imports:settings.allowAi')}
          extra={
            <Typography.Text type="warning">{t('imports:settings.allowAiHelp')}</Typography.Text>
          }
          style={{ marginBlockEnd: 0 }}
        >
          <Switch
            checked={settings.data.allowAiOnImportedDocuments}
            loading={save.isPending}
            data-testid="import-settings-ai"
            onChange={(v) => change({ allowAiOnImportedDocuments: v })}
          />
        </Form.Item>
      </Form>
    </Card>
  );
}
