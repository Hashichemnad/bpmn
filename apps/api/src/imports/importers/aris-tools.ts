import type { DiagramEdge, DiagramNode, GraphContent, ImportIssue } from '@processhub/shared';
import { ImportFileError, parseSafeXml } from '../safe-upload';
import { issue } from './tabular';

/** Library object of an AML export (roles / org units, application systems). */
export interface ArisObject {
  /** ObjDef id (used by occurrences). */
  id: string;
  guid: string;
  type: 'ROLE' | 'SYSTEM';
  nameEn: string;
  nameAr: string;
}

export interface ArisModel {
  id: string;
  guid: string;
  kind: 'EPC' | 'VALUE_CHAIN';
  typeNum: string;
  nameEn: string;
  nameAr: string;
  content: GraphContent;
  /** Node id → ObjDef id of a library object (role / system). */
  objectNodes: Map<string, string>;
  issues: ImportIssue[];
}

export interface ArisFile {
  objects: ArisObject[];
  models: ArisModel[];
  /** Models of other types (listed in the report, see BACKLOG). */
  skipped: { name: string; typeNum: string }[];
}

const ROLE_TYPES = new Set([
  'OT_ORG_UNIT',
  'OT_ORG_UNIT_TYPE',
  'OT_PERS_TYPE',
  'OT_POS',
  'OT_GRP',
  'OT_PERS',
]);
const SYSTEM_TYPES = new Set(['OT_APPL_SYS_TYPE', 'OT_APPL_SYS', 'OT_APPL_SYS_CLS', 'OT_IT_FUNC']);
const isEpc = (t: string) => /^MT_E?EPC/.test(t);
const isValueChain = (t: string) => t === 'MT_VAL_ADD_CHN_DGM';

/** LCIDs whose primary language is Arabic (0x01): 1025 (ar-SA), 3073 (ar-EG), … */
const isArabicLcid = (lcid: number) => (lcid & 0x3ff) === 0x01;

const kids = (el: Element, name: string) =>
  Array.from(el.children).filter((c) => c.localName === name);

/** AT_NAME of an ObjDef / Model in English and Arabic (other languages fill English if empty). */
function names(el: Element): { nameEn: string; nameAr: string } {
  let en = '';
  let ar = '';
  let other = '';
  for (const attr of kids(el, 'AttrDef')) {
    if (attr.getAttribute('AttrDef.Type') !== 'AT_NAME') continue;
    for (const v of kids(attr, 'AttrValue')) {
      const plain = Array.from(v.getElementsByTagName('PlainText'))
        .map((p) => p.getAttribute('TextValue') ?? '')
        .join('');
      const text = (plain || v.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const lcid = Number(v.getAttribute('LocaleId'));
      if (isArabicLcid(lcid)) ar ||= text;
      else if (lcid === 1033 || lcid === 2057 || (lcid & 0x3ff) === 0x09) en ||= text;
      else other ||= text;
    }
  }
  return { nameEn: en || (ar ? '' : other), nameAr: ar };
}

const guidOf = (el: Element, idAttr: string) =>
  (kids(el, 'GUID')[0]?.textContent ?? '').trim() || el.getAttribute(idAttr) || '';

const num = (el: Element | undefined, attr: string) => {
  const v = Number(el?.getAttribute(attr));
  return Number.isFinite(v) ? v : null;
};

const DEFAULT_SIZE: Record<string, [number, number]> = {
  event: [130, 64],
  function: [130, 64],
  processPath: [130, 64],
  and: [44, 44],
  or: [44, 44],
  xor: [44, 44],
  orgUnit: [120, 56],
  system: [120, 56],
  information: [120, 56],
  document: [120, 56],
  chevron: [160, 70],
  block: [140, 60],
};
const SCALE = 0.4;
const RESOURCE = new Set(['orgUnit', 'system', 'information', 'document']);

/**
 * Reads an ARIS Markup Language (AML) export: object definitions (roles / org units and
 * application systems become library objects) and models — EPCs into the EPC diagram type,
 * value-added chain diagrams into value chains. Other model types are listed, not imported.
 */
export function readAml(xml: string, file: string): ArisFile {
  const doc = parseSafeXml(xml, file);
  if (doc.documentElement.localName !== 'AML') throw new ImportFileError('NOT_AML', { file });
  const defs = new Map<string, Element>();
  for (const d of Array.from(doc.getElementsByTagName('ObjDef')))
    defs.set(d.getAttribute('ObjDef.ID') ?? '', d);
  const objects: ArisObject[] = [];
  for (const [id, d] of defs) {
    const t = d.getAttribute('TypeNum') ?? '';
    const type = ROLE_TYPES.has(t) ? 'ROLE' : SYSTEM_TYPES.has(t) ? 'SYSTEM' : null;
    if (!type) continue;
    const n = names(d);
    if (!n.nameEn && !n.nameAr) continue;
    objects.push({ id, guid: guidOf(d, 'ObjDef.ID'), type, ...n });
  }
  const libraryIds = new Set(objects.map((o) => o.id));
  const models: ArisModel[] = [];
  const skipped: ArisFile['skipped'] = [];
  for (const m of Array.from(doc.getElementsByTagName('Model'))) {
    const typeNum = m.getAttribute('Model.Type') ?? m.getAttribute('TypeNum') ?? '';
    const n = names(m);
    if (!isEpc(typeNum) && !isValueChain(typeNum)) {
      skipped.push({ name: n.nameEn || n.nameAr || typeNum, typeNum });
      continue;
    }
    const kind = isEpc(typeNum) ? 'EPC' : 'VALUE_CHAIN';
    const issues: ImportIssue[] = [];
    const nodes: DiagramNode[] = [];
    const edges: DiagramEdge[] = [];
    const occId = new Map<string, string>();
    const objectNodes = new Map<string, string>();
    const occs = Array.from(m.getElementsByTagName('ObjOcc'));
    let unknown = 0;
    for (const o of occs) {
      const def = defs.get(o.getAttribute('ObjDef.IdRef') ?? '');
      if (!def) continue;
      const t = def.getAttribute('TypeNum') ?? '';
      const symbol = o.getAttribute('SymbolNum') ?? def.getAttribute('SymbolNum') ?? '';
      let k: string | null = null;
      if (kind === 'VALUE_CHAIN') k = t === 'OT_FUNC' ? 'chevron' : null;
      else if (t === 'OT_FUNC') k = /PRCS_IF/.test(symbol) ? 'processPath' : 'function';
      else if (t === 'OT_EVT') k = 'event';
      else if (t === 'OT_RULE') k = /AND/.test(symbol) ? 'and' : /XOR/.test(symbol) ? 'xor' : 'or';
      else if (ROLE_TYPES.has(t)) k = 'orgUnit';
      else if (SYSTEM_TYPES.has(t)) k = 'system';
      else if (t === 'OT_INFO_CARR') k = 'document';
      else if (t === 'OT_TECH_TRM' || t === 'OT_CLST' || t === 'OT_ENT_TYPE') k = 'information';
      if (!k) {
        unknown++;
        continue;
      }
      const id = `n${nodes.length + 1}`;
      occId.set(o.getAttribute('ObjOcc.ID') ?? '', id);
      const pos = kids(o, 'Position')[0];
      const size = kids(o, 'Size')[0];
      const [dw, dh] = DEFAULT_SIZE[k];
      const w = num(size, 'Size.dX');
      const h = num(size, 'Size.dY');
      const label = names(def);
      nodes.push({
        id,
        kind: k,
        x: Math.round((num(pos, 'Pos.X') ?? nodes.length * 200) * SCALE),
        y: Math.round((num(pos, 'Pos.Y') ?? 0) * SCALE),
        width: Math.max(30, Math.min(400, w ? Math.round(w * SCALE) : dw)),
        height: Math.max(30, Math.min(300, h ? Math.round(h * SCALE) : dh)),
        nameEn: label.nameEn.slice(0, 300),
        nameAr: label.nameAr.slice(0, 300),
      });
      const defId = def.getAttribute('ObjDef.ID') ?? '';
      if (libraryIds.has(defId)) objectNodes.set(id, defId);
    }
    for (const o of occs)
      for (const c of Array.from(o.getElementsByTagName('CxnOcc'))) {
        const from = occId.get(o.getAttribute('ObjOcc.ID') ?? '');
        const to = occId.get(c.getAttribute('ToObjOcc.IdRef') ?? '');
        if (!from || !to || from === to) continue;
        const kf = nodes.find((x) => x.id === from)!.kind;
        const kt = nodes.find((x) => x.id === to)!.kind;
        edges.push({
          id: `e${edges.length + 1}`,
          kind:
            kind === 'VALUE_CHAIN'
              ? 'arrow'
              : RESOURCE.has(kf) || RESOURCE.has(kt)
                ? 'assignment'
                : 'flow',
          sourceId: from,
          targetId: to,
          waypoints: [],
          nameEn: '',
          nameAr: '',
        });
      }
    if (unknown) issues.push(issue('WARNING', 'ARIS_UNSUPPORTED_OBJECTS', { count: unknown }));
    if (!nodes.length) issues.push(issue('ERROR', 'EMPTY_DIAGRAM'));
    // Coordinates start at the top-left corner.
    const minX = Math.min(...nodes.map((x) => x.x), 0);
    const minY = Math.min(...nodes.map((x) => x.y), 0);
    for (const x of nodes) {
      x.x = x.x - minX + 40;
      x.y = x.y - minY + 40;
    }
    models.push({
      id: m.getAttribute('Model.ID') ?? '',
      guid: guidOf(m, 'Model.ID'),
      kind,
      typeNum,
      ...n,
      content: { schema: 1, type: kind, nodes, edges },
      objectNodes,
      issues,
    });
  }
  return { objects, models, skipped };
}
