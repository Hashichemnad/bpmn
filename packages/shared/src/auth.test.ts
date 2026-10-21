import { describe, expect, it } from 'vitest';
import {
  authSettingsSchema,
  mfaRequiredFor,
  mfaVerifySchema,
  normaliseRecoveryCode,
  type AuthSettingsInput,
} from './auth';

const base: AuthSettingsInput = {
  ssoEnabled: true,
  provider: 'ENTRA',
  tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47',
  issuer: '',
  clientId: 'client',
  buttonLabelEn: '',
  buttonLabelAr: '',
  allowedDomains: ['example.com'],
  autoCreateUsers: true,
  defaultRole: 'VIEWER',
  defaultDepartmentId: null,
  groupsClaim: 'groups',
  groupMappings: [],
  syncRolesOnLogin: true,
  localLoginEnabled: true,
  breakGlassUserId: null,
  mfaRequiredRoles: [],
};

const issues = (v: unknown) => {
  const r = authSettingsSchema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('authSettingsSchema', () => {
  it('accepts a complete Entra ID configuration', () => {
    expect(issues(base)).toEqual([]);
  });
  it('requires a GUID tenant ID for Entra ID', () => {
    expect(issues({ ...base, tenantId: 'contoso.onmicrosoft.com' })).toContain('TENANT_ID_INVALID');
  });
  it('requires an http(s) issuer URL without query for generic OIDC', () => {
    expect(issues({ ...base, provider: 'OIDC', issuer: 'ftp://idp' })).toContain('ISSUER_INVALID');
    expect(issues({ ...base, provider: 'OIDC', issuer: 'https://idp/?a=1' })).toContain(
      'ISSUER_INVALID',
    );
    expect(
      issues({ ...base, provider: 'OIDC', issuer: 'https://idp.example.com/realms/x' }),
    ).toEqual([]);
  });
  it('needs client ID, issuer and at least one domain when enabled', () => {
    expect(issues({ ...base, clientId: '' })).toContain('SSO_INCOMPLETE');
    expect(issues({ ...base, tenantId: '' })).toContain('SSO_INCOMPLETE');
    expect(issues({ ...base, allowedDomains: [] })).toContain('DOMAIN_REQUIRED');
    expect(issues({ ...base, ssoEnabled: false, clientId: '', allowedDomains: [] })).toEqual([]);
  });
  it('lower-cases domains and rejects addresses or URLs', () => {
    const r = authSettingsSchema.parse({ ...base, allowedDomains: ['Example.COM'] });
    expect(r.allowedDomains).toEqual(['example.com']);
    expect(issues({ ...base, allowedDomains: ['a@example.com'] })).toHaveLength(1);
    expect(issues({ ...base, allowedDomains: ['https://example.com'] })).toHaveLength(1);
  });
  it('requires a break-glass account when password sign-in is off', () => {
    expect(issues({ ...base, localLoginEnabled: false })).toContain('BREAK_GLASS_REQUIRED');
  });
});

describe('two-factor helpers', () => {
  it('normalises recovery codes', () => {
    expect(normaliseRecoveryCode(' abcd efgh-ijkl mnop ')).toBe('ABCD-EFGH-IJKL-MNOP');
  });
  it('accepts either a 6-digit code or a recovery code', () => {
    expect(mfaVerifySchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(mfaVerifySchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(mfaVerifySchema.parse({ recoveryCode: 'abcdefghijklmnop' })).toEqual({
      recoveryCode: 'ABCD-EFGH-IJKL-MNOP',
    });
    expect(mfaVerifySchema.safeParse({ code: '123456', recoveryCode: 'x' }).success).toBe(false);
  });
  it('knows when a role requires 2FA', () => {
    expect(mfaRequiredFor(['ADMIN', 'VIEWER'], ['ADMIN'])).toBe(true);
    expect(mfaRequiredFor(['VIEWER'], ['ADMIN'])).toBe(false);
  });
});
