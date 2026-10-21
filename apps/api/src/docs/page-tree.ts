import { isSelfOrDescendant } from '@processhub/shared';

export interface PageTreeRow {
  id: string;
  parentId: string | null;
  sortOrder: number;
}

export class PageMoveError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'INVALID_PARENT') {
    super(code);
  }
}

/**
 * Moves a page under `parentId` at position `index` among its new siblings and
 * returns the rows whose parent or sort order change.
 */
export function planPageMove(
  rows: PageTreeRow[],
  id: string,
  parentId: string | null,
  index: number,
): { id: string; parentId: string | null; sortOrder: number }[] {
  const page = rows.find((r) => r.id === id);
  if (!page) throw new PageMoveError('NOT_FOUND');
  if (parentId && !rows.some((r) => r.id === parentId)) throw new PageMoveError('INVALID_PARENT');
  if (isSelfOrDescendant(rows, id, parentId)) throw new PageMoveError('INVALID_PARENT');
  const siblings = rows
    .filter((r) => r.parentId === parentId && r.id !== id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  siblings.splice(Math.min(index, siblings.length), 0, { ...page, parentId });
  return siblings
    .map((r, i) => ({
      id: r.id,
      parentId,
      sortOrder: i,
      changed: r.sortOrder !== i || r.id === id,
    }))
    .filter((r) => r.changed || (r.id === id && page.parentId !== parentId))
    .map(({ id: rowId, sortOrder }) => ({ id: rowId, parentId, sortOrder }));
}

export function nextPageSortOrder(rows: PageTreeRow[], parentId: string | null): number {
  const sibs = rows.filter((r) => r.parentId === parentId);
  return sibs.length ? Math.max(...sibs.map((s) => s.sortOrder)) + 1 : 0;
}
