import { describe, expect, it } from 'vitest';
import {
  extractLabelRefs,
  normaliseSearchText,
  rankSuggestions,
  type SuggestionCandidate,
} from './dictionary';
import { createObjectSchema, dictionarySuggestQuerySchema, renameObjectSchema } from './schemas';

const c = (p: Partial<SuggestionCandidate> & { id: string }): SuggestionCandidate => ({
  type: 'TERM',
  nameEn: '',
  nameAr: '',
  ...p,
});

describe('normaliseSearchText', () => {
  it('folds case, spaces and Arabic letter variants', () => {
    expect(normaliseSearchText('  Program   REQUEST ')).toBe('program request');
    expect(normaliseSearchText('إدارة')).toBe(normaliseSearchText('اداره'));
    expect(normaliseSearchText('مُدِيرُ')).toBe('مدير');
    expect(normaliseSearchText('مستشفى')).toBe('مستشفي');
    expect(normaliseSearchText('مسـؤول')).toBe('مسوول');
  });
});

describe('rankSuggestions', () => {
  const items = [
    c({
      id: 'pr',
      nameEn: 'Program request',
      nameAr: 'طلب برنامج',
      synonymsEn: ['Initiative request'],
    }),
    c({ id: 'pm', type: 'ROLE', nameEn: 'Program manager', nameAr: 'مدير البرنامج' }),
    c({ id: 'sf', type: 'SYSTEM', nameEn: 'Salesforce PMS', nameAr: 'نظام سيلزفورس' }),
    c({ id: 'ap', nameEn: 'Approval', nameAr: 'اعتماد', synonymsAr: ['موافقة'] }),
  ];

  it('prefers prefix matches and terms over roles', () => {
    const r = rankSuggestions(items, 'prog', 'en').map((x) => x.candidate.id);
    expect(r).toEqual(['pr', 'pm']);
  });

  it('matches words inside the name and synonyms, reporting the synonym', () => {
    const r = rankSuggestions(items, 'initiative', 'en');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ candidate: { id: 'pr' }, synonym: 'Initiative request' });
    expect(rankSuggestions(items, 'pms', 'en')[0].candidate.id).toBe('sf');
  });

  it('matches Arabic names and synonyms with spelling variants', () => {
    expect(rankSuggestions(items, 'مدير', 'ar')[0].candidate.id).toBe('pm');
    expect(rankSuggestions(items, 'موافقه', 'ar')[0]).toMatchObject({
      candidate: { id: 'ap' },
      synonym: 'موافقة',
    });
  });

  it('ranks the active language before the other one and honours the limit', () => {
    const both = [
      c({ id: 'en', nameEn: 'Request', nameAr: 'x' }),
      c({ id: 'ar', nameEn: 'y', nameAr: 'Request' }),
    ];
    expect(rankSuggestions(both, 'request', 'ar').map((x) => x.candidate.id)).toEqual(['ar', 'en']);
    expect(rankSuggestions(both, 'request', 'en', 1).map((x) => x.candidate.id)).toEqual(['en']);
    expect(rankSuggestions(both, '   ', 'en')).toEqual([]);
  });
});

describe('extractLabelRefs', () => {
  it('lists elements whose label comes from a library object', () => {
    const xml = `<bpmn:process id="P">
      <bpmn:userTask id="T1" name="A" ph:nameEn="A" ph:labelRef="5b1d7a52-6c1e-4c7f-9a33-2f8f3d0e9a11" />
      <bpmn:task id="T2" name="B" />
      <bpmn:task ph:labelRef="abc" id="T&amp;3" />
    </bpmn:process>`;
    expect([...extractLabelRefs(xml)]).toEqual([
      ['T1', '5b1d7a52-6c1e-4c7f-9a33-2f8f3d0e9a11'],
      ['T&3', 'abc'],
    ]);
  });
});

describe('dictionary schemas', () => {
  it('validates terms with synonyms (de-duplicated) and status', () => {
    const r = createObjectSchema.parse({
      type: 'TERM',
      nameEn: 'Program request',
      synonymsEn: ['Initiative', 'Initiative', ' Project request '],
      status: 'DRAFT',
    });
    expect(r.synonymsEn).toEqual(['Initiative', 'Project request']);
    expect(
      createObjectSchema.safeParse({ type: 'TERM', nameEn: 'x', synonymsEn: [''] }).success,
    ).toBe(false);
    expect(createObjectSchema.safeParse({ type: 'TERM', nameEn: 'x', status: 'NEW' }).success).toBe(
      false,
    );
  });

  it('parses suggestion queries with optional types', () => {
    expect(dictionarySuggestQuerySchema.parse({ q: 'pro' })).toEqual({
      q: 'pro',
      types: ['TERM', 'ROLE', 'SYSTEM'],
      limit: 8,
    });
    expect(dictionarySuggestQuerySchema.parse({ q: 'x', types: 'ROLE', limit: '3' })).toMatchObject(
      { types: ['ROLE'], limit: 3 },
    );
    expect(dictionarySuggestQuerySchema.safeParse({ q: 'x', types: 'RISK' }).success).toBe(false);
    expect(dictionarySuggestQuerySchema.safeParse({ q: ' ' }).success).toBe(false);
  });

  it('requires a name when renaming', () => {
    expect(renameObjectSchema.safeParse({ nameEn: '', nameAr: '' }).success).toBe(false);
    expect(renameObjectSchema.parse({ nameAr: 'اعتماد' })).toMatchObject({ updateLabels: true });
  });
});
