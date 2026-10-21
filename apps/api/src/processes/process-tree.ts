import { isSelfOrDescendant, type ProcessCategory } from '@processhub/shared';

export interface TreeProcess {
  id: string;
  parentId: string | null;
  category: ProcessCategory;
  level: number;
  sortOrder: number;
}

export interface MoveTarget {
  parentId: string | null;
  index: number;
  category?: ProcessCategory;
}

export interface ProcessUpdate {
  id: string;
  parentId?: string | null;
  category?: ProcessCategory;
  level?: number;
  sortOrder?: number;
}

export class MoveError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'PARENT_NOT_FOUND' | 'INVALID_PARENT') {
    super(code);
  }
}

/** Siblings share a parent; top-level siblings additionally share a category (band). */
function siblingsOf(items: TreeProcess[], parentId: string | null, category: ProcessCategory) {
  return items
    .filter((p) => p.parentId === parentId && (parentId !== null || p.category === category))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Plans a move / re-parent / re-order of a process. Returns the minimal set of
 * row updates: the moved process, re-numbered siblings, and descendants whose
 * category or level changes.
 */
export function planMove(
  items: TreeProcess[],
  movingId: string,
  target: MoveTarget,
): ProcessUpdate[] {
  const byId = new Map(items.map((p) => [p.id, p]));
  const moving = byId.get(movingId);
  if (!moving) throw new MoveError('NOT_FOUND');
  const parent = target.parentId ? byId.get(target.parentId) : null;
  if (target.parentId && !parent) throw new MoveError('PARENT_NOT_FOUND');
  if (isSelfOrDescendant(items, movingId, target.parentId)) throw new MoveError('INVALID_PARENT');

  const category = parent ? parent.category : (target.category ?? moving.category);
  const level = parent ? parent.level + 1 : 1;
  const updates = new Map<string, ProcessUpdate>();
  const set = (id: string, patch: Omit<ProcessUpdate, 'id'>) =>
    updates.set(id, { ...(updates.get(id) ?? { id }), ...patch });

  // Close the gap at the old position.
  const oldSiblings = siblingsOf(items, moving.parentId, moving.category).filter(
    (p) => p.id !== movingId,
  );
  oldSiblings.forEach((p, i) => p.sortOrder !== i && set(p.id, { sortOrder: i }));

  // Insert at the new position.
  const newSiblings = siblingsOf(items, target.parentId, category).filter((p) => p.id !== movingId);
  const index = Math.min(Math.max(target.index, 0), newSiblings.length);
  newSiblings.splice(index, 0, { ...moving, sortOrder: -1 });
  newSiblings.forEach((p, i) => {
    if (p.id === movingId) set(p.id, { parentId: target.parentId, category, level, sortOrder: i });
    else if (p.sortOrder !== i) set(p.id, { sortOrder: i });
  });

  // Cascade category and level to descendants.
  const levelDelta = level - moving.level;
  if (levelDelta !== 0 || category !== moving.category) {
    const stack = items.filter((p) => p.parentId === movingId);
    while (stack.length) {
      const d = stack.pop()!;
      set(d.id, { category, level: d.level + levelDelta });
      stack.push(...items.filter((p) => p.parentId === d.id));
    }
  }

  // Drop no-op updates for the moved node itself (e.g. dropped in the same place).
  const self = updates.get(movingId)!;
  if (
    self.parentId === moving.parentId &&
    self.category === moving.category &&
    self.level === moving.level &&
    self.sortOrder === moving.sortOrder
  ) {
    updates.delete(movingId);
  }
  return [...updates.values()];
}

/** Next sortOrder for a new process appended to a parent (or a band at the top level). */
export function nextSortOrder(
  items: TreeProcess[],
  parentId: string | null,
  category: ProcessCategory,
): number {
  const siblings = siblingsOf(items, parentId, category);
  return siblings.length ? siblings[siblings.length - 1].sortOrder + 1 : 0;
}
