import { describe, expect, it } from 'vitest';
import type { ProcessSummaryDto } from '@processhub/shared';
import { categoryNodeKey, computeDrop } from './tree-dnd';

const p = (id: string, parentId: string | null, category: ProcessSummaryDto['category'], sortOrder: number): ProcessSummaryDto => ({
  id, parentId, category, sortOrder, code: id, nameEn: id, nameAr: '', status: 'DRAFT', level: parentId ? 2 : 1, ownerId: null, departmentId: null,
});

const items = [p('C1', null, 'CORE', 0), p('C2', null, 'CORE', 1), p('C3', null, 'CORE', 2), p('S1', null, 'SUPPORT', 0), p('C1a', 'C1', 'CORE', 0)];

describe('computeDrop', () => {
  it('drops onto a category node to move to the top of that band', () => {
    expect(computeDrop(items, 'C1a', categoryNodeKey('SUPPORT'), false, 0)).toEqual({ parentId: null, index: 0, category: 'SUPPORT' });
    expect(computeDrop(items, 'C1a', categoryNodeKey('SUPPORT'), true, 1)).toBeNull();
  });
  it('drops onto a process to make it the first child', () => {
    expect(computeDrop(items, 'S1', 'C2', false, 0)).toEqual({ parentId: 'C2', index: 0 });
  });
  it('drops between siblings, accounting for the dragged node', () => {
    // C1 moved after C3 → index 2 among [C2, C3]
    expect(computeDrop(items, 'C1', 'C3', true, 1)).toEqual({ parentId: null, index: 2, category: 'CORE' });
    // C3 moved before C1 → index 0
    expect(computeDrop(items, 'C3', 'C1', true, -1)).toEqual({ parentId: null, index: 0, category: 'CORE' });
    // sub-process dropped after S1 joins the support band
    expect(computeDrop(items, 'C1a', 'S1', true, 1)).toEqual({ parentId: null, index: 1, category: 'SUPPORT' });
  });
  it('ignores drops onto itself', () => {
    expect(computeDrop(items, 'C1', 'C1', false, 0)).toBeNull();
  });
});
