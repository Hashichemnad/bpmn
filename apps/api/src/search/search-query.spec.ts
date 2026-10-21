import { escapeLike, toAnyTsQuery, toPrefixTsQuery } from './search-query';

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

describe('toAnyTsQuery', () => {
  it('ORs the words of a question, without duplicates, operators or single letters', () => {
    expect(toAnyTsQuery('How do I request a new laptop?')).toBe(
      'how:* | do:* | request:* | new:* | laptop:*',
    );
    expect(toAnyTsQuery("laptop' | !(x) & laptop")).toBe('laptop:*');
    // Diacritics (tanween) end a word: the stem stays as a prefix, matching its variants.
    expect(toAnyTsQuery('كيف أطلب حاسوبًا')).toBe('كيف:* | أطلب:* | حاسوب:*');
    expect(toAnyTsQuery(' ? ')).toBeNull();
  });
});
