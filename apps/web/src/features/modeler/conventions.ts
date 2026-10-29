import {
  checkConventions,
  parseBpmnGraph,
  type BpmnIssue,
  type ConventionIssue,
  type ModelingConventions,
} from '@processhub/shared';
import type { BpmnInstance } from './bpmn-types';

/**
 * Modeling conventions in the Validation panel (D-088): the diagram is read with the same shared
 * reader the server uses on "Submit for review", so the panel shows exactly what would block it.
 */
export async function conventionIssues(
  instance: BpmnInstance,
  conventions: ModelingConventions,
): Promise<ConventionIssue[]> {
  const { xml } = await instance.saveXML({ format: false });
  return xml ? checkConventions(parseBpmnGraph(xml), conventions) : [];
}

/** The basic "unconnected" warning is left out when the convention reports the same element. */
export function withoutDuplicates(issues: BpmnIssue[], conventions: ConventionIssue[]) {
  const unconnected = new Set(
    conventions.filter((c) => c.rule === 'noUnconnected').map((c) => c.elementId),
  );
  return issues.filter((i) => !(i.code === 'UNCONNECTED_ELEMENT' && unconnected.has(i.elementId)));
}
