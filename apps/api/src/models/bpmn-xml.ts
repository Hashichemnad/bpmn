import {
  extractBpmnElementIds,
  type BpmnElementLabel,
  type ElementLabelDto,
} from '@processhub/shared';
import { badRequest } from '../common/app-exception';

const BPMN_MODEL_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

/**
 * Basic structural/safety checks on uploaded BPMN XML. Full parsing happens in
 * bpmn-js on the client; the server rejects DTDs/entities (XXE, billion laughs)
 * and anything that is not a BPMN 2.0 definitions document.
 */
/** The BPMN 2.0 model namespace declared as an xmlns attribute (not just mentioned somewhere). */
const BPMN_NS_DECLARATION = new RegExp(
  `\\sxmlns(:[\\w.-]+)?\\s*=\\s*["']${BPMN_MODEL_NS.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}["']`,
);

export function assertSafeBpmnXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw badRequest('INVALID_BPMN', 'DTD and entity declarations are not allowed');
  }
  const withoutProlog = xml.replace(/^\uFEFF?\s*(<\?xml[^>]*\?>)?\s*(<!--[\s\S]*?-->\s*)*/, '');
  if (!/^<([\w-]+:)?definitions[\s>]/.test(withoutProlog) || !BPMN_NS_DECLARATION.test(xml)) {
    throw badRequest('INVALID_BPMN', 'Not a BPMN 2.0 document');
  }
}

export function countFlowElements(xml: string): number {
  return extractBpmnElementIds(xml).size;
}

/** Bilingual label of a BPMN element; a plain `name` (foreign BPMN) is treated as English. */
export function elementLabel(
  labels: Map<string, BpmnElementLabel>,
  elementId: string,
): ElementLabelDto | null {
  const l = labels.get(elementId);
  if (!l) return null;
  return { nameEn: l.nameEn || (l.nameAr ? '' : l.name), nameAr: l.nameAr };
}
