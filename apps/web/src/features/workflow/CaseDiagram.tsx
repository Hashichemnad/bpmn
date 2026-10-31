import { useCallback, useEffect, useState } from 'react';
import { Space, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { DiagramCanvas } from '@/features/docs/EmbeddedDiagram';
import type { BpmnInstance, Canvas, ElementRegistry } from '@/features/modeler/bpmn-types';

/**
 * Read-only diagram of a request's process version: current steps highlighted, completed steps
 * marked (Phase 5.2 step 3). The XML is the deployed version the case is pinned to.
 */
export function CaseDiagram({
  xml,
  active,
  completed = [],
  focus,
}: {
  xml: string;
  active: string[];
  completed?: string[];
  focus?: string | null;
}) {
  const { t } = useTranslation();
  const [viewer, setViewer] = useState<BpmnInstance | null>(null);
  const apply = useCallback(
    (v: BpmnInstance) => {
      const canvas = v.get<Canvas>('canvas');
      const registry = v.get<ElementRegistry>('elementRegistry');
      for (const el of registry.getAll()) {
        canvas.removeMarker(el, 'ph-wf-active');
        canvas.removeMarker(el, 'ph-wf-done');
      }
      for (const id of completed) if (registry.get(id)) canvas.addMarker(id, 'ph-wf-done');
      for (const id of active) if (registry.get(id)) canvas.addMarker(id, 'ph-wf-active');
      const target =
        (focus && registry.get(focus)) || (active[0] ? registry.get(active[0]) : undefined);
      if (target) canvas.scrollToElement(target);
    },
    [active, completed, focus],
  );
  useEffect(() => {
    if (viewer) apply(viewer);
  }, [viewer, apply]);
  return (
    <div className="ph-case-diagram" data-testid="case-diagram">
      <DiagramCanvas xml={xml} fit="width" onReady={(v) => setViewer(v)} />
      <Space size={12} style={{ marginBlockStart: 6 }}>
        <Tag className="ph-wf-legend-active">{t('workflow:case.legendActive')}</Tag>
        <Tag className="ph-wf-legend-done">{t('workflow:case.legendDone')}</Tag>
      </Space>
    </div>
  );
}
