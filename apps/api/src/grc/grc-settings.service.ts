import { Injectable } from '@nestjs/common';
import { SETTING_KEYS, resolveGrcSettings, type GrcSettings } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';

/** Settings → Risk & Compliance: categories, risk matrix labels and bands, portal visibility. */
@Injectable()
export class GrcSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<GrcSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.GRC } });
    return resolveGrcSettings(row?.value);
  }

  async set(input: GrcSettings, actor: AuthUser, meta: RequestMeta) {
    const key = SETTING_KEYS.GRC;
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
