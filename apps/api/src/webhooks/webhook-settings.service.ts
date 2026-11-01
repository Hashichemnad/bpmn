import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_WEBHOOK_SETTINGS,
  SETTING_KEYS,
  webhookSettingsSchema,
  type WebhookSettings,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';

/** Setting `integrations.webhooks`: host allow-lists and delivery log retention (D-174). */
@Injectable()
export class WebhookSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<WebhookSettings> {
    const row = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.INTEGRATIONS_WEBHOOKS },
    });
    const parsed = webhookSettingsSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : DEFAULT_WEBHOOK_SETTINGS;
  }

  async update(input: WebhookSettings, actor: AuthUser, meta: RequestMeta) {
    const before = await this.get();
    const value = input as unknown as Prisma.InputJsonValue;
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.INTEGRATIONS_WEBHOOKS },
        create: { key: SETTING_KEYS.INTEGRATIONS_WEBHOOKS, value, updatedById: actor.id },
        update: { value, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: SETTING_KEYS.INTEGRATIONS_WEBHOOKS,
          userId: actor.id,
          summary: { before, after: input },
          meta,
        },
        tx,
      );
    });
    return this.get();
  }
}
