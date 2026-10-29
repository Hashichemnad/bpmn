import {
  STEP_TYPES,
  STEP_TYPE_BPMN,
  isFlowNode,
  normaliseSearchText,
  stepTypeOf,
  type Locale,
  type StepType,
} from '@processhub/shared';
import type {
  BpmnInstance,
  BusinessObject,
  CommandStack,
  DiagramElement,
  ElementRegistry,
  Modeling,
} from './bpmn-types';
import { laneOf, laneRoleOf, readLabels } from './diagram';
import { pickLabel } from './labels';
import { planAutoLayout } from './auto-layout';

/**
 * Quick Model (Modeler design B2, D-085): the process as a table — one row per step with its
 * bilingual name, the role performing it (lane), IT system, step type and next steps with optional
 * condition labels. Rows are read from the diagram and written back as ONE undoable command that
 * creates, changes and removes elements (existing ids are kept, so comments, links and history
 * stay attached) and then runs the shared auto-layout. Elements the table does not show (data
 * objects, annotations, boundary events, …) are left alone.
 */

export interface QuickRole {
  /** Library role (lane linked with ph:roleId), or null for a lane named by text only. */
  id: string | null;
  nameEn: string;
  nameAr: string;
}

export interface QuickNext {
  /** Key of the target row. */
  target: string;
  labelEn: string;
  labelAr: string;
}

export interface QuickRow {
  /** Element id of an existing step; `new-…` for rows not in the diagram yet. */
  key: string;
  nameEn: string;
  nameAr: string;
  role: QuickRole | null;
  /** Library IT system (SUPPORTS link), or null. */
  systemId: string | null;
  type: StepType;
  /** BPMN type of an `other` step (shown, not editable). */
  elementType?: string;
  next: QuickNext[];
}

export type QuickIssueCode =
  | 'NAME_MISSING'
  | 'UNKNOWN_NEXT'
  | 'SELF_LOOP'
  | 'END_HAS_NEXT'
  | 'NO_NEXT'
  | 'DECISION_ONE_WAY'
  | 'EMPTY';

export interface QuickIssue {
  code: QuickIssueCode;
  severity: 'error' | 'warning';
  /** Row number (1-based); absent for table-wide issues. */
  row?: number;
}

type Shape = DiagramElement & {
  x: number;
  y: number;
  width: number;
  height: number;
  incoming?: Connection[];
  outgoing?: Connection[];
  children?: Shape[];
};
type Connection = DiagramElement & { source: Shape; target: Shape };

let newKeyCounter = 0;
export const newRowKey = () => `new-${Date.now().toString(36)}-${++newKeyCounter}`;
export const isNewKey = (key: string) => key.startsWith('new-');

export const emptyRow = (): QuickRow => ({
  key: newRowKey(),
  nameEn: '',
  nameAr: '',
  role: null,
  systemId: null,
  type: 'task',
  next: [],
});

const container = (el: DiagramElement) => {
  let p = el.parent;
  while (p && p.type === 'bpmn:Lane') p = p.parent;
  return p;
};

/** Flow nodes the table shows: everything at the top level except start and boundary events. */
function tableNodes(registry: ElementRegistry): Shape[] {
  return registry.filter(
    (e) =>
      e.type !== 'label' &&
      isFlowNode(e.type) &&
      e.type !== 'bpmn:StartEvent' &&
      e.type !== 'bpmn:BoundaryEvent' &&
      ['bpmn:Process', 'bpmn:Participant'].includes(container(e)?.type ?? ''),
  ) as Shape[];
}

const stepKindOf = (bo: BusinessObject) => (bo.get('ph:stepKind') as string | undefined) ?? null;

export function rowTypeOf(el: DiagramElement): StepType {
  const bo = el.businessObject;
  return stepTypeOf({ type: el.type, stepKind: stepKindOf(bo), nameEn: readLabels(bo).nameEn });
}

function laneRole(lane: DiagramElement | null): QuickRole | null {
  if (!lane) return null;
  const l = readLabels(lane.businessObject);
  return {
    id: laneRoleOf(lane),
    nameEn: l.nameEn || l.name || '',
    nameAr: l.nameAr || '',
  };
}

/**
 * The table of a diagram: steps in flow order (breadth-first from the start events, then the rest
 * left to right), each with its lane role, first linked IT system and outgoing sequence flows.
 */
export function diagramToRows(
  instance: BpmnInstance,
  systemOf: (elementId: string) => string | null = () => null,
): QuickRow[] {
  const registry = instance.get<ElementRegistry>('elementRegistry');
  const nodes = tableNodes(registry);
  const inTable = new Set(nodes.map((n) => n.id));
  const starts = registry.filter(
    (e) => e.type === 'bpmn:StartEvent' && e.parent?.type !== 'bpmn:SubProcess',
  ) as Shape[];
  const flowsOut = (n: Shape) =>
    (n.outgoing ?? []).filter((c) => c.type === 'bpmn:SequenceFlow' && inTable.has(c.target.id));

  const order: Shape[] = [];
  const seen = new Set<string>();
  const queue = [...starts]
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .flatMap((s) => flowsOut(s).map((c) => c.target));
  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    order.push(n);
    queue.push(...flowsOut(n).map((c) => c.target));
  }
  order.push(...nodes.filter((n) => !seen.has(n.id)).sort((a, b) => a.x - b.x || a.y - b.y));

  return order.map((n) => {
    const labels = readLabels(n.businessObject);
    const type = rowTypeOf(n);
    return {
      key: n.id,
      nameEn: labels.nameEn ?? (labels.nameAr ? '' : (labels.name ?? '')),
      nameAr: labels.nameAr ?? '',
      role: laneRole(laneOf(registry, n)),
      systemId: systemOf(n.id),
      type,
      ...(type === 'other' ? { elementType: n.type } : {}),
      next: flowsOut(n).map((c) => {
        const l = readLabels(c.businessObject);
        return {
          target: c.target.id,
          labelEn: l.nameEn ?? (l.nameAr ? '' : (l.name ?? '')),
          labelAr: l.nameAr ?? '',
        };
      }),
    };
  });
}

/** Problems that block generating the diagram (errors) or deserve a look (warnings). */
export function validateRows(rows: QuickRow[]): QuickIssue[] {
  const issues: QuickIssue[] = [];
  if (!rows.length) return [{ code: 'EMPTY', severity: 'error' }];
  const keys = new Set(rows.map((r) => r.key));
  rows.forEach((r, i) => {
    const row = i + 1;
    if (!r.nameEn.trim() && !r.nameAr.trim() && r.type !== 'end' && r.type !== 'other')
      issues.push({ code: 'NAME_MISSING', severity: 'error', row });
    for (const n of r.next) {
      if (!keys.has(n.target)) issues.push({ code: 'UNKNOWN_NEXT', severity: 'error', row });
      else if (n.target === r.key) issues.push({ code: 'SELF_LOOP', severity: 'error', row });
    }
    if (r.type === 'end' && r.next.length)
      issues.push({ code: 'END_HAS_NEXT', severity: 'error', row });
    if (r.type !== 'end' && r.type !== 'other' && !r.next.length)
      issues.push({ code: 'NO_NEXT', severity: 'warning', row });
    if (r.type === 'decision' && r.next.length === 1)
      issues.push({ code: 'DECISION_ONE_WAY', severity: 'warning', row });
  });
  return issues;
}

// ---------- Paste from Excel ----------

/** Labels of the step types accepted in a pasted "type" column (both languages and the keys). */
export type TypeLabels = Record<(typeof STEP_TYPES)[number], string[]>;

export interface PasteLookup {
  roles: { id: string; nameEn: string; nameAr: string }[];
  systems: { id: string; nameEn: string; nameAr: string }[];
  typeLabels: TypeLabels;
}

export interface PasteResult {
  rows: QuickRow[];
  /** Names of IT systems that are not in the library (left empty). */
  unknownSystems: string[];
  /** Next-step references that matched no row (row number and text). */
  unknownNext: { row: number; text: string }[];
}

const ARABIC = /[؀-ۿ]/;
const HEADER = /^(step|steps|name|#|no\.?|الخطوة|الخطوات|الاسم|م)$/i;

/** Tab-separated text (copied from Excel); quoted cells may contain tabs and line breaks. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const t = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '\t') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const byName = <T extends { nameEn: string; nameAr: string }>(items: T[], text: string) => {
  const q = normaliseSearchText(text);
  return items.find(
    (i) => normaliseSearchText(i.nameEn) === q || normaliseSearchText(i.nameAr) === q,
  );
};

/**
 * Rows from pasted Excel columns: step name (English), step name (Arabic), performed by, IT system,
 * step type, next steps, condition labels. A single name column is enough; a name in Arabic script
 * in the first column goes to the Arabic name. Next steps refer to row numbers or step names,
 * separated by ";" or ","; the conditions column lists one label per next step in the same order.
 * Roles and systems are matched to the library by name (spelling variants folded); an unknown role
 * still becomes a lane with that name.
 */
export function rowsFromPaste(text: string, lookup: PasteLookup): PasteResult {
  const table = parseTsv(text);
  if (table.length && HEADER.test(table[0][0]?.trim() ?? '')) table.shift();
  const unknownSystems: string[] = [];
  const unknownNext: PasteResult['unknownNext'] = [];
  const rows: QuickRow[] = table.map((cells) => {
    const [c0 = '', c1 = '', role = '', system = '', type = ''] = cells.map((c) => c.trim());
    let nameEn = c0;
    let nameAr = c1;
    if (ARABIC.test(c0) && !c1) [nameEn, nameAr] = ['', c0];
    const libRole = role ? byName(lookup.roles, role) : undefined;
    const libSystem = system ? byName(lookup.systems, system) : undefined;
    if (system && !libSystem && !unknownSystems.includes(system)) unknownSystems.push(system);
    const q = normaliseSearchText(type);
    const stepType =
      (q &&
        STEP_TYPES.find(
          (t) => t === q || lookup.typeLabels[t].some((l) => normaliseSearchText(l) === q),
        )) ||
      'task';
    return {
      key: newRowKey(),
      nameEn,
      nameAr,
      role: libRole
        ? { id: libRole.id, nameEn: libRole.nameEn, nameAr: libRole.nameAr }
        : role
          ? ARABIC.test(role)
            ? { id: null, nameEn: '', nameAr: role }
            : { id: null, nameEn: role, nameAr: '' }
          : null,
      systemId: libSystem?.id ?? null,
      type: stepType,
      next: [],
    };
  });
  // Next steps (second pass: they refer to rows by number or name).
  table.forEach((cells, i) => {
    const refs = (cells[5] ?? '')
      .split(/[;,،\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const labels = (cells[6] ?? '').split(/[;,،\n]/).map((s) => s.trim());
    refs.forEach((ref, j) => {
      const num = /^\d+$/.test(ref) ? Number(ref) : NaN;
      const target = Number.isFinite(num)
        ? rows[num - 1]
        : rows.find(
            (r) =>
              normaliseSearchText(r.nameEn) === normaliseSearchText(ref) ||
              normaliseSearchText(r.nameAr) === normaliseSearchText(ref),
          );
      if (!target) {
        unknownNext.push({ row: i + 1, text: ref });
        return;
      }
      const label = labels[j] ?? '';
      rows[i].next.push({
        target: target.key,
        labelEn: ARABIC.test(label) ? '' : label,
        labelAr: ARABIC.test(label) ? label : '',
      });
    });
  });
  // Without a next-step column, steps follow each other in row order.
  if (table.every((c) => !(c[5] ?? '').trim()))
    rows.forEach((r, i) => {
      if (i < rows.length - 1 && r.type !== 'end')
        r.next.push({ target: rows[i + 1].key, labelEn: '', labelAr: '' });
    });
  return { rows, unknownSystems, unknownNext };
}

// ---------- Table → diagram ----------

interface ElementFactory {
  createParticipantShape(): DiagramElement;
}
interface ExtModeling extends Modeling {
  createShape(
    shape: { type: string } | DiagramElement,
    position: { x: number; y: number },
    parent: DiagramElement,
  ): Shape;
  removeElements(elements: DiagramElement[]): void;
  removeShape(shape: DiagramElement): void;
  moveShape(shape: DiagramElement, delta: { x: number; y: number }, parent?: DiagramElement): void;
  connect(source: DiagramElement, target: DiagramElement, attrs?: { type: string }): Connection;
  addLane(target: DiagramElement, location: 'top' | 'bottom'): Shape;
}
interface Replace {
  replaceElement(el: DiagramElement, target: { type: string }): Shape;
}
interface Canvas {
  getRootElement(): DiagramElement;
}

interface QuickModelContext {
  rows: QuickRow[];
  locale: Locale;
  /** Filled in by the command: row key → element id (new rows get generated ids). */
  ids?: Map<string, string>;
  /** Lanes no role uses any more (removed at the end when empty). */
  unusedLanes?: Shape[];
}

const roleKey = (r: QuickRole) =>
  r.id ? `id:${r.id}` : `name:${normaliseSearchText(r.nameEn || r.nameAr)}`;

/** Sets both labels and the shown one (active language) — only when they changed. */
function setLabels(
  modeling: ExtModeling,
  el: DiagramElement,
  nameEn: string,
  nameAr: string,
  locale: Locale,
) {
  const bo = el.businessObject;
  const l = readLabels(bo);
  const en = nameEn.trim();
  const ar = nameAr.trim();
  if ((l.nameEn ?? '') === en && (l.nameAr ?? '') === ar) return;
  const display = pickLabel({ nameEn: en, nameAr: ar }, locale);
  if ((bo.name ?? '') !== display) modeling.updateLabel(el, display || null);
  modeling.updateModdleProperties(el, bo, {
    'ph:nameEn': en || undefined,
    'ph:nameAr': ar || undefined,
    // The text was set here, not chosen from the library.
    ...(bo.get('ph:labelRef') && (l.nameEn !== en || l.nameAr !== ar)
      ? { 'ph:labelRef': undefined }
      : {}),
  });
}

/**
 * Command handler `ph.quickModel`: all changes run in `preExecute`, so they form one undo step
 * together with the auto-layout in `postExecute`.
 */
class QuickModelHandler {
  static $inject = [
    'elementRegistry',
    'modeling',
    'elementFactory',
    'bpmnReplace',
    'canvas',
    'commandStack',
  ];

  constructor(
    private readonly registry: ElementRegistry,
    private readonly modeling: ExtModeling,
    private readonly factory: ElementFactory,
    private readonly replace: Replace,
    private readonly canvas: Canvas,
    private readonly commandStack: CommandStack & { execute(cmd: string, ctx: unknown): void },
  ) {}

  preExecute(context: QuickModelContext) {
    const { rows, locale } = context;
    const { registry, modeling } = this;
    const ids = new Map<string, string>();
    context.ids = ids;

    // 1. Pool and lanes (one lane per role, in the order roles first appear).
    const roles: QuickRole[] = [];
    for (const r of rows)
      if (r.role && (r.role.id || r.role.nameEn.trim() || r.role.nameAr.trim()))
        if (!roles.some((x) => roleKey(x) === roleKey(r.role!))) roles.push(r.role);
    let pool = registry.filter((e) => e.type === 'bpmn:Participant')[0] as Shape | undefined;
    if (!pool && roles.length) {
      const nodes = tableNodes(registry);
      const x = nodes.length ? Math.min(...nodes.map((n) => n.x)) + 300 : 400;
      const y = nodes.length ? Math.min(...nodes.map((n) => n.y)) + 100 : 250;
      pool = modeling.createShape(
        this.factory.createParticipantShape(),
        { x, y },
        this.canvas.getRootElement(),
      );
    }
    const leafLanes = () =>
      (
        registry.filter(
          (e) =>
            e.type === 'bpmn:Lane' &&
            !(e as Shape).children?.some((c) => c.type === 'bpmn:Lane') &&
            (!pool || container(e) === pool),
        ) as Shape[]
      ).sort((a, b) => a.y - b.y);
    const laneFor = new Map<string, Shape>();
    if (pool && roles.length) {
      let lanes = leafLanes();
      const free = new Set(lanes);
      const matches = (lane: Shape, role: QuickRole) => {
        const id = laneRoleOf(lane);
        if (role.id) return id === role.id;
        const l = readLabels(lane.businessObject);
        const q = normaliseSearchText(role.nameEn || role.nameAr);
        return !id && [l.nameEn, l.nameAr, l.name].some((n) => n && normaliseSearchText(n) === q);
      };
      for (const role of roles) {
        const lane = [...free].find((l) => matches(l, role));
        if (lane) {
          laneFor.set(roleKey(role), lane);
          free.delete(lane);
        }
      }
      const missing = roles.filter((r) => !laneFor.has(roleKey(r)));
      // Lanes no role uses any more and that hold no other elements are re-used first.
      const usedByOthers = (lane: Shape) =>
        (
          (lane.businessObject as unknown as { flowNodeRef?: BusinessObject[] }).flowNodeRef ?? []
        ).some((bo) => !rows.some((r) => r.key === bo.id));
      const reusable = [...free].filter((l) => !usedByOthers(l));
      while (reusable.length < missing.length) {
        const before = new Set(leafLanes());
        const target = lanes.length ? lanes[lanes.length - 1] : pool;
        modeling.addLane(target, 'bottom');
        const added = leafLanes().filter((l) => !before.has(l));
        // The first lane of a pool wraps its content and comes with a second, empty one.
        for (const l of added) if (!reusable.includes(l)) reusable.push(l);
        lanes = leafLanes();
      }
      for (const role of missing) {
        const lane = reusable.shift()!;
        free.delete(lane);
        laneFor.set(roleKey(role), lane);
      }
      for (const role of roles) {
        const lane = laneFor.get(roleKey(role))!;
        setLabels(modeling, lane, role.nameEn || role.nameAr, role.nameAr || role.nameEn, locale);
        if (laneRoleOf(lane) !== role.id)
          modeling.updateModdleProperties(lane, lane.businessObject, {
            'ph:roleId': role.id ?? undefined,
          });
      }
      context.unusedLanes = reusable;
    }

    // 2. Steps: update existing elements, create new ones.
    const parent = (pool ?? this.canvas.getRootElement()) as Shape;
    const existing = tableNodes(registry);
    let nextX = existing.length ? Math.max(...existing.map((n) => n.x + n.width)) + 120 : 300;
    const elements = new Map<string, Shape>();
    for (const row of rows) {
      let el = registry.get(row.key) as Shape | undefined;
      const want =
        row.type === 'other' ? null : STEP_TYPE_BPMN[row.type as Exclude<StepType, 'other'>];
      const lane = row.role ? laneFor.get(roleKey(row.role)) : undefined;
      const centre = (s?: Shape) =>
        s ? { x: nextX, y: s.y + s.height / 2 } : { x: nextX, y: parent.y + 100 };
      if (!el) {
        if (!want) continue;
        const target = lane ?? leafLanes()[0];
        el = modeling.createShape({ type: want.type }, centre(target), parent);
        nextX += 160;
      } else if (want && rowTypeOf(el) !== row.type) {
        // Same family (e.g. task ↔ approval on a user task): only the step kind changes.
        if (el.type !== want.type && !(row.type === 'task' && el.type === 'bpmn:UserTask'))
          el = this.replace.replaceElement(el, { type: want.type });
      }
      if (want && el.type === 'bpmn:UserTask') {
        const kind = row.type === 'approval' ? 'approval' : 'task';
        if (stepKindOf(el.businessObject) !== kind)
          modeling.updateModdleProperties(el, el.businessObject, { 'ph:stepKind': kind });
      }
      setLabels(modeling, el, row.nameEn, row.nameAr, locale);
      if (lane && laneOf(registry, el) !== lane) {
        const dy = lane.y + lane.height / 2 - (el.y + el.height / 2);
        modeling.moveShape(el, { x: 0, y: dy }, parent);
      }
      elements.set(row.key, el);
      ids.set(row.key, el.id);
    }

    // 3. Steps removed from the table are removed from the diagram.
    const keep = new Set([...elements.values()].map((e) => e.id));
    const removed = existing.filter((n) => !keep.has(n.id));
    if (removed.length) modeling.removeElements(removed);

    // 4. Sequence flows between steps: added, relabelled or removed as in the table.
    for (const row of rows) {
      const source = elements.get(row.key);
      if (!source) continue;
      const outgoing = (source.outgoing ?? []).filter(
        (c) => c.type === 'bpmn:SequenceFlow' && keep.has(c.target.id),
      );
      const wanted = row.next.filter((n) => elements.has(n.target));
      for (const c of outgoing)
        if (!wanted.some((n) => elements.get(n.target) === c.target)) modeling.removeElements([c]);
      for (const n of wanted) {
        const target = elements.get(n.target)!;
        let c = (source.outgoing ?? []).find(
          (x) => x.type === 'bpmn:SequenceFlow' && x.target === target,
        );
        c ??= modeling.connect(source, target, { type: 'bpmn:SequenceFlow' });
        setLabels(modeling, c, n.labelEn, n.labelAr, locale);
      }
    }

    // 5. A start event leads to the first step.
    const first = elements.get(rows[0]?.key ?? '');
    if (first) {
      const starts = registry.filter(
        (e) =>
          e.type === 'bpmn:StartEvent' &&
          ['bpmn:Process', 'bpmn:Participant'].includes(container(e)?.type ?? ''),
      ) as Shape[];
      const reaches = starts.some((s) => (s.outgoing ?? []).some((c) => keep.has(c.target.id)));
      if (!reaches) {
        const start =
          starts.find((s) => !(s.outgoing ?? []).length) ??
          modeling.createShape(
            { type: 'bpmn:StartEvent' },
            { x: first.x - 120, y: first.y + first.height / 2 },
            parent,
          );
        modeling.connect(start, first, { type: 'bpmn:SequenceFlow' });
      }
    }

    // 6. Lanes left empty by the table are removed (never the last one).
    for (const lane of context.unusedLanes ?? []) {
      const refs =
        (lane.businessObject as unknown as { flowNodeRef?: unknown[] }).flowNodeRef ?? [];
      if (!refs.length && leafLanes().length > 1 && registry.get(lane.id))
        modeling.removeShape(lane);
    }
  }

  postExecute() {
    const result = planAutoLayout(this.registry);
    if ('plan' in result) this.commandStack.execute('ph.autoLayout', { plan: result.plan });
  }

  execute() {
    return [];
  }

  revert() {
    return [];
  }
}

class QuickModelRegistration {
  static $inject = ['commandStack'];
  constructor(commandStack: { registerHandler(name: string, handler: unknown): void }) {
    commandStack.registerHandler('ph.quickModel', QuickModelHandler);
  }
}

/** Needs the auto-layout module (`ph.autoLayout`) in the same modeler. */
export const quickModelModule = {
  __init__: ['phQuickModel'],
  phQuickModel: ['type', QuickModelRegistration],
};

/**
 * Writes the table into the diagram (one undo step) and returns the element id of every row
 * (new rows get generated ids).
 */
export function applyRows(
  instance: BpmnInstance,
  rows: QuickRow[],
  locale: Locale,
): Map<string, string> {
  const context: QuickModelContext = { rows, locale };
  instance
    .get<CommandStack & { execute(cmd: string, ctx: unknown): void }>('commandStack')
    .execute('ph.quickModel', context);
  return context.ids ?? new Map();
}
