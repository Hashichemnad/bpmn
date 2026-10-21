import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ProcessCategory, ProcessStatus } from '@processhub/shared';

export const CATEGORY_COLORS: Record<ProcessCategory, string> = {
  MANAGEMENT: '#7c3aed',
  CORE: '#1d4ed8',
  SUPPORT: '#0f766e',
};

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
