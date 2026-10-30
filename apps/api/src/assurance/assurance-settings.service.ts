import { Injectable } from '@nestjs/common';
import { SETTING_KEYS, resolveAssuranceSettings, type AssuranceSettings } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';

/** Settings → Risk & Compliance → Issues: severity scale, reminders, escalation. */
@Injectable()
export class AssuranceSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<AssuranceSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.ASSURANCE } });
    return resolveAssuranceSettings(row?.value);
  }

  async set(input: AssuranceSettings, actor: AuthUser, meta: RequestMeta) {
    const key = SETTING_KEYS.ASSURANCE;
    const before = await this.get();
    await this.prisma.$transaction(async (tx) => {
      const value = { ...input };
      await tx.setting.upsert({
        where: { key },
        create: { key, value, updatedById: actor.id },
        update: { value, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: key,
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
