import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import TextUtil from 'diagram-js/lib/util/Text';
import RuleProvider from 'diagram-js/lib/features/rules/RuleProvider';
import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';
import BaseLayouter from 'diagram-js/lib/layout/BaseLayouter';
import CroppingConnectionDocking from 'diagram-js/lib/layout/CroppingConnectionDocking';
import { connectRectangles } from 'diagram-js/lib/layout/ManhattanLayout';
import { getMid } from 'diagram-js/lib/layout/LayoutUtil';
import { append as svgAppend, attr as svgAttr, create as svgCreate } from 'tiny-svg';
import type { DiagramNode, DiagramTheme, Locale } from '@processhub/shared';
import { DIAGRAM_FONT } from '@/features/modeler/renderer';
import { blockColour, edgeDef, kindColours, nodeDef, type Notation } from './notations';
import { arrowHead, outlinePath, polylineMiddle, translatePath } from './shapes';

/**
 * diagram-js building blocks shared by every graph notation (value chain, organisation chart,
 * EPC — D-120): element factory with stable ids, renderer (shapes, bilingual labels, theme
 * colours), rules from the notation, connection layout, an undoable "update properties" command
 * and direct label editing in the active language.
 */

/** Shared, mutable state the modules read (the editor updates it in place). */
export interface GraphState {
  notation: Notation;
  locale: Locale;
  theme: DiagramTheme;
  readOnly: boolean;
  /** Connection kind chosen in the context pad for the connect tool in progress. */
  connectKind?: string;
  /** "Colour by" view colours per element id (shown only, never stored). */
  viewColours?: Map<string, { fill: string; stroke: string }>;
}

export const SHAPE_TYPE = 'ph:node';
export const EDGE_TYPE = 'ph:edge';

export interface Point {
  x: number;
  y: number;
}

/** Business data of an edge (stored as is in the content). */
export interface EdgeData {
  id: string;
  kind: string;
  nameEn: string;
  nameAr: string;
}

export interface GraphShape {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  businessObject: DiagramNode;
  parent?: GraphElement;
  children?: GraphElement[];
  incoming?: GraphConnection[];
  outgoing?: GraphConnection[];
}

export interface GraphConnection {
  id: string;
  type: string;
  waypoints: Point[];
  source: GraphShape;
  target: GraphShape;
  businessObject: EdgeData;
  parent?: GraphElement;
}

export type GraphElement = GraphShape | GraphConnection;

export const isConnection = (el: object): el is GraphConnection =>
  Array.isArray((el as { waypoints?: unknown }).waypoints);

/** Element ids: kind + random suffix (unique across sessions, valid in DMN / BPMN conversions). */
export function newElementId(kind: string): string {
  const prefix = kind.charAt(0).toUpperCase() + kind.slice(1).replace(/[^\w]/g, '');
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Label of a shape / edge in the active language, falling back to the other one. */
export function labelOf(
  data: { nameEn?: string; nameAr?: string },
  locale: Locale,
): { text: string; fallback: boolean } {
  const own = (locale === 'ar' ? data.nameAr : data.nameEn) ?? '';
  if (own) return { text: own, fallback: false };
  const other = (locale === 'ar' ? data.nameEn : data.nameAr) ?? '';
  return { text: other, fallback: !!other };
}

const ARABIC = /[؀-ۿ]/;

// ---------- Element factory ----------

interface CreateAttrs {
  id?: string;
  type?: string;
  businessObject?: Partial<DiagramNode> & Partial<EdgeData>;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

type Create = (type: string, attrs?: CreateAttrs) => unknown;

/**
 * Gives every new shape / connection a stable random id, the shape size of its kind and a
 * business object (diagram-js would number ids from 1 again in every session).
 */
class PhElementIds {
  static $inject = ['elementFactory', 'graphState'];
  constructor(factory: { create: Create }, state: GraphState) {
    const create = factory.create.bind(factory) as Create;
    factory.create = (elementType, attrs = {}) => {
      if (elementType !== 'shape' && elementType !== 'connection')
        return create(elementType, attrs);
      const bo = { ...(attrs.businessObject ?? {}) };
      const kind = bo.kind ?? (elementType === 'connection' ? 'flow' : 'node');
      const id = attrs.id ?? bo.id ?? newElementId(kind);
      if (elementType === 'connection') {
        const data: EdgeData = { id, kind, nameEn: bo.nameEn ?? '', nameAr: bo.nameAr ?? '' };
        return create('connection', { ...attrs, id, type: EDGE_TYPE, businessObject: data });
      }
      const def = nodeDef(state.notation, kind);
      const node = { nameEn: '', nameAr: '', ...bo, id, kind } as DiagramNode;
      return create('shape', {
        width: def.width,
        height: def.height,
        ...attrs,
        id,
        type: SHAPE_TYPE,
        businessObject: node,
        isFrame: !!def.container,
      });
    };
  }
}

// ---------- Renderer ----------

interface TextUtilLike {
  createText(
    text: string,
    options: {
      box: { width: number; height: number };
      align?: string;
      padding?: number;
      style?: Record<string, string | number>;
    },
  ): SVGTextElement;
}

const LABEL_COLOUR = '#1F2933';

class GraphRenderer extends BaseRenderer {
  static $inject = ['eventBus', 'graphState'];
  private readonly text: TextUtilLike;

  constructor(
    eventBus: unknown,
    private readonly state: GraphState,
  ) {
    super(eventBus as never, 2000);
    this.text = new TextUtil({
      style: { fontFamily: DIAGRAM_FONT, fontSize: 12, lineHeight: 1.25 },
    }) as unknown as TextUtilLike;
  }

  override canRender(element: object) {
    const type = (element as { type?: string }).type;
    return type === SHAPE_TYPE || type === EDGE_TYPE;
  }

  private colours(node: DiagramNode) {
    const def = nodeDef(this.state.notation, node.kind);
    const view = this.state.viewColours?.get(node.id);
    if (view) return { ...view, def };
    const base = blockColour(node, this.state.theme) ?? kindColours(def.colour, this.state.theme);
    return { fill: node.fill ?? base.fill, stroke: node.stroke ?? base.stroke, def };
  }

  override drawShape(parent: SVGElement, element: GraphShape) {
    const node = element.businessObject;
    const { fill, stroke, def } = this.colours(node);
    const { width: w, height: h } = element;
    const outline = svgCreate('path', {
      d: outlinePath(def.outline, w, h),
      fill: def.outline === 'frame' ? fill : fill,
      'fill-opacity': def.outline === 'frame' ? 0.55 : 1,
      stroke,
      'stroke-width': def.outline === 'unit' ? 2 : 1.5,
      ...(def.outline === 'frame' ? { 'stroke-dasharray': '6 4' } : {}),
    });
    svgAppend(parent, outline);
    this.decorate(parent, def.outline, w, h, stroke);
    if (def.symbol) {
      const t = svgCreate('text', {
        x: w / 2,
        y: h / 2 + 7,
        'text-anchor': 'middle',
        'font-size': 20,
        'font-family': 'Arial, sans-serif',
        fill: stroke,
      });
      t.textContent = def.symbol;
      svgAppend(parent, t);
    } else {
      this.drawLabel(
        parent,
        node,
        w,
        h,
        def.labelTop ? 'center-top' : 'center-middle',
        def.outline,
      );
    }
    return outline;
  }

  /** Extra strokes that identify a kind (person icon, system bars, org unit line …). */
  private decorate(parent: SVGElement, outline: string, w: number, h: number, stroke: string) {
    const line = (d: string, extra: Record<string, string | number> = {}) =>
      svgAppend(
        parent,
        svgCreate('path', { d, fill: 'none', stroke, 'stroke-width': 1.2, ...extra }),
      );
    if (outline === 'system') {
      line(`M8,0 V${h} M${w - 8},0 V${h}`);
    } else if (outline === 'orgUnit') {
      line(`M${w * 0.16},${h * 0.14} V${h * 0.86}`);
    } else if (outline === 'information') {
      line(`M0,12 H${w}`);
    } else if (outline === 'processPath') {
      line(translatePath(outlinePath('event', 26, 14), w - 32, h - 20));
    } else if (outline === 'person') {
      const cx = 18;
      const cy = h / 2;
      line(`M${cx - 6},${cy + 9} C${cx - 6},${cy + 2} ${cx + 6},${cy + 2} ${cx + 6},${cy + 9}`);
      svgAppend(
        parent,
        svgCreate('circle', { cx, cy: cy - 4, r: 4, fill: 'none', stroke, 'stroke-width': 1.2 }),
      );
    } else if (outline === 'position') {
      line(`M10,${h - 7} H${w - 10}`, { 'stroke-opacity': 0.35 });
    }
  }

  private drawLabel(
    parent: SVGElement,
    data: { nameEn?: string; nameAr?: string },
    w: number,
    h: number,
    align: string,
    outline: string,
  ) {
    const { text, fallback } = labelOf(data, this.state.locale);
    if (!text) return;
    const inset =
      outline === 'chevron' ? Math.min(h / 2, w * 0.2) * 0.6 : outline === 'person' ? 14 : 0;
    const t = this.text.createText(text, {
      box: { width: w - inset * 2, height: h },
      align,
      padding: align === 'center-top' ? 8 : 6,
      style: {
        fill: LABEL_COLOUR,
        fontWeight: align === 'center-top' ? 600 : 'normal',
        ...(fallback ? { fontStyle: 'italic', fillOpacity: 0.65 } : {}),
      },
    });
    if (ARABIC.test(text)) t.setAttribute('direction', 'rtl');
    if (inset) svgAttr(t, { transform: `translate(${inset}, 0)` });
    t.classList.add('ph-graph-label');
    svgAppend(parent, t);
  }

  override drawConnection(parent: SVGElement, element: GraphConnection) {
    const def = edgeDef(this.state.notation, element.businessObject.kind);
    const pts = element.waypoints;
    const stroke = '#475569';
    const path = svgCreate('path', {
      d: pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '),
      fill: 'none',
      stroke,
      'stroke-width': 1.5,
      'stroke-linejoin': 'round',
      ...(def.dashed ? { 'stroke-dasharray': '7 5' } : {}),
      ...(def.dotted ? { 'stroke-dasharray': '2 4', 'stroke-linecap': 'round' } : {}),
    });
    svgAppend(parent, path);
    const head = def.arrow ? arrowHead(pts) : null;
    if (head) svgAppend(parent, svgCreate('path', { d: head, fill: stroke, stroke }));
    const { text } = labelOf(element.businessObject, this.state.locale);
    if (text) {
      const mid = polylineMiddle(pts);
      const t = svgCreate('text', {
        x: mid.x,
        y: mid.y - 6,
        'text-anchor': 'middle',
        'font-size': 11,
        'font-family': DIAGRAM_FONT,
        fill: LABEL_COLOUR,
        'paint-order': 'stroke',
        stroke: '#FFFFFF',
        'stroke-width': 3,
      });
      if (ARABIC.test(text)) t.setAttribute('direction', 'rtl');
      t.textContent = text;
      svgAppend(parent, t);
    }
    return path;
  }

  override getShapePath(element: GraphShape) {
    const def = nodeDef(this.state.notation, element.businessObject.kind);
    return translatePath(
      outlinePath(def.outline, element.width, element.height),
      element.x,
      element.y,
    );
  }

  override getConnectionPath(connection: GraphConnection) {
    return connection.waypoints.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  }
}

// ---------- Rules ----------

class GraphRules extends RuleProvider {
  static override $inject = ['eventBus', 'graphState'];
  constructor(
    eventBus: unknown,
    private readonly state: GraphState,
  ) {
    super(eventBus as never);
  }

  override init() {
    const notation = () => this.state.notation;
    const isFrame = (el?: { businessObject?: { kind?: string } } | null) =>
      !!el?.businessObject?.kind && !!nodeDef(notation(), el.businessObject.kind).container;
    const isRoot = (el?: { parent?: unknown; type?: string } | null) =>
      !!el && !el.parent && el.type !== SHAPE_TYPE && el.type !== EDGE_TYPE;
    const canDrop = (shapes: { businessObject?: { kind?: string } }[], target?: unknown) => {
      const t = target as GraphShape | undefined;
      if (this.state.readOnly) return false;
      if (isRoot(t)) return true;
      return isFrame(t) && shapes.every((s) => !isFrame(s));
    };
    const connection = (source?: GraphShape, target?: GraphShape, preferred?: string) => {
      if (this.state.readOnly || !source || !target || source === target) return false;
      if (source.type !== SHAPE_TYPE || target.type !== SHAPE_TYPE) return false;
      const kind = notation().connect(source.businessObject, target.businessObject, preferred);
      return kind ? { type: EDGE_TYPE, businessObject: { kind } } : false;
    };
    this.addRule('shape.create', (ctx: { shape: GraphShape; target?: unknown }) =>
      canDrop([ctx.shape], ctx.target),
    );
    this.addRule('elements.create', (ctx: { elements: GraphShape[]; target?: unknown }) =>
      canDrop(
        ctx.elements.filter((e) => !isConnection(e)),
        ctx.target,
      ),
    );
    this.addRule('elements.move', (ctx: { shapes: GraphShape[]; target?: unknown }) =>
      ctx.target === undefined ? !this.state.readOnly : canDrop(ctx.shapes, ctx.target),
    );
    this.addRule(
      'shape.resize',
      (ctx: { shape: GraphShape }) =>
        !this.state.readOnly &&
        ctx.shape.type === SHAPE_TYPE &&
        nodeDef(notation(), ctx.shape.businessObject.kind).resizable,
    );
    this.addRule(
      'connection.create',
      (ctx: { source?: GraphShape; target?: GraphShape; hints?: { kind?: string } }) =>
        connection(ctx.source, ctx.target, ctx.hints?.kind ?? this.state.connectKind),
    );
    this.addRule(
      'connection.reconnect',
      (ctx: { connection: GraphConnection; source?: GraphShape; target?: GraphShape }) =>
        !!connection(ctx.source, ctx.target, ctx.connection.businessObject.kind),
    );
    this.addRule('connection.updateWaypoints', () => !this.state.readOnly);
    this.addRule('elements.delete', () => !this.state.readOnly);
  }
}

// ---------- Layout ----------

class GraphLayouter extends BaseLayouter {
  static $inject = ['graphState'];
  constructor(private readonly state: GraphState) {
    super();
  }

  override layoutConnection(
    connection: GraphConnection,
    hints: {
      source?: GraphShape;
      target?: GraphShape;
      connectionStart?: Point;
      connectionEnd?: Point;
    } = {},
  ) {
    const source = hints.source ?? connection.source;
    const target = hints.target ?? connection.target;
    const def = edgeDef(this.state.notation, connection.businessObject.kind);
    const start = hints.connectionStart ?? getMid(source as never);
    const end = hints.connectionEnd ?? getMid(target as never);
    if (def.orthogonal) {
      const vertical = Math.abs(start.y - end.y) > Math.abs(start.x - end.x);
      return connectRectangles(source as never, target as never, start, end, {
        preferredLayouts: [vertical ? 'v:v' : 'h:h'],
      }) as Point[];
    }
    return [start, end];
  }
}

/** Connections end at the shape outline, not at its centre (like bpmn-js BpmnUpdater). */
class ConnectionCropping extends CommandInterceptor {
  static override $inject = ['eventBus', 'connectionDocking'];
  constructor(eventBus: unknown, docking: { getCroppedWaypoints(c: GraphConnection): Point[] }) {
    super(eventBus as never);
    const crop = (e: { context: { connection?: GraphConnection; cropped?: boolean } }) => {
      const c = e.context.connection;
      if (!c || e.context.cropped || !c.source || !c.target) return;
      c.waypoints = docking.getCroppedWaypoints(c);
      e.context.cropped = true;
    };
    this.executed(['connection.layout', 'connection.create'], crop as never);
    this.reverted(['connection.layout'], ((e: { context: { cropped?: boolean } }) => {
      delete e.context.cropped;
    }) as never);
  }
}

// ---------- Commands ----------

interface UpdateContext {
  element: GraphElement;
  properties: Record<string, unknown>;
  oldProperties?: Record<string, unknown>;
}

/** Undoable change of business properties (labels, colours, links, category …). */
class UpdatePropertiesHandler {
  execute(ctx: UpdateContext) {
    const bo = ctx.element.businessObject as unknown as Record<string, unknown>;
    ctx.oldProperties = Object.fromEntries(Object.keys(ctx.properties).map((k) => [k, bo[k]]));
    for (const [k, v] of Object.entries(ctx.properties)) {
      if (v === undefined || v === null || v === '') {
        if (k === 'nameEn' || k === 'nameAr') bo[k] = '';
        else delete bo[k];
      } else bo[k] = v;
    }
    return [ctx.element];
  }

  revert(ctx: UpdateContext) {
    const bo = ctx.element.businessObject as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(ctx.oldProperties ?? {})) {
      if (v === undefined) delete bo[k];
      else bo[k] = v;
    }
    return [ctx.element];
  }
}

class CommandsSetup {
  static $inject = ['commandStack'];
  constructor(commandStack: { registerHandler(name: string, handler: unknown): void }) {
    commandStack.registerHandler('ph.updateProperties', UpdatePropertiesHandler);
  }
}

// ---------- Label editing ----------

interface Canvas {
  getAbsoluteBBox(el: unknown): { x: number; y: number; width: number; height: number };
  zoom(): number;
}

class LabelEditing {
  static $inject = ['eventBus', 'canvas', 'directEditing', 'commandStack', 'graphState'];
  constructor(
    eventBus: { on(e: string | string[], cb: (e: { element: GraphElement }) => void): void },
    private readonly canvas: Canvas,
    private readonly directEditing: {
      registerProvider(p: unknown): void;
      activate(el: unknown): void;
      complete(): void;
      isActive(): boolean;
    },
    private readonly commandStack: { execute(cmd: string, ctx: unknown): void },
    private readonly state: GraphState,
  ) {
    directEditing.registerProvider(this);
    eventBus.on('element.dblclick', (e) => {
      if (!state.readOnly && e.element.type) this.directEditing.activate(e.element);
    });
    eventBus.on('create.end', (e) => {
      const ctx = (e as { context?: { shape?: GraphElement; elements?: GraphElement[] } }).context;
      const el = ctx?.shape ?? ctx?.elements?.[0];
      if (el && !state.readOnly) this.directEditing.activate(el);
    });
    // Like bpmn-js: clicking elsewhere, dragging or zooming keeps what was typed.
    eventBus.on(['element.mousedown', 'drag.init', 'canvas.viewbox.changing', 'autoPlace'], () => {
      if (this.directEditing.isActive()) this.directEditing.complete();
    });
  }

  activate(element: GraphElement) {
    if (this.state.readOnly || (element.type !== SHAPE_TYPE && element.type !== EDGE_TYPE)) return;
    if (!isConnection(element) && nodeDef(this.state.notation, element.businessObject.kind).symbol)
      return;
    const field = this.state.locale === 'ar' ? 'nameAr' : 'nameEn';
    const text = (element.businessObject as { nameEn: string; nameAr: string })[field] ?? '';
    const zoom = this.canvas.zoom();
    let bounds: { x: number; y: number; width: number; height: number };
    if (isConnection(element)) {
      const mid = polylineMiddle(element.waypoints);
      const box = this.canvas.getAbsoluteBBox({
        x: mid.x - 60,
        y: mid.y - 14,
        width: 120,
        height: 28,
      });
      bounds = box;
    } else {
      bounds = this.canvas.getAbsoluteBBox(element);
    }
    return {
      bounds,
      text,
      style: {
        fontFamily: DIAGRAM_FONT,
        fontSize: `${12 * zoom}px`,
        lineHeight: 1.25,
        direction: this.state.locale === 'ar' ? 'rtl' : 'ltr',
        paddingTop: `${6 * zoom}px`,
        paddingBottom: `${6 * zoom}px`,
        paddingLeft: `${6 * zoom}px`,
        paddingRight: `${6 * zoom}px`,
      },
      options: { centerVertically: true },
    };
  }

  update(element: GraphElement, newText: string) {
    const field = this.state.locale === 'ar' ? 'nameAr' : 'nameEn';
    const value = newText.trim().slice(0, 300);
    if ((element.businessObject as { nameEn: string; nameAr: string })[field] === value) return;
    this.commandStack.execute('ph.updateProperties', { element, properties: { [field]: value } });
  }
}

// ---------- Keyboard ----------

class GraphKeyboard {
  static $inject = ['keyboard', 'editorActions', 'graphState'];
  constructor(
    keyboard: {
      addListener(fn: (ctx: { keyEvent: KeyboardEvent }) => boolean | void): void;
      isCmd(e: KeyboardEvent): boolean;
      isKey(keys: string | string[], e: KeyboardEvent): boolean;
    },
    editorActions: {
      trigger(action: string, opts?: unknown): unknown;
      isRegistered(a: string): boolean;
    },
    state: GraphState,
  ) {
    keyboard.addListener(({ keyEvent: e }) => {
      if (state.readOnly) return;
      const run = (action: string) => {
        if (!editorActions.isRegistered(action)) return false;
        editorActions.trigger(action);
        return true;
      };
      if (keyboard.isCmd(e) && keyboard.isKey(['a', 'A'], e)) return run('selectElements');
      if (keyboard.isCmd(e) || e.altKey) return;
      if (keyboard.isKey(['e', 'E'], e)) return run('directEditing');
      if (keyboard.isKey(['l', 'L'], e)) return run('lassoTool');
      if (keyboard.isKey(['h', 'H'], e)) return run('handTool');
      if (keyboard.isKey(['c', 'C'], e)) return run('globalConnectTool');
    });
  }
}

class GraphEditorActions {
  static $inject = [
    'editorActions',
    'selection',
    'elementRegistry',
    'directEditing',
    'lassoTool',
    'handTool',
    'globalConnect',
  ];
  constructor(
    editorActions: { register(actions: Record<string, () => unknown>): void },
    selection: { get(): unknown[]; select(els: unknown[]): void },
    elementRegistry: { filter(fn: (el: { type: string }) => boolean): unknown[] },
    directEditing: { activate(el: unknown): void },
    lassoTool: { activateSelection(e?: unknown): void },
    handTool: { activateHand(e?: unknown): void },
    globalConnect: { start(e?: unknown): void },
  ) {
    editorActions.register({
      selectElements: () =>
        selection.select(
          elementRegistry.filter((e) => e.type === SHAPE_TYPE || e.type === EDGE_TYPE),
        ),
      directEditing: () => {
        const [el] = selection.get();
        if (el) directEditing.activate(el);
      },
      lassoTool: () => lassoTool.activateSelection(),
      handTool: () => handTool.activateHand(),
      globalConnectTool: () => globalConnect.start(),
    });
  }
}

/** The ProcessHub graph module (add after the diagram-js feature modules). */
export function graphModule(state: GraphState) {
  return {
    __init__: [
      'phElementIds',
      'graphRenderer',
      'graphRules',
      'phCommands',
      'labelEditing',
      'graphKeyboard',
      'graphEditorActions',
      'connectionCropping',
    ],
    graphState: ['value', state],
    phElementIds: ['type', PhElementIds],
    graphRenderer: ['type', GraphRenderer],
    graphRules: ['type', GraphRules],
    layouter: ['type', GraphLayouter],
    connectionDocking: ['type', CroppingConnectionDocking],
    connectionCropping: ['type', ConnectionCropping],
    phCommands: ['type', CommandsSetup],
    labelEditing: ['type', LabelEditing],
    graphKeyboard: ['type', GraphKeyboard],
    graphEditorActions: ['type', GraphEditorActions],
  };
}

/** Read-only variant: renderer and connection layout (viewers, portal, print, compare). */
export function graphViewerModule(state: GraphState) {
  return {
    __init__: ['phElementIds', 'graphRenderer'],
    graphState: ['value', state],
    phElementIds: ['type', PhElementIds],
    graphRenderer: ['type', GraphRenderer],
    layouter: ['type', GraphLayouter],
    connectionDocking: ['type', CroppingConnectionDocking],
  };
}
