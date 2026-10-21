import { escapeLike, toPrefixTsQuery } from './search-query';

describe('toPrefixTsQuery', () => {
  it('builds a prefix query from words only', () => {
    expect(toPrefixTsQuery('Purchase  ord')).toBe('purchase:* & ord:*');
    expect(toPrefixTsQuery("x' | !(y) & z:*")).toBe('x:* & y:* & z:*');
    expect(toPrefixTsQuery('إجراءات التشغيل')).toBe('إجراءات:* & التشغيل:*');
    expect(toPrefixTsQuery('C.02.03')).toBe('c:* & 02:* & 03:*');
    expect(toPrefixTsQuery('  !!  ')).toBeNull();
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });
});
