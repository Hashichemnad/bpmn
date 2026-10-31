import { describe, expect, it } from 'vitest';
import { generateValueChain, type ValueChainSource } from './value-chain';
import { parseDiagramContent, stringifyDiagramContent } from './diagrams';

const p = (
  id: string,
  category: ValueChainSource['category'],
  level = 1,
  parentId: string | null = null,
  sortOrder = 0,
): ValueChainSource => ({
  id: `00000000-0000-4000-8000-00000000000${id}`,
  code: `${category[0]}.0${id}`,
  nameEn: `Process ${id}`,
  nameAr: `عملية ${id}`,
  category,
  parentId: parentId ? `00000000-0000-4000-8000-00000000000${parentId}` : null,
  level,
  sortOrder,
});

describe('generateValueChain (D-121)', () => {
  const house = [
    p('1', 'MANAGEMENT'),
    p('2', 'CORE', 1, null, 1),
    p('3', 'CORE', 1, null, 0),
    p('4', 'SUPPORT'),
    p('5', 'CORE', 2, '3'),
  ];

  it('builds frames per category with chevrons for core processes, linked to the processes', () => {
    const c = generateValueChain(house);
    expect(c.nodes.filter((n) => n.kind === 'frame').map((n) => n.id)).toEqual([
      'Frame_MANAGEMENT',
      'Frame_CORE',
      'Frame_SUPPORT',
    ]);
    const core = c.nodes.filter((n) => n.kind === 'chevron');
    // Sorted by the process house order.
    expect(core.map((n) => n.nameEn)).toEqual(['Process 3', 'Process 2']);
    expect(core.every((n) => n.parentId === 'Frame_CORE' && n.processId)).toBe(true);
    expect(c.nodes.find((n) => n.nameEn === 'Process 4')).toMatchObject({
      kind: 'block',
      category: 'SUPPORT',
    });
    expect(c.nodes.some((n) => n.nameEn === 'Process 5')).toBe(false);
    expect(parseDiagramContent('VALUE_CHAIN', stringifyDiagramContent(c)).ok).toBe(true);
  });

  it('adds level-2 processes under their parent when asked', () => {
    const c = generateValueChain(house, { includeLevel2: true });
    const child = c.nodes.find((n) => n.nameEn === 'Process 5')!;
    const parent = c.nodes.find((n) => n.nameEn === 'Process 3')!;
    expect(child).toMatchObject({ kind: 'block', parentId: 'Frame_CORE' });
    expect(child.y).toBeGreaterThan(parent.y + parent.height);
    expect(parseDiagramContent('VALUE_CHAIN', stringifyDiagramContent(c)).ok).toBe(true);
  });
});
