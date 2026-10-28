import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Space, Switch, Tooltip, Typography } from 'antd';
import {
  CheckCircleOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import type { PortalProcessDto } from '@processhub/shared';
import { useMyPortal } from '@/api/portal';
import { useAuth } from '@/auth/AuthProvider';
import { useLocalized } from '@/components/i18n-helpers';
import { DiagramCanvas } from '@/features/docs/EmbeddedDiagram';
import type {
  BpmnInstance,
  Canvas,
  DiagramElement,
  ElementRegistry,
  EventBus,
} from '@/features/modeler/bpmn-types';
import { MinimapModule, setMinimap } from '@/features/modeler/minimap';
import { linkBadgeItems, useDiagramOverlays } from '@/features/modeler/useDiagramOverlays';
import { useWorkspacePrefs } from '@/features/modeler/workspace-prefs';
import { ZoomControl } from '@/features/modeler/ZoomControl';
import { myStepIds, stepInfo, type StepInfo } from './step-info';

const SELECTABLE =
  /^bpmn:(Task|UserTask|ServiceTask|ManualTask|ScriptTask|BusinessRuleTask|SendTask|ReceiveTask|SubProcess|CallActivity|StartEvent|EndEvent|IntermediateCatchEvent|IntermediateThrowEvent|ExclusiveGateway|ParallelGateway|InclusiveGateway|EventBasedGateway)$/;

/**
 * Read-only published diagram: click a step to see its details; call activities linked to a
 * published process show a drill-down button. Badges show the published links of each step;
 * "Highlight my steps" emphasises the steps of the reader's job roles.
 */
export function PortalDiagram({
  process,
  selectedId,
  onSelect,
}: {
  process: PortalProcessDto;
  selectedId: string | null;
  onSelect: (step: StepInfo | null) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const loc = useLocalized();
  const { user } = useAuth();
  const my = useMyPortal();
  const [prefs, updatePrefs] = useWorkspacePrefs(user?.id);
  const [viewer, setViewer] = useState<BpmnInstance | null>(null);
  const [version, setVersion] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [highlight, setHighlight] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const modules = useMemo(() => [MinimapModule], []);

  const mine = useMemo(
    () => myStepIds(process, new Set((my.data?.jobRoles ?? []).map((r) => r.id))),
    [process, my.data],
  );

  const mark = useCallback((v: BpmnInstance | null, id: string | null) => {
    if (!v) return;
    const canvas = v.get<Canvas>('canvas');
    const registry = v.get<ElementRegistry>('elementRegistry');
    for (const el of registry.filter(() => true)) canvas.removeMarker(el.id, 'ph-step-selected');
    if (id && registry.get(id)) canvas.addMarker(id, 'ph-step-selected');
  }, []);

  const ready = (v: BpmnInstance) => {
    const registry = v.get<ElementRegistry>('elementRegistry');
    const canvas = v.get<Canvas>('canvas');
    for (const el of registry.filter((e) => SELECTABLE.test(e.type))) {
      canvas.addMarker(el.id, 'ph-step-clickable');
    }
    const eventBus = v.get<EventBus>('eventBus');
    eventBus.on('element.click', (e: { element: DiagramElement }) => {
      const el = e.element.type === 'label' ? e.element.labelTarget : e.element;
      selectRef.current(el && SELECTABLE.test(el.type) ? stepInfo(el) : null);
    });
    eventBus.on('canvas.viewbox.changed', (e: { viewbox: { scale: number } }) =>
      setZoom(e.viewbox.scale),
    );
    setZoom(canvas.zoom());
    const id = selectedRef.current;
    const el = id ? registry.get(id) : undefined;
    if (el) {
      selectRef.current(stepInfo(el));
      canvas.scrollToElement(el);
    }
    mark(v, id);
    setViewer(v);
    setVersion((n) => n + 1);
  };

  useEffect(() => mark(viewer, selectedId), [viewer, selectedId, mark]);
  useEffect(() => {
    if (viewer) setMinimap(viewer, prefs.minimap);
  }, [viewer, version, prefs.minimap]);

  // Highlight my steps: emphasise them and fade the others.
  useEffect(() => {
    if (!viewer) return;
    const canvas = viewer.get<Canvas>('canvas');
    const steps = viewer
      .get<ElementRegistry>('elementRegistry')
      .filter((e) => SELECTABLE.test(e.type));
    for (const el of steps) {
      canvas.removeMarker(el, 'ph-step-mine');
      canvas.removeMarker(el, 'ph-step-faded');
      if (highlight) canvas.addMarker(el, mine.has(el.id) ? 'ph-step-mine' : 'ph-step-faded');
    }
  }, [viewer, version, highlight, mine]);

  const published = useMemo(() => new Set(process.drillTargets.map((d) => d.id)), [process]);
  const items = useMemo(() => linkBadgeItems(process.links, loc), [process.links, loc]);
  useDiagramOverlays({
    instance: viewer,
    version,
    items,
    onBadge: (id) => {
      const el = viewer?.get<ElementRegistry>('elementRegistry').get(id);
      if (el) selectRef.current(stepInfo(el));
    },
    drill: {
      allowed: (target) => published.has(target),
      open: (target) => navigate(`/portal/processes/${target}`),
    },
  });

  useEffect(() => {
    const onChange = () => {
      setFullscreen(document.fullscreenElement === wrapRef.current);
      viewer?.get<Canvas>('canvas').resized();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [viewer]);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void wrapRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  if (!process.bpmnXml) return null;
  return (
    <div
      ref={wrapRef}
      className={`ph-portal-diagram${prefs.badges ? '' : ' ph-badges-off'}${fullscreen ? ' is-fullscreen' : ''}`}
    >
      <div className="ph-portal-diagram-bar" role="toolbar" aria-label={t('portal:diagram.tools')}>
        <ZoomControl instance={viewer} zoom={zoom} />
        <Space size={12} wrap>
          <Tooltip title={mine.size ? undefined : t('portal:diagram.noMySteps')}>
            <Space size={6}>
              <Switch
                size="small"
                checked={highlight}
                disabled={!mine.size}
                onChange={setHighlight}
                aria-label={t('portal:diagram.highlightMine')}
              />
              <Typography.Text type={mine.size ? undefined : 'secondary'}>
                {t('portal:diagram.highlightMine')}
                {mine.size ? ` (${mine.size})` : ''}
              </Typography.Text>
            </Space>
          </Tooltip>
          <Tooltip title={t('modeler:view.badges')}>
            <Button
              size="small"
              type={prefs.badges ? 'primary' : 'default'}
              ghost={prefs.badges}
              icon={<TagsOutlined />}
              aria-pressed={prefs.badges}
              aria-label={t('modeler:view.badges')}
              onClick={() => updatePrefs({ badges: !prefs.badges })}
            />
          </Tooltip>
          <Button
            size="small"
            icon={prefs.minimap ? <CheckCircleOutlined /> : undefined}
            aria-pressed={prefs.minimap}
            onClick={() => updatePrefs({ minimap: !prefs.minimap })}
          >
            {t('modeler:view.minimap')}
          </Button>
          <Tooltip
            title={
              fullscreen
                ? t('modeler:workspace.fullscreenLeave')
                : t('modeler:workspace.fullscreen')
            }
          >
            <Button
              size="small"
              icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              aria-label={
                fullscreen
                  ? t('modeler:workspace.fullscreenLeave')
                  : t('modeler:workspace.fullscreen')
              }
              onClick={toggleFullscreen}
            />
          </Tooltip>
        </Space>
      </div>
      <DiagramCanvas
        xml={process.bpmnXml}
        className="ph-portal-canvas"
        onReady={ready}
        modules={modules}
        fit="width"
      />
    </div>
  );
}
