import { Injectable } from '@nestjs/common';
import {
  BusinessCalendar,
  DEFAULT_UAE_HOLIDAYS,
  DEFAULT_WORKFLOW_SETTINGS,
  SETTING_KEYS,
  holidayListSchema,
  workflowSettingsSchema,
  type WorkflowSettings,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';

/** Setting `workflow` (working week, reminders, escalation) and the business calendar (D-150). */
@Injectable()
export class WorkflowSettingsService {
  private cache: { at: number; settings: WorkflowSettings; calendar: BusinessCalendar } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<WorkflowSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.WORKFLOW } });
    const parsed = workflowSettingsSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : DEFAULT_WORKFLOW_SETTINGS;
  }

  async set(
    input: WorkflowSettings,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<WorkflowSettings> {
    const before = await this.get();
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.WORKFLOW },
        create: { key: SETTING_KEYS.WORKFLOW, value: input, updatedById: actor.id },
        update: { value: input, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: SETTING_KEYS.WORKFLOW,
          userId: actor.id,
          summary: { before, after: input },
          meta,
        },
        tx,
      );
    });
    this.cache = null;
    return this.get();
  }

  /** Working week from Setting `workflow` + the central public holidays (Setting `mining.holidays`). */
  async calendar(): Promise<BusinessCalendar> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.calendar;
    const settings = await this.get();
    const row = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.MINING_HOLIDAYS },
    });
    const parsed = holidayListSchema.safeParse(row?.value ?? {});
    const holidays = (parsed.success ? parsed.data.holidays : DEFAULT_UAE_HOLIDAYS).map(
      (h) => h.date,
    );
    const calendar = new BusinessCalendar(settings.calendar, holidays);
    this.cache = { at: Date.now(), settings, calendar };
    return calendar;
  }

  clearCache() {
    this.cache = null;
  }
}
