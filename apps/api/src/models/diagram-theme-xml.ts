import { JSDOM } from 'jsdom';
import {
  BPMN_BIOC_NS,
  BPMN_COLOR_NS,
  themeColour,
  themeKindOf,
  type DiagramTheme,
} from '@processhub/shared';

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const BPMNDI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';
const PH_NS = 'http://processhub.io/schema/bpmn';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

let dom: JSDOM | null = null;
const window = () => (dom ??= new JSDOM('')).window;

/** True when a BPMNShape already carries a colour (BPMN-in-Color or bpmn.io attributes). */
export function hasExplicitColour(shape: Element): boolean {
  return (
    shape.hasAttributeNS(BPMN_COLOR_NS, 'background-color') ||
    shape.hasAttributeNS(BPMN_COLOR_NS, 'border-color') ||
    shape.hasAttributeNS(BPMN_BIOC_NS, 'fill') ||
    shape.hasAttributeNS(BPMN_BIOC_NS, 'stroke')
  );
}

/** The prefix bound to `ns` on the root, declaring `preferred` (or a free variant) when missing. */
function prefixFor(root: Element, ns: string, preferred: string): string {
  const bound = root.lookupPrefix(ns);
  if (bound) return bound;
  let prefix = preferred;
  for (let i = 2; root.lookupNamespaceURI(prefix); i++) prefix = `${preferred}${i}`;
  root.setAttributeNS(XMLNS_NS, `xmlns:${prefix}`, ns);
  return prefix;
}

/**
 * Gives every shape without colours the theme colour of its element kind, as
 * `color:background-color` / `color:border-color` and `bioc:fill` / `bioc:stroke`.
 * Shapes that already have a colour are never changed. Returns the XML unchanged (same string)
 * when nothing was recoloured or the XML does not parse.
 */
export function applyThemeToXml(
  xml: string,
  theme: DiagramTheme,
): { xml: string; changed: number } {
  const w = window();
  const doc = new w.DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return { xml, changed: 0 };
  const root = doc.documentElement;

  const semantic = new Map<string, Element>();
  for (const el of Array.from(doc.getElementsByTagNameNS(BPMN_NS, '*'))) {
    const id = el.getAttribute('id');
    if (id) semantic.set(id, el);
  }
  // Lanes alternate their fill by position inside their lane set.
  const laneIndex = new Map<string, number>();
  for (const set of Array.from(doc.getElementsByTagNameNS(BPMN_NS, 'laneSet'))) {
    Array.from(set.children)
      .filter((c) => c.namespaceURI === BPMN_NS && c.localName === 'lane')
      .forEach((lane, i) => laneIndex.set(lane.getAttribute('id') ?? '', i));
  }

  let changed = 0;
  let colorPrefix = '';
  let biocPrefix = '';
  for (const shape of Array.from(doc.getElementsByTagNameNS(BPMNDI_NS, 'BPMNShape'))) {
    if (hasExplicitColour(shape)) continue;
    const id = shape.getAttribute('bpmnElement') ?? '';
    const el = semantic.get(id);
    if (!el) continue;
    const nameEn = el.getAttributeNS(PH_NS, 'nameEn') || '';
    const kind = themeKindOf({
      type: el.localName,
      nameEn: nameEn || (el.getAttributeNS(PH_NS, 'nameAr') ? '' : el.getAttribute('name')),
      stepKind: el.getAttributeNS(PH_NS, 'stepKind'),
      eventDefinitions: Array.from(el.children)
        .map((c) => c.localName)
        .filter((n) => n.endsWith('EventDefinition')),
    });
    if (!kind) continue;
    const { fill, stroke } = themeColour(theme, kind, laneIndex.get(id) ?? 0);
    colorPrefix ||= prefixFor(root, BPMN_COLOR_NS, 'color');
    biocPrefix ||= prefixFor(root, BPMN_BIOC_NS, 'bioc');
    shape.setAttributeNS(BPMN_BIOC_NS, `${biocPrefix}:stroke`, stroke);
    shape.setAttributeNS(BPMN_BIOC_NS, `${biocPrefix}:fill`, fill);
    shape.setAttributeNS(BPMN_COLOR_NS, `${colorPrefix}:background-color`, fill);
    shape.setAttributeNS(BPMN_COLOR_NS, `${colorPrefix}:border-color`, stroke);
    changed++;
  }
  if (!changed) return { xml, changed };
  const body = new w.XMLSerializer().serializeToString(doc);
  const prolog = /^\uFEFF?\s*<\?xml[^>]*\?>/.exec(xml)?.[0].trimStart();
  return { xml: prolog && !body.startsWith('<?xml') ? `${prolog}\n${body}` : body, changed };
}
