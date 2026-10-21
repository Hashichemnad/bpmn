import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  SETTING_KEYS,
  type EmailSettingsDto,
  type EmailSettingsInput,
  type TestEmailInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { badRequest } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { SecretBox } from '../integrations/secret-box';
import { MailTransport, type SmtpConfig } from './mail-transport';
import { renderTestEmail } from './email-templates';

/** Stored in Setting `email`; the SMTP password only as AES-256-GCM ciphertext. */
export interface StoredEmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  passwordSealed: string | null;
  fromAddress: string;
  fromName: string;
}

const DEFAULTS: StoredEmailSettings = {
  enabled: false,
  host: '',
  port: 587,
  secure: false,
  username: '',
  passwordSealed: null,
  fromAddress: '',
  fromName: 'ProcessHub',
};

/** SMTP settings (Settings → Email). */
@Injectable()
export class EmailSettingsService {
  private readonly box: SecretBox | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly transport: MailTransport,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.box = config.INTEGRATIONS_ENCRYPTION_KEY
      ? new SecretBox(config.INTEGRATIONS_ENCRYPTION_KEY)
      : null;
  }

  async get(): Promise<StoredEmailSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.EMAIL } });
    return { ...DEFAULTS, ...((row?.value as Partial<StoredEmailSettings> | undefined) ?? {}) };
  }

  toDto(s: StoredEmailSettings): EmailSettingsDto {
    return {
      enabled: s.enabled,
      host: s.host,
      port: s.port,
      secure: s.secure,
      username: s.username,
      hasPassword: !!s.passwordSealed,
      fromAddress: s.fromAddress,
      fromName: s.fromName,
      encryptionAvailable: !!this.box,
    };
  }

  async getDto() {
    return this.toDto(await this.get());
  }

  private merge(before: StoredEmailSettings, input: EmailSettingsInput): StoredEmailSettings {
    let passwordSealed = before.passwordSealed;
    if (input.clearPassword) passwordSealed = null;
    else if (input.password) {
      if (!this.box) throw badRequest('ENCRYPTION_KEY_MISSING');
      passwordSealed = this.box.encrypt(input.password);
    }
    return {
      enabled: input.enabled,
      host: input.host,
      port: input.port,
      secure: input.secure,
      username: input.username,
      passwordSealed,
      fromAddress: input.fromAddress,
      fromName: input.fromName,
    };
  }

  async update(input: EmailSettingsInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.get();
    const after = this.merge(before, input);
    const { passwordSealed: _b, ...beforePublic } = before;
    const { passwordSealed: _a, ...afterPublic } = after;
    await this.prisma.$transaction(async (tx) => {
      const value = after as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.EMAIL },
        create: { key: SETTING_KEYS.EMAIL, value, updatedById: actor.id },
        update: { value, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: SETTING_KEYS.EMAIL,
          userId: actor.id,
          summary: {
            before: beforePublic,
            after: afterPublic,
            credentialChanged: before.passwordSealed !== after.passwordSealed,
          },
          meta,
        },
        tx,
      );
    });
    return this.toDto(after);
  }

  /** Decrypted SMTP settings, or null when email is off or incomplete. */
  async smtp(s?: StoredEmailSettings): Promise<SmtpConfig | null> {
    const v = s ?? (await this.get());
    if (!v.enabled || !v.host || !v.fromAddress) return null;
    let password: string | null = null;
    if (v.passwordSealed) {
      if (!this.box) return null;
      try {
        password = this.box.decrypt(v.passwordSealed);
      } catch {
        return null;
      }
    }
    return {
      host: v.host,
      port: v.port,
      secure: v.secure,
      username: v.username,
      password,
      fromAddress: v.fromAddress,
      fromName: v.fromName,
    };
  }

  /** Sends a test message with the stored settings. */
  async sendTest(input: TestEmailInput, actor: AuthUser, meta: RequestMeta) {
    const smtp = await this.smtp();
    if (!smtp) throw badRequest('EMAIL_NOT_CONFIGURED');
    let ok = true;
    let error: string | null = null;
    try {
      await this.transport.send(smtp, { to: input.to, ...renderTestEmail(actor.locale) });
    } catch (err) {
      ok = false;
      error = ((err as Error).message ?? 'error').slice(0, 300);
      if (smtp.password) error = error.split(smtp.password).join('***');
    }
    await this.audit.log({
      action: 'EMAIL_TEST',
      entityType: 'Setting',
      entityId: SETTING_KEYS.EMAIL,
      userId: actor.id,
      summary: { to: input.to, ok, error },
      meta,
    });
    return { ok, error };
  }
}
