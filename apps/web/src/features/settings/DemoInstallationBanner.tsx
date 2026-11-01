import { Alert, App, Button, Popconfirm, Space } from 'antd';
import { ExperimentOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PERMISSIONS } from '@processhub/shared';
import { useClearDemo, useDemoStatus } from '@/api/integrations';
import { useAuth } from '@/auth/AuthProvider';
import { useErrorMessage } from '@/components/i18n-helpers';

/**
 * Warning for administrators while demo data, a demo user or the demo API key remains (D-180).
 * The go-live checklist (docs/DEPLOYMENT.md) removes them; a Super Admin then confirms it here.
 */
export function DemoInstallationBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can, canAny } = useAuth();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const allowed = canAny(PERMISSIONS.USERS_MANAGE, PERMISSIONS.SETTINGS_MANAGE);
  const status = useDemoStatus(allowed);
  const clear = useClearDemo();
  const s = status.data;
  if (!allowed || !s?.warning) return null;
  const stillActive = s.activeDemoUsers > 0 || s.activeDemoApiKeys > 0;
  const items = [
    s.demoData && t('admin:demo.data'),
    s.activeDemoUsers > 0 && t('admin:demo.users', { count: s.activeDemoUsers }),
    s.activeDemoApiKeys > 0 && t('admin:demo.apiKeys', { count: s.activeDemoApiKeys }),
  ].filter((x): x is string => !!x);
  return (
    <Alert
      className="ph-theme-notice"
      type="warning"
      showIcon
      icon={<ExperimentOutlined />}
      data-testid="demo-banner"
      message={t('admin:demo.title')}
      description={
        <>
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            {items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
          <div>{t('admin:demo.hint')}</div>
        </>
      }
      action={
        <Space direction="vertical" size={4}>
          {s.activeDemoApiKeys > 0 && (
            <Button size="small" onClick={() => navigate('/settings/integrations')}>
              {t('admin:demo.openApiKeys')}
            </Button>
          )}
          {s.activeDemoUsers > 0 && (
            <Button size="small" onClick={() => navigate('/admin/users')}>
              {t('admin:demo.openUsers')}
            </Button>
          )}
          {can(PERMISSIONS.SETTINGS_MANAGE) && (
            <Popconfirm
              title={t('admin:demo.confirmTitle')}
              description={t('admin:demo.confirmText')}
              disabled={stillActive}
              onConfirm={() =>
                clear.mutateAsync().then(
                  () => message.success(t('admin:demo.cleared')),
                  (err) => message.error(errorMessage(err)),
                )
              }
            >
              <Button
                size="small"
                type="primary"
                disabled={stillActive}
                title={stillActive ? t('admin:demo.clearBlocked') : undefined}
                loading={clear.isPending}
              >
                {t('admin:demo.clear')}
              </Button>
            </Popconfirm>
          )}
        </Space>
      }
    />
  );
}
