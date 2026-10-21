import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Empty, Flex, Popover, Spin, Tooltip, Typography } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { NotificationDto } from '@processhub/shared';
import { useMarkRead, useNotifications, useUnreadCount } from '@/api/governance';
import { useOpenNotification } from './use-open-notification';
import { useFormatDate } from '@/components/i18n-helpers';
import { useNotificationText } from './notification-text';

export function NotificationItem({
  n,
  onOpen,
}: {
  n: NotificationDto;
  onOpen: (n: NotificationDto) => void;
}) {
  const text = useNotificationText();
  const formatDate = useFormatDate();
  const { title, detail } = text(n);
  return (
    <div
      role="button"
      tabIndex={0}
      className={`ph-notification${n.readAt ? '' : ' ph-notification-unread'}`}
      onClick={() => onOpen(n)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(n)}
    >
      <Badge dot={!n.readAt} offset={[0, 6]}>
        <BellOutlined style={{ color: '#64748b', marginBlockStart: 4 }} />
      </Badge>
      <div style={{ minInlineSize: 0 }}>
        <Typography.Text strong={!n.readAt}>{title}</Typography.Text>
        {detail && (
          <Typography.Paragraph
            type="secondary"
            ellipsis={{ rows: 2 }}
            style={{ margin: 0, fontSize: 12 }}
          >
            {detail}
          </Typography.Paragraph>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {formatDate(n.createdAt)}
        </Typography.Text>
      </div>
    </div>
  );
}

/** Bell with unread count; the popover lists the latest notifications. */
export function NotificationBell({ allLink = '/notifications' }: { allLink?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const list = useNotifications({ pageSize: 8 });
  const markRead = useMarkRead();
  const openOne = useOpenNotification();
  const count = unread.data?.count ?? 0;

  const content = (
    <div className="ph-notification-list">
      <Flex justify="space-between" align="center" style={{ padding: '4px 4px 8px' }}>
        <Typography.Text strong>{t('governance:notifications.heading')}</Typography.Text>
        <Button size="small" type="link" disabled={!count} onClick={() => markRead.mutate('all')}>
          {t('governance:notifications.markAllRead')}
        </Button>
      </Flex>
      {list.isLoading ? (
        <Spin />
      ) : list.data?.items.length ? (
        list.data.items.map((n) => (
          <NotificationItem
            key={n.id}
            n={n}
            onOpen={(x) => {
              setOpen(false);
              openOne(x);
            }}
          />
        ))
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('governance:notifications.empty')}
        />
      )}
      <Button
        block
        type="link"
        onClick={() => {
          setOpen(false);
          navigate(allLink);
        }}
      >
        {t('governance:notifications.showAll')}
      </Button>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) void list.refetch();
      }}
      placement="bottomRight"
    >
      <Tooltip title={t('governance:notifications.heading')}>
        <Badge count={count} size="small" overflowCount={99}>
          <Button
            type="text"
            icon={<BellOutlined />}
            aria-label={t('governance:notifications.unread', { count })}
          />
        </Badge>
      </Tooltip>
    </Popover>
  );
}
