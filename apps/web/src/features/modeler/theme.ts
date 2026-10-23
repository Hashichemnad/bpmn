import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';
import {
  isThemeColour,
  themeColour,
  themeKindOf,
  type DiagramTheme,
  type ThemeColour,
  type ThemeElementInfo,
} from '@processhub/shared';
import type { DiagramElement, EventBus } from './bpmn-types';

/** Shared, mutable theme holder: the modeler keeps working when Settings → Branding changes. */
export interface ThemeState {
  theme: DiagramTheme;
}

interface Di {
  get(name: string): unknown;
}
type Element = DiagramElement & { di?: Di; y?: number; x?: number; children?: Element[] };

interface ThemeModeling {
  setColor(elements: DiagramElement[], colors: { fill?: string; stroke?: string }): void;
}

/** Stored colours of a shape (BPMN-in-Color first, then the bpmn.io attributes). */
export function elementColours(el: DiagramElement): { fill?: string; stroke?: string } {
  const di = (el as Element).di;
  const read = (a: string, b: string) =>
    ((di?.get(a) || di?.get(b)) as string | undefined) || undefined;
  return {
    fill: read('color:background-color', 'bioc:fill'),
    stroke: read('color:border-color', 'bioc:stroke'),
  };
}

export function hasColour(el: DiagramElement): boolean {
  const c = elementColours(el);
  return !!(c.fill || c.stroke);
}

export function themeInfo(el: DiagramElement): ThemeElementInfo {
  const bo = el.businessObject;
  const nameEn = bo.get('ph:nameEn') as string | undefined;
  const defs = (bo as unknown as { eventDefinitions?: { $type: string }[] }).eventDefinitions;
  return {
    type: el.type,
    nameEn: nameEn || (bo.get('ph:nameAr') ? '' : bo.name),
    stepKind: bo.get('ph:stepKind') as string | undefined,
    eventDefinitions: defs?.map((d) => d.$type) ?? [],
  };
}

/** Position of a lane among its sibling lanes, top to bottom (left to right when vertical). */
function laneIndex(el: Element): number {
  const siblings = (el.parent as Element | undefined)?.children?.filter(
    (c) => c.type === 'bpmn:Lane',
  );
  if (!siblings) return 0;
  const vertical = (el.di as { isHorizontal?: boolean } | undefined)?.isHorizontal === false;
  const pos = (c: Element) => (vertical ? (c.x ?? 0) : (c.y ?? 0));
  return [...siblings].sort((a, b) => pos(a) - pos(b)).indexOf(el);
}

/** Theme colour of an element, or null when the theme does not colour this kind of element. */
export function themeColourOf(el: DiagramElement, theme: DiagramTheme): ThemeColour | null {
  const kind = themeKindOf(themeInfo(el));
  return kind ? themeColour(theme, kind, kind === 'lane' ? laneIndex(el as Element) : 0) : null;
}

const sameColour = (a: { fill?: string; stroke?: string }, b: ThemeColour) =>
  a.fill?.toUpperCase() === b.fill.toUpperCase() &&
  a.stroke?.toUpperCase() === b.stroke.toUpperCase();

/**
 * Applies the theme as part of the modelling command (one undo step):
 * - new elements without colours get their theme colour;
 * - after a type change or a label / step-kind change, an element whose colours came from the
 *   theme gets the colour of its new kind;
 * - explicit colours (anything that is not a theme pair) are never overwritten, and elements
 *   without colours are not coloured by edits (only "Apply theme" in Settings does that).
 */
class ThemeBehavior extends CommandInterceptor {
  static override $inject = ['eventBus', 'modeling', 'phThemeState'];

  constructor(
    eventBus: EventBus,
    private readonly modeling: ThemeModeling,
    private readonly state: ThemeState,
  ) {
    super(eventBus as never);
    this.postExecuted('shape.create', ({ context }: { context: { shape: DiagramElement } }) =>
      this.colour(context.shape, 'new'),
    );
    this.postExecuted(
      'shape.replace',
      ({ context }: { context: { newShape?: DiagramElement; newElement?: DiagramElement } }) => {
        const el = context.newShape ?? context.newElement;
        if (el) this.colour(el, hasColour(el) ? 'themed' : 'new');
      },
    );
    this.postExecuted(
      ['element.updateModdleProperties', 'element.updateProperties', 'element.updateLabel'],
      ({ context }: { context: { element: DiagramElement } }) => {
        const el = context.element.labelTarget ?? context.element;
        if (el.type !== 'label') this.colour(el, 'themed');
      },
    );
    this.postExecuted(
      ['lane.add', 'lane.split', 'shape.delete'],
      ({ context }: { context: { shape?: Element; oldParent?: Element } }) => {
        // Lanes next to (add, delete) or inside (split) the changed lane alternate again.
        const parents = [context.shape, context.shape?.parent as Element, context.oldParent];
        const lanes = new Set(
          parents.flatMap((p) => p?.children?.filter((c) => c.type === 'bpmn:Lane') ?? []),
        );
        for (const lane of lanes) this.colour(lane, 'themed');
      },
    );
  }

  /** `new`: colour when uncoloured. `themed`: recolour only when the colours are theme colours. */
  private colour(el: DiagramElement, mode: 'new' | 'themed') {
    if (el.type === 'label' || !el.businessObject) return;
    const current = elementColours(el);
    const coloured = !!(current.fill || current.stroke);
    if (mode === 'new' && coloured) return;
    if (mode === 'themed' && !isThemeColour(this.state.theme, current.fill, current.stroke)) return;
    const target = themeColourOf(el, this.state.theme);
    if (!target || sameColour(current, target)) return;
    this.modeling.setColor([el], { fill: target.fill, stroke: target.stroke });
  }
}

export function themeModule(state: ThemeState) {
  return {
    __init__: ['phThemeBehavior'],
    phThemeState: ['value', state],
    phThemeBehavior: ['type', ThemeBehavior],
  };
}
