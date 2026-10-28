import { clampPanelWidth } from './workspace-prefs';

/**
 * Side panel of the modeler workspace (Properties / Issues / Comments / AI):
 * - closed while nothing is selected; opens when an element is selected (`auto`);
 * - closing it by hand turns `auto` off (remembered), opening it turns it back on;
 * - opened by hand or from the toolbar (`pinned`), it stays open when the selection is cleared;
 * - focus mode hides it without changing this state.
 */
export interface PanelState {
  visible: boolean;
  pinned: boolean;
  auto: boolean;
  width: number;
}

export type PanelAction =
  | { type: 'select'; hasSelection: boolean }
  | { type: 'toggle' }
  | { type: 'show' }
  | { type: 'close' }
  | { type: 'resize'; width: number };

export const initialPanelState = (prefs: { panelAuto: boolean; panelWidth: number }) => ({
  visible: false,
  pinned: false,
  auto: prefs.panelAuto,
  width: clampPanelWidth(prefs.panelWidth),
});

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'select':
      if (action.hasSelection) return state.auto ? { ...state, visible: true } : state;
      return state.pinned ? state : { ...state, visible: false };
    case 'toggle':
      return state.visible
        ? { ...state, visible: false, pinned: false, auto: false }
        : { ...state, visible: true, pinned: true, auto: true };
    case 'show':
      return { ...state, visible: true, pinned: true };
    case 'close':
      return { ...state, visible: false, pinned: false, auto: false };
    case 'resize':
      return { ...state, width: clampPanelWidth(action.width) };
  }
}
