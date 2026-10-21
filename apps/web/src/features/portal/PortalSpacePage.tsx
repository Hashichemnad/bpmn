import { useParams } from 'react-router-dom';
import { Card, Col, Row, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { usePortalSpaces } from '@/api/portal';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useLocalized } from '@/components/i18n-helpers';
import { SpaceIcon } from '@/features/docs/SpaceIcon';
import { PortalPageTree } from './PortalPageTree';

export function PortalSpacePage() {
  const { spaceId } = useParams<{ spaceId: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const spaces = usePortalSpaces();
  if (spaces.isLoading) return <LoadingState />;
  const space = spaces.data?.find((s) => s.id === spaceId);
  if (spaces.isError || !space) return <ErrorState error={spaces.error} />;
  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('portal:nav.home'), to: '/portal' },
          { title: t('portal:nav.docs'), to: '/portal/docs' },
          { title: loc(space) },
        ]}
        title={
          <Space>
            <SpaceIcon icon={space.icon} size={28} />
            {loc(space)}
          </Space>
        }
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <PortalPageTree spaceId={space.id} />
        </Col>
        <Col xs={24} lg={16}>
          <Card>
            <Typography.Paragraph className="ph-portal-reading">
              {loc(space, 'description') || t('portal:docs.choosePage')}
            </Typography.Paragraph>
            <Typography.Text type="secondary">
              {t('portal:docs.pageCount', { count: space.pageCount })}
            </Typography.Text>
          </Card>
        </Col>
      </Row>
    </>
  );
}
