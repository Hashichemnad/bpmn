import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  NOTIFICATION_TYPES,
  type ContentType,
  type EmailStatus,
  type Locale,
  type NotificationDto,
  type NotificationListQuery,
  type NotificationPrefsDto,
  type NotificationPrefsInput,
  type NotificationType,
  type Paginated,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { notFound } from '../common/app-exception';
import type { AuthUser } from '../common/auth-user';
import { EmailSettingsService } from './email-settings.service';
import { MailTransport } from './mail-transport';
import { renderEmail, type NotificationParams } from './email-templates';

export interface NotifyInput {
  userIds: (string | null | undefined)[];
  type: NotificationType;
  entityType?: ContentType | null;
  entityId?: string | null;
  params: NotificationParams;
  /** In-app path (also used for the email button). */
  link?: string | null;
  /** The user who caused the notification; never notified about their own action. */
  actorId?: string | null;
  /** Reminders: one notification per user and key. */
  dedupeKey?: string;
}

type Prefs = Record<NotificationType, { inApp: boolean; email: boolean }>;

export function effectivePrefs(stored: unknown): Prefs {
  const raw = (stored && typeof stored === 'object' ? stored : {}) as Partial<
    Record<string, { inApp?: unknown; email?: unknown }>
  >;
  return Object.fromEntries(
    NOTIFICATION_TYPES.map((t) => [
      t,
      { inApp: raw[t]?.inApp !== false, email: raw[t]?.email !== false },
    ]),
  ) as Prefs;
}

const userRef = { id: true, email: true, nameEn: true, nameAr: true } as const;

/**
 * In-app notification centre and email. Emails are sent one at a time after the request
 * (in-process queue); failures are recorded on the notification and never fail the request.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailSettingsService,
    private readonly transport: MailTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Resolves when every queued email has been handled (tests, shutdown). */
  whenIdle(): Promise<void> {
    return this.queue;
  }

  /** Creates the notifications and queues their emails; returns how many were created. */
  async notify(input: NotifyInput): Promise<number> {
    const ids = [...new Set(input.userIds.filter((v): v is string => !!v && v !== input.actorId))];
    if (!ids.length) return 0;
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, email: true, locale: true, notificationPrefs: true },
    });
    const smtpOn = !!(await this.email.smtp());
    const created: { id: string; email: string; locale: Locale }[] = [];
    let count = 0;
    for (const u of users) {
      const pref = effectivePrefs(u.notificationPrefs)[input.type];
      if (!pref.inApp && !pref.email) continue;
      const emailStatus: EmailStatus | null = pref.email ? (smtpOn ? 'PENDING' : 'SKIPPED') : null;
      try {
        const n = await this.prisma.notification.create({
          data: {
            userId: u.id,
            type: input.type,
            entityType: input.entityType ?? null,
            entityId: input.entityId ?? null,
            params: input.params as Prisma.InputJsonValue,
            link: input.link ?? null,
            actorId: input.actorId ?? null,
            inApp: pref.inApp,
            emailStatus,
            dedupeKey: input.dedupeKey ?? null,
          },
        });
        count++;
        if (emailStatus === 'PENDING') {
          created.push({ id: n.id, email: u.email, locale: u.locale === 'ar' ? 'ar' : 'en' });
        }
      } catch (err) {
        // A reminder that was already sent (dedupe key) is skipped quietly.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    if (created.length) this.enqueueEmails(created, input);
    return count;
  }

  private enqueueEmails(
    recipients: { id: string; email: string; locale: Locale }[],
    input: NotifyInput,
  ) {
    const url = input.link ? `${this.config.APP_URL}${input.link}` : this.config.APP_URL;
    this.queue = this.queue
      .then(async () => {
        const smtp = await this.email.smtp();
        for (const r of recipients) {
          if (!smtp) {
            await this.setEmailStatus(r.id, 'SKIPPED', null);
            continue;
          }
          try {
            await this.transport.send(smtp, {
              to: r.email,
              ...renderEmail(input.type, input.params, r.locale, url),
            });
            await this.setEmailStatus(r.id, 'SENT', null);
          } catch (err) {
            let message = ((err as Error).message ?? 'error').slice(0, 300);
            if (smtp.password) message = message.split(smtp.password).join('***');
            this.logger.warn(`Email to ${r.email} failed: ${message}`);
            await this.setEmailStatus(r.id, 'FAILED', message);
          }
        }
      })
      .catch((err: Error) => this.logger.error(`Email queue failed: ${err.message}`));
  }

  private async setEmailStatus(id: string, status: EmailStatus, error: string | null) {
    await this.prisma.notification
      .update({ where: { id }, data: { emailStatus: status, emailError: error } })
      .catch(() => undefined);
  }

  // ---------- Notification centre ----------

  async list(user: AuthUser, q: NotificationListQuery): Promise<Paginated<NotificationDto>> {
    const where: Prisma.NotificationWhereInput = {
      userId: user.id,
      inApp: true,
      ...(q.unread ? { readAt: null } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items: await this.toDtos(rows), total, page: q.page, pageSize: q.pageSize };
  }

  async toDtos(rows: Prisma.NotificationGetPayload<object>[]): Promise<NotificationDto[]> {
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((v): v is string => !!v))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: userRef,
    });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return rows.map((r) => ({
      id: r.id,
      type: r.type as NotificationType,
      entityType: (r.entityType as ContentType | null) ?? null,
      entityId: r.entityId,
      params: (r.params ?? {}) as Record<string, string | number>,
      link: r.link,
      actor: r.actorId ? (byId.get(r.actorId) ?? null) : null,
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      emailStatus: (r.emailStatus as EmailStatus | null) ?? null,
    }));
  }

  async unreadCount(user: AuthUser) {
    const count = await this.prisma.notification.count({
      where: { userId: user.id, inApp: true, readAt: null },
    });
    return { count };
  }

  async markRead(id: string, user: AuthUser) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId: user.id } });
    if (!n) throw notFound('Notification');
    if (!n.readAt) {
      await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    }
    return this.unreadCount(user);
  }

  async markAllRead(user: AuthUser) {
    await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return this.unreadCount(user);
  }

  /** Marks the user's notifications about one item as read (e.g. after opening a review). */
  async markItemRead(user: AuthUser, entityType: ContentType, entityId: string) {
    await this.prisma.notification.updateMany({
      where: { userId: user.id, entityType, entityId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  // ---------- Preferences ----------

  async getPrefs(user: AuthUser): Promise<NotificationPrefsDto> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { notificationPrefs: true },
    });
    return {
      prefs: effectivePrefs(u.notificationPrefs),
      emailEnabled: !!(await this.email.smtp()),
    };
  }

  async setPrefs(user: AuthUser, input: NotificationPrefsInput): Promise<NotificationPrefsDto> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { notificationPrefs: true },
    });
    const merged = { ...effectivePrefs(u.notificationPrefs), ...input.prefs };
    await this.prisma.user.update({
      where: { id: user.id },
      data: { notificationPrefs: merged as Prisma.InputJsonValue },
    });
    return this.getPrefs(user);
  }
}
