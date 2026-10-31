import { Link, useNavigate } from 'react-router-dom';
import { Card, Space, Tag, Typography } from 'antd';
import { FileTextOutlined, PartitionOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { PortalItemDto } from '@processhub/shared';
import { CategoryTag } from '@/components/tags';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { DiagramTypeIcon } from '@/features/diagrams/DiagramTypeIcon';
import { portalItemLink } from './portal-links';

/** Card of a published process or page. */
export function PortalItemCard({
  item,
  children,
}: {
  item: PortalItemDto;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  return (
    <Card
      hoverable
      size="small"
      className="ph-portal-card ph-clickable"
      onClick={(e) => {
        // Links inside the card (title, steps) navigate themselves.
        if (!(e.target as HTMLElement).closest('a')) navigate(portalItemLink(item));
      }}
    >
      <Space size={6} wrap style={{ marginBlockEnd: 6 }}>
        {item.type === 'PROCESS' ? (
          <>
            <PartitionOutlined style={{ color: '#1d4ed8' }} />
            {item.category && <CategoryTag category={item.category} />}
          </>
        ) : item.type === 'DIAGRAM' ? (
          <>
            <DiagramTypeIcon type={item.diagramType} />
            {item.diagramType && (
              <Tag bordered={false}>{t(`diagrams:type.${item.diagramType}`)}</Tag>
            )}
          </>
        ) : (
          <>
            <FileTextOutlined style={{ color: '#0f766e' }} />
            {item.space && <Tag bordered={false}>{loc(item.space)}</Tag>}
          </>
        )}
      </Space>
      <Typography.Title level={5} style={{ margin: 0 }}>
        <Link to={portalItemLink(item)} style={{ color: 'inherit' }}>
          {item.code && (
            <span dir="ltr" className="ph-title-code" style={{ marginInlineEnd: 6 }}>
              {item.code}
            </span>
          )}
          {loc(item, 'title') || t('docs:untitled')}
        </Link>
      </Typography.Title>
      {loc(item, 'description') && (
        <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ margin: '6px 0 0' }}>
          {loc(item, 'description')}
        </Typography.Paragraph>
      )}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {item.versionLabel || t('governance:versionN', { number: item.versionNumber })} ·{' '}
        {t('portal:updatedOn', { date: formatDate(item.publishedAt, false) })}
      </Typography.Text>
      {children}
    </Card>
  );
}
