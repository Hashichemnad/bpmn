import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, type ReportSubscription } from '@prisma/client';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BusinessCalendar,
  DEFAULT_REPORT_SETTINGS,
  DEFAULT_UAE_HOLIDAYS,
  DEFAULT_WORKFLOW_SETTINGS,
  PERMISSIONS,
  SETTING_KEYS,
  holidayListSchema,
  nextReportRun,
  reportSettingsSchema,
  workflowSettingsSchema,
  type Locale,
  type ReportDeliveryDto,
  type ReportFormat,
  type ReportSettings,
  type ReportSubscriptionDto,
  type ReportSubscriptionInput,
  type ScheduledReport,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { RendererService } from '../renderer/renderer.service';
import { AuthUserLoader } from '../auth/auth-user.loader';
import { EmailSettingsService } from '../notifications/email-settings.service';
import { MailTransport } from '../notifications/mail-transport';
import { NotificationsService } from '../notifications/notifications.service';
import { MiningJobsService } from '../mining/jobs/mining-jobs.service';
import { ExportDataService } from '../exports/export-data.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AppException, badRequest, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { startPeriodic, type Periodic } from '../common/periodic';
import { streamToBuffer } from '../common/streams';
import { ReportBuilders, ReportNotAllowed, mayReceive } from './report-builders';
import { reportEmail, reportExcel, reportHtml } from './report-render';

const MAX_RECIPIENTS = 500;
const MAX_ATTACHMENT = 10 * 1024 * 1024;
const DAY_MS = 86_400_000;

type Sub = ReportSubscription;

const userSelect = { id: true, nameEn: true, nameAr: true, email: true } as const;

/**
 * Scheduled report e-mails (Phase 4.4, D-179): subscriptions (users for themselves, Admins for a
 * role or department), a scheduler that hands due runs to the job runner, generation per recipient
 * with the recipient's permissions, PDF (renderer) / Excel / link only, secure download links,
 * unsubscribe links, delivery log, failure notifications.
 */
@Injectable()
export class SubscriptionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionsService.name);
  private periodic?: Periodic;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly renderer: RendererService,
    private readonly users: AuthUserLoader,
    private readonly email: EmailSettingsService,
    private readonly mail: MailTransport,
    private readonly notifications: NotificationsService,
    private readonly jobs: MiningJobsService,
    private readonly builders: ReportBuilders,
    private readonly exportData: ExportDataService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.jobs.register('REPORT_SEND', async (ctx) => {
      const p = (ctx.job.params ?? {}) as { subscriptionId?: string };
      if (!p.subscriptionId) return { sent: 0 };
      return this.run(p.subscriptionId);
    });
    if (this.config.NODE_ENV === 'test' || !this.config.SCHEDULER_INTERVAL_MINUTES) return;
    this.periodic = startPeriodic(
      'Scheduled reports',
      () => this.tick(),
      60_000,
      60_000,
      this.logger,
    );
  }

  onModuleDestroy() {
    this.periodic?.stop();
  }

  // ---------- settings ----------

  async settings(): Promise<ReportSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.REPORTS } });
    const parsed = reportSettingsSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : DEFAULT_REPORT_SETTINGS;
  }

  async updateSettings(input: ReportSettings, actor: AuthUser, meta: RequestMeta) {
    const before = await this.settings();
    const value = input as unknown as Prisma.InputJsonValue;
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.REPORTS },
        create: { key: SETTING_KEYS.REPORTS, value, updatedById: actor.id },
        update: { value, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: SETTING_KEYS.REPORTS,
          userId: actor.id,
          summary: { before, after: input },
          meta,
        },
        tx,
      );
    });
    return this.settings();
  }

  // ---------- schedule ----------

  private async isWorkDay(): Promise<(iso: string) => boolean> {
    const [wf, hol] = await Promise.all([
      this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.WORKFLOW } }),
      this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.MINING_HOLIDAYS } }),
    ]);
    const settings = workflowSettingsSchema.safeParse(wf?.value ?? {});
    const holidays = holidayListSchema.safeParse(hol?.value ?? {});
    const cal = new BusinessCalendar(
      (settings.success ? settings.data : DEFAULT_WORKFLOW_SETTINGS).calendar,
      (holidays.success ? holidays.data.holidays : DEFAULT_UAE_HOLIDAYS).map((h) => h.date),
    );
    return (iso: string) => cal.isWorkDay(Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS));
  }

  async nextRun(
    s: Pick<
      ReportSubscriptionInput,
      'frequency' | 'weekday' | 'monthDay' | 'time' | 'skipHolidays'
    >,
    after = new Date(),
  ) {
    return nextReportRun(s, after, await this.isWorkDay());
  }

  private lastPurge = 0;

  /** Hands every due subscription to the job runner (claimed by moving `nextRunAt`). */
  async tick(now = new Date()): Promise<number> {
    if (now.getTime() - this.lastPurge > 3600_000) {
      this.lastPurge = now.getTime();
      await this.purgeExpired();
    }
    const due = await this.prisma.reportSubscription.findMany({
      where: { active: true, deletedAt: null, nextRunAt: { lte: now } },
      take: 50,
    });
    let queued = 0;
    for (const s of due) {
      const next = await this.nextRun(this.scheduleOf(s), now);
      const claimed = await this.prisma.reportSubscription.updateMany({
        where: { id: s.id, nextRunAt: s.nextRunAt },
        data: { nextRunAt: next, lastRunAt: now },
      });
      if (claimed.count !== 1) continue;
      await this.jobs.enqueue({
        kind: 'REPORT_SEND',
        params: { subscriptionId: s.id },
        userId: s.ownerId,
      });
      queued++;
    }
    return queued;
  }

  private scheduleOf(s: Sub) {
    return {
      frequency: s.frequency as ReportSubscriptionInput['frequency'],
      weekday: s.weekday,
      monthDay: s.monthDay,
      time: s.time,
      skipHolidays: s.skipHolidays,
    };
  }

  // ---------- management ----------

  private manages(user: AuthUser) {
    return user.permissions.has(PERMISSIONS.USERS_MANAGE);
  }

  private canEdit(s: Sub, user: AuthUser) {
    return s.ownerId === user.id || this.manages(user);
  }

  private async load(id: string): Promise<Sub> {
    const s = await this.prisma.reportSubscription.findFirst({ where: { id, deletedAt: null } });
    if (!s) throw notFound('Subscription');
    return s;
  }

  /** Own subscriptions, those that reach the user through a role / department, all for Admins. */
  async list(user: AuthUser): Promise<ReportSubscriptionDto[]> {
    const roleIds = (
      await this.prisma.userRole.findMany({ where: { userId: user.id }, select: { roleId: true } })
    ).map((r) => r.roleId);
    const rows = await this.prisma.reportSubscription.findMany({
      where: {
        deletedAt: null,
        ...(this.manages(user)
          ? {}
          : {
              OR: [
                { ownerId: user.id },
                { audience: 'ROLE', roleId: { in: roleIds } },
                ...(user.departmentId
                  ? [{ audience: 'DEPARTMENT', audienceDepartmentId: user.departmentId }]
                  : []),
              ],
            }),
      },
      orderBy: { createdAt: 'desc' },
      include: { unsubscribes: { where: { userId: user.id } } },
    });
    const owners = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.ownerId) } },
      select: userSelect,
    });
    const byId = new Map(owners.map((o) => [o.id, o]));
    return rows.map((s) => ({
      ...this.toInput(s),
      id: s.id,
      owner: byId.get(s.ownerId) ?? null,
      unsubscribed: s.unsubscribes.length > 0,
      nextRunAt: s.nextRunAt?.toISOString() ?? null,
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
      canEdit: this.canEdit(s, user),
      createdAt: s.createdAt.toISOString(),
    }));
  }

  private toInput(s: Sub): ReportSubscriptionInput {
    return {
      name: s.name,
      report: s.report as ScheduledReport,
      filters: (s.filters ?? {}) as ReportSubscriptionInput['filters'],
      format: s.format as ReportFormat,
      ...this.scheduleOf(s),
      locale: (s.locale as Locale | null) ?? null,
      audience: s.audience as ReportSubscriptionInput['audience'],
      roleId: s.roleId,
      audienceDepartmentId: s.audienceDepartmentId,
      active: s.active,
    };
  }

  private async check(input: ReportSubscriptionInput, user: AuthUser) {
    if (input.audience !== 'SELF' && !this.manages(user))
      throw forbidden('Only administrators send reports to roles or departments');
    if (input.audience === 'SELF' && !mayReceive(input.report, user))
      throw forbidden('You cannot see this report');
    if (input.roleId && !(await this.prisma.role.findUnique({ where: { id: input.roleId } })))
      throw badRequest('ROLE_NOT_FOUND');
    for (const d of [input.audienceDepartmentId, input.filters.departmentId]) {
      if (d && !(await this.prisma.department.findFirst({ where: { id: d, deletedAt: null } })))
        throw badRequest('DEPARTMENT_NOT_FOUND');
    }
    if (
      input.filters.processId &&
      !(await this.prisma.process.findFirst({
        where: { id: input.filters.processId, deletedAt: null },
      }))
    )
      throw badRequest('PROCESS_NOT_FOUND');
  }

  private data(input: ReportSubscriptionInput) {
    return {
      name: input.name,
      report: input.report,
      filters: input.filters as Prisma.InputJsonValue,
      format: input.format,
      frequency: input.frequency,
      weekday: input.weekday,
      monthDay: input.monthDay,
      time: input.time,
      skipHolidays: input.skipHolidays,
      locale: input.locale,
      audience: input.audience,
      roleId: input.audience === 'ROLE' ? input.roleId : null,
      audienceDepartmentId: input.audience === 'DEPARTMENT' ? input.audienceDepartmentId : null,
      active: input.active,
    };
  }

  async create(input: ReportSubscriptionInput, user: AuthUser, meta: RequestMeta) {
    await this.check(input, user);
    const s = await this.prisma.reportSubscription.create({
      data: {
        ...this.data(input),
        ownerId: user.id,
        createdById: user.id,
        updatedById: user.id,
        nextRunAt: input.active ? await this.nextRun(input) : null,
      },
    });
    await this.audit.log({
      action: 'CREATE',
      entityType: 'ReportSubscription',
      entityId: s.id,
      userId: user.id,
      summary: { after: this.toInput(s) },
      meta,
    });
    return (await this.list(user)).find((x) => x.id === s.id)!;
  }

  async update(id: string, input: ReportSubscriptionInput, user: AuthUser, meta: RequestMeta) {
    const before = await this.load(id);
    if (!this.canEdit(before, user)) throw forbidden();
    await this.check(input, user);
    const s = await this.prisma.reportSubscription.update({
      where: { id },
      data: {
        ...this.data(input),
        updatedById: user.id,
        nextRunAt: input.active ? await this.nextRun(input) : null,
      },
    });
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'ReportSubscription',
      entityId: id,
      userId: user.id,
      summary: { before: this.toInput(before), after: this.toInput(s) },
      meta,
    });
    return (await this.list(user)).find((x) => x.id === s.id)!;
  }

  async remove(id: string, user: AuthUser, meta: RequestMeta) {
    const s = await this.load(id);
    if (!this.canEdit(s, user)) throw forbidden();
    await this.prisma.reportSubscription.update({
      where: { id },
      data: { deletedAt: new Date(), active: false, nextRunAt: null },
    });
    await this.audit.log({
      action: 'DELETE',
      entityType: 'ReportSubscription',
      entityId: id,
      userId: user.id,
      summary: { before: this.toInput(s) },
      meta,
    });
  }

  async deliveries(id: string, user: AuthUser): Promise<ReportDeliveryDto[]> {
    const s = await this.load(id);
    const rows = await this.prisma.reportDelivery.findMany({
      where: { subscriptionId: id, ...(this.canEdit(s, user) ? {} : { userId: user.id }) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const people = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: userSelect,
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    return rows.map((d) => ({
      id: d.id,
      user: byId.get(d.userId) ?? null,
      status: d.status as ReportDeliveryDto['status'],
      error: d.error,
      format: d.format as ReportFormat,
      attached: d.attached,
      fileName: d.fileName,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  /** "Send now": one run for the signed-in user only (a test of the e-mail). */
  async sendNow(id: string, user: AuthUser): Promise<ReportDeliveryDto> {
    const s = await this.load(id);
    if (!this.canEdit(s, user) && !(await this.recipients(s)).includes(user.id)) throw forbidden();
    const deliveryId = await this.deliver(s, user.id, await this.settings(), {
      notifyFailure: false,
    });
    return (await this.deliveries(id, user)).find((d) => d.id === deliveryId)!;
  }

  // ---------- runs ----------

  private async recipients(s: Sub): Promise<string[]> {
    const where: Prisma.UserWhereInput = { deletedAt: null, status: 'ACTIVE' };
    let ids: string[];
    if (s.audience === 'SELF') ids = [s.ownerId];
    else if (s.audience === 'ROLE' && s.roleId)
      ids = (
        await this.prisma.user.findMany({
          where: { ...where, roles: { some: { roleId: s.roleId } } },
          select: { id: true },
          take: MAX_RECIPIENTS,
        })
      ).map((u) => u.id);
    else if (s.audience === 'DEPARTMENT' && s.audienceDepartmentId)
      ids = (
        await this.prisma.user.findMany({
          where: { ...where, departmentId: s.audienceDepartmentId },
          select: { id: true },
          take: MAX_RECIPIENTS,
        })
      ).map((u) => u.id);
    else ids = [];
    const out = new Set(
      (await this.prisma.reportUnsubscribe.findMany({ where: { subscriptionId: s.id } })).map(
        (u) => u.userId,
      ),
    );
    return ids.filter((id) => !out.has(id));
  }

  /** One scheduled run: a delivery per recipient. */
  async run(subscriptionId: string): Promise<{ sent: number; failed: number; skipped: number }> {
    const s = await this.prisma.reportSubscription.findFirst({
      where: { id: subscriptionId, deletedAt: null, active: true },
    });
    if (!s) return { sent: 0, failed: 0, skipped: 0 };
    const settings = await this.settings();
    const counts = { sent: 0, failed: 0, skipped: 0 };
    for (const userId of await this.recipients(s)) {
      const id = await this.deliver(s, userId, settings, { notifyFailure: true });
      const d = await this.prisma.reportDelivery.findUnique({
        where: { id },
        select: { status: true },
      });
      if (d?.status === 'SENT') counts.sent++;
      else if (d?.status === 'FAILED') counts.failed++;
      else counts.skipped++;
    }
    return counts;
  }

  private async deliver(
    s: Sub,
    userId: string,
    settings: ReportSettings,
    opts: { notifyFailure: boolean },
  ): Promise<string> {
    const id = randomUUID();
    const base = { id, subscriptionId: s.id, userId, format: s.format };
    const user = await this.users.load(userId);
    if (!user) {
      await this.prisma.reportDelivery.create({
        data: { ...base, status: 'SKIPPED', error: 'USER_INACTIVE' },
      });
      return id;
    }
    const l: Locale = (s.locale as Locale | null) ?? user.locale ?? 'en';
    try {
      const smtp = await this.email.smtp();
      const content = await this.builders.build(
        s.report as ScheduledReport,
        (s.filters ?? {}) as ReportSubscriptionInput['filters'],
        user,
        l,
        s.format === 'PDF',
      );
      let file: { data: Buffer; contentType: string; ext: string };
      let note: string | null = null;
      if (s.format === 'PDF') {
        const brand = await this.exportData.branding();
        const pdf = await this.renderer.pdf(
          reportHtml(content, l, {
            orgName:
              (l === 'ar'
                ? brand.orgNameAr || brand.orgNameEn
                : brand.orgNameEn || brand.orgNameAr) || 'ProcessHub',
            primary: brand.template.primaryColor,
            logo: brand.logo
              ? `data:${brand.logo.contentType};base64,${brand.logo.data.toString('base64')}`
              : null,
            generatedAt: new Intl.DateTimeFormat(l === 'ar' ? 'ar' : 'en-GB', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Asia/Dubai',
            }).format(new Date()),
          }),
          { landscape: true },
        );
        if (pdf) file = { data: pdf, contentType: 'application/pdf', ext: 'pdf' };
        else {
          note = 'RENDERER_UNAVAILABLE_EXCEL_SENT';
          file = {
            data: await reportExcel(content, l),
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ext: 'xlsx',
          };
        }
      } else {
        file = {
          data: await reportExcel(content, l),
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ext: 'xlsx',
        };
      }
      const fileName = `${s.report.toLowerCase()}_${new Date().toISOString().slice(0, 10)}_${l}.${file.ext}`;
      const fileKey = `report-deliveries/${id}/${fileName}`;
      await this.storage.put(fileKey, file.data, file.contentType);
      const attach =
        settings.allowAttachments && s.format !== 'LINK' && file.data.length <= MAX_ATTACHMENT;
      const delivery = {
        ...base,
        fileKey,
        fileName,
        contentType: file.contentType,
        expiresAt: new Date(Date.now() + settings.linkDays * DAY_MS),
        attached: attach,
      };
      if (!smtp) {
        await this.prisma.reportDelivery.create({
          data: { ...delivery, attached: false, status: 'SKIPPED', error: 'SMTP_NOT_CONFIGURED' },
        });
        return id;
      }
      const link = `${this.config.APP_URL}/reports/deliveries/${id}`;
      const unsubscribe = `${this.config.APP_URL}/unsubscribe/${this.unsubscribeToken(s.id, userId)}`;
      const mail = reportEmail(content, l, s.name, link, unsubscribe, settings.linkDays, attach);
      await this.mail.send(smtp, {
        to: user.email,
        ...mail,
        headers: { 'List-Unsubscribe': `<${unsubscribe}>` },
        attachments: attach
          ? [{ filename: fileName, content: file.data, contentType: file.contentType }]
          : undefined,
      });
      await this.prisma.reportDelivery.create({
        data: { ...delivery, status: 'SENT', error: note },
      });
    } catch (err) {
      if (err instanceof ReportNotAllowed) {
        await this.prisma.reportDelivery.create({
          data: { ...base, status: 'SKIPPED', error: 'NO_PERMISSION' },
        });
        return id;
      }
      const message =
        err instanceof AppException
          ? err.code
          : ((err as Error).message ?? 'error').replace(/\s+/g, ' ').slice(0, 300);
      this.logger.warn(`Scheduled report ${s.id} for ${userId} failed: ${message}`);
      await this.prisma.reportDelivery.create({
        data: { ...base, status: 'FAILED', error: message },
      });
      if (opts.notifyFailure) {
        await this.notifications.notify({
          userIds: [s.ownerId],
          type: 'INTEGRATION',
          params: {
            kind: 'reportFailed',
            titleEn: s.name,
            titleAr: s.name,
            comment: message.slice(0, 200),
          },
          link: '/reports/subscriptions',
          dedupeKey: `REPORT_FAILED:${s.id}:${new Date().toISOString().slice(0, 13)}`,
        });
      }
    }
    return id;
  }

  // ---------- download and unsubscribe ----------

  /** The stored file of a delivery: only for its recipient, while the link is valid. */
  async download(deliveryId: string, user: AuthUser, meta: RequestMeta) {
    const d = await this.prisma.reportDelivery.findUnique({ where: { id: deliveryId } });
    if (!d || d.userId !== user.id || !d.fileKey) throw notFound('Report');
    if (!d.expiresAt || d.expiresAt < new Date())
      throw new AppException(
        HttpStatus.GONE,
        'REPORT_LINK_EXPIRED',
        'This report link has expired',
      );
    const data = await streamToBuffer(await this.storage.get(d.fileKey));
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'ReportSubscription',
      entityId: d.subscriptionId,
      userId: user.id,
      summary: { deliveryId, fileName: d.fileName },
      meta,
    });
    return {
      fileName: d.fileName ?? 'report',
      contentType: d.contentType ?? 'application/octet-stream',
      data,
    };
  }

  private signer() {
    return createHmac('sha256', `${this.config.JWT_ACCESS_SECRET}:report-unsubscribe`);
  }

  unsubscribeToken(subscriptionId: string, userId: string): string {
    const sig = this.signer().update(`${subscriptionId}.${userId}`).digest('base64url');
    return `${subscriptionId}.${userId}.${sig}`;
  }

  /** Public link of every report e-mail: stops this subscription for this recipient. */
  async unsubscribe(token: string) {
    const [subscriptionId, userId, sig] = token.split('.');
    const expected =
      subscriptionId && userId ? this.unsubscribeToken(subscriptionId, userId).split('.')[2] : '';
    const a = Buffer.from(sig ?? '');
    const b = Buffer.from(expected);
    if (!sig || a.length !== b.length || !timingSafeEqual(a, b))
      throw badRequest('INVALID_TOKEN', 'This unsubscribe link is not valid');
    const s = await this.prisma.reportSubscription.findUnique({ where: { id: subscriptionId } });
    if (!s) throw badRequest('INVALID_TOKEN');
    if (s.audience === 'SELF' && s.ownerId === userId) {
      await this.prisma.reportSubscription.update({
        where: { id: s.id },
        data: { active: false, nextRunAt: null },
      });
    } else {
      await this.prisma.reportUnsubscribe.upsert({
        where: { subscriptionId_userId: { subscriptionId, userId } },
        create: { subscriptionId, userId },
        update: {},
      });
    }
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'ReportSubscription',
      entityId: s.id,
      userId,
      summary: { unsubscribed: true },
    });
    return { name: s.name };
  }

  /** Signed-in user: subscribe again to a role / department report. */
  async resubscribe(id: string, user: AuthUser) {
    await this.load(id);
    await this.prisma.reportUnsubscribe.deleteMany({
      where: { subscriptionId: id, userId: user.id },
    });
  }

  async purgeExpired(): Promise<number> {
    const old = await this.prisma.reportDelivery.findMany({
      where: { expiresAt: { lt: new Date() }, fileKey: { not: null } },
      select: { id: true, fileKey: true },
      take: 500,
    });
    for (const d of old) {
      await this.storage.remove(d.fileKey!).catch(() => undefined);
      await this.prisma.reportDelivery.update({ where: { id: d.id }, data: { fileKey: null } });
    }
    return old.length;
  }
}
