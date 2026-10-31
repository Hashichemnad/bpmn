import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Drawer, List, Space, Tag, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { parseDiagramContent, type DiagramNode } from '@processhub/shared';
import { usePortalDiagram } from '@/api/diagrams';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useLocalized } from '@/components/i18n-helpers';
import { FeedbackButton } from '@/features/portal/FeedbackButton';
import { PortalMeta } from '@/features/portal/PortalMeta';
import { DiagramTypeIcon } from './DiagramTypeIcon';
import { DiagramView } from './DiagramView';
import type { GraphShape } from './kit/graph-modules';

/**
 * /portal/diagrams/:id — a published diagram, read-only. Elements linked to a published process or
 * diagram drill down to it (value chain → value chain → BPMN); other elements show their details.
 */
export function PortalDiagramPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const diagram = usePortalDiagram(id);
  const [detail, setDetail] = useState<DiagramNode | null>(null);
  const data = diagram.data;

  const drill = useMemo(() => {
    const processes = new Set(data?.drillProcesses.map((p) => p.id));
    const diagrams = new Set(data?.drillDiagrams.map((d) => d.id));
    return { processes, diagrams };
  }, [data]);
  const markers = useMemo<Record<string, string[]>>(() => {
    if (!data) return {};
    const parsed = parseDiagramContent(data.type, data.content);
    if (!parsed.ok || !parsed.content || parsed.content.type === 'SIPOC') return {};
    const result: Record<string, string[]> = {
      'ph-drill': parsed.content.nodes
        .filter(
          (n) =>
            (n.processId && drill.processes.has(n.processId)) ||
            (n.diagramId && drill.diagrams.has(n.diagramId)),
        )
        .map((n) => n.id),
    };
    return result;
  }, [data, drill]);

  if (diagram.isLoading) return <LoadingState />;
  if (diagram.isError || !data)
    return <ErrorState error={diagram.error} onRetry={() => void diagram.refetch()} />;

  const onElementClick = (shape: GraphShape) => {
    const n = shape.businessObject;
    if (n.diagramId && drill.diagrams.has(n.diagramId))
      return navigate(`/portal/diagrams/${n.diagramId}`);
    if (n.processId && drill.processes.has(n.processId))
      return navigate(`/portal/processes/${n.processId}`);
    setDetail(n);
  };
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
        {markers['ph-drill']?.length ? (
          <Typography.Paragraph type="secondary">
            {t('diagrams:portal.drillHint')}
          </Typography.Paragraph>
        ) : null}
        <DiagramView
          type={data.type}
          content={data.content}
          height="68vh"
          markers={markers}
          onElementClick={onElementClick}
        />
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
