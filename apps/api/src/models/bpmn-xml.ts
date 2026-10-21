import { extractBpmnElementIds } from '@processhub/shared';
import { badRequest } from '../common/app-exception';

const BPMN_MODEL_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

/**
 * Basic structural/safety checks on uploaded BPMN XML. Full parsing happens in
 * bpmn-js on the client; the server rejects DTDs/entities (XXE, billion laughs)
 * and anything that is not a BPMN 2.0 definitions document.
 */
export function assertSafeBpmnXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw badRequest('INVALID_BPMN', 'DTD and entity declarations are not allowed');
  }
  const withoutProlog = xml.replace(/^﻿?\s*(<\?xml[^>]*\?>)?\s*(<!--[\s\S]*?-->\s*)*/, '');
  if (!/^<([\w-]+:)?definitions[\s>]/.test(withoutProlog) || !xml.includes(BPMN_MODEL_NS)) {
    throw badRequest('INVALID_BPMN', 'Not a BPMN 2.0 document');
  }
}

export function countFlowElements(xml: string): number {
  return extractBpmnElementIds(xml).size;
}
