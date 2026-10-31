import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, Drawer, List, Space, Tag, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { DiagramNode } from '@processhub/shared';
import { usePortalDiagram } from '@/api/diagrams';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useLocalized } from '@/components/i18n-helpers';
import { FeedbackButton } from '@/features/portal/FeedbackButton';
import { PortalMeta } from '@/features/portal/PortalMeta';
import { DiagramTypeIcon } from './DiagramTypeIcon';
import { PortalDiagramCanvas } from './PortalDiagramCanvas';

/**
 * /portal/diagrams/:id — a published diagram, read-only. Elements linked to a published process or
 * diagram drill down to it (value chain → value chain → BPMN); other elements show their details.
 */
export function PortalDiagramPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const diagram = usePortalDiagram(id);
  const [detail, setDetail] = useState<DiagramNode | null>(null);
  const data = diagram.data;

  if (diagram.isLoading) return <LoadingState />;
  if (diagram.isError || !data)
    return <ErrorState error={diagram.error} onRetry={() => void diagram.refetch()} />;

  const detailLinks = detail ? data.links.filter((l) => l.elementId === detail.id) : [];

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('portal:nav.home'), to: '/portal' },
          { title: t('diagrams:portal.title'), to: '/portal/diagrams' },
          ...(data.process
            ? [
                {
                  title: `${data.process.code} ${loc(data.process)}`,
                  to: `/portal/processes/${data.process.id}`,
                },
              ]
            : []),
          { title: data.code },
        ]}
        title={
          <Space>
            <DiagramTypeIcon type={data.type} />
            <span className="ph-title-code" dir="ltr">
              {data.code}
            </span>
            {loc(data)}
          </Space>
        }
        subtitle={<Tag bordered={false}>{t(`diagrams:type.${data.type}`)}</Tag>}
        extra={
          <>
            <Button
              icon={<PrinterOutlined />}
              onClick={() => window.open(`/portal/print/diagrams/${data.id}`, '_blank', 'noopener')}
            >
              {t('diagrams:exportPdf')}
            </Button>
            <FeedbackButton type="DIAGRAM" id={data.id} />
          </>
        }
      />
      {(data.descriptionEn || data.descriptionAr) && (
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
          {loc(data, 'description')}
        </Typography.Paragraph>
      )}
      <Card className="ph-portal-diagram">
        <PortalDiagramCanvas diagram={data} height="68vh" onDetail={setDetail} />
      </Card>
      <div style={{ marginBlockStart: 24 }}>
        <PortalMeta meta={data.meta} />
      </div>
      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? loc(detail) || detail.id : ''}
        width={420}
      >
        {detail && (
          <>
            <Tag bordered={false}>{t(`diagrams:kinds.${detail.kind}`)}</Tag>
            {(detail.descriptionEn || detail.descriptionAr) && (
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBlockStart: 12 }}>
                {loc(detail, 'description')}
              </Typography.Paragraph>
            )}
            <List
              size="small"
              header={t('processes:linkedObjects')}
              dataSource={detailLinks}
              locale={{ emptyText: t('diagrams:links.none') }}
              renderItem={(l) => (
                <List.Item>
                  <Space>
                    <Tag bordered={false}>{t(`objects:types.${l.object.type}`)}</Tag>
                    {loc(l.object)}
                  </Space>
                </List.Item>
              )}
            />
          </>
        )}
      </Drawer>
    </>
  );
}
