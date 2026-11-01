import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, type Webhook, type WebhookDelivery } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_DISABLE_AFTER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_RETRY_MINUTES,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type TeamsLanguage,
  type WebhookEventType,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { DomainEvents, type DomainEvent, type IntegrationEvent } from '../events/domain-events';
import { NotificationsService } from '../notifications/notifications.service';
import { SecretBox } from '../integrations/secret-box';
import { startPeriodic, type Periodic } from '../common/periodic';
import { AppException } from '../common/app-exception';
import { checkDestination } from './destination-guard';
import { buildPayload, teamsCard } from './payloads';
import { signWebhook } from './webhook-signature';
import { WebhookHttp } from './webhook-http';
import { WebhookSettingsService } from './webhook-settings.service';

const STALE_LOCK_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

/** One line for the delivery log; never contains the URL (its query string can be a secret). */
function errorText(err: unknown, url?: string): string {
  let msg =
    err instanceof AppException
      ? err.code
      : ((err as Error)?.message ?? 'error').replace(/\s+/g, ' ').slice(0, 300);
  if (url) msg = msg.split(url).join('<url>');
  return msg;
}

/**
 * Delivers webhook and Teams events (D-174, D-176): domain events become one `WebhookDelivery` row
 * per matching destination (department / process-house branch filters), sent by a worker that claims
 * due rows (persisted queue, survives restarts), signs them, retries with backoff
 * (WEBHOOK_RETRY_MINUTES) and switches a destination off after WEBHOOK_DISABLE_AFTER failed attempts
 * in a row (Super Admins and the creator are notified).
 */
@Injectable()
export class WebhookDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDispatcher.name);
  private readonly box: SecretBox | null;
  private unsubscribe?: () => void;
  private poller?: Periodic;
  private purge?: Periodic;
  private running: Promise<void> | null = null;
  private again = false;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly http: WebhookHttp,
    private readonly settings: WebhookSettingsService,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.box = config.INTEGRATIONS_ENCRYPTION_KEY
      ? new SecretBox(config.INTEGRATIONS_ENCRYPTION_KEY)
      : null;
  }

  onModuleInit() {
    this.unsubscribe = this.events.on((e) => {
      const work = this.handle(e).then(
        () => undefined,
        (err: Error) => this.logger.error(`Webhook event ${e.type} failed: ${err.message}`),
      );
      this.pending = Promise.all([this.pending, work]);
      return work;
    });
    if (this.config.NODE_ENV === 'test') return;
    const seconds = this.config.WEBHOOK_POLL_SECONDS;
    if (seconds) {
      this.poller = startPeriodic(
        'Webhook deliveries',
        () => this.runOnce(),
        10_000,
        seconds * 1000,
        this.logger,
      );
    }
    this.purge = startPeriodic(
      'Webhook delivery log retention',
      () => this.purgeOld(),
      5 * 60_000,
      12 * 3600_000,
      this.logger,
    );
  }

  onModuleDestroy() {
    this.unsubscribe?.();
    this.poller?.stop();
    this.purge?.stop();
  }

  /** Resolves when queued events are turned into deliveries and the worker is idle (tests). */
  async whenIdle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 10));
      await this.pending;
      await this.running;
    }
  }

  // ---------- events → deliveries ----------

  async handle(e: DomainEvent): Promise<number> {
    let event: IntegrationEvent | null = null;
    if (e.type === 'integration') {
      event = e;
      // Pages of view-restricted spaces are not announced outside ProcessHub.
      if (e.entity.type === 'PAGE') {
        const page = await this.prisma.page.findUnique({
          where: { id: e.entity.id },
          select: { space: { select: { viewRestricted: true } } },
        });
        if (!page || page.space.viewRestricted) return 0;
      }
    } else if (e.type === 'content.published' || e.type === 'content.unpublished')
      event = await this.contentEvent(e);
    if (!event) return 0;
    const created = await this.enqueue(event);
    if (created) this.kick();
    return created;
  }

  private async contentEvent(
    e: Extract<DomainEvent, { type: 'content.published' | 'content.unpublished' }>,
  ): Promise<IntegrationEvent | null> {
    const published = e.type === 'content.published';
    const suffix = published ? 'published' : 'archived';
    const pub = published
      ? await this.prisma.publication.findFirst({
          where: { entityType: e.entityType, entityId: e.entityId, current: true },
        })
      : null;
    const data: Record<string, string | number | null> = pub
      ? {
          version: pub.versionLabel
            ? `${pub.versionNumber} (${pub.versionLabel})`
            : pub.versionNumber,
        }
      : {};
    if (e.entityType === 'PROCESS') {
      const p = await this.prisma.process.findUnique({ where: { id: e.entityId } });
      if (!p) return null;
      return {
        type: 'integration',
        event: `process.${suffix}` as WebhookEventType,
        entity: {
          type: 'PROCESS',
          id: p.id,
          code: pub?.code ?? p.code,
          nameEn: pub?.titleEn ?? p.nameEn,
          nameAr: pub?.titleAr ?? p.nameAr,
        },
        departmentId: p.departmentId,
        processId: p.id,
        ownerId: p.ownerId,
        link: `/processes/${p.id}`,
        data,
      };
    }
    if (e.entityType === 'PAGE') {
      const p = await this.prisma.page.findUnique({
        where: { id: e.entityId },
        include: { space: { select: { departmentId: true, viewRestricted: true } } },
      });
      // Pages of view-restricted spaces are not announced outside ProcessHub.
      if (!p || p.space.viewRestricted) return null;
      return {
        type: 'integration',
        event: `page.${suffix}` as WebhookEventType,
        entity: {
          type: 'PAGE',
          id: p.id,
          code: null,
          nameEn: pub?.titleEn ?? p.titleEn,
          nameAr: pub?.titleAr ?? p.titleAr,
        },
        departmentId: p.space.departmentId,
        processId: null,
        ownerId: p.ownerId,
        link: `/docs/${p.spaceId}/pages/${p.id}`,
        data,
      };
    }
    const d = await this.prisma.diagram.findUnique({ where: { id: e.entityId } });
    if (!d) return null;
    return {
      type: 'integration',
      event: `diagram.${suffix}` as WebhookEventType,
      entity: { type: 'DIAGRAM', id: d.id, code: d.code, nameEn: d.nameEn, nameAr: d.nameAr },
      departmentId: d.departmentId,
      processId: d.processId,
      ownerId: d.ownerId,
      link: `/diagrams/${d.id}`,
      data: { ...data, kind: d.type },
    };
  }

  private async ancestors(processId: string | null): Promise<Set<string>> {
    const out = new Set<string>();
    let id = processId;
    for (let i = 0; id && i < 30 && !out.has(id); i++) {
      out.add(id);
      const p = await this.prisma.process.findUnique({
        where: { id },
        select: { parentId: true },
      });
      id = p?.parentId ?? null;
    }
    return out;
  }

  /** Creates the deliveries of one event; returns how many. */
  async enqueue(event: IntegrationEvent): Promise<number> {
    const hooks = await this.prisma.webhook.findMany({
      where: { active: true, deletedAt: null, disabledAt: null, events: { has: event.event } },
    });
    if (!hooks.length) return 0;
    const chain = hooks.some((h) => h.processBranchId)
      ? await this.ancestors(event.processId)
      : new Set<string>();
    const matching = hooks.filter(
      (h) =>
        (!h.departmentIds.length ||
          (!!event.departmentId && h.departmentIds.includes(event.departmentId))) &&
        (!h.processBranchId || chain.has(h.processBranchId)),
    );
    if (!matching.length) return 0;
    const eventId = randomUUID();
    const payload = buildPayload(event, this.config.APP_URL, eventId);
    const owner =
      matching.some((h) => h.kind === 'TEAMS') && event.ownerId
        ? await this.prisma.user.findUnique({
            where: { id: event.ownerId },
            select: { nameEn: true, nameAr: true },
          })
        : null;
    await this.prisma.webhookDelivery.createMany({
      data: matching.map((h) => ({
        webhookId: h.id,
        eventId,
        eventType: event.event,
        payload: (h.kind === 'TEAMS'
          ? teamsCard({ ...payload, owner }, h.language as TeamsLanguage)
          : payload) as unknown as Prisma.InputJsonValue,
      })),
    });
    return matching.length;
  }

  // ---------- worker ----------

  /** Starts a run soon (new deliveries); a run in progress picks them up afterwards. */
  kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.runOnce()
      .then(
        () => undefined,
        (err: Error) => this.logger.error(`Webhook run failed: ${err.message}`),
      )
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  /** Sends every due delivery (batches of 20); returns how many were attempted. */
  async runOnce(now = new Date()): Promise<number> {
    let attempted = 0;
    for (let round = 0; round < 50; round++) {
      const due = await this.prisma.webhookDelivery.findMany({
        where: {
          status: 'PENDING',
          nextAttemptAt: { lte: now },
          OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } }],
        },
        orderBy: { nextAttemptAt: 'asc' },
        take: 20,
        select: { id: true },
      });
      if (!due.length) break;
      for (const d of due) {
        if (await this.attempt(d.id)) attempted++;
      }
    }
    return attempted;
  }

  /** Claims one delivery and sends it; false when another worker had it. */
  async attempt(id: string): Promise<boolean> {
    const claimed = await this.prisma.webhookDelivery.updateMany({
      where: {
        id,
        status: 'PENDING',
        OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } }],
      },
      data: { lockedAt: new Date() },
    });
    if (claimed.count !== 1) return false;
    const d = await this.prisma.webhookDelivery.findUniqueOrThrow({
      where: { id },
      include: { webhook: true },
    });
    await this.send(d, d.webhook);
    return true;
  }

  private async send(d: WebhookDelivery, hook: Webhook): Promise<void> {
    if (!d.test && (!hook.active || hook.disabledAt || hook.deletedAt)) {
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: 'GAVE_UP',
          lockedAt: null,
          nextAttemptAt: null,
          lastError: 'DESTINATION_OFF',
        },
      });
      return;
    }
    let url = '';
    const started = Date.now();
    try {
      if (!this.box) throw new AppException(400, 'ENCRYPTION_KEY_MISSING');
      url = this.box.decrypt(hook.urlSealed);
      const settings = await this.settings.get();
      // Again before sending: the allow-list may have changed (resolution happens in the sender).
      await checkDestination(url, hook.kind, settings, this.http.policy, { resolve: false });
      const body = JSON.stringify(d.payload);
      const headers: Record<string, string> = {
        'user-agent': 'ProcessHub-Webhook/1',
        [WEBHOOK_EVENT_HEADER]: d.eventType,
        [WEBHOOK_DELIVERY_HEADER]: d.eventId,
      };
      if (hook.kind === 'WEBHOOK' && hook.secretSealed) {
        const ts = Math.floor(Date.now() / 1000);
        headers[WEBHOOK_TIMESTAMP_HEADER] = String(ts);
        headers[WEBHOOK_SIGNATURE_HEADER] = signWebhook(
          this.box.decrypt(hook.secretSealed),
          ts,
          body,
        );
      }
      const res = await this.http.post(url, body, headers);
      const ok = res.status >= 200 && res.status < 300;
      await this.finish(d, hook, {
        ok,
        statusCode: res.status,
        error: ok
          ? null
          : res.status >= 300 && res.status < 400
            ? `REDIRECT_NOT_FOLLOWED (${res.status})`
            : `HTTP ${res.status}`,
        snippet: res.body.slice(0, 500),
        durationMs: Date.now() - started,
      });
    } catch (err) {
      await this.finish(d, hook, {
        ok: false,
        statusCode: null,
        error: errorText(err, url),
        snippet: null,
        durationMs: Date.now() - started,
      });
    }
  }

  private async finish(
    d: WebhookDelivery,
    hook: Webhook,
    r: {
      ok: boolean;
      statusCode: number | null;
      error: string | null;
      snippet: string | null;
      durationMs: number;
    },
  ) {
    const attempts = d.attempts + 1;
    const now = new Date();
    const retryIn = WEBHOOK_RETRY_MINUTES[attempts - 1];
    const status = r.ok ? 'SUCCEEDED' : d.test || retryIn === undefined ? 'GAVE_UP' : 'PENDING';
    await this.prisma.webhookDelivery.update({
      where: { id: d.id },
      data: {
        status,
        attempts,
        lockedAt: null,
        lastStatusCode: r.statusCode,
        lastError: r.error,
        responseSnippet: r.snippet,
        durationMs: r.durationMs,
        deliveredAt: r.ok ? now : null,
        nextAttemptAt: status === 'PENDING' ? new Date(now.getTime() + retryIn! * 60_000) : null,
      },
    });
    if (d.test) return;
    if (r.ok) {
      if (hook.consecutiveFailures) {
        await this.prisma.webhook.update({
          where: { id: hook.id },
          data: { consecutiveFailures: 0 },
        });
      }
      return;
    }
    const updated = await this.prisma.webhook.update({
      where: { id: hook.id },
      data: { consecutiveFailures: { increment: 1 } },
    });
    if (updated.consecutiveFailures >= WEBHOOK_DISABLE_AFTER && !updated.disabledAt) {
      await this.disable(updated, r.error ?? 'error');
    }
  }

  private async disable(hook: Webhook, reason: string) {
    await this.prisma.$transaction([
      this.prisma.webhook.update({
        where: { id: hook.id },
        data: { disabledAt: new Date(), disabledReason: reason.slice(0, 300) },
      }),
      this.prisma.webhookDelivery.updateMany({
        where: { webhookId: hook.id, status: 'PENDING' },
        data: {
          status: 'GAVE_UP',
          nextAttemptAt: null,
          lockedAt: null,
          lastError: 'DESTINATION_DISABLED',
        },
      }),
    ]);
    this.logger.warn(`Destination "${hook.name}" switched off after repeated failures: ${reason}`);
    const admins = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        roles: { some: { role: { key: 'SUPER_ADMIN' } } },
      },
      select: { id: true },
    });
    await this.notifications.notify({
      userIds: [...admins.map((a) => a.id), hook.createdById],
      type: 'INTEGRATION',
      params: {
        kind: 'webhookDisabled',
        titleEn: hook.name,
        titleAr: hook.name,
        comment: `${WEBHOOK_DISABLE_AFTER}× ${reason}`.slice(0, 200),
      },
      link: `/settings/integrations?tab=${hook.kind === 'TEAMS' ? 'teams' : 'webhooks'}`,
      dedupeKey: `WEBHOOK_DISABLED:${hook.id}:${new Date().toISOString().slice(0, 10)}`,
    });
  }

  async purgeOld(): Promise<number> {
    const { retentionDays } = await this.settings.get();
    const { count } = await this.prisma.webhookDelivery.deleteMany({
      where: {
        createdAt: { lt: new Date(Date.now() - retentionDays * DAY_MS) },
        status: { not: 'PENDING' },
      },
    });
    return count;
  }
}
