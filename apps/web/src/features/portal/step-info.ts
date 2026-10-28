import type { PortalProcessDto } from '@processhub/shared';
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

/** Steps performed by one of the reader's job roles (published role links). */
export function myStepIds(process: PortalProcessDto, jobRoleIds: Set<string>): Set<string> {
  return new Set(
    process.links
      .filter((l) => l.object.type === 'ROLE' && jobRoleIds.has(l.object.id))
      .map((l) => l.bpmnElementId),
  );
}
