import { Descriptions, Flex, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { PortalMetaDto } from '@processhub/shared';
import { OfficialBadge, ReviewStateTag } from '@/components/tags';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';

/** Version label, approval, owner and next review date of a published item. */
export function PortalMeta({ meta, extra }: { meta: PortalMetaDto; extra?: React.ReactNode }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const name = (u: { nameEn: string; nameAr: string; email: string } | null) =>
    u ? loc(u) || u.email : '—';
  return (
    <div className="ph-portal-meta">
      <Flex gap={8} wrap="wrap" align="center" style={{ marginBlockEnd: 8 }}>
        <OfficialBadge />
        <Typography.Text strong>
          {meta.versionLabel || t('governance:versionN', { number: meta.versionNumber })}
        </Typography.Text>
        <ReviewStateTag state={meta.reviewState === 'OK' ? 'NONE' : meta.reviewState} />
      </Flex>
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
        <Descriptions.Item label={t('portal:meta.approved')}>
          <Space size={4} wrap>
            {meta.approvedAt ? formatDate(meta.approvedAt, false) : '—'}
            {meta.approvedBy.length > 0 && (
              <Typography.Text type="secondary">
                ({meta.approvedBy.map(name).join(', ')})
              </Typography.Text>
            )}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t('portal:meta.published')}>
          {formatDate(meta.publishedAt, false)}
        </Descriptions.Item>
        <Descriptions.Item label={t('fields.owner')}>{name(meta.owner)}</Descriptions.Item>
        <Descriptions.Item label={t('portal:meta.nextReview')}>
          {meta.nextReviewAt ? formatDate(meta.nextReviewAt, false) : '—'}
        </Descriptions.Item>
        {extra}
      </Descriptions>
    </div>
  );
}
