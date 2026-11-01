import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Col, Descriptions, List, Row, Space, Typography } from 'antd';
import { FileTextOutlined, GlobalOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { ExportDialog, type ExportRequest } from '@/features/exports/ExportDialog';
import { usePageTree } from '@/api/docs';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/states';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { useSpaceContext } from './space-context';
import { SpaceIcon } from './SpaceIcon';

export function SpaceHomePage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const { space, newPage } = useSpaceContext();
  const tree = usePageTree(space.id);
  const [exportReq, setExportReq] = useState<ExportRequest | null>(null);
  const recent = useMemo(
    () => [...(tree.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8),
    [tree.data],
  );
  const top = (tree.data ?? [])
    .filter((p) => !p.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <>
      <PageHeader
        crumbs={[{ title: t('nav.docs'), to: '/docs' }, { title: loc(space) }]}
        title={
          <span>
            <SpaceIcon icon={space.icon} size={24} /> {loc(space)}
          </span>
        }
        subtitle={loc(space, 'description')}
        extra={
          <Space wrap>
            <Button
              icon={<GlobalOutlined />}
              onClick={() =>
                setExportReq({ format: 'html', scope: 'SPACE', id: space.id, title: loc(space) })
              }
            >
              {t('integrations:export.menuHtml')}
            </Button>
            {space.canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => newPage(null)}>
                {t('docs:pages.new')}
              </Button>
            )}
          </Space>
        }
      />
      <ExportDialog request={exportReq} onClose={() => setExportReq(null)} />
      {!tree.isLoading && !tree.data?.length ? (
        <Card>
          <EmptyState
            description={t('docs:pages.emptySpace')}
            action={
              space.canEdit && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => newPage(null)}>
                  {t('docs:pages.createFirst')}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Row gutter={[24, 24]}>
          <Col xs={24} xl={16}>
            <Card title={t('docs:spaces.contents')} loading={tree.isLoading}>
              <List
                dataSource={top}
                renderItem={(p) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={<FileTextOutlined className="ph-muted" />}
                      title={
                        <Link to={`/docs/${space.id}/pages/${p.id}`}>
                          {loc(p, 'title') || t('docs:untitled')}
                        </Link>
                      }
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Col>
          <Col xs={24} xl={8}>
            <Card
              title={t('docs:spaces.recent')}
              loading={tree.isLoading}
              style={{ marginBottom: 24 }}
            >
              <List
                size="small"
                dataSource={recent}
                renderItem={(p) => (
                  <List.Item>
                    <Link to={`/docs/${space.id}/pages/${p.id}`}>
                      {loc(p, 'title') || t('docs:untitled')}
                    </Link>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDate(p.updatedAt, false)}
                    </Typography.Text>
                  </List.Item>
                )}
              />
            </Card>
            <Card title={t('docs:spaces.about')}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label={t('docs:spaces.key')}>
                  <span dir="ltr">{space.key}</span>
                </Descriptions.Item>
                <Descriptions.Item label={t('fields.owner')}>
                  {loc(space.owner) || space.owner?.email || '—'}
                </Descriptions.Item>
                <Descriptions.Item label={t('fields.department')}>
                  {loc(space.department) || '—'}
                </Descriptions.Item>
                <Descriptions.Item label={t('docs:permissions.accessLabel')}>
                  {space.viewRestricted
                    ? t('docs:permissions.restrictedView')
                    : t('docs:permissions.openView')}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
        </Row>
      )}
    </>
  );
}
