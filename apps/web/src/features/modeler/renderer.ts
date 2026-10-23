import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import { getLabelColor, getStrokeColor } from 'bpmn-js/lib/draw/BpmnRenderUtil';
import { themeKindOf } from '@processhub/shared';
import type { DiagramElement, EventBus } from './bpmn-types';
import { detectLocale } from './labels';

/**
 * Enterprise look on top of the standard BPMN shapes (DECISIONS D-069): the bpmn-js renderer draws
 * every element, this renderer (higher priority) then softens corners, adds a subtle shadow,
 * thins borders to 1.5 px, draws clearer task-type icons, tints lane header bands and gives
 * Arabic labels a right-to-left direction. Shapes stay standard BPMN, so diagrams look the same
 * in other tools apart from these details.
 */

/** Colours for elements without stored colours (the theme never applies itself at render time). */
export const DEFAULT_FILL = '#FFFFFF';
export const DEFAULT_STROKE = '#2B3440';
export const DEFAULT_LABEL = '#1F2933';
/** Lane and pool names: dark ink, independent of the (lighter) lane border colour. */
const HEADER_TEXT = '#1F2933';

/** Inter for Latin script, IBM Plex Sans Arabic for Arabic glyphs (browser per-glyph fallback). */
export const DIAGRAM_FONT = "Inter, 'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif";

export const DIAGRAM_CONFIG = {
  bpmnRenderer: {
    defaultFillColor: DEFAULT_FILL,
    defaultStrokeColor: DEFAULT_STROKE,
    defaultLabelColor: DEFAULT_LABEL,
  },
  textRenderer: {
    defaultStyle: {
      fontFamily: DIAGRAM_FONT,
      fontSize: 12,
      fontWeight: 'normal',
      lineHeight: 1.25,
    },
    externalStyle: { fontSize: 11, lineHeight: 1.25 },
  },
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const BORDER = '1.5px';
const RADIUS = 12;

type Attrs = Record<string, string | number>;

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  style: Partial<CSSStyleDeclaration> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  Object.assign(el.style, style);
  return el;
}

interface TextRenderer {
  createText(
    text: string,
    options: {
      box: { width: number; height: number };
      align?: string;
      padding?: number | { top: number; bottom: number; left: number; right: number };
      style?: Record<string, unknown>;
    },
  ): SVGTextElement;
}

interface BpmnRenderer {
  handlers: Record<
    string,
    (parent: SVGElement, element: DiagramElement, attrs?: Record<string, unknown>) => SVGElement
  >;
  canRender(element: DiagramElement): boolean;
  drawShape(parent: SVGElement, element: DiagramElement): SVGElement;
  drawConnection(parent: SVGElement, element: DiagramElement): SVGElement;
  getShapePath(element: DiagramElement): string;
  getConnectionPath(element: DiagramElement): string;
}

type Shape = DiagramElement & { width: number; height: number };

const ACTIVITY =
  /^bpmn:(Task|UserTask|ServiceTask|ManualTask|ScriptTask|BusinessRuleTask|SendTask|ReceiveTask|SubProcess|CallActivity|AdHocSubProcess|Transaction)$/;
const EVENT =
  /^bpmn:(StartEvent|EndEvent|IntermediateCatchEvent|IntermediateThrowEvent|BoundaryEvent)$/;
const GATEWAY = /Gateway$/;
/** Tasks drawn with ProcessHub icons (the others keep the standard BPMN icon). */
const ICON_TASKS = new Set([
  'bpmn:UserTask',
  'bpmn:ServiceTask',
  'bpmn:SendTask',
  'bpmn:ReceiveTask',
]);

type IconKind = 'user' | 'approval' | 'service' | 'send' | 'receive';

/** Icon drawn into a 16×16 box at the top-left corner of a task. */
function drawIcon(parent: SVGElement, kind: IconKind, stroke: string, fill: string) {
  const g = svg('g', { class: 'ph-task-icon', transform: 'translate(7 4) scale(0.9)' });
  const line = {
    stroke,
    strokeWidth: '1.4px',
    fill: 'none',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  if (kind === 'user' || kind === 'approval') {
    g.append(
      svg('circle', { cx: 7, cy: 4.6, r: 3 }, { ...line, fill }),
      svg('path', { d: 'M1.5 15c0-3.3 2.5-5.6 5.5-5.6s5.5 2.3 5.5 5.6' }, { ...line, fill }),
    );
    if (kind === 'approval') {
      g.append(
        svg('circle', { cx: 13, cy: 12, r: 4 }, { fill: stroke, stroke: fill, strokeWidth: '1px' }),
        svg(
          'path',
          { d: 'M11.2 12.1l1.3 1.3 2.4-2.6' },
          { ...line, stroke: fill, strokeWidth: '1.3px' },
        ),
      );
    }
  } else if (kind === 'service') {
    const teeth = Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      const p = (r: number) =>
        `${(8 + r * Math.cos(a)).toFixed(2)} ${(8 + r * Math.sin(a)).toFixed(2)}`;
      return `M${p(4.6)}L${p(7.2)}`;
    }).join('');
    g.append(
      svg('path', { d: teeth }, { ...line, strokeWidth: '2.2px' }),
      svg('circle', { cx: 8, cy: 8, r: 4.8 }, { ...line, fill }),
      svg('circle', { cx: 8, cy: 8, r: 1.8 }, line),
    );
  } else {
    const filled = kind === 'send';
    g.append(
      svg(
        'rect',
        { x: 0.5, y: 2.5, width: 15, height: 10.5, rx: 1.5 },
        { ...line, fill: filled ? stroke : fill },
      ),
      svg('path', { d: 'M1.2 3.4L8 8.6l6.8-5.2' }, { ...line, stroke: filled ? fill : stroke }),
    );
  }
  parent.append(g);
}

function iconKind(el: DiagramElement): IconKind | null {
  switch (el.type) {
    case 'bpmn:UserTask': {
      const bo = el.businessObject;
      const kind = themeKindOf({
        type: el.type,
        nameEn: (bo.get('ph:nameEn') as string | undefined) || bo.name,
        stepKind: bo.get('ph:stepKind') as string | undefined,
      });
      return kind === 'approvalTask' ? 'approval' : 'user';
    }
    case 'bpmn:ServiceTask':
      return 'service';
    case 'bpmn:SendTask':
      return 'send';
    case 'bpmn:ReceiveTask':
      return 'receive';
    default:
      return null;
  }
}

/**
 * Arabic labels: right-to-left paragraph direction. bpmn-js positions every line by its left
 * edge, and with `direction: rtl` the "end" of a line is its left edge, so `text-anchor: end`
 * keeps the computed position while punctuation and mixed text order correctly.
 */
export function directLabels(parent: SVGElement) {
  for (const text of Array.from(parent.querySelectorAll<SVGTextElement>('text.djs-label'))) {
    if (detectLocale(text.textContent ?? '') !== 'ar') continue;
    text.setAttribute('direction', 'rtl');
    text.style.direction = 'rtl';
    text.setAttribute('text-anchor', 'end');
    text.style.unicodeBidi = 'plaintext';
  }
}

/** Soft shadow behind the shape body: a blurred-looking offset copy without stroke. */
function addShadow(parent: SVGElement, body: SVGElement) {
  const shadow = body.cloneNode(false) as SVGElement;
  shadow.removeAttribute('style');
  shadow.setAttribute('class', 'ph-shadow');
  Object.assign(shadow.style, { fill: '#0F172A', fillOpacity: '0.09', stroke: 'none' });
  shadow.setAttribute('transform', 'translate(0 2)');
  parent.insertBefore(shadow, body);
  body.classList.add('ph-body');
}

export class PhRenderer extends BaseRenderer {
  static $inject = ['eventBus', 'bpmnRenderer', 'textRenderer'];

  constructor(
    eventBus: EventBus,
    private readonly bpmn: BpmnRenderer,
    private readonly text: TextRenderer,
  ) {
    super(eventBus as never, 1500);
  }

  override canRender(element: object): boolean {
    return this.bpmn.canRender(element as DiagramElement);
  }

  override drawShape(parent: SVGElement, el: object): SVGElement {
    const element = el as DiagramElement;
    const shape = el as Shape;
    const icon = ICON_TASKS.has(element.type) ? iconKind(element) : null;
    const body = icon
      ? this.drawIconTask(parent, shape, icon)
      : this.bpmn.drawShape(parent, element);

    if (ACTIVITY.test(element.type)) {
      body.setAttribute('rx', String(RADIUS));
      body.setAttribute('ry', String(RADIUS));
      body.style.strokeWidth = BORDER;
      body.style.fillOpacity = '1';
      addShadow(parent, body);
    } else if (EVENT.test(element.type)) {
      body.style.strokeWidth = element.type === 'bpmn:EndEvent' ? '3px' : BORDER;
      addShadow(parent, body);
    } else if (GATEWAY.test(element.type)) {
      body.style.strokeWidth = BORDER;
      addShadow(parent, body);
    } else if (element.type === 'bpmn:Lane' || element.type === 'bpmn:Participant') {
      this.styleHeader(parent, shape, body);
    }
    directLabels(parent);
    return body;
  }

  override drawConnection(parent: SVGElement, element: object): SVGElement {
    const line = this.bpmn.drawConnection(parent, element as DiagramElement);
    line.style.strokeWidth = BORDER;
    return line;
  }

  override getShapePath(element: object): string {
    return this.bpmn.getShapePath(element as DiagramElement);
  }

  override getConnectionPath(element: object): string {
    return this.bpmn.getConnectionPath(element as DiagramElement);
  }

  /** Task body and label from bpmn-js, then the icon; the label leaves room for the icon. */
  private drawIconTask(parent: SVGElement, el: Shape, icon: IconKind): SVGElement {
    const body = this.bpmn.handlers['bpmn:Task'](parent, el);
    const stroke = getStrokeColor(el as never, DEFAULT_STROKE);
    const fill = (body.style.fill || DEFAULT_FILL) as string;
    const old = parent.querySelector('text.djs-label');
    if (old) {
      const label = this.text.createText(el.businessObject.name ?? '', {
        box: { width: el.width, height: el.height },
        align: 'center-middle',
        padding: { top: 18, bottom: 2, left: 6, right: 6 },
        style: { fill: getLabelColor(el as never, DEFAULT_LABEL, DEFAULT_STROKE) },
      });
      label.classList.add('djs-label');
      old.replaceWith(label);
    }
    drawIcon(parent, icon, stroke, fill);
    return body;
  }

  /** Lanes and pools: opaque fill (alternating lane colours stay visible), tinted header band. */
  private styleHeader(parent: SVGElement, el: Shape, body: SVGElement) {
    const di = (el as unknown as { di?: { get(n: string): unknown; isHorizontal?: boolean } }).di;
    const horizontal = di?.isHorizontal !== false;
    if (el.type === 'bpmn:Lane') body.style.fillOpacity = '1';
    body.style.strokeWidth = el.type === 'bpmn:Participant' ? BORDER : '1px';
    const stroke = getStrokeColor(el as never, DEFAULT_STROKE);
    const band = svg(
      'rect',
      horizontal
        ? { x: 0, y: 0, width: 30, height: el.height }
        : { x: 0, y: 0, width: el.width, height: 30 },
      {
        fill: stroke,
        fillOpacity: el.type === 'bpmn:Participant' ? '0.12' : '0.07',
        stroke: 'none',
      },
    );
    band.setAttribute('class', 'ph-header-band');
    body.after(band);
    for (const t of Array.from(parent.querySelectorAll<SVGTextElement>('text.djs-label'))) {
      t.style.fill = HEADER_TEXT;
      t.style.fontWeight = '600';
    }
  }
}

export const phRendererModule = {
  __init__: ['phRenderer'],
  phRenderer: ['type', PhRenderer],
};
