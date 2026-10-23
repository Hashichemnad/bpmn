import ColorPickerModule from 'bpmn-js-color-picker';
import 'bpmn-js-color-picker/colors/color-picker.css';
import { NEUTRAL_COLOURS, type DiagramTheme } from '@processhub/shared';
import type { DiagramElement } from './bpmn-types';
import { themeColourOf, type ThemeState } from './theme';

export interface PickerColour {
  label: string;
  fill: string;
  stroke: string;
}

/** English labels; Arabic via the bpmn-js translate module (translate.ts). */
const NEUTRAL_LABELS = ['White', 'Light grey', 'Grey', 'Purple'];

/** Theme palette first (one entry per distinct colour pair), then a few neutral colours. */
export function pickerColours(theme: DiagramTheme): PickerColour[] {
  const all: PickerColour[] = [
    { label: 'Start / end event', ...theme.start },
    { label: 'Successful end', ...theme.end },
    { label: 'Rejected end', ...theme.endRejected },
    { label: 'Human task', ...theme.humanTask },
    { label: 'Approval task', ...theme.approvalTask },
    { label: 'System task', ...theme.systemTask },
    { label: 'Gateway', ...theme.gateway },
    { label: 'Intermediate event', ...theme.intermediateEvent },
    { label: 'Lane', fill: theme.lane.fillAlt, stroke: theme.lane.stroke },
    ...NEUTRAL_COLOURS.map((c, i) => ({ label: NEUTRAL_LABELS[i], ...c })),
  ];
  const seen = new Set<string>();
  return all.filter((c) => {
    const key = `${c.fill}/${c.stroke}`.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Updates the palette in place (the colour picker keeps a reference to the array). */
export function syncPickerColours(target: PickerColour[], theme: DiagramTheme) {
  target.splice(0, target.length, ...pickerColours(theme));
}

interface PopupMenu {
  registerProvider(id: string, priority: number, provider: unknown): void;
}
interface ColourModeling {
  setColor(elements: DiagramElement[], colors: { fill?: string; stroke?: string }): void;
}
type Entries = Record<string, unknown>;

const RESET_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/></svg>`;
const NONE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25" width="100%" height="100%"><rect rx="2" x="1" y="1" width="22" height="22" fill="#fff" stroke="#94a3b8" stroke-width="1.5"/><path d="M4 21L21 4" stroke="#C62828" stroke-width="1.5"/></svg>`;

/**
 * Adds "Reset to theme" (theme colour of each element's kind) and "No colour" to the colour
 * picker; the plain "Default" entry of bpmn-js-color-picker is not offered.
 */
class ThemeColourEntries {
  static $inject = ['popupMenu', 'modeling', 'phThemeState', 'translate'];

  constructor(
    popupMenu: PopupMenu,
    private readonly modeling: ColourModeling,
    private readonly state: ThemeState,
    private readonly translate: (s: string) => string,
  ) {
    popupMenu.registerProvider('color-picker', 500, this);
  }

  getPopupMenuEntries(elements: DiagramElement[]) {
    return (entries: Entries): Entries => ({
      'ph-reset-theme': {
        id: 'ph-reset-theme',
        title: this.translate('Reset to theme'),
        imageHtml: RESET_ICON,
        action: () => {
          for (const el of elements) {
            const c = themeColourOf(el, this.state.theme);
            this.modeling.setColor([el], c ? { fill: c.fill, stroke: c.stroke } : {});
          }
        },
      },
      ...entries,
      'ph-no-colour': {
        id: 'ph-no-colour',
        title: this.translate('No colour'),
        imageHtml: NONE_ICON,
        action: () => this.modeling.setColor(elements, { fill: undefined, stroke: undefined }),
      },
    });
  }
}

/** Colour picker for the modeler context pad (editable diagrams only). */
export function colourPickerModule() {
  return {
    __depends__: [ColorPickerModule],
    __init__: ['phThemeColourEntries'],
    phThemeColourEntries: ['type', ThemeColourEntries],
  };
}
