import type { Locale } from '@processhub/shared';
import {
  EDGE_TYPE,
  SHAPE_TYPE,
  isConnection,
  type GraphElement,
  type GraphShape,
  type GraphState,
} from './graph-modules';
import { kindColours, nodeDef } from './notations';
import { kindIconUrl } from './shapes';

/** Titles of the context pad entries in both languages (diagram-js renders plain text). */
const TITLES: Record<string, { en: string; ar: string }> = {
  delete: { en: 'Delete', ar: 'حذف' },
  connect: { en: 'Connect', ar: 'ربط' },
  staff: { en: 'Staff line', ar: 'خط استشاري' },
  edit: { en: 'Edit label', ar: 'تعديل التسمية' },
};

const TRASH =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#B42318" stroke-width="1.6"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>',
  );
const ARROW = (dashed: boolean) =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="1.6"><path d="M4 19L19 5"${dashed ? ' stroke-dasharray="3 2"' : ''}/><path d="M12 5h7v7"/></svg>`,
  );
const PEN =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="1.6"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  );

/** Localised title of a notation kind (set by the editor from i18n). */
export type KindTitle = (kind: string, locale: Locale) => string;

interface Deps {
  graphState: GraphState & { kindTitle?: KindTitle };
  elementFactory: { createShape(attrs: Record<string, unknown>): GraphShape };
  modeling: {
    removeElements(els: unknown[]): void;
    appendShape(
      source: GraphShape,
      shape: GraphShape,
      position: { x: number; y: number },
      parent: unknown,
      hints: { connection: Record<string, unknown> },
    ): GraphShape;
  };
  connect: { start(event: Event, source: GraphShape, autoActivate?: boolean): void };
  rules: { allowed(action: string, ctx: unknown): unknown };
  directEditing: { activate(el: unknown): void };
  eventBus: { on(e: string, cb: () => void): void };
}

/** Context pad of the graph notations: append the next shape, connect, edit label, delete. */
class GraphContextPad {
  static $inject = [
    'contextPad',
    'graphState',
    'elementFactory',
    'modeling',
    'connect',
    'rules',
    'directEditing',
    'eventBus',
  ];
  private readonly d: Deps;

  constructor(
    contextPad: { registerProvider(p: unknown): void },
    graphState: Deps['graphState'],
    elementFactory: Deps['elementFactory'],
    modeling: Deps['modeling'],
    connect: Deps['connect'],
    rules: Deps['rules'],
    directEditing: Deps['directEditing'],
    eventBus: Deps['eventBus'],
  ) {
    this.d = { graphState, elementFactory, modeling, connect, rules, directEditing, eventBus };
    contextPad.registerProvider(this);
    eventBus.on('connect.cleanup', () => {
      graphState.connectKind = undefined;
    });
  }

  getContextPadEntries(element: GraphElement) {
    const { graphState: state, modeling, connect, directEditing } = this.d;
    if (state.readOnly || (element.type !== SHAPE_TYPE && element.type !== EDGE_TYPE)) return {};
    const title = (key: string) => TITLES[key][state.locale];
    const entries: Record<string, unknown> = {};
    if (!isConnection(element)) {
      const notation = state.notation;
      for (const kind of notation.append(element.businessObject.kind)) {
        const def = nodeDef(notation, kind);
        const colours = kindColours(def.colour, state.theme);
        entries[`append.${kind}`] = {
          group: 'model',
          imageUrl: kindIconUrl(def.outline, colours, def.symbol),
          title: state.kindTitle?.(kind, state.locale) ?? kind,
          action: { click: () => this.append(element, kind) },
        };
      }
      const start = (kind?: string) => (event: Event) => {
        state.connectKind = kind;
        connect.start(event, element);
      };
      entries.connect = {
        group: 'connect',
        imageUrl: ARROW(false),
        title: title('connect'),
        action: { click: start(), dragstart: start() },
      };
      if (notation.edges.some((e) => e.kind === 'staff'))
        entries.staff = {
          group: 'connect',
          imageUrl: ARROW(true),
          title: title('staff'),
          action: { click: start('staff'), dragstart: start('staff') },
        };
    }
    entries.edit = {
      group: 'edit',
      imageUrl: PEN,
      title: title('edit'),
      action: { click: () => directEditing.activate(element) },
    };
    entries.delete = {
      group: 'edit',
      imageUrl: TRASH,
      title: title('delete'),
      action: { click: () => modeling.removeElements([element]) },
    };
    return entries;
  }

  /** Adds a shape of `kind` next to `source` (right or below) and connects them. */
  private append(source: GraphShape, kind: string) {
    const { graphState: state, elementFactory, modeling } = this.d;
    const def = nodeDef(state.notation, kind);
    const shape = elementFactory.createShape({ businessObject: { kind } });
    const gap = 60;
    const position =
      state.notation.appendDirection === 'right'
        ? { x: source.x + source.width + gap + def.width / 2, y: source.y + source.height / 2 }
        : { x: source.x + source.width / 2, y: source.y + source.height + gap + def.height / 2 };
    const kindOfEdge = state.notation.connect(source.businessObject, { kind });
    if (!kindOfEdge) return;
    const created = modeling.appendShape(source, shape, position, source.parent, {
      connection: { type: EDGE_TYPE, businessObject: { kind: kindOfEdge } },
    });
    if (!def.symbol) this.d.directEditing.activate(created);
  }
}

export const contextPadModule = {
  __init__: ['graphContextPad'],
  graphContextPad: ['type', GraphContextPad],
};
