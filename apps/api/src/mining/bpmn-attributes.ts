const PH_NS = 'http://processhub.io/schema/bpmn';

const escAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Sets (or removes, value null) `ph:` attributes on the element with `id` in BPMN XML, adding the
 * ProcessHub namespace to the definitions when missing. Only the opening tag is touched.
 */
export function setPhAttributes(
  xml: string,
  id: string,
  attrs: Record<string, string | null>,
): string {
  const tag = new RegExp(`<([\\w.-]+:)?([\\w.-]+)(\\s[^<>]*?\\bid="${escRe(id)}"[^<>]*?)(/?)>`);
  const m = tag.exec(xml);
  if (!m) throw new Error(`Element ${id} not found`);
  // The prefix bound to the ProcessHub namespace (usually "ph").
  const ns = new RegExp(`xmlns:([\\w.-]+)="${escRe(PH_NS)}"`).exec(xml);
  const prefix = ns?.[1] ?? 'ph';
  let body = m[3];
  for (const [name, value] of Object.entries(attrs)) {
    const re = new RegExp(`\\s${escRe(prefix)}:${escRe(name)}="[^"]*"`);
    body = body.replace(re, '');
    if (value !== null) body = `${body.replace(/\s+$/, '')} ${prefix}:${name}="${escAttr(value)}"`;
  }
  body = body.replace(/\s+$/, '') + (m[4] ? ' ' : '');
  let out = `${xml.slice(0, m.index)}<${m[1] ?? ''}${m[2]}${body}${m[4]}>${xml.slice(m.index + m[0].length)}`;
  if (!ns) out = out.replace(/<([\w.-]+:)?definitions\b/, (d) => `${d} xmlns:ph="${PH_NS}"`);
  return out;
}
