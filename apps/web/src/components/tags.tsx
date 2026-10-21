import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { SafetyCertificateFilled } from '@ant-design/icons';
import type { ProcessCategory, ProcessStatus, ReviewDateState } from '@processhub/shared';
import { CATEGORY_COLORS } from './colors';

export function CategoryTag({ category }: { category: ProcessCategory }) {
  const { t } = useTranslation();
  return (
    <Tag color={CATEGORY_COLORS[category]} bordered={false}>
      {t(`processes:category.${category}`)}
    </Tag>
  );
}

const STATUS_COLORS: Record<ProcessStatus, string> = {
  DRAFT: 'default',
  IN_REVIEW: 'processing',
  APPROVED: 'success',
  PUBLISHED: 'green',
  ARCHIVED: 'warning',
};

/** Lifecycle status; a draft whose last review asked for changes shows that instead. */
export function StatusTag({
  status,
  changesRequested,
  rejected,
}: {
  status: ProcessStatus;
  changesRequested?: boolean;
  rejected?: boolean;
}) {
  const { t } = useTranslation();
  if (status === 'DRAFT' && (changesRequested || rejected)) {
    return (
      <Tag color={rejected ? 'error' : 'orange'}>
        {t(rejected ? 'governance:status.rejected' : 'governance:status.changesRequested')}
      </Tag>
    );
  }
  return <Tag color={STATUS_COLORS[status]}>{t(`processes:status.${status}`)}</Tag>;
}

const REVIEW_STATE_COLORS: Record<ReviewDateState, string> = {
  NONE: 'default',
  OK: 'green',
  DUE: 'gold',
  OVERDUE: 'red',
};

/** Periodic review date state of a published item. */
export function ReviewStateTag({ state }: { state: ReviewDateState }) {
  const { t } = useTranslation();
  if (state === 'NONE') return null;
  return <Tag color={REVIEW_STATE_COLORS[state]}>{t(`governance:reviewState.${state}`)}</Tag>;
}

/** "Official version" badge of published content. */
export function OfficialBadge() {
  const { t } = useTranslation();
  return (
    <Tag color="green" icon={<SafetyCertificateFilled />} className="ph-official">
      {t('governance:official')}
    </Tag>
  );
}
