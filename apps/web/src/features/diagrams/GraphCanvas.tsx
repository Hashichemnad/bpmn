import { useEffect, useRef, useState } from 'react';
import { DEFAULT_DIAGRAM_THEME, type GraphContent } from '@processhub/shared';
import { usePublicSettings } from '@/api/hooks';
import { useLocale } from '@/app/LocaleProvider';
import { fitPage } from '@/features/modeler/view';
import type { Canvas } from '@/features/modeler/bpmn-types';
import {
  createGraphDiagram,
  importGraph,
  redrawAll,
  type GraphInstance,
} from './kit/graph-diagram';
import type { GraphShape, GraphState } from './kit/graph-modules';
import { NOTATIONS } from './kit/notations';

export interface GraphCanvasProps {
  content: GraphContent;
  height?: number | string;
  className?: string;
  /** Element ids to highlight with a marker class: { 'ph-diff-added': [...], … }. */
  markers?: Record<string, string[]>;
  onElementClick?: (shape: GraphShape) => void;
  /** Called once the diagram is shown (badges, drill-down overlays). */
  onReady?: (instance: GraphInstance) => void | (() => void);
}

/** Read-only graph diagram with pan and zoom (portal, review, versions, print). */
export function GraphCanvas({
  content,
  height = 480,
  className,
  markers,
  onElementClick,
  onReady,
}: GraphCanvasProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { locale } = useLocale();
  const settings = usePublicSettings();
  const theme = settings.data?.diagramTheme ?? DEFAULT_DIAGRAM_THEME;
  const stateRef = useRef<GraphState>({
    notation: NOTATIONS[content.type],
    locale,
    theme,
    readOnly: true,
  });
  const [instance, setInstance] = useState<GraphInstance | null>(null);
  const clickRef = useRef(onElementClick);
  clickRef.current = onElementClick;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    if (!ref.current) return;
    const inst = createGraphDiagram('viewer', ref.current, stateRef.current);
    inst
      .get<{ on(e: string, cb: (e: { element: GraphShape }) => void): void }>('eventBus')
      .on('element.click', (e) => {
        if (e.element.businessObject) clickRef.current?.(e.element);
      });
    setInstance(inst);
    return () => inst.destroy();
  }, []);

  useEffect(() => {
    if (!instance) return;
    stateRef.current.notation = NOTATIONS[content.type];
    let cleanup: void | (() => void);
    let cancelled = false;
    void importGraph(instance, content).then(() => {
      if (cancelled) return;
      const canvas = instance.get<Canvas>('canvas');
      for (const [cls, ids] of Object.entries(markers ?? {}))
        for (const id of ids) {
          try {
            canvas.addMarker(id, cls);
          } catch {
            /* element not in this version */
          }
        }
      requestAnimationFrame(() => fitPage(canvas));
      cleanup = readyRef.current?.(instance);
    });
    return () => {
      cancelled = true;
      if (typeof cleanup === 'function') cleanup();
    };
  }, [instance, content, markers]);

  useEffect(() => {
    stateRef.current.locale = locale;
    stateRef.current.theme = theme;
    if (instance) redrawAll(instance);
  }, [locale, theme, instance]);

  return (
    <div
      ref={ref}
      dir="ltr"
      className={['ph-graph-canvas', className].filter(Boolean).join(' ')}
      style={{ height }}
    />
  );
}
