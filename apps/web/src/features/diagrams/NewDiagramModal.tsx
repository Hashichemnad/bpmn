import { useState, type ComponentType } from 'react';
import type { DiagramType } from '@processhub/shared';
import { DiagramFormModal } from './DiagramFormModal';
import { ValueChainGenerator } from './notations/ValueChain';
import { OrgChartGenerator } from './notations/OrgChart';

/** Generation options a notation offers when a diagram is created (value chain, org chart, SIPOC). */
export interface GeneratorProps {
  /** Reports generated content (null = start empty). */
  onContent: (content: string | null, changeNote?: string) => void;
}

const GENERATORS: Partial<Record<DiagramType, ComponentType<GeneratorProps>>> = {
  VALUE_CHAIN: ValueChainGenerator,
  ORG_CHART: OrgChartGenerator,
};

export function NewDiagramModal({
  type,
  defaultProcessId,
  onClose,
}: {
  type: DiagramType;
  defaultProcessId?: string | null;
  onClose: () => void;
}) {
  const [generated, setGenerated] = useState<{ content: string; changeNote?: string } | null>(null);
  const Generator = GENERATORS[type];
  return (
    <DiagramFormModal
      open
      type={type}
      defaultProcessId={defaultProcessId}
      content={generated?.content}
      changeNote={generated?.changeNote}
      extra={
        Generator ? (
          <Generator
            onContent={(content, changeNote) =>
              setGenerated(content ? { content, changeNote } : null)
            }
          />
        ) : null
      }
      onClose={onClose}
    />
  );
}
