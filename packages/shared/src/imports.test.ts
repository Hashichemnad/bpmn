import { describe, expect, it } from 'vitest';
import {
  canImportKind,
  findProcessCodes,
  isArabicText,
  labelByScript,
  matchesImportFilter,
  summariseImport,
  type ImportPreviewItem,
} from './imports';

const item = (over: Partial<ImportPreviewItem>): ImportPreviewItem => ({
  ref: 'r',
  entity: 'PROCESS',
  key: 'k',
  nameEn: '',
  nameAr: '',
  action: 'CREATE',
  matchId: null,
  matchBy: null,
  source: '',
  issues: [],
  changes: [],
  suggestions: [],
  skip: false,
  ...over,
});

describe('import helpers', () => {
  it('detects Arabic labels by script', () => {
    expect(isArabicText('تسجيل الطلبات')).toBe(true);
    expect(isArabicText('Register requests')).toBe(false);
    expect(isArabicText('C.01 تسجيل')).toBe(true);
    expect(isArabicText('1234')).toBe(false);
    expect(labelByScript(' استلام الطلب ')).toEqual({ nameEn: '', nameAr: 'استلام الطلب' });
    expect(labelByScript('Receive')).toEqual({ nameEn: 'Receive', nameAr: '' });
  });

  it('finds process codes in file names and text', () => {
    expect(findProcessCodes('C.01.02 Register requests.bpmn')).toEqual(['C.01.02']);
    expect(findProcessCodes('see S-02-01 and M.1')).toEqual(['S.02.01', 'M.1']);
    expect(findProcessCodes('no code here')).toEqual([]);
  });

  it('summarises the dry run: errors block unless the item is skipped', () => {
    const err = { level: 'ERROR' as const, code: 'X' };
    const items = [
      item({}),
      item({ action: 'UPDATE' }),
      item({ action: 'SKIP' }),
      item({ issues: [err] }),
      item({ issues: [err], skip: true }),
      item({ issues: [{ level: 'WARNING', code: 'W' }] }),
    ];
    expect(summariseImport(items)).toMatchObject({
      items: 6,
      create: 2,
      update: 1,
      skip: 2,
      errors: 2,
      warnings: 1,
      blocking: 1,
    });
    expect(items.filter((i) => matchesImportFilter(i, 'errors'))).toHaveLength(2);
    expect(items.filter((i) => matchesImportFilter(i, 'skip'))).toHaveLength(2);
  });

  it('limits kinds to import.manage, module permissions and Super Admins', () => {
    expect(canImportKind('BPMN', ['import.manage'], ['ADMIN'])).toBe(true);
    expect(canImportKind('BPMN', ['processes.edit'], ['MODELER'])).toBe(false);
    expect(canImportKind('GRC_RISKS', ['import.manage'], ['ADMIN'])).toBe(false);
    expect(canImportKind('GRC_RISKS', ['import.manage', 'grc.edit'], ['ADMIN'])).toBe(true);
    expect(canImportKind('PACKAGE', ['import.manage'], ['ADMIN'])).toBe(false);
    expect(canImportKind('PACKAGE', ['import.manage'], ['SUPER_ADMIN'])).toBe(true);
  });
});
