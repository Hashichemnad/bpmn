import { describe, expect, it } from 'vitest';
import type { PageSummaryDto } from '@processhub/shared';
import { computePageDrop } from './page-tree-dnd';

const page = (id: string, parentId: string | null, sortOrder: number): PageSummaryDto => ({
  id,
  spaceId: 's',
  parentId,
  sortOrder,
  titleEn: id,
  titleAr: '',
  hasEn: true,
  hasAr: false,
  status: 'DRAFT',
  updatedAt: '',
});
const pages = [page('a', null, 0), page('b', null, 1), page('c', null, 2), page('a1', 'a', 0)];

describe('computePageDrop', () => {
  it('drops onto a page as first child', () => {
    expect(computePageDrop(pages, 'c', 'a', false, 0)).toEqual({ parentId: 'a', index: 0 });
  });
  it('drops before / after a sibling', () => {
    expect(computePageDrop(pages, 'c', 'a', true, -1)).toEqual({ parentId: null, index: 0 });
    expect(computePageDrop(pages, 'a', 'b', true, 1)).toEqual({ parentId: null, index: 1 });
    expect(computePageDrop(pages, 'a1', 'c', true, 1)).toEqual({ parentId: null, index: 3 });
  });
  it('ignores drops onto itself', () => {
    expect(computePageDrop(pages, 'a', 'a', false, 0)).toBeNull();
  });
});
