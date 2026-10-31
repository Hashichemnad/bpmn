import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { duePeriod, type KpiFrequency } from '@processhub/shared';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { KpiSettingsService } from './kpi-settings.service';

/** Hook for the Salesforce sync (step 5), registered by the integration so the module stays independent. */
export interface ScheduledJob {
  runScheduled(now: Date): Promise<unknown>;
}

/**
 * Periodic KPI work (like the assurance scheduler): one reminder per KPI and period to the owner
 * when the value of the last completed period is missing; the scheduled Salesforce sync.
 */
@Injectable()
export class KpiScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KpiScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private first?: ReturnType<typeof setTimeout>;
  private readonly jobs: ScheduledJob[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: KpiSettingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  register(job: ScheduledJob) {
    this.jobs.push(job);
  }

  onModuleInit() {
    const minutes = this.config.SCHEDULER_INTERVAL_MINUTES;
    if (!minutes || this.config.NODE_ENV === 'test') return;
    const run = () => void this.runOnce().catch((e: Error) => this.logger.error(e.message));
    this.first = setTimeout(run, 120_000);
    this.timer = setInterval(run, minutes * 60_000);
  }

  onModuleDestroy() {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  async runOnce(now = new Date()) {
    const reminders = await this.remind(now);
    if (reminders) this.logger.log(`KPI reminders: ${reminders}`);
    for (const job of this.jobs) await job.runScheduled(now);
    return { reminders };
  }

  /** One reminder per KPI and due period (`Kpi.reminderSentFor`). */
  async remind(now = new Date()): Promise<number> {
    if (!(await this.settings.get()).reminders) return 0;
    const kpis = await this.prisma.kpi.findMany({
      where: {
        status: 'ACTIVE',
        dataSource: { in: ['MANUAL', 'EXCEL'] },
        object: { deletedAt: null, ownerId: { not: null } },
      },
      include: { object: true, measurements: { select: { period: true } } },
    });
    let sent = 0;
    for (const k of kpis) {
      const period = duePeriod(now, k.frequency as KpiFrequency);
      if (k.reminderSentFor === period || k.measurements.some((m) => m.period === period)) continue;
      sent += await this.notifications.notify({
        type: 'KPI',
        userIds: [k.object.ownerId],
        params: {
          kind: 'due',
          code: k.object.code ?? '',
          titleEn: k.object.nameEn,
          titleAr: k.object.nameAr,
          comment: period,
        },
        link: `/kpis/${k.objectId}`,
        dedupeKey: `kpi-due:${k.objectId}:${period}`,
      });
      await this.prisma.kpi.update({
        where: { objectId: k.objectId },
        data: { reminderSentFor: period },
      });
    }
    return sent;
  }
}
