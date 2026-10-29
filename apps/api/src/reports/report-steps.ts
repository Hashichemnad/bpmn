import {
  flowOrder,
  graphLabel,
  isStepNode,
  parseBpmnGraph,
  type GraphNode,
  type Locale,
  type StepAttributes,
  type StepType,
} from '@processhub/shared';
import { pick } from './report-i18n';
import type { ReportProcess } from './report-data.service';

/** One step of a report table (handbook step table, RACI rows). */
export interface ReportStep {
  id: string;
  name: string;
  type: StepType;
  /** Lane of the step (its role in the diagram). */
  lane: string;
  /** Roles performing the step: the lane plus roles linked with "performs". */
  roles: string[];
  systems: string[];
  documents: string[];
  description: string;
  attributes: StepAttributes;
}

/** Steps (activities) of a process in flow order, with their roles, systems and documents. */
export function reportSteps(p: ReportProcess, locale: Locale): ReportStep[] {
  if (!p.bpmnXml) return [];
  const graph = parseBpmnGraph(p.bpmnXml);
  const lanes = new Map(graph.lanes.map((l) => [l.id, graphLabel(l, locale)]));
  const linked = (n: GraphNode, type: string) =>
    p.links
      .filter((l) => l.bpmnElementId === n.id && l.object.type === type)
      .map((l) => pick(locale, l.object))
      .filter((v, i, all) => !!v && all.indexOf(v) === i);
  return flowOrder(graph)
    .filter(isStepNode)
    .map((n) => {
      const lane = (n.laneId && lanes.get(n.laneId)) || '';
      const roles = [lane, ...linked(n, 'ROLE')].filter((v, i, all) => !!v && all.indexOf(v) === i);
      return {
        id: n.id,
        name: graphLabel(n, locale) || n.id,
        type: n.stepType,
        lane,
        roles,
        systems: linked(n, 'SYSTEM'),
        documents: linked(n, 'DOCUMENT'),
        description:
          (locale === 'ar'
            ? n.descriptionAr || n.descriptionEn
            : n.descriptionEn || n.descriptionAr) || '',
        attributes: n.attributes,
      };
    });
}
