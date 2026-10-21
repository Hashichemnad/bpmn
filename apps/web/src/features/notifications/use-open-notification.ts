import { useNavigate } from 'react-router-dom';
import type { NotificationDto } from '@processhub/shared';
import { useMarkRead } from '@/api/governance';

/** Opens a notification: marks it read and follows its link. */
export function useOpenNotification() {
  const navigate = useNavigate();
  const markRead = useMarkRead();
  return (n: NotificationDto) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };
}
