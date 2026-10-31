import { JSDOM } from 'jsdom';
import { BPMN_BIOC_NS, BPMN_COLOR_NS, isArabicText, type ImportIssue } from '@processhub/shared';
import { readBpmn } from '../../ai/bpmn/read-bpmn';
import { structureToBpmn } from '../../ai/bpmn/structure-to-bpmn';
import { ImportFileError, parseSafeXml } from '../safe-upload';
import { issue } from './tabular';

export const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
export const BPMNDI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';
const DC_NS = 'http://www.omg.org/spec/DD/20100524/DC';
const DI_NS = 'http://www.omg.org/spec/DD/20100524/DI';
export const PH_NS = 'http://processhub.io/schema/bpmn';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

/** Namespaces that are part of BPMN 2.0, its diagram interchange, colours and ProcessHub. */
const XSD_NS = 'http://www.w3.org/2001/XMLSchema';
const STANDARD = new Set([
  BPMN_NS,
  BPMNDI_NS,
  DC_NS,
  DI_NS,
  PH_NS,
  XSI_NS,
  XSD_NS,
  XML_NS,
  BPMN_COLOR_NS,
  BPMN_BIOC_NS,
]);

/** Elements that carry a name shown on the canvas. */
const LABELLED = new Set([
  'process',
  'participant',
  'lane',
  'sequenceFlow',
  'messageFlow',
  'task',
  'userTask',
  'manualTask',
  'serviceTask',
  'sendTask',
  'receiveTask',
  'scriptTask',
  'businessRuleTask',
  'callActivity',
  'subProcess',
  'transaction',
  'adHocSubProcess',
  'startEvent',
  'endEvent',
  'intermediateCatchEvent',
  'intermediateThrowEvent',
  'boundaryEvent',
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
  'eventBasedGateway',
  'complexGateway',
  'dataObjectReference',
  'dataStoreReference',
]);
const ACTIVITY = /task$|^callActivity$|^subProcess$|^transaction$|^adHocSubProcess$/i;
const FLOW_NODE = /task$|activity$|subprocess$|transaction$|event$|gateway$/i;

let dom: JSDOM | null = null;
const serializer = () => new (dom ??= new JSDOM('')).window.XMLSerializer();

export interface BpmnAnalysis {
  /** Normalised XML (ph labels, vendor extensions per option, layout when needed). */
  xml: string;
  processIds: string[];
  nameEn: string;
  nameAr: string;
  hadLayout: boolean;
  laidOut: boolean;
  vendors: string[];
  elements: number;
  flows: number;
  lanes: { id: string; name: string }[];
  /** Labelled flow nodes (for dictionary suggestions). */
  labels: { id: string; name: string }[];
  arabic: boolean;
  issues: ImportIssue[];
}

const nameOf = (el: Element) =>
  el.getAttributeNS(PH_NS, 'nameEn') ||
  el.getAttributeNS(PH_NS, 'nameAr') ||
  el.getAttribute('name') ||
  '';

/** Removes elements and attributes of vendor namespaces (Camunda, Signavio, Bizagi …). */
function stripVendor(doc: Document): string[] {
  const vendors = new Set<string>();
  const all = Array.from(doc.getElementsByTagName('*'));
  for (const el of all) {
    if (!el.isConnected) continue;
    if (el.namespaceURI && !STANDARD.has(el.namespaceURI)) {
      vendors.add(el.namespaceURI);
      el.parentNode?.removeChild(el);
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      if (attr.namespaceURI === XMLNS_NS) {
        if (!STANDARD.has(attr.value) && attr.value !== BPMN_NS) {
          vendors.add(attr.value);
          el.removeAttributeNode(attr);
        }
      } else if (attr.namespaceURI && !STANDARD.has(attr.namespaceURI)) {
        vendors.add(attr.namespaceURI);
        el.removeAttributeNode(attr);
      }
    }
  }
  for (const ext of Array.from(doc.getElementsByTagNameNS(BPMN_NS, 'extensionElements')))
    if (!Array.from(ext.childNodes).some((c) => c.nodeType === 1)) ext.parentNode?.removeChild(ext);
  return [...vendors];
}

function vendorNamespaces(doc: Document): string[] {
  const out = new Set<string>();
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (el.namespaceURI && !STANDARD.has(el.namespaceURI)) out.add(el.namespaceURI);
    for (const a of Array.from(el.attributes))
      if (a.namespaceURI && a.namespaceURI !== XMLNS_NS && !STANDARD.has(a.namespaceURI))
        out.add(a.namespaceURI);
  }
  return [...out];
}

/** Sets ph:nameEn / ph:nameAr from `name` by script, where no bilingual label exists yet. */
function bilingualLabels(doc: Document): boolean {
  const root = doc.documentElement;
  if (!root.lookupNamespaceURI('ph')) root.setAttributeNS(XMLNS_NS, 'xmlns:ph', PH_NS);
  let arabic = false;
  for (const el of Array.from(doc.getElementsByTagNameNS(BPMN_NS, '*'))) {
    if (!LABELLED.has(el.localName)) continue;
    const name = (el.getAttribute('name') ?? '').trim();
    const hasEn = el.hasAttributeNS(PH_NS, 'nameEn');
    const hasAr = el.hasAttributeNS(PH_NS, 'nameAr');
    if (hasAr && el.getAttributeNS(PH_NS, 'nameAr')) arabic = true;
    if (!name || hasEn || hasAr) continue;
    if (isArabicText(name)) {
      arabic = true;
      el.setAttributeNS(PH_NS, 'ph:nameAr', name);
    } else el.setAttributeNS(PH_NS, 'ph:nameEn', name);
  }
  return arabic;
}

function layoutPresent(doc: Document): boolean {
  const nodes = Array.from(doc.getElementsByTagNameNS(BPMN_NS, '*')).filter(
    (e) => FLOW_NODE.test(e.localName) && e.localName !== 'boundaryEvent',
  ).length;
  const shapes = doc.getElementsByTagNameNS(BPMNDI_NS, 'BPMNShape').length;
  return nodes === 0 ? shapes > 0 : shapes >= Math.ceil(nodes * 0.8);
}

/**
 * Checks and normalises one BPMN 2.0 document of an import (Signavio, Camunda, Bizagi, ARIS …):
 * safe XML, BPMN root, vendor extensions (strip / keep), bilingual labels by script, layout via
 * the shared layered layout when the diagram interchange is missing (or always, by option).
 */
export function analyseBpmn(
  text: string,
  file: string,
  opts: { stripVendor: boolean; layout: 'MISSING' | 'ALWAYS'; key: string },
): BpmnAnalysis {
  let doc = parseSafeXml(text, file);
  const root = doc.documentElement;
  if (root.localName !== 'definitions' || root.namespaceURI !== BPMN_NS)
    throw new ImportFileError('NOT_BPMN', { file });
  const issues: ImportIssue[] = [];
  const vendors = opts.stripVendor ? stripVendor(doc) : vendorNamespaces(doc);
  if (vendors.length)
    issues.push(
      issue('WARNING', opts.stripVendor ? 'VENDOR_STRIPPED' : 'VENDOR_KEPT', {
        list: vendors.map((v) => v.replace(/^https?:\/\//, '')).join(', '),
      }),
    );
  let arabic = bilingualLabels(doc);
  const hadLayout = layoutPresent(doc);
  let laidOut = false;
  if (!hadLayout || opts.layout === 'ALWAYS') {
    const processes = doc.getElementsByTagNameNS(BPMN_NS, 'process');
    if (processes.length > 1)
      issues.push(issue('WARNING', 'LAYOUT_FIRST_POOL', { count: processes.length }));
    try {
      const read = readBpmn(serializer().serializeToString(doc));
      if (read.structure.nodes.length) {
        const xml = structureToBpmn(read.structure, {
          key: opts.key,
          preserve: read.preserve,
          flowIds: read.flowIds,
          containers: read.containers,
        });
        doc = parseSafeXml(xml, file);
        laidOut = true;
        if (read.dropped) issues.push(issue('WARNING', 'LAYOUT_DROPPED', { count: read.dropped }));
        if (!hadLayout) issues.push(issue('WARNING', 'LAYOUT_GENERATED'));
      }
    } catch {
      issues.push(issue('ERROR', 'LAYOUT_FAILED'));
    }
    arabic = bilingualLabels(doc) || arabic;
  }

  const all = Array.from(doc.getElementsByTagNameNS(BPMN_NS, '*'));
  const nodes = all.filter((e) => FLOW_NODE.test(e.localName));
  const processes = all.filter((e) => e.localName === 'process');
  const participant = all.find((e) => e.localName === 'participant');
  const named = participant && nameOf(participant) ? participant : processes.find((p) => nameOf(p));
  const nameEn = named
    ? named.getAttributeNS(PH_NS, 'nameEn') ||
      (isArabicText(named.getAttribute('name') ?? '') ? '' : (named.getAttribute('name') ?? ''))
    : '';
  const nameAr = named
    ? named.getAttributeNS(PH_NS, 'nameAr') ||
      (isArabicText(named.getAttribute('name') ?? '') ? (named.getAttribute('name') ?? '') : '')
    : '';
  if (!nodes.some((n) => n.localName === 'startEvent'))
    issues.push(issue('WARNING', 'NO_START_EVENT'));
  if (!nodes.some((n) => n.localName === 'endEvent')) issues.push(issue('WARNING', 'NO_END_EVENT'));
  const unnamed = nodes.filter((n) => ACTIVITY.test(n.localName) && !nameOf(n)).length;
  if (unnamed) issues.push(issue('WARNING', 'UNNAMED_ACTIVITIES', { count: unnamed }));
  if (!nodes.length) issues.push(issue('ERROR', 'EMPTY_DIAGRAM'));
  const xml = serializer().serializeToString(doc);
  if (xml.length > 5 * 1024 * 1024) issues.push(issue('ERROR', 'DIAGRAM_TOO_LARGE'));
  return {
    xml: xml.startsWith('<?xml') ? xml : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`,
    processIds: processes.map((p) => p.getAttribute('id') ?? '').filter(Boolean),
    nameEn,
    nameAr,
    hadLayout,
    laidOut,
    vendors,
    elements: nodes.length,
    flows: all.filter((e) => e.localName === 'sequenceFlow').length,
    lanes: all
      .filter((e) => e.localName === 'lane' && !e.getElementsByTagNameNS(BPMN_NS, 'lane').length)
      .map((l) => ({ id: l.getAttribute('id') ?? '', name: nameOf(l) }))
      .filter((l) => l.id && l.name),
    labels: nodes
      .filter((n) => ACTIVITY.test(n.localName) || n.localName.endsWith('Event'))
      .map((n) => ({ id: n.getAttribute('id') ?? '', name: nameOf(n) }))
      .filter((l) => l.id && l.name),
    arabic,
    issues,
  };
}

/** Sets accepted suggestions on the XML: lane → `ph:roleId`, element → `ph:labelRef`. */
export function applyBpmnSuggestions(
  xml: string,
  roles: Map<string, string>,
  terms: Map<string, string>,
): string {
  if (!roles.size && !terms.size) return xml;
  const doc = parseSafeXml(xml);
  const root = doc.documentElement;
  if (!root.lookupNamespaceURI('ph')) root.setAttributeNS(XMLNS_NS, 'xmlns:ph', PH_NS);
  for (const el of Array.from(doc.getElementsByTagNameNS(BPMN_NS, '*'))) {
    const id = el.getAttribute('id') ?? '';
    const role = roles.get(id);
    if (role && el.localName === 'lane') el.setAttributeNS(PH_NS, 'ph:roleId', role);
    const term = terms.get(id);
    if (term) el.setAttributeNS(PH_NS, 'ph:labelRef', term);
  }
  const out = serializer().serializeToString(doc);
  return out.startsWith('<?xml') ? out : `<?xml version="1.0" encoding="UTF-8"?>\n${out}`;
}
