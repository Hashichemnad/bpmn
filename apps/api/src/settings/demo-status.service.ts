import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  SETTING_KEYS,
  demoInstallationSchema,
  demoWarning,
  type DemoInstallation,
  type DemoStatusDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { conflict } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';

/**
 * Demo installation warning (D-180): while seeded demo data has not been confirmed removed, or a
 * demo user or demo API key is still active, administrators see a banner (go-live checklist).
 */
@Injectable()
export class DemoStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async marker(): Promise<DemoInstallation | null> {
    const row = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.DEMO_INSTALLATION },
    });
    if (!row) return null;
    const parsed = demoInstallationSchema.safeParse(row.value);
    return parsed.success ? parsed.data : null;
  }

  async status(): Promise<DemoStatusDto> {
    const m = await this.marker();
    if (!m) {
      return {
        warning: false,
        seededAt: null,
        demoData: false,
        activeDemoUsers: 0,
        activeDemoApiKeys: 0,
        clearedAt: null,
      };
    }
    const [activeDemoUsers, activeDemoApiKeys] = await Promise.all([
      m.userIds.length
        ? this.prisma.user.count({
            where: { id: { in: m.userIds }, status: 'ACTIVE', deletedAt: null },
          })
        : 0,
      m.apiKeyIds.length
        ? this.prisma.apiKey.count({
            where: { id: { in: m.apiKeyIds }, revokedAt: null, expiresAt: { gt: new Date() } },
          })
        : 0,
    ]);
    const s = {
      seededAt: m.seededAt,
      demoData: !m.clearedAt,
      activeDemoUsers,
      activeDemoApiKeys,
      clearedAt: m.clearedAt,
    };
    return { ...s, warning: demoWarning(s) };
  }

  /**
   * A Super Admin confirms the demo content was removed. Refused while a demo user or demo API key
   * is still active: those are switched off first (Users, Settings → Integrations).
   */
  async clear(actor: AuthUser, meta: RequestMeta): Promise<DemoStatusDto> {
    const m = await this.marker();
    const current = await this.status();
    if (!m || m.clearedAt) return current;
    if (current.activeDemoUsers || current.activeDemoApiKeys) {
      throw conflict(
        'DEMO_STILL_ACTIVE',
        'Deactivate the demo users and revoke the demo API key first',
      );
    }
    const value: DemoInstallation = {
      ...m,
      clearedAt: new Date().toISOString(),
      clearedById: actor.id,
    };
    await this.prisma.setting.update({
      where: { key: SETTING_KEYS.DEMO_INSTALLATION },
      data: { value: value as unknown as Prisma.InputJsonValue, updatedById: actor.id },
    });
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'Setting',
      entityId: SETTING_KEYS.DEMO_INSTALLATION,
      userId: actor.id,
      summary: { demoRemovedConfirmed: true, seededAt: m.seededAt },
      meta,
    });
    return this.status();
  }
}
