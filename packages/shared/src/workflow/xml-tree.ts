import { decodeXml } from '../bpmn-validation';

/**
 * A tiny, dependency-free XML reader for the server and the browser (same tokenizer approach as
 * `bpmn-graph.ts`): elements with their local name, prefix, attributes, children and text. Enough for
 * BPMN and DMN files written by bpmn-js / dmn-js; namespaces are resolved by prefix only.
 */
export interface XmlEl {
  local: string;
  prefix: string;
  attrs: Record<string, string>;
  children: XmlEl[];
  text: string;
}

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([\w.-]+:)?([\w.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXmlTree(xml: string): XmlEl {
  const root: XmlEl = { local: '#root', prefix: '', attrs: {}, children: [], text: '' };
  const stack: XmlEl[] = [root];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(xml))) {
    const [, cdata, closing, prefix, local, attrText, selfClosing, chars] = m;
    const top = stack[stack.length - 1];
    if (chars !== undefined) {
      top.text += decodeXml(chars);
      continue;
    }
    if (cdata !== undefined) {
      top.text += cdata;
      continue;
    }
    if (!local) continue;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    ATTR.lastIndex = 0;
    while ((a = ATTR.exec(attrText ?? ''))) attrs[a[1]] = decodeXml(a[2] ?? a[3] ?? '');
    const el: XmlEl = {
      local,
      prefix: prefix ? prefix.slice(0, -1) : '',
      attrs,
      children: [],
      text: '',
    };
    top.children.push(el);
    if (!selfClosing) stack.push(el);
  }
  return root;
}

export const childEls = (el: XmlEl, local: string) => el.children.filter((c) => c.local === local);
export const childEl = (el: XmlEl, local: string) => el.children.find((c) => c.local === local);

/** Depth-first search of all descendants with a local name. */
export function findAll(el: XmlEl, local: string, out: XmlEl[] = []): XmlEl[] {
  for (const c of el.children) {
    if (c.local === local) out.push(c);
    findAll(c, local, out);
  }
  return out;
}

/** Attribute by local name with any prefix (`ph:exec`, `xyz:exec` …) — prefer the given prefix. */
export function phAttr(el: XmlEl, name: string): string | undefined {
  if (el.attrs[`ph:${name}`] !== undefined) return el.attrs[`ph:${name}`];
  return undefined;
}
