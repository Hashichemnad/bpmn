import type { MovePageInput, PageSummaryDto } from '@processhub/shared';

/**
 * Translates an Ant Design tree drop into a page move:
 *  - `dropToGap=false`: dropped onto the target → becomes its first child.
 *  - `dropToGap=true`: dropped before (-1) or after (1) the target, as its sibling.
 */
export function computePageDrop(
  pages: PageSummaryDto[],
  dragId: string,
  targetId: string,
  dropToGap: boolean,
  relative: -1 | 0 | 1,
): MovePageInput | null {
  const target = pages.find((p) => p.id === targetId);
  if (!target || target.id === dragId) return null;
  if (!dropToGap) return { parentId: target.id, index: 0 };
  const siblings = pages
    .filter((p) => p.parentId === target.parentId && p.id !== dragId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const pos = siblings.findIndex((p) => p.id === target.id);
  return { parentId: target.parentId, index: Math.max(relative === 1 ? pos + 1 : pos, 0) };
}
