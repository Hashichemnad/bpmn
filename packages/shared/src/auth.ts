import { z } from 'zod';
import { SYSTEM_ROLE_KEYS, type SystemRoleKey } from './constants';
import type { CurrentUser } from './types';

// ---------- Single sign-on (OIDC) and two-factor authentication (Phase 6) ----------

/** ENTRA = Microsoft Entra ID (Azure AD), issuer derived from the tenant ID; OIDC = any other provider. */
export const SSO_PROVIDERS = ['ENTRA', 'OIDC'] as const;
export type SsoProvider = (typeof SSO_PROVIDERS)[number];

/** Path of the OIDC redirect URI, appended to APP_URL (register it at the identity provider). */
export const SSO_CALLBACK_PATH = '/api/v1/auth/sso/callback';
export const SSO_START_PATH = '/api/v1/auth/sso/start';

/** Error codes the SSO callback sends back to the login page (`/login?ssoError=<code>`). */
export const SSO_ERROR_CODES = [
  'SSO_DISABLED',
  'SSO_STATE_INVALID',
  'SSO_PROVIDER_ERROR',
  'SSO_CANCELLED',
  'SSO_EMAIL_MISSING',
  'SSO_DOMAIN_NOT_ALLOWED',
  'SSO_USER_NOT_FOUND',
  'SSO_USER_INACTIVE',
  'SSO_ACCOUNT_CONFLICT',
] as const;
export type SsoErrorCode = (typeof SSO_ERROR_CODES)[number];

export const MAX_GROUP_MAPPINGS = 100;
export const MAX_ALLOWED_DOMAINS = 50;

/** Number of recovery codes generated at enrolment (each can be used once). */
/** Roles that must use 2FA for password sign-in unless Settings → Authentication changes it (D-061). */
export const DEFAULT_MFA_REQUIRED_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
] as const satisfies readonly SystemRoleKey[];
export const MFA_RECOVERY_CODE_COUNT = 10;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A bare domain name such as `example.com` (no `@`, no scheme). */
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const ssoGroupMappingSchema = z.object({
  /** Value of the groups claim: Entra ID group object ID, or a group name for other providers. */
  group: z.string().trim().min(1).max(256),
  roles: z.array(z.enum(SYSTEM_ROLE_KEYS)).max(SYSTEM_ROLE_KEYS.length),
  departmentId: z.string().uuid().nullable(),
});
export type SsoGroupMapping = z.infer<typeof ssoGroupMappingSchema>;

export const authSettingsSchema = z
  .object({
    ssoEnabled: z.boolean(),
    provider: z.enum(SSO_PROVIDERS),
    /** Entra ID only: directory (tenant) ID, a GUID. */
    tenantId: z.string().trim().max(64),
    /** OIDC only: issuer URL (discovery at `<issuer>/.well-known/openid-configuration`). */
    issuer: z.string().trim().max(500),
    clientId: z.string().trim().max(256),
    /** New client secret; empty keeps the stored one. Never returned by the API. */
    clientSecret: z.string().trim().max(1000).optional(),
    clearClientSecret: z.boolean().optional(),
    /** Label of the sign-in button. */
    buttonLabelEn: z.string().trim().max(100),
    buttonLabelAr: z.string().trim().max(100),
    /** Lower-case domains; sign-in is refused for other e-mail addresses. */
    allowedDomains: z
      .array(z.string().trim().toLowerCase().regex(DOMAIN, 'Invalid domain'))
      .max(MAX_ALLOWED_DOMAINS),
    /** Create unknown users on their first sign-in (just in time). */
    autoCreateUsers: z.boolean(),
    defaultRole: z.enum(SYSTEM_ROLE_KEYS),
    defaultDepartmentId: z.string().uuid().nullable(),
    /** Claim that holds the user's groups (Entra ID: `groups`). */
    groupsClaim: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_.:/-]+$/),
    groupMappings: z.array(ssoGroupMappingSchema).max(MAX_GROUP_MAPPINGS),
    /** Apply the group mappings on every sign-in (not only when the user is created). */
    syncRolesOnLogin: z.boolean(),
    /** Password sign-in; when off only the break-glass account may use it. */
    localLoginEnabled: z.boolean(),
    breakGlassUserId: z.string().uuid().nullable(),
    /** Roles whose members must use two-factor authentication for password sign-in. */
    mfaRequiredRoles: z.array(z.enum(SYSTEM_ROLE_KEYS)).max(SYSTEM_ROLE_KEYS.length),
  })
  .superRefine((v, ctx) => {
    if (v.provider === 'ENTRA' && v.tenantId && !GUID.test(v.tenantId)) {
      ctx.addIssue({ code: 'custom', path: ['tenantId'], message: 'TENANT_ID_INVALID' });
    }
    if (v.provider === 'OIDC' && v.issuer) {
      let ok = false;
      try {
        const u = new URL(v.issuer);
        ok = (u.protocol === 'https:' || u.protocol === 'http:') && !u.search && !u.hash;
      } catch {
        ok = false;
      }
      if (!ok) ctx.addIssue({ code: 'custom', path: ['issuer'], message: 'ISSUER_INVALID' });
    }
    if (v.ssoEnabled) {
      const issuerMissing = v.provider === 'ENTRA' ? !v.tenantId : !v.issuer;
      if (issuerMissing || !v.clientId) {
        ctx.addIssue({ code: 'custom', path: ['clientId'], message: 'SSO_INCOMPLETE' });
      }
      if (!v.allowedDomains.length) {
        ctx.addIssue({ code: 'custom', path: ['allowedDomains'], message: 'DOMAIN_REQUIRED' });
      }
    }
    if (!v.localLoginEnabled && !v.breakGlassUserId) {
      ctx.addIssue({ code: 'custom', path: ['breakGlassUserId'], message: 'BREAK_GLASS_REQUIRED' });
    }
  });
export type AuthSettingsInput = z.infer<typeof authSettingsSchema>;

export interface AuthSettingsDto extends Omit<
  AuthSettingsInput,
  'clientSecret' | 'clearClientSecret'
> {
  hasClientSecret: boolean;
  /** False when INTEGRATIONS_ENCRYPTION_KEY is missing (the secret cannot be stored). */
  encryptionAvailable: boolean;
  /** Redirect URI to register at the identity provider. */
  redirectUri: string;
  /** True when AUTH_FORCE_LOCAL_LOGIN overrides "password sign-in off". */
  localLoginForced: boolean;
}

/** Result of "Test connection": the provider's discovery document was read. */
export interface AuthTestResultDto {
  ok: boolean;
  issuer?: string;
  authorizationEndpoint?: string;
  errorCode?: string;
  message?: string;
}

/** What the login page needs before sign-in. */
export interface PublicAuthDto {
  ssoEnabled: boolean;
  ssoButtonLabelEn: string;
  ssoButtonLabelAr: string;
  /** False when only the break-glass account may sign in with a password. */
  localLoginEnabled: boolean;
}

// ---------- Two-factor authentication (TOTP) ----------

const totpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'MFA_CODE_FORMAT');
/** Recovery codes: `XXXX-XXXX-XXXX-XXXX` (Crockford-style base32, case and dashes ignored). */
const recoveryCode = z
  .string()
  .trim()
  .min(16)
  .max(40)
  .transform((c) => normaliseRecoveryCode(c));

export const mfaVerifySchema = z.union([
  z.object({ code: totpCode }).strict(),
  z.object({ recoveryCode }).strict(),
]);
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const mfaCodeSchema = z.object({ code: totpCode });
export type MfaCodeInput = z.infer<typeof mfaCodeSchema>;

export const mfaSetupSchema = z.object({ password: z.string().min(1).max(256) });
export type MfaSetupInput = z.infer<typeof mfaSetupSchema>;

/** Turning 2FA off or new recovery codes: password and a current code. */
export const mfaConfirmSchema = z.object({
  password: z.string().min(1).max(256),
  code: totpCode,
});
export type MfaConfirmInput = z.infer<typeof mfaConfirmSchema>;

export interface MfaSetupDto {
  /** Base32 secret for manual entry. */
  secret: string;
  /** `otpauth://` URI shown as a QR code. */
  otpauthUrl: string;
}

export interface MfaStatusDto {
  enabled: boolean;
  /** One of the user's roles requires 2FA (it cannot be turned off). */
  required: boolean;
  /** 2FA applies to password sign-in only; false for accounts without a password. */
  available: boolean;
  recoveryCodesLeft: number;
  enabledAt: string | null;
}

export type LoginResponseDto = { user: CurrentUser } | { mfa: LoginMfaStep };

export interface MfaRecoveryCodesDto {
  recoveryCodes: string[];
}

/** Second step needed after a correct password. */
export const LOGIN_MFA_STEPS = ['VERIFY', 'SETUP'] as const;
export type LoginMfaStep = (typeof LOGIN_MFA_STEPS)[number];

export function normaliseRecoveryCode(code: string): string {
  const plain = code.toUpperCase().replace(/[\s-]/g, '');
  return plain.match(/.{1,4}/g)?.join('-') ?? '';
}

/** Whether any of the roles requires 2FA. */
export function mfaRequiredFor(roles: readonly SystemRoleKey[], required: readonly string[]) {
  return roles.some((r) => required.includes(r));
}
