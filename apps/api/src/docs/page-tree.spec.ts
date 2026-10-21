import { PageMoveError, nextPageSortOrder, planPageMove } from './page-tree';

const rows = [
  { id: 'a', parentId: null, sortOrder: 0 },
  { id: 'b', parentId: null, sortOrder: 1 },
  { id: 'c', parentId: null, sortOrder: 2 },
  { id: 'a1', parentId: 'a', sortOrder: 0 },
];

describe('planPageMove', () => {
  it('re-orders siblings', () => {
    expect(planPageMove(rows, 'c', null, 0)).toEqual([
      { id: 'c', parentId: null, sortOrder: 0 },
      { id: 'a', parentId: null, sortOrder: 1 },
      { id: 'b', parentId: null, sortOrder: 2 },
    ]);
  });

  it('re-parents a page', () => {
    expect(planPageMove(rows, 'b', 'a', 5)).toEqual([{ id: 'b', parentId: 'a', sortOrder: 1 }]);
  });

  it('rejects moving under itself or a descendant', () => {
    expect(() => planPageMove(rows, 'a', 'a1', 0)).toThrow(PageMoveError);
    expect(() => planPageMove(rows, 'a', 'a', 0)).toThrow(PageMoveError);
    expect(() => planPageMove(rows, 'x', null, 0)).toThrow(PageMoveError);
    expect(() => planPageMove(rows, 'a', 'zzz', 0)).toThrow(PageMoveError);
  });

  it('computes the next sort order', () => {
    expect(nextPageSortOrder(rows, null)).toBe(3);
    expect(nextPageSortOrder(rows, 'b')).toBe(0);
  });
});
