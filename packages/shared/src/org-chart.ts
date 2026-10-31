import type { DiagramEdge, DiagramNode, GraphContent } from './diagrams';

/**
 * Organisation chart generation and merge (D-122). Units come from the department hierarchy,
 * positions from Role library objects placed in departments, persons (optional) from the users
 * holding those job roles. Generated elements have deterministic ids, so a regeneration merges
 * into the existing chart: manual elements and edits stay, sources that disappeared are removed.
 */

export interface OrgSourceDepartment {
  id: string;
  nameEn: string;
  nameAr: string;
  parentId: string | null;
}

export interface OrgSourceRole {
  id: string;
  nameEn: string;
  nameAr: string;
  /** Departments the position belongs to (role attribute `departmentId`, else its holders' departments). */
  departmentIds: string[];
}

export interface OrgSourcePerson {
  id: string;
  nameEn: string;
  nameAr: string;
  departmentId: string | null;
  roleIds: string[];
}

export interface OrgSourceDto {
  departments: OrgSourceDepartment[];
  roles: OrgSourceRole[];
  /** Only for users who may read the user directory. */
  people: OrgSourcePerson[] | null;
}

/** Attribute of a Role library object holding the department of the position. */
export const ROLE_DEPARTMENT_ATTRIBUTE = 'departmentId';

/** Id prefixes of generated elements (manual elements never use them). */
export const ORG_GENERATED_PREFIXES = ['GU_', 'GP_', 'GM_', 'GR_'] as const;
export const isGeneratedOrgId = (id: string) =>
  ORG_GENERATED_PREFIXES.some((p) => id.startsWith(p));

/** Short deterministic hash (FNV-1a, base 36) for edge ids. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const UNIT = { w: 190, h: 64 };
const POS = { w: 170, h: 52 };
const PERSON = { w: 160, h: 44 };
const COL_GAP = 40;
const ROW_GAP = 56;
const ITEM_GAP = 14;
const INDENT = 20;

export const orgUnitId = (departmentId: string) => `GU_${departmentId}`;
export const orgPositionId = (departmentId: string, roleId: string) =>
  `GP_${hash(departmentId)}_${roleId}`;
export const orgPersonId = (userId: string, roleId: string) => `GM_${hash(roleId)}_${userId}`;

/** A top-down chart: each unit with its positions (and persons) below it, sub-units underneath. */
export function generateOrgChart(
  source: OrgSourceDto,
  options: { includePersons?: boolean } = {},
): GraphContent {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const ids = new Set(source.departments.map((d) => d.id));
  const childrenOf = (id: string | null) =>
    source.departments
      .filter((d) => (id ? d.parentId === id : !d.parentId || !ids.has(d.parentId)))
      .sort((a, b) => (a.nameEn || a.nameAr).localeCompare(b.nameEn || b.nameAr));
  const rolesOf = (deptId: string) =>
    source.roles
      .filter((r) => r.departmentIds.includes(deptId))
      .sort((a, b) => (a.nameEn || a.nameAr).localeCompare(b.nameEn || b.nameAr));
  const peopleOf = (deptId: string, roleId: string) =>
    options.includePersons && source.people
      ? source.people
          .filter((p) => p.departmentId === deptId && p.roleIds.includes(roleId))
          .sort((a, b) => (a.nameEn || a.nameAr).localeCompare(b.nameEn || b.nameAr))
      : [];
  const blockHeight = (d: OrgSourceDepartment) =>
    UNIT.h +
    rolesOf(d.id).reduce(
      (sum, r) => sum + ITEM_GAP + POS.h + peopleOf(d.id, r.id).length * (ITEM_GAP / 2 + PERSON.h),
      0,
    );
  const width = (d: OrgSourceDepartment): number => {
    const kids = childrenOf(d.id);
    const own = UNIT.w + INDENT;
    if (!kids.length) return own;
    return Math.max(own, kids.reduce((s, k) => s + width(k), 0) + COL_GAP * (kids.length - 1));
  };
  const edge = (sourceId: string, targetId: string, waypoints: { x: number; y: number }[]) =>
    edges.push({
      id: `GR_${hash(`${sourceId}>${targetId}`)}`,
      kind: 'reports',
      sourceId,
      targetId,
      waypoints,
      nameEn: '',
      nameAr: '',
    });
  // "Comb" lines: positions and people hang off a line along the inline-start side of the
  // column; sub-units are reached around the column, so no line crosses a shape.
  const comb = (x: number, fromY: number, toX: number, toY: number) => [
    { x, y: fromY },
    { x, y: toY },
    { x: toX, y: toY },
  ];
  const place = (d: OrgSourceDepartment, left: number, top: number) => {
    const w = width(d);
    const x = left + (w - UNIT.w - INDENT) / 2;
    const unitId = orgUnitId(d.id);
    nodes.push({
      id: unitId,
      kind: 'unit',
      x,
      y: top,
      width: UNIT.w,
      height: UNIT.h,
      nameEn: d.nameEn,
      nameAr: d.nameAr,
      departmentId: d.id,
    });
    let y = top + UNIT.h;
    for (const r of rolesOf(d.id)) {
      y += ITEM_GAP;
      const posId = orgPositionId(d.id, r.id);
      nodes.push({
        id: posId,
        kind: 'position',
        x: x + INDENT,
        y,
        width: POS.w,
        height: POS.h,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        objectId: r.id,
        departmentId: d.id,
      });
      edge(unitId, posId, comb(x + 10, top + UNIT.h, x + INDENT, y + POS.h / 2));
      y += POS.h;
      const posBottom = y;
      for (const p of peopleOf(d.id, r.id)) {
        y += ITEM_GAP / 2;
        const personId = orgPersonId(p.id, r.id);
        nodes.push({
          id: personId,
          kind: 'person',
          x: x + INDENT * 2,
          y,
          width: PERSON.w,
          height: PERSON.h,
          nameEn: p.nameEn,
          nameAr: p.nameAr,
          userId: p.id,
        });
        edge(posId, personId, comb(x + INDENT + 10, posBottom, x + INDENT * 2, y + PERSON.h / 2));
        y += PERSON.h;
      }
    }
    const kids = childrenOf(d.id);
    let childLeft =
      left +
      (w - (kids.reduce((s, k) => s + width(k), 0) + COL_GAP * Math.max(0, kids.length - 1))) / 2;
    const childTop = top + blockHeight(d) + ROW_GAP;
    const busY = childTop - ROW_GAP / 2;
    for (const k of kids) {
      const kx = childLeft + (width(k) - UNIT.w - INDENT) / 2 + UNIT.w / 2;
      edge(unitId, orgUnitId(k.id), [
        { x, y: top + UNIT.h / 2 },
        { x: x - 12, y: top + UNIT.h / 2 },
        { x: x - 12, y: busY },
        { x: kx, y: busY },
        { x: kx, y: childTop },
      ]);
      place(k, childLeft, childTop);
      childLeft += width(k) + COL_GAP;
    }
  };
  let left = 0;
  for (const root of childrenOf(null)) {
    place(root, left, 0);
    left += width(root) + COL_GAP * 2;
  }
  return { schema: 1, type: 'ORG_CHART', nodes, edges };
}

export interface OrgMergeResult {
  content: GraphContent;
  added: DiagramNode[];
  /** Generated elements whose name changed in the source. */
  renamed: { before: DiagramNode; after: DiagramNode }[];
  /** Generated elements whose source no longer exists. */
  removed: DiagramNode[];
  /** Manual elements (and connections) kept as they are. */
  keptManual: number;
}

/**
 * Merges a fresh generation into the current chart (merge by id): generated elements keep their
 * position, size, colours and description and take the names / references of the source; new
 * sources are added; generated elements without source are removed; manual elements and
 * connections stay. Connections to removed elements are dropped.
 */
export function mergeOrgChart(current: GraphContent, generated: GraphContent): OrgMergeResult {
  const fresh = new Map(generated.nodes.map((n) => [n.id, n]));
  const nodes: DiagramNode[] = [];
  const renamed: OrgMergeResult['renamed'] = [];
  const removed: DiagramNode[] = [];
  let keptManual = 0;
  for (const n of current.nodes) {
    if (!isGeneratedOrgId(n.id)) {
      nodes.push(n);
      keptManual++;
      continue;
    }
    const g = fresh.get(n.id);
    if (!g) {
      removed.push(n);
      continue;
    }
    const merged: DiagramNode = {
      ...n,
      nameEn: g.nameEn,
      nameAr: g.nameAr,
      departmentId: g.departmentId,
      objectId: g.objectId,
      userId: g.userId,
    };
    if (n.nameEn !== g.nameEn || n.nameAr !== g.nameAr) renamed.push({ before: n, after: merged });
    nodes.push(merged);
  }
  const existing = new Set(current.nodes.map((n) => n.id));
  const added = generated.nodes.filter((n) => !existing.has(n.id));
  nodes.push(...added);
  const present = new Set(nodes.map((n) => n.id));
  const edges = current.edges.filter((e) => present.has(e.sourceId) && present.has(e.targetId));
  keptManual += edges.filter((e) => !isGeneratedOrgId(e.id)).length;
  const edgeIds = new Set(edges.map((e) => e.id));
  for (const e of generated.edges)
    if (!edgeIds.has(e.id) && present.has(e.sourceId) && present.has(e.targetId)) edges.push(e);
  return { content: { ...current, nodes, edges }, added, renamed, removed, keptManual };
}

/** Steps a role (position) performs, with its RACI letter (R = performs, A = approval step). */
export interface RoleActivityDto {
  process: { id: string; code: string; nameEn: string; nameAr: string; status: string };
  steps: { id: string; nameEn: string; nameAr: string; letter: 'R' | 'A'; viaLane: boolean }[];
}
