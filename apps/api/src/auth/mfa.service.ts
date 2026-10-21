import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import {
  SETTING_KEYS,
  mfaRequiredFor,
  type MfaConfirmInput,
  type MfaRecoveryCodesDto,
  type MfaSetupDto,
  type MfaStatusDto,
  type MfaVerifyInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AppException, badRequest, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { SecretBox } from '../integrations/secret-box';
import { AuthSettingsService } from './auth-settings.service';
import { PasswordService } from './password.service';
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, totpUri, verifyTotp } from './totp';

export const invalidMfaCode = (status = HttpStatus.BAD_REQUEST) =>
  new AppException(status, 'MFA_CODE_INVALID', 'Invalid or already used code');

/** TOTP two-factor authentication for accounts with a local password. */
@Injectable()
export class MfaService {
  private readonly box: SecretBox | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly authSettings: AuthSettingsService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.box = config.INTEGRATIONS_ENCRYPTION_KEY
      ? new SecretBox(config.INTEGRATIONS_ENCRYPTION_KEY)
      : null;
  }

  /**
   * Whether 2FA is required for the user's password sign-in: one of their roles requires it, or the
   * user is the break-glass account (always, D-062).
   */
  async isRequired(user: Pick<AuthUser, 'id' | 'roles'>): Promise<boolean> {
    const s = await this.authSettings.get();
    return s.breakGlassUserId === user.id || mfaRequiredFor(user.roles, s.mfaRequiredRoles);
  }

  async status(user: AuthUser): Promise<MfaStatusDto> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const recoveryCodesLeft = await this.prisma.mfaRecoveryCode.count({
      where: { userId: user.id, usedAt: null },
    });
    return {
      enabled: !!record.totpEnabledAt,
      required: await this.isRequired(user),
      available: record.passwordHash !== '',
      recoveryCodesLeft: record.totpEnabledAt ? recoveryCodesLeft : 0,
      enabledAt: record.totpEnabledAt?.toISOString() ?? null,
    };
  }

  /** Profile: starts enrolment after re-entering the password. */
  async setup(user: AuthUser, password: string): Promise<MfaSetupDto> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await this.assertPassword(record, password);
    if (record.totpEnabledAt) throw badRequest('MFA_ALREADY_ENABLED');
    return this.startSetup(record);
  }

  /** Stores a new pending secret; 2FA is only switched on after a correct code (confirm). */
  async startSetup(record: User): Promise<MfaSetupDto> {
    if (record.passwordHash === '') throw badRequest('MFA_NOT_AVAILABLE');
    if (!this.box) throw badRequest('ENCRYPTION_KEY_MISSING');
    const secret = newTotpSecret();
    await this.prisma.user.update({
      where: { id: record.id },
      data: { totpPendingSealed: this.box.encrypt(secret) },
    });
    const org = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.ORG_NAME_EN } });
    const issuer = typeof org?.value === 'string' && org.value.trim() ? org.value : 'ProcessHub';
    return { secret, otpauthUrl: totpUri(secret, issuer, record.email) };
  }

  /** Confirms enrolment with a code from the app; returns the recovery codes (shown once). */
  async confirmSetup(
    userId: string,
    code: string,
    meta: RequestMeta,
  ): Promise<MfaRecoveryCodesDto> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (record.totpEnabledAt) throw badRequest('MFA_ALREADY_ENABLED');
    if (!record.totpPendingSealed || !this.box) throw badRequest('MFA_SETUP_NOT_STARTED');
    const secret = this.box.decrypt(record.totpPendingSealed);
    const step = verifyTotp(secret, code, null);
    if (step === null) throw invalidMfaCode();
    const recoveryCodes = newRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          totpSecretSealed: record.totpPendingSealed,
          totpPendingSealed: null,
          totpEnabledAt: new Date(),
          totpLastStep: step,
        },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })),
      });
      await this.audit.log(
        { action: 'MFA_ENABLE', entityType: 'User', entityId: userId, userId, meta },
        tx,
      );
    });
    return { recoveryCodes };
  }

  async disable(user: AuthUser, input: MfaConfirmInput, meta: RequestMeta): Promise<void> {
    if (await this.isRequired(user)) {
      throw forbidden('Two-factor authentication is required for your role');
    }
    const record = await this.confirmIdentity(user.id, input);
    await this.prisma.$transaction(async (tx) => {
      await this.clear(tx, record.id);
      await this.audit.log(
        { action: 'MFA_DISABLE', entityType: 'User', entityId: user.id, userId: user.id, meta },
        tx,
      );
    });
  }

  async regenerateRecoveryCodes(
    user: AuthUser,
    input: MfaConfirmInput,
    meta: RequestMeta,
  ): Promise<MfaRecoveryCodesDto> {
    await this.confirmIdentity(user.id, input);
    const recoveryCodes = newRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((c) => ({ userId: user.id, codeHash: hashRecoveryCode(c) })),
      });
      await this.audit.log(
        {
          action: 'MFA_RECOVERY_CODES',
          entityType: 'User',
          entityId: user.id,
          userId: user.id,
          meta,
        },
        tx,
      );
    });
    return { recoveryCodes };
  }

  /** Admin: removes a user's 2FA (lost phone) and signs them out everywhere. */
  async reset(targetId: string, actor: AuthUser, meta: RequestMeta): Promise<void> {
    const target = await this.prisma.user.findFirst({
      where: { id: targetId, deletedAt: null },
      include: { roles: { include: { role: true } } },
    });
    if (!target) throw notFound('User');
    if (
      target.roles.some((r) => r.role.key === 'SUPER_ADMIN') &&
      !actor.roles.includes('SUPER_ADMIN')
    ) {
      throw forbidden('Only a Super Admin can reset two-factor authentication of a Super Admin');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.clear(tx, targetId);
      await tx.refreshToken.updateMany({
        where: { userId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(
        {
          action: 'MFA_RESET',
          entityType: 'User',
          entityId: targetId,
          userId: actor.id,
          summary: { email: target.email, wasEnabled: !!target.totpEnabledAt },
          meta,
        },
        tx,
      );
    });
  }

  /**
   * Second sign-in step: a TOTP code (each time step only once) or an unused recovery code.
   * Returns which one was used; throws MFA_CODE_INVALID (401) otherwise.
   */
  async verifyLogin(record: User, input: MfaVerifyInput): Promise<'TOTP' | 'RECOVERY_CODE'> {
    if (!record.totpEnabledAt || !record.totpSecretSealed || !this.box) {
      throw invalidMfaCode(HttpStatus.UNAUTHORIZED);
    }
    if ('recoveryCode' in input) {
      const used = await this.prisma.mfaRecoveryCode.updateMany({
        where: {
          userId: record.id,
          codeHash: hashRecoveryCode(input.recoveryCode),
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) throw invalidMfaCode(HttpStatus.UNAUTHORIZED);
      return 'RECOVERY_CODE';
    }
    if (!(await this.useCode(record, input.code))) throw invalidMfaCode(HttpStatus.UNAUTHORIZED);
    return 'TOTP';
  }

  /** Checks a code and records its time step atomically (no replay, even concurrently). */
  private async useCode(record: User, code: string): Promise<boolean> {
    const secret = this.box!.decrypt(record.totpSecretSealed!);
    const step = verifyTotp(secret, code, record.totpLastStep);
    if (step === null) return false;
    const claimed = await this.prisma.user.updateMany({
      where: {
        id: record.id,
        OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
      },
      data: { totpLastStep: step },
    });
    return claimed.count === 1;
  }

  /** Password + current code, for turning 2FA off or new recovery codes. */
  private async confirmIdentity(userId: string, input: MfaConfirmInput): Promise<User> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.assertPassword(record, input.password);
    if (!record.totpEnabledAt || !record.totpSecretSealed || !this.box) {
      throw badRequest('MFA_NOT_ENABLED');
    }
    if (!(await this.useCode(record, input.code))) throw invalidMfaCode();
    return record;
  }

  private async assertPassword(record: User, password: string) {
    if (record.passwordHash === '') throw badRequest('MFA_NOT_AVAILABLE');
    if (!(await this.passwords.verify(record.passwordHash, password))) {
      throw badRequest('INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
    }
  }

  private async clear(tx: Pick<PrismaService, 'user' | 'mfaRecoveryCode'>, userId: string) {
    await tx.user.update({
      where: { id: userId },
      data: {
        totpSecretSealed: null,
        totpPendingSealed: null,
        totpEnabledAt: null,
        totpLastStep: null,
      },
    });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
  }
}
