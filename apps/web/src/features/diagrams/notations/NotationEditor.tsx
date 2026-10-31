import type { DiagramDto } from '@processhub/shared';
import { GraphEditor } from '../GraphEditor';

/** Graph notation editors: the shared GraphEditor plus each notation's own fields and tools. */
export function NotationEditor(props: {
  diagram: DiagramDto;
  readOnly?: boolean;
  onClose: () => void;
}) {
  return <GraphEditor {...props} />;
}
