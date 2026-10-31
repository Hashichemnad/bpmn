import { Injectable } from '@nestjs/common';
import {
  DEFAULT_MINING_SETTINGS,
  SETTING_KEYS,
  miningSettingsSchema,
  type MiningSettings,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';

/** Setting `mining`: retention, job concurrency, portal performance tab, default time zone. */
@Injectable()
export class MiningSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<MiningSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.MINING } });
    const parsed = miningSettingsSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : DEFAULT_MINING_SETTINGS;
  }

  async set(input: MiningSettings, actor: AuthUser, meta: RequestMeta): Promise<MiningSettings> {
    const before = await this.get();
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.MINING },
        create: { key: SETTING_KEYS.MINING, value: input, updatedById: actor.id },
        update: { value: input, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: SETTING_KEYS.MINING,
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
