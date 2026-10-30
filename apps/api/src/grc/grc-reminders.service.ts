import { Injectable, Logger } from '@nestjs/common';
import { addDays, type GrcObjectType, type GrcReviewTaskDto } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GrcSettingsService } from './grc-settings.service';

const PATHS: Record<GrcObjectType, string> = {
  RISK: '/grc/risks',
  CONTROL: '/grc/controls',
  REQUIREMENT: '/grc/requirements',
};
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Next-review reminders of risks, controls and requirements (Phase 4.1): the owner is notified
 * once when the review comes within `reminderDaysBefore` days and once when it is overdue
 * (notification GRC_REVIEW, run by the governance scheduler); the same items appear in the
 * owner's "My tasks".
 */
@Injectable()
export class GrcRemindersService {
  private readonly logger = new Logger(GrcRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: GrcSettingsService,
  ) {}

  /** Active items with a review due within the reminder window (optionally of one owner). */
  async dueItems(now = new Date(), ownerId?: string): Promise<GrcReviewTaskDto[]> {
    const { reminderDaysBefore } = await this.settings.get();
    const window = addDays(now, reminderDaysBefore);
    const due = { status: 'ACTIVE' as const, nextReviewAt: { lte: window } };
    const rows = await this.prisma.repoObject.findMany({
      where: {
        deletedAt: null,
        ...(ownerId ? { ownerId } : { ownerId: { not: null } }),
        OR: [{ risk: due }, { control: due }, { requirement: due }],
      },
      include: {
        risk: { select: { nextReviewAt: true } },
        control: { select: { nextReviewAt: true } },
        requirement: { select: { nextReviewAt: true } },
      },
    });
    return rows
      .map((o) => {
        const at = (o.risk ?? o.control ?? o.requirement)!.nextReviewAt!;
        const type = o.type as GrcObjectType;
        return {
          id: o.id,
          type,
          code: o.code,
          nameEn: o.nameEn,
          nameAr: o.nameAr,
          ownerId: o.ownerId,
          nextReviewAt: at.toISOString(),
          overdue: at <= now,
          link: `${PATHS[type]}/${o.id}`,
        };
      })
      .sort((a, b) => a.nextReviewAt.localeCompare(b.nextReviewAt));
  }

  async runOnce(now = new Date()) {
    let sent = 0;
    for (const i of await this.dueItems(now)) {
      const kind = i.overdue ? 'overdue' : 'due';
      sent += await this.notifications.notify({
        userIds: [i.ownerId],
        type: 'GRC_REVIEW',
        params: {
          kind,
          itemType: i.type,
          code: i.code ?? '',
          titleEn: i.nameEn,
          titleAr: i.nameAr,
          due: i.nextReviewAt,
        },
        link: i.link,
        dedupeKey: `GRC_REVIEW:${kind}:${i.id}:${day(new Date(i.nextReviewAt))}`,
      });
    }
    if (sent) this.logger.log(`Risk & Compliance review reminders: ${sent}`);
    return sent;
  }
}
