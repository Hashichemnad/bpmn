import { dmnIssues } from '@processhub/shared';
import { badRequest } from '../common/app-exception';

/**
 * Safety checks on DMN XML (import and save). dmn-js parses the model on the client; the server
 * rejects DTDs / entities (XXE, billion laughs), processing instructions other than the prolog,
 * external references (`href` other than a local `#id`) and anything that is not a DMN
 * definitions document. Labels are rendered as text by dmn-js and the portal (never as HTML).
 */
export function assertSafeDmnXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw badRequest('INVALID_DMN', 'DTD and entity declarations are not allowed');
  const withoutProlog = xml.replace(/^\uFEFF?\s*(<\?xml[^>]*\?>)?/, '');
  if (/<\?/.test(withoutProlog))
    throw badRequest('INVALID_DMN', 'Processing instructions are not allowed');
  if (/\shref\s*=\s*"(?!#)[^"]*"/i.test(xml))
    throw badRequest('INVALID_DMN', 'Only local references (#id) are allowed');
  if (/<(?:[\w-]+:)?(?:script|iframe|object|embed)\b/i.test(xml))
    throw badRequest('INVALID_DMN', 'Markup elements are not allowed');
  const body = withoutProlog.replace(/^\s*(<!--[\s\S]*?-->\s*)*/, '');
  if (!/^<([\w-]+:)?definitions[\s>]/.test(body) || dmnIssues(xml).length)
    throw badRequest('INVALID_DMN', 'Not a DMN 1.x document');
}
