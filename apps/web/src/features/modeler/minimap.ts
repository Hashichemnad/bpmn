import MinimapModule from 'diagram-js-minimap';
import 'diagram-js-minimap/assets/diagram-js-minimap.css';
import type { BpmnInstance } from './bpmn-types';

export { MinimapModule };

interface Minimap {
  toggle(open?: boolean): void;
  isOpen(): boolean;
}

/** Opens or closes the mini-map of a diagram created with MinimapModule. */
export function setMinimap(instance: BpmnInstance, open: boolean): void {
  const minimap = instance.get<Minimap | null>('minimap', false);
  if (minimap && minimap.isOpen() !== open) minimap.toggle(open);
}
