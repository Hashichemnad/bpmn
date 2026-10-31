import { describe, expect, it } from 'vitest';
import {
  diagramElementIds,
  diagramElements,
  diagramRefs,
  diagramText,
  emptyDiagramContent,
  parseDiagramContent,
  stringifyDiagramContent,
  type GraphContent,
} from './diagrams';

const P1 = '11111111-1111-4111-8111-111111111111';
const vc = (patch: Partial<GraphContent> = {}): GraphContent => ({
  schema: 1,
  type: 'VALUE_CHAIN',
  nodes: [
    {
      id: 'C1',
      kind: 'chevron',
      x: 0,
      y: 0,
      width: 160,
      height: 60,
      nameEn: 'Plan',
      nameAr: 'تخطيط',
      processId: P1,
    },
    { id: 'C2', kind: 'chevron', x: 170, y: 0, width: 160, height: 60, nameEn: 'Buy', nameAr: '' },
  ],
  edges: [
    {
      id: 'E1',
      kind: 'arrow',
      sourceId: 'C1',
      targetId: 'C2',
      waypoints: [],
      nameEn: '',
      nameAr: '',
    },
  ],
  ...patch,
});

describe('diagram content (D-120)', () => {
  it('accepts valid content of every type and an empty diagram', () => {
    for (const type of ['VALUE_CHAIN', 'ORG_CHART', 'EPC', 'SIPOC', 'DMN'] as const)
      expect(parseDiagramContent(type, emptyDiagramContent(type, 'X', 'س')).ok).toBe(true);
    expect(parseDiagramContent('VALUE_CHAIN', stringifyDiagramContent(vc())).ok).toBe(true);
  });

  it('rejects wrong types, unknown kinds, duplicate ids and dangling connections', () => {
    const issues = (c: unknown, type: 'VALUE_CHAIN' | 'EPC' = 'VALUE_CHAIN') => {
      const r = parseDiagramContent(type, JSON.stringify(c));
      return r.ok ? [] : r.issues.map((i) => i.code);
    };
    expect(issues(vc(), 'EPC')).toEqual(['TYPE_MISMATCH']);
    const badKind = vc();
    badKind.nodes[0].kind = 'event';
    expect(issues(badKind)).toContain('INVALID_KIND');
    const dup = vc();
    dup.nodes[1].id = 'C1';
    expect(issues(dup)).toContain('DUPLICATE_ID');
    const dangling = vc();
    dangling.edges[0].targetId = 'nope';
    expect(issues(dangling)).toContain('UNKNOWN_NODE');
    const badId = vc();
    badId.nodes[0].id = '1 bad';
    expect(issues(badId)).toContain('INVALID_ELEMENT_ID');
    const badParent = vc();
    badParent.nodes[1].parentId = 'C1';
    expect(issues(badParent)).toContain('INVALID_PARENT');
    expect(parseDiagramContent('SIPOC', '{').ok).toBe(false);
    expect(parseDiagramContent('DMN', '<definitions/>').ok).toBe(false);
  });

  it('extracts elements, ids, search text and references', () => {
    const raw = stringifyDiagramContent(vc());
    expect(diagramElements('VALUE_CHAIN', raw).map((e) => e.id)).toEqual(['C1', 'C2']);
    expect([...diagramElementIds('VALUE_CHAIN', raw)].sort()).toEqual(['C1', 'C2', 'E1']);
    expect(diagramText('VALUE_CHAIN', raw)).toEqual({ textEn: 'Plan\nBuy', textAr: 'تخطيط' });
    expect(diagramRefs('VALUE_CHAIN', raw)).toEqual({ processIds: [P1], diagramIds: [] });
    const dmn = emptyDiagramContent('DMN', 'Approval', 'اعتماد');
    expect(diagramElements('DMN', dmn)).toMatchObject([
      { id: 'Decision_1', kind: 'decision', nameEn: 'Approval', nameAr: 'اعتماد' },
      { id: 'Input_1', kind: 'input' },
      { id: 'Output_1', kind: 'output' },
    ]);
  });
});
