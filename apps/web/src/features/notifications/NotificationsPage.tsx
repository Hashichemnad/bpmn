import { useState } from 'react';
import { Button, Card, Empty, Pagination, Segmented, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { useMarkRead, useNotifications } from '@/api/governance';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { NotificationItem } from './NotificationBell';
import { useOpenNotification } from './use-open-notification';

/** Notification centre: everything the user was notified about, newest first. */
export function NotificationsPage() {
  const { t } = useTranslation();
  const [unread, setUnread] = useState(false);
  const [page, setPage] = useState(1);
  const list = useNotifications({ unread, page, pageSize: 20 });
  const markRead = useMarkRead();
  const openOne = useOpenNotification();
  return (
    <>
      <PageHeader
        title={t('governance:notifications.heading')}
        subtitle={t('governance:notifications.subtitle')}
        extra={
          <Space>
            <Segmented
              value={unread ? 'unread' : 'all'}
              onChange={(v) => {
                setUnread(v === 'unread');
                setPage(1);
              }}
              options={[
                { value: 'all', label: t('governance:notifications.all') },
                { value: 'unread', label: t('governance:notifications.unreadOnly') },
              ]}
            />
            <Button onClick={() => markRead.mutate('all')}>
              {t('governance:notifications.markAllRead')}
            </Button>
          </Space>
        }
      />
      <Card>
        {list.isLoading ? (
          <LoadingState />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.data?.items.length ? (
          <>
            {list.data.items.map((n) => (
              <NotificationItem key={n.id} n={n} onOpen={openOne} />
            ))}
            <Pagination
              style={{ marginBlockStart: 16, textAlign: 'center' }}
              current={page}
              pageSize={20}
              total={list.data.total}
              onChange={setPage}
              hideOnSinglePage
            />
          </>
        ) : (
          <Empty description={t('governance:notifications.empty')} />
        )}
      </Card>
    </>
  );
}
