import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_MFA_REQUIRED_ROLES,
  SETTING_KEYS,
  SSO_CALLBACK_PATH,
  type AuthSettingsDto,
  type AuthSettingsInput,
  type PublicAuthDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { badRequest } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { SecretBox } from '../integrations/secret-box';

/** Stored form of Settings → Authentication (setting key `auth`). */
export type StoredAuthSettings = Omit<AuthSettingsInput, 'clientSecret' | 'clearClientSecret'> & {
  clientSecretSealed: string | null;
};

export const AUTH_DEFAULTS: StoredAuthSettings = {
  ssoEnabled: false,
  provider: 'ENTRA',
  tenantId: '',
  issuer: '',
  clientId: '',
  clientSecretSealed: null,
  buttonLabelEn: '',
  buttonLabelAr: '',
  allowedDomains: [],
  autoCreateUsers: true,
  defaultRole: 'VIEWER',
  defaultDepartmentId: null,
  groupsClaim: 'groups',
  groupMappings: [],
  syncRolesOnLogin: false,
  requireIdpMfa: false,
  localLoginEnabled: true,
  breakGlassUserId: null,
  mfaRequiredRoles: [...DEFAULT_MFA_REQUIRED_ROLES],
};

/** Issuer URL of the configured provider (Entra ID: derived from the tenant ID). */
export function issuerOf(s: Pick<StoredAuthSettings, 'provider' | 'tenantId' | 'issuer'>): string {
  return s.provider === 'ENTRA'
    ? `https://login.microsoftonline.com/${s.tenantId.toLowerCase()}/v2.0`
    : s.issuer.replace(/\/+$/, '');
}

@Injectable()
export class AuthSettingsService {
  private readonly box: SecretBox | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.box = config.INTEGRATIONS_ENCRYPTION_KEY
      ? new SecretBox(config.INTEGRATIONS_ENCRYPTION_KEY)
      : null;
  }

  get redirectUri(): string {
    return `${this.config.APP_URL}${SSO_CALLBACK_PATH}`;
  }

  async get(): Promise<StoredAuthSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.AUTH } });
    return {
      ...AUTH_DEFAULTS,
      ...((row?.value as Partial<StoredAuthSettings> | undefined) ?? {}),
    };
  }

  toDto(s: StoredAuthSettings): AuthSettingsDto {
    const { clientSecretSealed, ...rest } = s;
    return {
      ...rest,
      hasClientSecret: !!clientSecretSealed,
      encryptionAvailable: !!this.box,
      redirectUri: this.redirectUri,
      localLoginForced: this.config.AUTH_FORCE_LOCAL_LOGIN,
    };
  }

  async getDto() {
    return this.toDto(await this.get());
  }

  async getPublic(): Promise<PublicAuthDto> {
    const s = await this.get();
    return {
      ssoEnabled: this.ssoUsable(s),
      ssoButtonLabelEn: s.buttonLabelEn,
      ssoButtonLabelAr: s.buttonLabelAr,
      localLoginEnabled: s.localLoginEnabled || this.config.AUTH_FORCE_LOCAL_LOGIN,
    };
  }

  /** SSO is switched on and complete (a secret is stored and can be decrypted). */
  ssoUsable(s: StoredAuthSettings): boolean {
    return s.ssoEnabled && !!s.clientId && !!s.clientSecretSealed && !!this.box;
  }

  /** Whether a user may sign in with a password (local sign-in on, break-glass, or env override). */
  localLoginAllowed(s: StoredAuthSettings, userId: string): boolean {
    return (
      s.localLoginEnabled || this.config.AUTH_FORCE_LOCAL_LOGIN || s.breakGlassUserId === userId
    );
  }

  clientSecret(s: StoredAuthSettings): string {
    if (!s.clientSecretSealed || !this.box) throw new Error('No client secret is configured');
    return this.box.decrypt(s.clientSecretSealed);
  }

  /** Applies the form to the stored settings; returns the merged result without saving. */
  merge(before: StoredAuthSettings, input: AuthSettingsInput): StoredAuthSettings {
    let clientSecretSealed = before.clientSecretSealed;
    if (input.clearClientSecret) clientSecretSealed = null;
    else if (input.clientSecret) {
      if (!this.box) throw badRequest('ENCRYPTION_KEY_MISSING');
      clientSecretSealed = this.box.encrypt(input.clientSecret);
    }
    const { clientSecret: _s, clearClientSecret: _c, ...rest } = input;
    return {
      ...rest,
      allowedDomains: [...new Set(input.allowedDomains)],
      mfaRequiredRoles: [...new Set(input.mfaRequiredRoles)],
      clientSecretSealed,
    };
  }

  async update(input: AuthSettingsInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.get();
    const after = this.merge(before, input);
    await this.assertValid(after);
    const { clientSecretSealed: _b, ...beforePublic } = before;
    const { clientSecretSealed: _a, ...afterPublic } = after;
    await this.prisma.$transaction(async (tx) => {
      const value = after as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.AUTH },
        create: { key: SETTING_KEYS.AUTH, value, updatedById: actor.id },
        update: { value, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: SETTING_KEYS.AUTH,
          userId: actor.id,
          summary: {
            before: beforePublic,
            after: afterPublic,
            credentialChanged: before.clientSecretSealed !== after.clientSecretSealed,
          },
          meta,
        },
        tx,
      );
    });
    return this.toDto(after);
  }

  private async assertValid(s: StoredAuthSettings) {
    if (s.ssoEnabled && !s.clientSecretSealed) throw badRequest('SSO_SECRET_REQUIRED');
    if (!s.localLoginEnabled) {
      // Without SSO nobody but the break-glass account could sign in.
      if (!s.ssoEnabled) throw badRequest('SSO_REQUIRED_FOR_LOCAL_OFF');
      const breakGlass = await this.prisma.user.findFirst({
        where: {
          id: s.breakGlassUserId ?? undefined,
          deletedAt: null,
          status: 'ACTIVE',
          passwordHash: { not: '' },
          roles: { some: { role: { key: 'SUPER_ADMIN' } } },
        },
      });
      if (!breakGlass) throw badRequest('BREAK_GLASS_INVALID');
    }
    const departmentIds = [
      s.defaultDepartmentId,
      ...s.groupMappings.map((m) => m.departmentId),
    ].filter((id): id is string => !!id);
    if (departmentIds.length) {
      const unique = [...new Set(departmentIds)];
      const found = await this.prisma.department.count({
        where: { id: { in: unique }, deletedAt: null },
      });
      if (found !== unique.length) throw badRequest('DEPARTMENT_NOT_FOUND');
    }
  }
}
