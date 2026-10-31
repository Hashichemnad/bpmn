import Diagram from 'diagram-js';
import ModelingModule from 'diagram-js/lib/features/modeling';
import MoveModule from 'diagram-js/lib/features/move';
import CreateModule from 'diagram-js/lib/features/create';
import ConnectModule from 'diagram-js/lib/features/connect';
import ContextPadModule from 'diagram-js/lib/features/context-pad';
import ResizeModule from 'diagram-js/lib/features/resize';
import BendpointsModule from 'diagram-js/lib/features/bendpoints';
import ConnectionPreviewModule from 'diagram-js/lib/features/connection-preview';
import LassoToolModule from 'diagram-js/lib/features/lasso-tool';
import HandToolModule from 'diagram-js/lib/features/hand-tool';
import GlobalConnectModule from 'diagram-js/lib/features/global-connect';
import SnappingModule from 'diagram-js/lib/features/snapping';
import GridSnappingModule from 'diagram-js/lib/features/grid-snapping';
import AlignElementsModule from 'diagram-js/lib/features/align-elements';
import DistributeElementsModule from 'diagram-js/lib/features/distribute-elements';
import KeyboardModule from 'diagram-js/lib/features/keyboard';
import EditorActionsModule from 'diagram-js/lib/features/editor-actions';
import KeyboardMoveSelectionModule from 'diagram-js/lib/features/keyboard-move-selection';
import AutoScrollModule from 'diagram-js/lib/features/auto-scroll';
import OutlineModule from 'diagram-js/lib/features/outline';
import SelectionModule from 'diagram-js/lib/features/selection';
import OverlaysModule from 'diagram-js/lib/features/overlays';
import ZoomScrollModule from 'diagram-js/lib/navigation/zoomscroll';
import MoveCanvasModule from 'diagram-js/lib/navigation/movecanvas';
import KeyboardMoveModule from 'diagram-js/lib/navigation/keyboard-move';
import DirectEditingModule from 'diagram-js-direct-editing';
import 'diagram-js/assets/diagram-js.css';
import type { DiagramEdge, DiagramNode, GraphContent } from '@processhub/shared';
import { MinimapModule } from '@/features/modeler/minimap';
import { diagramFontsReady } from '@/features/modeler/create-diagram';
import {
  EDGE_TYPE,
  SHAPE_TYPE,
  graphModule,
  graphViewerModule,
  isConnection,
  type GraphConnection,
  type GraphShape,
  type GraphState,
} from './graph-modules';
import { contextPadModule } from './context-pad';

/** A diagram-js instance (modeler or viewer) of one of the graph notations. */
export interface GraphInstance {
  get<T = unknown>(service: string, strict?: boolean): T;
  destroy(): void;
}

interface Canvas {
  getRootElement(): unknown;
  setRootElement(el: unknown): unknown;
  addShape(shape: unknown, parent?: unknown): GraphShape;
  addConnection(conn: unknown, parent?: unknown): GraphConnection;
  getActiveLayer(): SVGGraphicsElement;
  getContainer(): HTMLElement;
  _svg: SVGSVGElement;
}

interface ElementFactory {
  createRoot(attrs: Record<string, unknown>): unknown;
  createShape(attrs: Record<string, unknown>): GraphShape;
  createConnection(attrs: Record<string, unknown>): GraphConnection;
}

/** modeler: editable; viewer: read-only with pan / zoom (portal, review, print). */
export function createGraphDiagram(
  kind: 'modeler' | 'viewer',
  container: HTMLElement,
  state: GraphState,
  config: Record<string, unknown> = {},
): GraphInstance {
  const navigation = [ZoomScrollModule, MoveCanvasModule, SelectionModule, OverlaysModule];
  const modules =
    kind === 'modeler'
      ? [
          ...navigation,
          ModelingModule,
          MoveModule,
          CreateModule,
          ConnectModule,
          ContextPadModule,
          ResizeModule,
          BendpointsModule,
          ConnectionPreviewModule,
          LassoToolModule,
          HandToolModule,
          GlobalConnectModule,
          SnappingModule,
          GridSnappingModule,
          AlignElementsModule,
          DistributeElementsModule,
          KeyboardModule,
          EditorActionsModule,
          KeyboardMoveSelectionModule,
          KeyboardMoveModule,
          AutoScrollModule,
          OutlineModule,
          DirectEditingModule,
          MinimapModule,
          graphModule(state),
          contextPadModule,
        ]
      : [...navigation, OutlineModule, MinimapModule, graphViewerModule(state)];
  return new Diagram({
    canvas: { container },
    modules,
    gridSnapping: { active: true },
    ...config,
  } as never) as unknown as GraphInstance;
}

/** Replaces the diagram with the given content (no undo history). */
export async function importGraph(instance: GraphInstance, content: GraphContent): Promise<void> {
  await diagramFontsReady();
  const canvas = instance.get<Canvas>('canvas');
  const factory = instance.get<ElementFactory>('elementFactory');
  (instance as unknown as { clear(): void }).clear();
  const root = factory.createRoot({ id: '__ph_root' });
  canvas.setRootElement(root);
  const shapes = new Map<string, GraphShape>();
  // Parents (frames) before their children so children can be added inside.
  const nodes = [...content.nodes].sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId));
  for (const n of nodes) {
    const { x, y, width, height, ...rest } = n;
    const shape = factory.createShape({
      id: n.id,
      x,
      y,
      width,
      height,
      businessObject: rest,
    });
    const parent = (n.parentId && shapes.get(n.parentId)) || root;
    shapes.set(n.id, canvas.addShape(shape, parent));
  }
  for (const e of content.edges) {
    const source = shapes.get(e.sourceId);
    const target = shapes.get(e.targetId);
    if (!source || !target) continue;
    const conn = factory.createConnection({
      id: e.id,
      source,
      target,
      waypoints: e.waypoints.length >= 2 ? e.waypoints : straight(source, target),
      businessObject: { kind: e.kind, nameEn: e.nameEn, nameAr: e.nameAr },
    });
    canvas.addConnection(conn, root);
  }
  instance.get<{ fire(e: string, p?: unknown): void }>('eventBus').fire('import.done', {});
}

const centre = (s: GraphShape) => ({
  x: Math.round(s.x + s.width / 2),
  y: Math.round(s.y + s.height / 2),
});
const straight = (a: GraphShape, b: GraphShape) => [centre(a), centre(b)];

const round = (n: number) => Math.round(n * 10) / 10;

/** Current diagram as content JSON (stable order: shapes by position, then edges). */
export function exportGraph(instance: GraphInstance, type: GraphContent['type']): GraphContent {
  const all = instance
    .get<{ getAll(): (GraphShape | GraphConnection)[] }>('elementRegistry')
    .getAll();
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  for (const el of all) {
    if (isConnection(el)) {
      if (el.type !== EDGE_TYPE) continue;
      const bo = el.businessObject;
      edges.push({
        id: el.id,
        kind: bo.kind,
        sourceId: el.source.id,
        targetId: el.target.id,
        waypoints: el.waypoints.map((p) => ({ x: round(p.x), y: round(p.y) })),
        nameEn: bo.nameEn ?? '',
        nameAr: bo.nameAr ?? '',
      });
    } else if (el.type === SHAPE_TYPE) {
      const bo = { ...el.businessObject } as DiagramNode & Record<string, unknown>;
      const parent = el.parent as GraphShape | undefined;
      const node: DiagramNode = {
        ...bo,
        id: el.id,
        x: round(el.x),
        y: round(el.y),
        width: round(el.width),
        height: round(el.height),
      };
      delete node.parentId;
      if (parent?.type === SHAPE_TYPE) node.parentId = parent.id;
      nodes.push(node);
    }
  }
  nodes.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  edges.sort((a, b) => a.id.localeCompare(b.id));
  return { schema: 1, type, nodes, edges };
}

const EXPORT_PADDING = 16;

/** SVG of the whole diagram (like bpmn-js saveSVG): content layer, padded bounding box. */
export function graphSvg(instance: GraphInstance): string {
  const canvas = instance.get<Canvas>('canvas');
  const layer = canvas.getActiveLayer();
  const container = canvas.getContainer();
  container.classList.add('djs-outline-hidden');
  let box: DOMRect;
  try {
    box = layer.getBBox();
  } finally {
    container.classList.remove('djs-outline-hidden');
  }
  const x = box.x - EXPORT_PADDING;
  const y = box.y - EXPORT_PADDING;
  const w = box.width + EXPORT_PADDING * 2;
  const h = box.height + EXPORT_PADDING * 2;
  // Selection outlines and overlays are not part of the exported drawing.
  const clone = layer.cloneNode(true) as SVGGElement;
  clone
    .querySelectorAll('.djs-outline, .djs-hit, .djs-bendpoints, .djs-segment-dragger')
    .forEach((n) => n.remove());
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" version="1.1">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#FFFFFF"/>` +
    clone.innerHTML +
    '</svg>'
  );
}

/** Redraws every element (language or theme changed). */
export function redrawAll(instance: GraphInstance): void {
  const registry = instance.get<{ getAll(): { type: string }[] }>('elementRegistry');
  const elements = registry.getAll().filter((e) => e.type === SHAPE_TYPE || e.type === EDGE_TYPE);
  instance.get<{ fire(e: string, p: unknown): void }>('eventBus').fire('elements.changed', {
    elements,
  });
}
