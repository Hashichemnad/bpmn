import type { MoveProcessInput, ProcessCategory, ProcessSummaryDto } from '@processhub/shared';

export const CATEGORY_NODE_PREFIX = 'category:';

export const categoryNodeKey = (c: ProcessCategory) => `${CATEGORY_NODE_PREFIX}${c}`;

export function parseCategoryKey(key: string): ProcessCategory | null {
  return key.startsWith(CATEGORY_NODE_PREFIX)
    ? (key.slice(CATEGORY_NODE_PREFIX.length) as ProcessCategory)
    : null;
}

function siblings(items: ProcessSummaryDto[], parentId: string | null, category: ProcessCategory) {
  return items
    .filter((p) => p.parentId === parentId && (parentId !== null || p.category === category))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Translates an Ant Design tree drop into a move request.
 *  - `dropToGap=false`: dropped onto `targetKey` → becomes its first child
 *    (onto a category node → top level of that band).
 *  - `dropToGap=true`: dropped before (`-1`) or after (`1`) the target, as its sibling.
 * Returns null when the drop is not meaningful (e.g. next to a category node).
 */
export function computeDrop(
  items: ProcessSummaryDto[],
  dragId: string,
  targetKey: string,
  dropToGap: boolean,
  relative: -1 | 0 | 1,
): MoveProcessInput | null {
  const category = parseCategoryKey(targetKey);
  if (category) {
    return dropToGap ? null : { parentId: null, index: 0, category };
  }
  const target = items.find((p) => p.id === targetKey);
  if (!target || target.id === dragId) return null;
  if (!dropToGap) return { parentId: target.id, index: 0 };

  const sibs = siblings(items, target.parentId, target.category).filter((p) => p.id !== dragId);
  const pos = sibs.findIndex((p) => p.id === target.id);
  const index = relative === 1 ? pos + 1 : pos;
  return {
    parentId: target.parentId,
    index: Math.max(index, 0),
    ...(target.parentId === null ? { category: target.category } : {}),
  };
}
