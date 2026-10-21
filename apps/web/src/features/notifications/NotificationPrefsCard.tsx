import { Alert, App, Card, Switch, Table } from 'antd';
import { useTranslation } from 'react-i18next';
import { NOTIFICATION_TYPES, type NotificationType } from '@processhub/shared';
import { useNotificationPrefs, useSaveNotificationPrefs } from '@/api/governance';
import { useErrorMessage } from '@/components/i18n-helpers';

/** Per-user choice of in-app and email notifications for each type. */
export function NotificationPrefsCard() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const prefs = useNotificationPrefs();
  const save = useSaveNotificationPrefs();
  const set = (type: NotificationType, channel: 'inApp' | 'email', value: boolean) => {
    const current = prefs.data!.prefs[type];
    save.mutate(
      { prefs: { [type]: { ...current, [channel]: value } } },
      { onError: (err) => message.error(errorMessage(err)) },
    );
  };
  return (
    <Card title={t('governance:prefs.title')} style={{ marginBlockStart: 24 }}>
      {prefs.data && !prefs.data.emailEnabled && (
        <Alert
          type="info"
          showIcon
          style={{ marginBlockEnd: 12 }}
          message={t('governance:prefs.emailOff')}
        />
      )}
      <Table
        size="small"
        rowKey="type"
        loading={prefs.isLoading}
        pagination={false}
        dataSource={NOTIFICATION_TYPES.map((type) => ({ type }))}
        columns={[
          {
            title: t('governance:prefs.type'),
            key: 'type',
            render: (_, r) => t(`governance:prefs.types.${r.type}`),
          },
          {
            title: t('governance:prefs.inApp'),
            key: 'inApp',
            width: 110,
            render: (_, r) => (
              <Switch
                size="small"
                checked={prefs.data?.prefs[r.type].inApp}
                onChange={(v) => set(r.type, 'inApp', v)}
                aria-label={`${t(`governance:prefs.types.${r.type}`)} – ${t('governance:prefs.inApp')}`}
              />
            ),
          },
          {
            title: t('governance:prefs.email'),
            key: 'email',
            width: 110,
            render: (_, r) => (
              <Switch
                size="small"
                checked={prefs.data?.prefs[r.type].email}
                onChange={(v) => set(r.type, 'email', v)}
                aria-label={`${t(`governance:prefs.types.${r.type}`)} – ${t('governance:prefs.email')}`}
              />
            ),
          },
        ]}
      />
    </Card>
  );
}
