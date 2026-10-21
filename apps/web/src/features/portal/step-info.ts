import type { DiagramElement } from '@/features/modeler/bpmn-types';
import { readLabels, linkedProcessOf } from '@/features/modeler/diagram';

export interface StepInfo {
  id: string;
  type: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  linkedProcessId: string | null;
}

export function stepInfo(el: DiagramElement): StepInfo {
  const bo = el.businessObject;
  const labels = readLabels(bo);
  return {
    id: el.id,
    type: el.type,
    nameEn: labels.nameEn || labels.name || '',
    nameAr: labels.nameAr ?? '',
    descriptionEn: (bo.get('ph:descriptionEn') as string | undefined) ?? '',
    descriptionAr: (bo.get('ph:descriptionAr') as string | undefined) ?? '',
    linkedProcessId: linkedProcessOf(bo),
  };
}
