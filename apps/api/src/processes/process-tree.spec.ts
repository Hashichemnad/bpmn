import { MoveError, nextSortOrder, planMove, type TreeProcess } from './process-tree';

const items: TreeProcess[] = [
  { id: 'M1', parentId: null, category: 'MANAGEMENT', level: 1, sortOrder: 0 },
  { id: 'C1', parentId: null, category: 'CORE', level: 1, sortOrder: 0 },
  { id: 'C2', parentId: null, category: 'CORE', level: 1, sortOrder: 1 },
  { id: 'C1a', parentId: 'C1', category: 'CORE', level: 2, sortOrder: 0 },
  { id: 'C1b', parentId: 'C1', category: 'CORE', level: 2, sortOrder: 1 },
  { id: 'C1a1', parentId: 'C1a', category: 'CORE', level: 3, sortOrder: 0 },
  { id: 'S1', parentId: null, category: 'SUPPORT', level: 1, sortOrder: 0 },
];

const byId = (updates: ReturnType<typeof planMove>) =>
  Object.fromEntries(updates.map((u) => [u.id, u]));

describe('planMove', () => {
  it('re-orders siblings within the same parent', () => {
    const u = byId(planMove(items, 'C1b', { parentId: 'C1', index: 0 }));
    expect(u.C1b).toMatchObject({ sortOrder: 0, parentId: 'C1' });
    expect(u.C1a).toEqual({ id: 'C1a', sortOrder: 1 });
  });

  it('re-parents into another band and cascades category and level', () => {
    const u = byId(planMove(items, 'C1a', { parentId: 'S1', index: 0 }));
    expect(u.C1a).toMatchObject({ parentId: 'S1', category: 'SUPPORT', level: 2, sortOrder: 0 });
    expect(u.C1a1).toEqual({ id: 'C1a1', category: 'SUPPORT', level: 3 });
    // old sibling closes the gap
    expect(u.C1b).toEqual({ id: 'C1b', sortOrder: 0 });
  });

  it('promotes to top level of a chosen band', () => {
    const u = byId(planMove(items, 'C1a', { parentId: null, index: 5, category: 'MANAGEMENT' }));
    expect(u.C1a).toMatchObject({ parentId: null, category: 'MANAGEMENT', level: 1, sortOrder: 1 });
    expect(u.C1a1).toEqual({ id: 'C1a1', category: 'MANAGEMENT', level: 2 });
  });

  it('rejects moving under itself or a descendant', () => {
    expect(() => planMove(items, 'C1', { parentId: 'C1a1', index: 0 })).toThrow(MoveError);
    expect(() => planMove(items, 'C1', { parentId: 'C1', index: 0 })).toThrow('INVALID_PARENT');
  });

  it('rejects unknown nodes', () => {
    expect(() => planMove(items, 'X', { parentId: null, index: 0 })).toThrow('NOT_FOUND');
    expect(() => planMove(items, 'C1', { parentId: 'X', index: 0 })).toThrow('PARENT_NOT_FOUND');
  });

  it('returns nothing when dropped in place', () => {
    expect(planMove(items, 'C2', { parentId: null, index: 1, category: 'CORE' })).toEqual([]);
  });
});

describe('nextSortOrder', () => {
  it('appends after the last sibling within a band', () => {
    expect(nextSortOrder(items, null, 'CORE')).toBe(2);
    expect(nextSortOrder(items, null, 'SUPPORT')).toBe(1);
    expect(nextSortOrder(items, 'C1a1', 'CORE')).toBe(0);
  });
});
