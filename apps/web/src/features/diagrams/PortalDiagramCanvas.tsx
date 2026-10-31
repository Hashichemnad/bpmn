import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { parseDiagramContent, type DiagramNode, type PortalDiagramDto } from '@processhub/shared';
import { DiagramView } from './DiagramView';
import type { GraphShape } from './kit/graph-modules';

/**
 * A published diagram in the portal: elements linked to a published process or diagram are
 * highlighted and drill down to it (value chain → value chain → BPMN); other elements report
 * their details.
 */
export function PortalDiagramCanvas({
  diagram,
  height,
  onDetail,
}: {
  diagram: PortalDiagramDto;
  height: number | string;
  onDetail?: (node: DiagramNode) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const drill = useMemo(
    () => ({
      processes: new Set(diagram.drillProcesses.map((p) => p.id)),
      diagrams: new Set(diagram.drillDiagrams.map((d) => d.id)),
    }),
    [diagram],
  );
  const markers = useMemo((): Record<string, string[]> => {
    const parsed = parseDiagramContent(diagram.type, diagram.content);
    if (!parsed.ok || !parsed.content || parsed.content.type === 'SIPOC') return {};
    const ids: string[] = parsed.content.nodes
      .filter(
        (n) =>
          (n.processId && drill.processes.has(n.processId)) ||
          (n.diagramId && drill.diagrams.has(n.diagramId)),
      )
      .map((n) => n.id);
    return { 'ph-drill': ids };
  }, [diagram, drill]);
  const onElementClick = (shape: GraphShape) => {
    const n = shape.businessObject;
    if (n.diagramId && drill.diagrams.has(n.diagramId))
      return navigate(`/portal/diagrams/${n.diagramId}`);
    if (n.processId && drill.processes.has(n.processId))
      return navigate(`/portal/processes/${n.processId}`);
    onDetail?.(n);
  };
  return (
    <>
      {markers['ph-drill']?.length ? (
        <Typography.Paragraph type="secondary">
          {t('diagrams:portal.drillHint')}
        </Typography.Paragraph>
      ) : null}
      <DiagramView
        type={diagram.type}
        content={diagram.content}
        height={height}
        markers={markers}
        onElementClick={onElementClick}
      />
    </>
  );
}

/** The portal home's value chain start page (Setting portal.startDiagramId, D-126). */
export function PortalStartValueChain({ diagram }: { diagram: PortalDiagramDto }) {
  return <PortalDiagramCanvas diagram={diagram} height={420} />;
}
