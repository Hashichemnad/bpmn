import { describe, expect, it } from 'vitest';
import { parseDiagramContent, stringifyDiagramContent } from './diagrams';
import {
  generateOrgChart,
  mergeOrgChart,
  orgPositionId,
  orgUnitId,
  type OrgSourceDto,
} from './org-chart';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const source: OrgSourceDto = {
  departments: [
    { id: id(1), nameEn: 'Executive Office', nameAr: 'المكتب التنفيذي', parentId: null },
    { id: id(2), nameEn: 'Finance', nameAr: 'المالية', parentId: id(1) },
    { id: id(3), nameEn: 'IT', nameAr: 'تقنية المعلومات', parentId: id(1) },
  ],
  roles: [{ id: id(10), nameEn: 'Accountant', nameAr: 'محاسب', departmentIds: [id(2)] }],
  people: [{ id: id(20), nameEn: 'Sara', nameAr: 'سارة', departmentId: id(2), roleIds: [id(10)] }],
};

describe('organisation chart (D-122)', () => {
  it('generates units, positions, persons and reporting lines top-down', () => {
    const c = generateOrgChart(source, { includePersons: true });
    expect(parseDiagramContent('ORG_CHART', stringifyDiagramContent(c)).ok).toBe(true);
    expect(c.nodes.map((n) => n.kind).sort()).toEqual([
      'person',
      'position',
      'unit',
      'unit',
      'unit',
    ]);
    const root = c.nodes.find((n) => n.id === orgUnitId(id(1)))!;
    const finance = c.nodes.find((n) => n.id === orgUnitId(id(2)))!;
    expect(finance.y).toBeGreaterThan(root.y + root.height);
    expect(c.edges.filter((e) => e.sourceId === root.id)).toHaveLength(2);
    expect(generateOrgChart(source).nodes.some((n) => n.kind === 'person')).toBe(false);
  });

  it('merges a regeneration: keeps manual elements and layout, renames, adds and removes', () => {
    const first = generateOrgChart(source);
    const pos = orgPositionId(id(2), id(10));
    const edited = {
      ...first,
      nodes: [
        ...first.nodes.map((n) => (n.id === pos ? { ...n, x: 999, fill: '#FFFFFF' } : n)),
        {
          id: 'Position_manual',
          kind: 'position',
          x: 0,
          y: 500,
          width: 100,
          height: 40,
          nameEn: 'Advisor',
          nameAr: '',
        },
      ],
    };
    const next: OrgSourceDto = {
      departments: [
        { ...source.departments[0] },
        { ...source.departments[1], nameEn: 'Finance & Accounts' },
        { id: id(4), nameEn: 'HR', nameAr: 'الموارد البشرية', parentId: id(1) },
      ],
      roles: source.roles,
      people: null,
    };
    const r = mergeOrgChart(edited, generateOrgChart(next));
    expect(r.added.map((n) => n.id)).toEqual([orgUnitId(id(4))]);
    expect(r.removed.map((n) => n.id)).toEqual([orgUnitId(id(3))]);
    expect(r.renamed.map((x) => x.after.nameEn)).toEqual(['Finance & Accounts']);
    expect(r.content.nodes.find((n) => n.id === pos)).toMatchObject({ x: 999, fill: '#FFFFFF' });
    expect(r.content.nodes.some((n) => n.id === 'Position_manual')).toBe(true);
    expect(
      r.content.edges.every(
        (e) => e.sourceId !== orgUnitId(id(3)) && e.targetId !== orgUnitId(id(3)),
      ),
    ).toBe(true);
    expect(parseDiagramContent('ORG_CHART', stringifyDiagramContent(r.content)).ok).toBe(true);
  });
});
