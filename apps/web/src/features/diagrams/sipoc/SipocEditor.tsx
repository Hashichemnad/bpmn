import type { DiagramDto } from '@processhub/shared';
import { useDiagramContent } from '@/api/diagrams';
import { LoadingState } from '@/components/states';
import { DiagramView } from '../DiagramView';

/** Placeholder until the notation's editor is built (read-only view). */
export default function Editor({
  diagram,
}: {
  diagram: DiagramDto;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const content = useDiagramContent(diagram.id);
  if (!content.data) return <LoadingState />;
  return <DiagramView type={diagram.type} content={content.data.content} height="90vh" />;
}
