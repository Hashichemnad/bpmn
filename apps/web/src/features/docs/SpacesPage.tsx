import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Col, Row, Space, Tag, Tooltip, Typography } from 'antd';
import { FileTextOutlined, LockOutlined, PlusOutlined, SnippetsOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS } from '@processhub/shared';
import { useSpaces } from '@/api/docs';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useFormatNumber, useLocalized } from '@/components/i18n-helpers';
import { SpaceFormModal } from './SpaceFormModal';
import { SpaceIcon } from './SpaceIcon';

export function SpacesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const loc = useLocalized();
  const fmt = useFormatNumber();
  const spaces = useSpaces();
  const [creating, setCreating] = useState(false);
  const canManage = can(PERMISSIONS.DOCS_MANAGE);

  return (
    <>
      <PageHeader
        title={t('docs:spaces.title')}
        subtitle={t('docs:spaces.subtitle')}
        extra={
          canManage && (
            <>
              <Link to="/docs/templates">
                <Button icon={<SnippetsOutlined />}>{t('docs:templates.title')}</Button>
              </Link>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                {t('docs:spaces.new')}
              </Button>
            </>
          )
        }
      />
      {spaces.isLoading ? (
        <LoadingState />
      ) : spaces.isError ? (
        <ErrorState error={spaces.error} onRetry={() => void spaces.refetch()} />
      ) : !spaces.data?.length ? (
        <Card>
          <EmptyState
            description={t('docs:spaces.empty')}
            action={
              canManage && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                  {t('docs:spaces.new')}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {spaces.data.map((s) => (
            <Col key={s.id} xs={24} md={12} xl={8}>
              <Link to={`/docs/${s.id}`} className="ph-tile-link">
                <Card hoverable className="ph-space-card">
                  <Space align="start" size={14}>
                    <SpaceIcon icon={s.icon} size={26} />
                    <div style={{ minInlineSize: 0 }}>
                      <Space size={6} wrap>
                        <Typography.Title level={5} style={{ margin: 0 }}>
                          {loc(s)}
                        </Typography.Title>
                        <Tag className="ph-space-key">{s.key}</Tag>
                        {s.viewRestricted && (
                          <Tooltip title={t('docs:permissions.restrictedView')}>
                            <LockOutlined className="ph-muted" />
                          </Tooltip>
                        )}
                      </Space>
                      <Typography.Paragraph
                        type="secondary"
                        ellipsis={{ rows: 2 }}
                        style={{ margin: '6px 0' }}
                      >
                        {loc(s, 'description') || t('docs:spaces.noDescription')}
                      </Typography.Paragraph>
                      <Space size={12} className="ph-tile-meta" wrap>
                        <span>
                          <FileTextOutlined />{' '}
                          {t('docs:spaces.pages', {
                            count: s.pageCount,
                            formatted: fmt(s.pageCount),
                          })}
                        </span>
                        {s.department && <span>{loc(s.department)}</span>}
                      </Space>
                    </div>
                  </Space>
                </Card>
              </Link>
            </Col>
          ))}
        </Row>
      )}
      {creating && <SpaceFormModal onClose={() => setCreating(false)} />}
    </>
  );
}
