import { Tag, Tooltip } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { CaseStatus } from '@processhub/shared';
import { useFormatDate } from '@/components/i18n-helpers';

/** Due date with colouring: overdue red, due within a day amber. */
export function DueTag({ due }: { due: string | null }) {
  const { t } = useTranslation();
  const formatDate = useFormatDate();
  if (!due) return <span>—</span>;
  const ms = new Date(due).getTime() - Date.now();
  const cls = ms < 0 ? 'ph-wf-due-overdue' : ms < 86_400_000 ? 'ph-wf-due-soon' : undefined;
  return (
    <Tooltip title={ms < 0 ? t('workflow:tasks.overdue') : undefined}>
      <span className={cls} data-due={ms < 0 ? 'overdue' : ms < 86_400_000 ? 'soon' : 'ok'}>
        {ms < 0 && <ClockCircleOutlined />} {formatDate(due)}
      </span>
    </Tooltip>
  );
}

const STATUS_COLOURS: Record<CaseStatus, string> = {
  RUNNING: 'blue',
  COMPLETED: 'green',
  CANCELLED: 'default',
  WITHDRAWN: 'default',
};

export function CaseStatusTag({
  status,
  outcome,
}: {
  status: CaseStatus;
  outcome?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <Tag color={outcome === 'ERROR' ? 'red' : STATUS_COLOURS[status]}>
      {t(`workflow:caseStatus.${status}`)}
      {status === 'COMPLETED' && outcome && outcome !== 'NORMAL'
        ? ` · ${t(`workflow:outcome.${outcome}`)}`
        : ''}
    </Tag>
  );
}
