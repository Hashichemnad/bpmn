import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { addDays, type ContentType } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { itemLink } from './content.service';
import { WorkflowsService } from './workflows.service';

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Reminders, checked periodically in this process:
 *  - periodic review due soon (REVIEW_DUE) and overdue (REVIEW_OVERDUE, kind "periodic") → owner;
 *  - review tasks past their due date (REVIEW_OVERDUE, kind "task") → assignees.
 * Dedupe keys make every reminder fire once per item and date.
 */
@Injectable()
export class GovernanceScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GovernanceScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private first?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly workflows: WorkflowsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    const minutes = this.config.SCHEDULER_INTERVAL_MINUTES;
    if (!minutes || this.config.NODE_ENV === 'test') return;
    const run = () => void this.runOnce().catch((e: Error) => this.logger.error(e.message));
    this.first = setTimeout(run, 60_000);
    this.timer = setInterval(run, minutes * 60_000);
  }

  onModuleDestroy() {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  async runOnce(now = new Date()) {
    const settings = await this.workflows.settings();
    const sent = { due: 0, overdue: 0, tasks: 0 };
    const pubs = await this.prisma.publication.findMany({
      where: { current: true },
      select: { entityType: true, entityId: true },
    });
    const ids = (t: ContentType) => pubs.filter((p) => p.entityType === t).map((p) => p.entityId);
    const window = addDays(now, settings.reminderDays);
    const [processes, pages] = await Promise.all([
      this.prisma.process.findMany({
        where: {
          id: { in: ids('PROCESS') },
          deletedAt: null,
          status: { not: 'ARCHIVED' },
          nextReviewAt: { lte: window },
        },
      }),
      this.prisma.page.findMany({
        where: {
          id: { in: ids('PAGE') },
          deletedAt: null,
          status: { not: 'ARCHIVED' },
          nextReviewAt: { lte: window },
          space: { deletedAt: null },
        },
        include: { space: { select: { ownerId: true } } },
      }),
    ]);
    const items = [
      ...processes.map((p) => ({
        type: 'PROCESS' as const,
        id: p.id,
        ownerId: p.ownerId,
        at: p.nextReviewAt!,
        params: { titleEn: p.nameEn, titleAr: p.nameAr, code: p.code },
        link: itemLink({ type: 'PROCESS', id: p.id }),
      })),
      ...pages.map((p) => ({
        type: 'PAGE' as const,
        id: p.id,
        ownerId: p.ownerId ?? p.space.ownerId,
        at: p.nextReviewAt!,
        params: { titleEn: p.titleEn, titleAr: p.titleAr },
        link: itemLink({ type: 'PAGE', id: p.id, spaceId: p.spaceId }),
      })),
    ];
    for (const i of items) {
      const overdue = i.at <= now;
      const type = overdue ? 'REVIEW_OVERDUE' : 'REVIEW_DUE';
      const n = await this.notifications.notify({
        userIds: [i.ownerId],
        type,
        entityType: i.type,
        entityId: i.id,
        params: { ...i.params, due: i.at.toISOString(), kind: 'periodic' },
        link: i.link,
        dedupeKey: `${type}:${i.type}:${i.id}:${day(i.at)}`,
      });
      if (n) sent[overdue ? 'overdue' : 'due']++;
    }

    const late = await this.prisma.review.findMany({
      where: { status: 'IN_PROGRESS', dueAt: { lt: now }, overdueNotifiedAt: null },
      include: { tasks: { where: { status: 'PENDING' } } },
    });
    for (const r of late) {
      const item =
        r.entityType === 'PROCESS'
          ? await this.prisma.process.findUnique({ where: { id: r.entityId } })
          : await this.prisma.page.findUnique({ where: { id: r.entityId } });
      if (!item) continue;
      const params: Record<string, string> =
        'code' in item
          ? { titleEn: item.nameEn, titleAr: item.nameAr, code: item.code }
          : { titleEn: item.titleEn, titleAr: item.titleAr };
      await this.notifications.notify({
        userIds: r.tasks.map((t) => t.assigneeId),
        type: 'REVIEW_OVERDUE',
        entityType: r.entityType,
        entityId: r.entityId,
        params: { ...params, due: r.dueAt!.toISOString(), kind: 'task', version: r.versionNumber },
        link: `/reviews/${r.id}`,
        dedupeKey: `REVIEW_OVERDUE:review:${r.id}`,
      });
      await this.prisma.review.update({ where: { id: r.id }, data: { overdueNotifiedAt: now } });
      sent.tasks++;
    }
    if (sent.due + sent.overdue + sent.tasks) {
      this.logger.log(
        `Reminders: ${sent.due} due, ${sent.overdue} overdue, ${sent.tasks} late reviews`,
      );
    }
    return sent;
  }
}
