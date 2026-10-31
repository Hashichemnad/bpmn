import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  INVITATION_TTL_DAYS,
  type AcceptInvitationInput,
  type InvitationInfoDto,
  type Locale,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PasswordService } from '../auth/password.service';
import { AuthSettingsService } from '../auth/auth-settings.service';
import { EmailSettingsService } from '../notifications/email-settings.service';
import { MailTransport } from '../notifications/mail-transport';
import { renderInvitationEmail, renderSsoWelcomeEmail } from '../notifications/email-templates';
import { readImportSettings } from '../imports/import-settings';
import { badRequest, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Set-password invitations for users created without a password (Import Center, M15): a random
 * 256-bit token (only its SHA-256 is stored), single use, valid INVITATION_TTL_DAYS. Not used when
 * password sign-in is off (users sign in with SSO; the account is linked by e-mail).
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly authSettings: AuthSettingsService,
    private readonly email: EmailSettingsService,
    private readonly transport: MailTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * How new users will sign in (D-164): a set-password invitation while password sign-in is on;
   * once SSO is live and password sign-in is off, a welcome e-mail with the sign-in link
   * (`SSO_WELCOME`, Setting `imports.ssoWelcomeEmail`) or no e-mail at all (`SSO`).
   */
  async mode(): Promise<'INVITE' | 'SSO' | 'SSO_WELCOME' | 'NO_EMAIL'> {
    const s = await this.authSettings.getPublic();
    const smtp = !!(await this.email.smtp());
    if (s.ssoEnabled && !s.localLoginEnabled)
      return smtp && (await readImportSettings(this.prisma)).ssoWelcomeEmail
        ? 'SSO_WELCOME'
        : 'SSO';
    if (!smtp) return s.ssoEnabled ? 'SSO' : 'NO_EMAIL';
    return 'INVITE';
  }

  /** Welcome e-mail with the single sign-on link (no password, nothing to set). */
  async sendWelcome(userId: string): Promise<boolean> {
    const smtp = await this.email.smtp();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!smtp || !user) return false;
    const auth = await this.authSettings.getPublic();
    const locale = (user.locale === 'ar' ? 'ar' : 'en') as Locale;
    const name =
      (locale === 'ar' ? user.nameAr || user.nameEn : user.nameEn || user.nameAr) || user.email;
    const label = (locale === 'ar' ? auth.ssoButtonLabelAr : auth.ssoButtonLabelEn) || '';
    const url = `${this.config.APP_URL.replace(/\/$/, '')}/login`;
    try {
      await this.transport.send(smtp, {
        to: user.email,
        ...renderSsoWelcomeEmail(locale, name, url, label),
      });
      return true;
    } catch (e) {
      this.logger.warn(`Welcome e-mail to user ${userId} not sent: ${(e as Error).message}`);
      return false;
    }
  }

  /** Creates an invitation (older open ones are withdrawn) and returns the token. */
  async create(userId: string, actorId: string | null, tx: Prisma.TransactionClient = this.prisma) {
    const token = randomBytes(32).toString('base64url');
    await tx.userInvitation.updateMany({
      where: { userId, usedAt: null },
      data: { expiresAt: new Date() },
    });
    await tx.userInvitation.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
        createdById: actorId,
      },
    });
    return token;
  }

  /** Sends the e-mail; returns false when e-mail is not configured or sending failed. */
  async send(userId: string, token: string): Promise<boolean> {
    const smtp = await this.email.smtp();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!smtp || !user) return false;
    const locale = (user.locale === 'ar' ? 'ar' : 'en') as Locale;
    const name =
      (locale === 'ar' ? user.nameAr || user.nameEn : user.nameEn || user.nameAr) || user.email;
    const url = `${this.config.APP_URL.replace(/\/$/, '')}/invitation/${token}`;
    try {
      await this.transport.send(smtp, {
        to: user.email,
        ...renderInvitationEmail(locale, name, url, INVITATION_TTL_DAYS),
      });
      await this.prisma.userInvitation.updateMany({
        where: { tokenHash: hashToken(token) },
        data: { sentAt: new Date() },
      });
      return true;
    } catch (e) {
      this.logger.warn(`Invitation to user ${userId} not sent: ${(e as Error).message}`);
      return false;
    }
  }

  /** Admin: new invitation for a user without a password (users.manage). */
  async resend(userId: string, actor: AuthUser, meta: RequestMeta) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw notFound('User');
    if (user.passwordHash) throw badRequest('USER_HAS_PASSWORD');
    const mode = await this.mode();
    if (mode !== 'INVITE' && mode !== 'SSO_WELCOME') throw badRequest('EMAIL_NOT_CONFIGURED');
    const sent =
      mode === 'SSO_WELCOME'
        ? await this.sendWelcome(userId)
        : await this.send(userId, await this.create(userId, actor.id));
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'User',
      entityId: userId,
      userId: actor.id,
      summary: { invitation: sent ? 'sent' : 'failed', mode },
      meta,
    });
    return { sent };
  }

  private async open(token: string) {
    const inv = await this.prisma.userInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (
      !inv ||
      inv.usedAt ||
      inv.expiresAt < new Date() ||
      inv.user.deletedAt ||
      inv.user.status !== 'ACTIVE' ||
      inv.user.passwordHash
    )
      throw badRequest('INVITATION_INVALID');
    return inv;
  }

  async info(token: string): Promise<InvitationInfoDto> {
    const inv = await this.open(token);
    return {
      email: inv.user.email,
      nameEn: inv.user.nameEn,
      nameAr: inv.user.nameAr,
      locale: inv.user.locale === 'ar' ? 'ar' : 'en',
      expiresAt: inv.expiresAt.toISOString(),
    };
  }

  /** Sets the first password; the user then signs in normally (2FA enrolment if their role needs it). */
  async accept(input: AcceptInvitationInput, meta: RequestMeta) {
    const inv = await this.open(input.token);
    this.passwords.assertPolicy(input.password);
    const passwordHash = await this.passwords.hash(input.password);
    await this.prisma.$transaction(async (tx) => {
      const used = await tx.userInvitation.updateMany({
        where: { id: inv.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (!used.count) throw badRequest('INVITATION_INVALID');
      await tx.user.update({
        where: { id: inv.userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      await this.audit.log(
        {
          action: 'PASSWORD_CHANGE',
          entityType: 'User',
          entityId: inv.userId,
          userId: inv.userId,
          summary: { invitation: true },
          meta,
        },
        tx,
      );
    });
    return { email: inv.user.email };
  }
}
