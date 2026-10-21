import { Link } from 'react-router-dom';
import { Card, List, Space, Tag, Typography } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS } from '@processhub/shared';
import { useRelatedPages } from '@/api/docs';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState, ErrorState } from '@/components/states';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';

/** "Related documentation": wiki pages linked to a process or repository object. */
export function RelatedDocsCard({ kind, id }: { kind: 'processes' | 'objects'; id: string }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const pages = useRelatedPages(kind, id, can(PERMISSIONS.DOCS_READ));
  if (!can(PERMISSIONS.DOCS_READ)) return null;
  return (
    <Card title={t('docs:related.title')}>
      {pages.isError ? (
        <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
      ) : (
        <List
          loading={pages.isLoading}
          dataSource={pages.data ?? []}
          locale={{ emptyText: <EmptyState description={t('docs:related.none')} /> }}
          renderItem={(p) => (
            <List.Item>
              <List.Item.Meta
                avatar={<FileTextOutlined className="ph-muted" style={{ marginTop: 4 }} />}
                title={
                  <Space wrap size={6}>
                    <Link to={`/docs/${p.space.id}/pages/${p.id}`}>
                      {loc(p, 'title') || t('docs:untitled')}
                    </Link>
                    <Tag>{loc(p.space)}</Tag>
                  </Space>
                }
                description={
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatDate(p.updatedAt)}
                  </Typography.Text>
                }
              />
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}
