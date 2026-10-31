import { JSDOM } from 'jsdom';
import { parseSafeXml } from './safe-upload';
import { BPMN_NS, PH_NS } from './importers/bpmn-tools';

const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const LABELLED = /task$|activity$|subprocess$|event$|gateway$|^lane$|^participant$|^sequenceFlow$/i;

let dom: JSDOM | null = null;
const serializer = () => new (dom ??= new JSDOM('')).window.XMLSerializer();

/** Bilingual labels of the named elements of a BPMN model (`ph:nameEn` / `ph:nameAr`). */
export function extractBpmnLabels(xml: string): { id: string; en: string; ar: string }[] {
  const doc = parseSafeXml(xml);
  return Array.from(doc.getElementsByTagNameNS(BPMN_NS, '*'))
    .filter((e) => LABELLED.test(e.localName))
    .map((e) => ({
      id: e.getAttribute('id') ?? '',
      en: e.getAttributeNS(PH_NS, 'nameEn') ?? '',
      ar: e.getAttributeNS(PH_NS, 'nameAr') ?? '',
    }))
    .filter((l) => l.id && (l.en || l.ar));
}

/** Writes translated labels into `ph:nameEn` / `ph:nameAr` (the visible `name` is kept). */
export function setBpmnLabels(
  xml: string,
  labels: { id: string; lang: 'en' | 'ar'; text: string }[],
): string {
  const doc = parseSafeXml(xml);
  const root = doc.documentElement;
  if (!root.lookupNamespaceURI('ph')) root.setAttributeNS(XMLNS_NS, 'xmlns:ph', PH_NS);
  const byId = new Map(labels.map((l) => [`${l.id}:${l.lang}`, l.text]));
  for (const e of Array.from(doc.getElementsByTagNameNS(BPMN_NS, '*'))) {
    const id = e.getAttribute('id') ?? '';
    for (const lang of ['en', 'ar'] as const) {
      const text = byId.get(`${id}:${lang}`);
      if (text) e.setAttributeNS(PH_NS, lang === 'en' ? 'ph:nameEn' : 'ph:nameAr', text);
    }
  }
  const out = serializer().serializeToString(doc);
  return out.startsWith('<?xml') ? out : `<?xml version="1.0" encoding="UTF-8"?>\n${out}`;
}
