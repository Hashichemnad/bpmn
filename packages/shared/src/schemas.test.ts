import { describe, expect, it } from 'vitest';
import {
  createProcessSchema,
  createUserSchema,
  moveProcessSchema,
  paginationQuerySchema,
  createSpaceSchema,
  gitSettingsSchema,
  savePageSchema,
  spaceGrantSchema,
} from './schemas';
import { SYSTEM_ROLES, PERMISSIONS } from './constants';

describe('createProcessSchema', () => {
  it('requires at least one name', () => {
    const r = createProcessSchema.safeParse({ code: 'C.01', category: 'CORE' });
    expect(r.success).toBe(false);
  });
  it('requires a category for top-level processes', () => {
    const r = createProcessSchema.safeParse({ code: 'C.01', nameEn: 'Sales' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe('CATEGORY_REQUIRED');
  });
  it('accepts a sub-process without category', () => {
    const r = createProcessSchema.safeParse({
      code: 'C.01.02',
      nameAr: 'المبيعات',
      parentId: '3f1c5a2e-8d9b-4c3a-9f1e-2b6d7a8c9e0f',
    });
    expect(r.success).toBe(true);
  });
  it('rejects malformed codes', () => {
    expect(
      createProcessSchema.safeParse({ code: 'C..1', nameEn: 'x', category: 'CORE' }).success,
    ).toBe(false);
    expect(
      createProcessSchema.safeParse({ code: '<script>', nameEn: 'x', category: 'CORE' }).success,
    ).toBe(false);
  });
});

describe('createUserSchema', () => {
  it('normalises email and requires a role', () => {
    const r = createUserSchema.safeParse({
      email: ' Admin@Example.COM ',
      nameEn: 'A',
      password: 'x',
      roles: [],
    });
    expect(r.success).toBe(false);
    const ok = createUserSchema.parse({
      email: ' Admin@Example.COM ',
      nameEn: 'A',
      password: 'x',
      roles: ['VIEWER'],
    });
    expect(ok.email).toBe('admin@example.com');
    expect(ok.locale).toBe('en');
  });
});

describe('paginationQuerySchema', () => {
  it('coerces and caps values', () => {
    expect(paginationQuerySchema.parse({ page: '2', pageSize: '10' })).toMatchObject({
      page: 2,
      pageSize: 10,
    });
    expect(paginationQuerySchema.safeParse({ pageSize: '1000' }).success).toBe(false);
  });
});

describe('moveProcessSchema', () => {
  it('accepts root moves', () => {
    expect(
      moveProcessSchema.parse({ parentId: null, index: 0, category: 'SUPPORT' }).parentId,
    ).toBeNull();
  });
});

describe('system roles', () => {
  it('only super admin can manage settings', () => {
    const holders = Object.entries(SYSTEM_ROLES)
      .filter(([, r]) => r.permissions.includes(PERMISSIONS.SETTINGS_MANAGE))
      .map(([k]) => k);
    expect(holders).toEqual(['SUPER_ADMIN']);
  });
  it('viewer is read-only', () => {
    expect(SYSTEM_ROLES.VIEWER.permissions.every((p) => p.endsWith('.read'))).toBe(true);
  });
});

describe('phase 2 schemas', () => {
  it('space keys are short upper-case identifiers', () => {
    expect(createSpaceSchema.parse({ key: 'qm', nameEn: 'Quality' }).key).toBe('QM');
    expect(createSpaceSchema.safeParse({ key: '1QM', nameEn: 'x' }).success).toBe(false);
    expect(createSpaceSchema.safeParse({ key: 'QM', nameEn: '', nameAr: '' }).success).toBe(false);
  });

  it('space grants validate the principal id by type', () => {
    expect(
      spaceGrantSchema.safeParse({ principalType: 'ROLE', principalId: 'MODELER', access: 'EDIT' })
        .success,
    ).toBe(true);
    expect(
      spaceGrantSchema.safeParse({ principalType: 'ROLE', principalId: 'GOD', access: 'EDIT' })
        .success,
    ).toBe(false);
    expect(
      spaceGrantSchema.safeParse({ principalType: 'USER', principalId: 'abc', access: 'VIEW' })
        .success,
    ).toBe(false);
  });

  it('page saves need a title and a change note', () => {
    const ok = savePageSchema.parse({ titleAr: 'عنوان', changeNote: 'First' });
    expect(ok).toMatchObject({ contentEn: '', dirEn: 'ltr', dirAr: 'rtl' });
    expect(savePageSchema.safeParse({ titleEn: 'x', changeNote: ' ' }).success).toBe(false);
    expect(savePageSchema.safeParse({ changeNote: 'x' }).success).toBe(false);
  });

  it('git settings validate repository, branch, folder and URL', () => {
    const base = { enabled: true, provider: 'gitlab', repository: 'group/sub/project' };
    expect(gitSettingsSchema.parse({ ...base, folder: '/bpm/export/' }).folder).toBe('bpm/export');
    expect(gitSettingsSchema.safeParse({ ...base, folder: '../etc' }).success).toBe(false);
    expect(gitSettingsSchema.safeParse({ ...base, branch: 'feature/x' }).success).toBe(true);
    expect(gitSettingsSchema.safeParse({ ...base, branch: 'a..b' }).success).toBe(false);
    expect(gitSettingsSchema.safeParse({ ...base, repository: 'nope' }).success).toBe(false);
    expect(gitSettingsSchema.safeParse({ ...base, baseUrl: 'ftp://x' }).success).toBe(false);
    expect(
      gitSettingsSchema.parse({ ...base, baseUrl: 'https://gitlab.example.com/' }).baseUrl,
    ).toBe('https://gitlab.example.com');
    expect(gitSettingsSchema.safeParse({ enabled: true, provider: 'github' }).success).toBe(false);
    expect(gitSettingsSchema.safeParse({ enabled: false, provider: 'github' }).success).toBe(true);
  });
});
