import type { DiagramType } from '@processhub/shared';

/** Accent colour of each diagram type (icons, tags). */
export const DIAGRAM_TYPE_COLOURS: Record<DiagramType, string> = {
  VALUE_CHAIN: '#7c3aed',
  ORG_CHART: '#0369a1',
  DMN: '#b45309',
  EPC: '#15803d',
  SIPOC: '#be185d',
};
