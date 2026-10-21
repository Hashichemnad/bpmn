import { describe, expect, it } from 'vitest';
import {
  buildTree,
  checkPasswordPolicy,
  descendantIds,
  isSelfOrDescendant,
  localized,
} from './helpers';

describe('localized', () => {
  const e = { nameEn: 'Procurement', nameAr: 'المشتريات' };
  it('returns the value in the requested language', () => {
    expect(localized(e, 'name', 'en')).toBe('Procurement');
    expect(localized(e, 'name', 'ar')).toBe('المشتريات');
  });
  it('falls back to the other language when empty', () => {
    expect(localized({ nameEn: 'Only English', nameAr: '' }, 'name', 'ar')).toBe('Only English');
    expect(localized({ nameEn: '  ', nameAr: 'عربي فقط' }, 'name', 'en')).toBe('عربي فقط');
  });
  it('handles missing entities', () => {
    expect(localized(null, 'name', 'en')).toBe('');
  });
});

describe('checkPasswordPolicy', () => {
  it('accepts a strong password', () => {
    expect(checkPasswordPolicy('Str0ngPassword')).toEqual([]);
  });
  it('reports every violation', () => {
    expect(checkPasswordPolicy('abc')).toEqual(['TOO_SHORT', 'MISSING_UPPER', 'MISSING_DIGIT']);
  });
  it('supports symbol requirement', () => {
    const policy = {
      minLength: 4,
      requireUpper: false,
      requireLower: false,
      requireDigit: false,
      requireSymbol: true,
    };
    expect(checkPasswordPolicy('abcd', policy)).toEqual(['MISSING_SYMBOL']);
    expect(checkPasswordPolicy('ab!d', policy)).toEqual([]);
  });
});

describe('tree helpers', () => {
  const items = [
    { id: 'a', parentId: null, sortOrder: 1 },
    { id: 'b', parentId: null, sortOrder: 0 },
    { id: 'a1', parentId: 'a', sortOrder: 0 },
    { id: 'a1x', parentId: 'a1', sortOrder: 0 },
    { id: 'orphan', parentId: 'missing', sortOrder: 5 },
  ];
  it('builds a sorted forest', () => {
    const tree = buildTree(items);
    expect(tree.map((n) => n.id)).toEqual(['b', 'a', 'orphan']);
    expect(tree[1].children[0].children[0].id).toBe('a1x');
  });
  it('detects descendants', () => {
    expect(isSelfOrDescendant(items, 'a', 'a1x')).toBe(true);
    expect(isSelfOrDescendant(items, 'a', 'a')).toBe(true);
    expect(isSelfOrDescendant(items, 'a', 'b')).toBe(false);
    expect(isSelfOrDescendant(items, 'a', null)).toBe(false);
  });
  it('lists descendants', () => {
    expect(descendantIds(items, 'a').sort()).toEqual(['a1', 'a1x']);
  });
});
