import { Alert, Button, Space } from 'antd';
import { BgColorsOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PERMISSIONS } from '@processhub/shared';
import { useDiagramThemeNotice, useDismissDiagramThemeNotice } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';

/**
 * One-time notice for Super Admins after the upgrade (D-072): existing diagrams have no colours
 * yet. Disappears when dismissed or once "Apply theme" has run.
 */
export function DiagramThemeNotice() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const allowed = can(PERMISSIONS.SETTINGS_MANAGE);
  const notice = useDiagramThemeNotice(allowed);
  const dismiss = useDismissDiagramThemeNotice();
  if (!allowed || !notice.data?.show) return null;
  return (
    <Alert
      className="ph-theme-notice"
      type="info"
      showIcon
      icon={<BgColorsOutlined />}
      message={t('admin:theme.notice')}
      description={t('admin:theme.noticeDetail', { count: notice.data.models })}
      action={
        <Space direction="vertical" size={4}>
          <Button size="small" type="primary" onClick={() => navigate('/settings')}>
            {t('admin:theme.noticeOpen')}
          </Button>
          <Button size="small" loading={dismiss.isPending} onClick={() => dismiss.mutate()}>
            {t('admin:theme.noticeDismiss')}
          </Button>
        </Space>
      }
    />
  );
}
