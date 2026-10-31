import { useEffect, useMemo, useState } from 'react';
import {
  PERMISSIONS,
  type DiagramNode,
  type ProcessFactDto,
  type ValueChainColourMode,
} from '@processhub/shared';
import { useProcessFacts } from '@/api/diagrams';
import { useGrcSettings } from '@/api/grc';
import { useAuth } from '@/auth/AuthProvider';
import { RAG_HEX } from '@/features/kpi/kpi-helpers';
import { exportGraph, redrawAll, type GraphInstance } from '../kit/graph-diagram';
import { SHAPE_TYPE, type GraphShape, type GraphState } from '../kit/graph-modules';
import { valueChainColours, type LegendEntry } from './value-chain-colours';

/** Value chain view logic shared by the editor: facts, colour by, badges and drill-down. */

interface Overlays {
  add(id: string, type: string, o: { position: Record<string, number>; html: HTMLElement }): string;
  remove(filter: { type: string }): void;
}

/** Process ids linked from the current diagram (refreshed after every change). */
function linkedProcessIds(instance: GraphInstance | null, tick: number): string[] {
  void tick;
  if (!instance) return [];
  return [
    ...new Set(
      exportGraph(instance, 'VALUE_CHAIN').nodes.flatMap((n) => (n.processId ? [n.processId] : [])),
    ),
  ];
}

/** Value chain state for the editor: facts of linked processes, colour by, badges, drill-down. */
export function useValueChain(instance: GraphInstance | null, changeTick: number) {
  const { can } = useAuth();
  const ids = useMemo(() => linkedProcessIds(instance, changeTick), [instance, changeTick]);
  const facts = useProcessFacts(ids);
  const grc = useGrcSettings(can(PERMISSIONS.GRC_READ));
  const [mode, setMode] = useState<ValueChainColourMode>('none');
  const byId = useMemo(() => new Map((facts.data ?? []).map((f) => [f.id, f])), [facts.data]);
  return { facts: byId, mode, setMode, bands: grc.data?.bands ?? [] };
}

/** Applies "Colour by" (view only) and returns the legend. */
export function useColourBy(
  instance: GraphInstance | null,
  state: {
    facts: Map<string, ProcessFactDto>;
    mode: ValueChainColourMode;
    bands: ReturnType<typeof useValueChain>['bands'];
  },
  changeTick: number,
): LegendEntry[] {
  const [legend, setLegend] = useState<LegendEntry[]>([]);
  useEffect(() => {
    if (!instance) return;
    const graphState = instance.get<GraphState>('graphState');
    if (state.mode === 'none' && !graphState.viewColours) return setLegend([]);
    const nodes = exportGraph(instance, 'VALUE_CHAIN').nodes;
    const result = valueChainColours(nodes, state.facts, state.mode, state.bands);
    graphState.viewColours = state.mode === 'none' ? undefined : result.colours;
    setLegend(result.legend);
    redrawAll(instance);
  }, [instance, state.facts, state.mode, state.bands, changeTick]);
  return legend;
}

/** Status / KPI / risk badges on linked elements and a drill-down button (editor). */
export function decorateValueChain(
  instance: GraphInstance,
  facts: Map<string, ProcessFactDto>,
  t: (key: string) => string,
  open: (node: DiagramNode) => void,
) {
  const overlays = instance.get<Overlays>('overlays');
  overlays.remove({ type: 'ph-vc' });
  const shapes = instance
    .get<{ filter(fn: (e: GraphShape) => boolean): GraphShape[] }>('elementRegistry')
    .filter(
      (e) => e.type === SHAPE_TYPE && !!(e.businessObject.processId || e.businessObject.diagramId),
    );
  for (const shape of shapes) {
    const n = shape.businessObject;
    const drill = document.createElement('button');
    drill.type = 'button';
    drill.className = 'ph-vc-drill';
    drill.title = t('diagrams:valueChain.openLinked');
    drill.setAttribute('aria-label', t('diagrams:valueChain.openLinked'));
    drill.textContent = '↗';
    drill.addEventListener('click', (e) => {
      e.stopPropagation();
      open(n);
    });
    overlays.add(shape.id, 'ph-vc', { position: { top: -9, left: -9 }, html: drill });
    const f = n.processId ? facts.get(n.processId) : undefined;
    if (!f) continue;
    const badges = document.createElement('div');
    badges.className = 'ph-vc-badges';
    const pill = (cls: string, text: string, title: string, colour?: string) => {
      const s = document.createElement('span');
      s.className = `ph-vc-badge ${cls}`;
      s.textContent = text;
      s.title = title;
      if (colour) s.style.background = colour;
      badges.appendChild(s);
    };
    pill(
      `is-${f.status.toLowerCase()}`,
      t(`processes:status.${f.status}`),
      t('diagrams:colourBy.status'),
    );
    if (f.kpi)
      pill(
        'is-kpi',
        'KPI',
        `${t('diagrams:colourBy.kpi')}: ${t(`kpi:rag.${f.kpi}`)}`,
        RAG_HEX[f.kpi],
      );
    if (f.risk) pill('is-risk', String(f.risk.score), t('diagrams:colourBy.risk'));
    overlays.add(shape.id, 'ph-vc', { position: { bottom: -10, right: 4 }, html: badges });
  }
}
