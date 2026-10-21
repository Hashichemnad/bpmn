import { Link } from 'react-router-dom';
import { Card, Col, Empty, Row, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { usePortalSpaces } from '@/api/portal';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useLocalized } from '@/components/i18n-helpers';
import { SpaceIcon } from '@/features/docs/SpaceIcon';

/** Documentation spaces with published pages. */
export function PortalDocsPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const spaces = usePortalSpaces();
  if (spaces.isLoading) return <LoadingState />;
  if (spaces.isError)
    return <ErrorState error={spaces.error} onRetry={() => void spaces.refetch()} />;
  return (
    <>
      <PageHeader
        crumbs={[{ title: t('portal:nav.home'), to: '/portal' }, { title: t('portal:nav.docs') }]}
        title={t('portal:docs.title')}
        subtitle={t('portal:docs.subtitle')}
      />
      {spaces.data?.length ? (
        <Row gutter={[16, 16]}>
          {spaces.data.map((s) => (
            <Col xs={24} md={12} lg={8} key={s.id}>
              <Link to={`/portal/docs/${s.id}`} style={{ display: 'block', blockSize: '100%' }}>
                <Card hoverable className="ph-portal-card">
                  <Card.Meta
                    avatar={<SpaceIcon icon={s.icon} size={36} />}
                    title={loc(s)}
                    description={
                      <>
                        <Typography.Paragraph
                          type="secondary"
                          ellipsis={{ rows: 2 }}
                          style={{ marginBlockEnd: 4 }}
                        >
                          {loc(s, 'description')}
                        </Typography.Paragraph>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t('portal:docs.pageCount', { count: s.pageCount })}
                        </Typography.Text>
                      </>
                    }
                  />
                </Card>
              </Link>
            </Col>
          ))}
        </Row>
      ) : (
        <Empty description={t('portal:docs.empty')} />
      )}
    </>
  );
}
