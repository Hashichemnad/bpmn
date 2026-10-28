import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Empty, Flex, Space, Typography } from 'antd';
import { EditOutlined, ExpandOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ProcessDto } from '@processhub/shared';
import { useLinks, useProcessModel } from '@/api/hooks';
import { useComments } from '@/api/governance';
import { useLocale } from '@/app/LocaleProvider';
import { useLocalized } from '@/components/i18n-helpers';
import { ErrorState, LoadingState } from '@/components/states';
import type { BpmnInstance, Canvas, DiagramElement, ElementRegistry, EventBus } from './bpmn-types';
import { createDiagram, importDiagram } from './create-diagram';
import { applyLanguage, normaliseDiagram } from './diagram';
import { afterLayout, fitWidth } from './view';
import { commentBadgeItems, linkBadgeItems, useDiagramOverlays } from './useDiagramOverlays';

/**
 * Model tab of the process page: read-only preview of the working model with badges, and the
 * buttons that open the full-screen modeler workspace. `elementId` (deep link) is highlighted.
 */
export function ModelPreview({ process, elementId }: { process: ProcessDto; elementId?: string }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const loc = useLocalized();
  const navigate = useNavigate();
  const model = useProcessModel(process.id);
  const links = useLinks(process.id);
  const comments = useComments('PROCESS', process.id);
  const ref = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<BpmnInstance | null>(null);
  const [version, setVersion] = useState(0);
  const xml = model.data?.bpmnXml;

  const open = (edit: boolean, element?: string) => {
    const q = new URLSearchParams();
    if (!edit) q.set('view', '1');
    if (element) q.set('element', element);
    const qs = q.toString();
    navigate(`/processes/${process.id}/model${qs ? `?${qs}` : ''}`);
  };

  useEffect(() => {
    if (!ref.current || !xml) return;
    const v = createDiagram('navigated', { container: ref.current });
    let alive = true;
    void importDiagram(v, xml).then(() => {
      if (!alive) return;
      normaliseDiagram(v);
      applyLanguage(v, locale);
      afterLayout(() => alive && fitWidth(v.get<Canvas>('canvas')));
      setViewer(v);
      setVersion((n) => n + 1);
    });
    return () => {
      alive = false;
      setViewer(null);
      v.destroy();
    };
  }, [xml, locale]);

  // Deep link: highlight and show the element.
  useEffect(() => {
    if (!viewer || !elementId) return;
    const canvas = viewer.get<Canvas>('canvas');
    const el = viewer.get<ElementRegistry>('elementRegistry').get(elementId);
    if (!el) return;
    canvas.addMarker(el, 'ph-step-selected');
    afterLayout(() => canvas.scrollToElement(el));
    return () => canvas.removeMarker(el, 'ph-step-selected');
  }, [viewer, version, elementId]);

  // Double-click a step: open it in the workspace.
  useEffect(() => {
    if (!viewer) return;
    const handler = (e: { element: DiagramElement }) => {
      const el = e.element.type === 'label' ? e.element.labelTarget : e.element;
      if (el && el.type !== 'bpmn:Process' && el.type !== 'bpmn:Collaboration')
        open(process.canEditModel, el.id);
    };
    viewer.get<EventBus>('eventBus').on('element.dblclick', handler as never);
    return () => viewer.get<EventBus>('eventBus').off('element.dblclick', handler as never);
  });

  const items = useMemo(
    () => [
      ...linkBadgeItems(
        (links.data ?? []).map((l) => ({ bpmnElementId: l.bpmnElementId, object: l.repoObject })),
        loc,
      ),
      ...commentBadgeItems(comments.data ?? []),
    ],
    [links.data, comments.data, loc],
  );
  useDiagramOverlays({
    instance: viewer,
    version,
    items,
    onBadge: (id) => open(process.canEditModel, id),
    drill: { open: (target) => navigate(`/processes/${target}?tab=model`) },
  });

  if (model.isError) return <ErrorState error={model.error} onRetry={() => void model.refetch()} />;

  return (
    <Card
      size="small"
      className="ph-model-preview"
      title={
        <Space size={6}>
          {t('modeler:preview.title')}
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            {t('modeler:preview.hint')}
          </Typography.Text>
        </Space>
      }
      extra={
        <Flex gap={8} wrap="wrap">
          <Button icon={<ExpandOutlined />} onClick={() => open(false, elementId)}>
            {t('modeler:preview.open')}
          </Button>
          {process.canEditModel && (
            <Button type="primary" icon={<EditOutlined />} onClick={() => open(true, elementId)}>
              {t('modeler:preview.edit')}
            </Button>
          )}
        </Flex>
      }
    >
      {model.isLoading ? (
        <LoadingState />
      ) : xml ? (
        <div
          ref={ref}
          dir="ltr"
          className="ph-model-preview-canvas"
          aria-label={t('modeler:canvas')}
        />
      ) : (
        <Empty description={t('modeler:preview.empty')}>
          {process.canEditModel && (
            <Button type="primary" icon={<EditOutlined />} onClick={() => open(true)}>
              {t('modeler:preview.create')}
            </Button>
          )}
        </Empty>
      )}
    </Card>
  );
}
