import { Injectable } from '@nestjs/common';
import {
  DEFAULT_KPI_SETTINGS,
  SETTING_KEYS,
  kpiSettingsSchema,
  type KpiSettings,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';

/** Setting `kpi`: portal visibility of process KPIs (off by default) and owner reminders. */
@Injectable()
export class KpiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<KpiSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.KPI } });
    const parsed = kpiSettingsSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : DEFAULT_KPI_SETTINGS;
  }

  async set(input: KpiSettings, actor: AuthUser, meta: RequestMeta): Promise<KpiSettings> {
    const before = await this.get();
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.KPI },
        create: { key: SETTING_KEYS.KPI, value: input, updatedById: actor.id },
        update: { value: input, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: SETTING_KEYS.KPI,
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
