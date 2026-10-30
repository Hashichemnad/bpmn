import { useEffect, useRef } from 'react';
import { createDiagram, importDiagram } from '@/features/modeler/create-diagram';
import type { BpmnInstance } from '@/features/modeler/bpmn-types';

/** Read-only diagram (pan / zoom) of a BPMN XML string, e.g. a draft sent for feedback. */
export function XmlDiagram({ xml, height = 420 }: { xml: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !xml) return;
    const viewer: BpmnInstance = createDiagram('navigated', { container: ref.current });
    void importDiagram(viewer, xml).then(() =>
      (viewer.get('canvas') as { zoom: (v: string) => void }).zoom('fit-viewport'),
    );
    return () => viewer.destroy();
  }, [xml]);
  return (
    <div
      ref={ref}
      data-testid="feedback-diagram"
      style={{ height, border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff' }}
    />
  );
}
