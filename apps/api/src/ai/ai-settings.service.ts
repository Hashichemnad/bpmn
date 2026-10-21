import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SETTING_KEYS, type AiSettingsDto, type AiSettingsInput } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { badRequest } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { SecretBox } from '../integrations/secret-box';
import { AiError, type AiConnection } from './providers/types';
import { AI_DEFAULTS, type StoredAiSettings } from './ai-defaults';

export { AI_DEFAULTS, type StoredAiSettings } from './ai-defaults';

@Injectable()
export class AiSettingsService {
  private readonly box: SecretBox | null;
  private readonly timeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.box = config.INTEGRATIONS_ENCRYPTION_KEY
      ? new SecretBox(config.INTEGRATIONS_ENCRYPTION_KEY)
      : null;
    this.timeoutMs = config.AI_HTTP_TIMEOUT_MS;
  }

  async get(): Promise<StoredAiSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.AI } });
    return { ...AI_DEFAULTS, ...((row?.value as Partial<StoredAiSettings> | undefined) ?? {}) };
  }

  toDto(s: StoredAiSettings): AiSettingsDto {
    const { apiKeySealed, ...rest } = s;
    return { ...rest, hasApiKey: !!apiKeySealed, encryptionAvailable: !!this.box };
  }

  async getDto() {
    return this.toDto(await this.get());
  }

  /** Applies the form to the stored settings; returns the merged result without saving. */
  private merge(before: StoredAiSettings, input: AiSettingsInput): StoredAiSettings {
    let apiKeySealed = before.apiKeySealed;
    if (input.clearApiKey) apiKeySealed = null;
    else if (input.apiKey?.trim()) {
      if (!this.box) throw badRequest('ENCRYPTION_KEY_MISSING');
      apiKeySealed = this.box.encrypt(input.apiKey.trim());
    }
    return {
      enabled: input.enabled,
      provider: input.provider,
      model: input.model,
      fastModel: input.fastModel,
      apiKeySealed,
      allowedRoles: [...new Set(input.allowedRoles)],
      userDailyLimit: input.userDailyLimit,
      orgMonthlyLimit: input.orgMonthlyLimit,
      noticeEn: input.noticeEn,
      noticeAr: input.noticeAr,
      suggestions: input.suggestions,
    };
  }

  async update(input: AiSettingsInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.get();
    const after = this.merge(before, input);
    if (after.enabled && !after.apiKeySealed) throw badRequest('AI_KEY_REQUIRED');
    const { apiKeySealed: _b, ...beforePublic } = before;
    const { apiKeySealed: _a, ...afterPublic } = after;
    await this.prisma.$transaction(async (tx) => {
      const value = after as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.AI },
        create: { key: SETTING_KEYS.AI, value, updatedById: actor.id },
        update: { value, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: SETTING_KEYS.AI,
          userId: actor.id,
          summary: {
            before: beforePublic,
            after: afterPublic,
            credentialChanged: before.apiKeySealed !== after.apiKeySealed,
          },
          meta,
        },
        tx,
      );
    });
    return this.toDto(after);
  }

  /** Settings for a test call: the stored key unless a new one is typed. */
  async forTest(input: AiSettingsInput): Promise<StoredAiSettings> {
    return this.merge(await this.get(), input);
  }

  /** Decrypted connection; throws AI_NOT_CONFIGURED when the key is missing or unreadable. */
  connection(s: StoredAiSettings): AiConnection {
    if (!s.apiKeySealed || !this.box) {
      throw new AiError('AI_NOT_CONFIGURED', 'No API key is configured');
    }
    try {
      return {
        provider: s.provider,
        apiKey: this.box.decrypt(s.apiKeySealed),
        timeoutMs: this.timeoutMs,
      };
    } catch {
      throw new AiError(
        'AI_NOT_CONFIGURED',
        'The stored API key cannot be decrypted with the current encryption key',
      );
    }
  }
}
