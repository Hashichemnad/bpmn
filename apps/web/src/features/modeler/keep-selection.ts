import type { DiagramElement, EventBus, Selection } from './bpmn-types';

/**
 * diagram-js deselects a shape that is clicked while it is the only selected one. In the
 * workspace that closes the side panel between the two clicks of a double-click (label editing):
 * the panel flickers and, in Arabic where the panel sits on the left, the diagram moved so the
 * second click hit another element. A plain click on the selected shape now keeps it selected;
 * Esc, a click on the empty canvas or Shift+click still deselect.
 */
class KeepSelection {
  static $inject = ['eventBus', 'selection'];

  constructor(eventBus: EventBus, selection: Selection) {
    eventBus.on(
      'element.click',
      1500,
      (e: { element: DiagramElement; originalEvent?: MouseEvent }) => {
        const ev = e.originalEvent;
        if (ev && (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.button !== 0)) return;
        const current = selection.get();
        if (current.length === 1 && current[0] === e.element) return false;
      },
    );
  }
}

export const keepSelectionModule = {
  __init__: ['phKeepSelection'],
  phKeepSelection: ['type', KeepSelection],
};
