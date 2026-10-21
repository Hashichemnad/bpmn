import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ProcessCategory, ProcessStatus } from '@processhub/shared';
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

export function StatusTag({ status }: { status: ProcessStatus }) {
  const { t } = useTranslation();
  return <Tag color={STATUS_COLORS[status]}>{t(`processes:status.${status}`)}</Tag>;
}
