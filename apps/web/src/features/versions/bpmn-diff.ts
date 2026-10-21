import { BpmnModdle } from 'bpmn-moddle';
import { diff } from 'bpmn-js-differ';
import { phModdleDescriptor } from '@/features/modeler/phModdle';

export type BpmnChangeKind = 'added' | 'removed' | 'changed' | 'layout';

export interface BpmnChange {
  id: string;
  kind: BpmnChangeKind;
  /** BPMN type without prefix, e.g. "UserTask". */
  type: string;
  nameEn: string;
  nameAr: string;
  /** Changed attributes (for kind "changed"). */
  attrs: { name: string; oldValue: string; newValue: string }[];
}

interface Element {
  id: string;
  $type: string;
  name?: string;
  get(name: string): unknown;
}

const str = (v: unknown) =>
  v === undefined || v === null
    ? ''
    : typeof v === 'object'
      ? ((v as { id?: string }).id ?? JSON.stringify(v))
      : String(v);

function labels(el: Element) {
  const en = str(el.get?.('ph:nameEn'));
  const ar = str(el.get?.('ph:nameAr'));
  return { nameEn: en || (ar ? '' : str(el.name)), nameAr: ar };
}

async function parse(xml: string) {
  const moddle = new BpmnModdle({ ph: phModdleDescriptor });
  const { rootElement } = await moddle.fromXML(xml);
  return rootElement;
}

const ORDER: Record<BpmnChangeKind, number> = { added: 0, removed: 1, changed: 2, layout: 3 };

/** Semantic diff of two BPMN documents (bpmn-js-differ), with bilingual element names. */
export async function diffBpmn(oldXml: string, newXml: string): Promise<BpmnChange[]> {
  const [a, b] = await Promise.all([parse(oldXml), parse(newXml)]);
  const result = diff(a, b);
  const make = (
    kind: BpmnChangeKind,
    el: Element,
    attrs: BpmnChange['attrs'] = [],
  ): BpmnChange => ({
    id: el.id,
    kind,
    type: el.$type.replace(/^bpmn:/, ''),
    ...labels(el),
    attrs,
  });
  const changes: BpmnChange[] = [
    ...Object.values(result._added).map((el) => make('added', el)),
    ...Object.values(result._removed).map((el) => make('removed', el)),
    ...Object.values(result._changed).map((c) =>
      make(
        'changed',
        c.model,
        // bpmn-js-differ 3.x passes jsondiffpatch's [old, new] into (newValue, oldValue),
        // so its attribute values are swapped; correct them here.
        Object.entries(c.attrs).map(([name, v]) => ({
          name,
          oldValue: str(v.newValue),
          newValue: str(v.oldValue),
        })),
      ),
    ),
    ...Object.values(result._layoutChanged)
      .filter((el) => !result._changed[el.id] && !result._added[el.id])
      .map((el) => make('layout', el)),
  ];
  // Diagram elements (BPMNShape/Edge) and the root process are noise in the change list.
  return changes
    .filter(
      (c) => !/^(Definitions|Process|Collaboration)$/.test(c.type) && !c.type.startsWith('bpmndi:'),
    )
    .sort((x, y) => ORDER[x.kind] - ORDER[y.kind] || x.id.localeCompare(y.id));
}
