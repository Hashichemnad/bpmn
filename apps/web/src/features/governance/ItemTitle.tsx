import { Link } from 'react-router-dom';
import { Space, Tag } from 'antd';
import { FileTextOutlined, PartitionOutlined } from '@ant-design/icons';
import type { ContentRefDto } from '@processhub/shared';
import { useLocalized } from '@/components/i18n-helpers';
import { useTranslation } from 'react-i18next';
import { workspaceLink } from './links';

/** Icon, code and title of a process or page, linking to it. */
export function ItemTitle({ item, to }: { item: ContentRefDto; to?: string }) {
  const loc = useLocalized();
  const { t } = useTranslation();
  return (
    <Space size={6}>
      {item.entityType === 'PROCESS' ? <PartitionOutlined /> : <FileTextOutlined />}
      <Link to={to ?? workspaceLink(item)}>
        {item.code && (
          <span dir="ltr" className="ph-title-code" style={{ marginInlineEnd: 6 }}>
            {item.code}
          </span>
        )}
        {loc(item, 'title') || t('docs:untitled')}
      </Link>
      <Tag bordered={false}>{t(`governance:type.${item.entityType}`)}</Tag>
    </Space>
  );
}
