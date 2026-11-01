import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Webhook, type WebhookDelivery } from '@prisma/client';
import {
  type Paginated,
  type TeamsLanguage,
  type WebhookCreateInput,
  type WebhookDeliveryDto,
  type WebhookDeliveryQuery,
  type WebhookDto,
  type WebhookEventType,
  type WebhookKind,
  type WebhookSecretDto,
  type WebhookUpdateInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { badRequest, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { SecretBox } from '../integrations/secret-box';
import { checkDestination, displayUrl } from './destination-guard';
import { teamsCard, testPayload } from './payloads';
import { generateWebhookSecret } from './webhook-signature';
import { WebhookDispatcher } from './webhook-dispatcher.service';
import { WebhookHttp } from './webhook-http';
import { WebhookSettingsService } from './webhook-settings.service';

export function toDeliveryDto(d: WebhookDelivery): WebhookDeliveryDto {
  return {
    id: d.id,
    eventId: d.eventId,
    eventType: d.eventType as WebhookEventType | 'test',
    status: d.status,
    attempts: d.attempts,
    nextAttemptAt: d.status === 'PENDING' ? (d.nextAttemptAt?.toISOString() ?? null) : null,
    lastStatusCode: d.lastStatusCode,
    lastError: d.lastError,
    responseSnippet: d.responseSnippet,
    durationMs: d.durationMs,
    test: d.test,
    payload: d.payload,
    createdAt: d.createdAt.toISOString(),
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
  };
}

/**
 * Webhooks and Microsoft Teams destinations (Settings → Integrations, Super Admin; Admins read):
 * create / change / delete, signing secret (shown once), test event, resend, delivery log (D-174).
 */
@Injectable()
export class WebhooksService {
  private readonly box: SecretBox | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: WebhookSettingsService,
    private readonly http: WebhookHttp,
    private readonly dispatcher: WebhookDispatcher,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.box = config.INTEGRATIONS_ENCRYPTION_KEY
      ? new SecretBox(config.INTEGRATIONS_ENCRYPTION_KEY)
      : null;
  }

  private sealer(): SecretBox {
    if (!this.box) throw badRequest('ENCRYPTION_KEY_MISSING');
    return this.box;
  }

  async list(kind?: WebhookKind): Promise<WebhookDto[]> {
    const rows = await this.prisma.webhook.findMany({
      where: { deletedAt: null, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return this.toDtos(rows);
  }

  private async load(id: string): Promise<Webhook> {
    const w = await this.prisma.webhook.findFirst({ where: { id, deletedAt: null } });
    if (!w) throw notFound('Webhook');
    return w;
  }

  async get(id: string): Promise<WebhookDto> {
    return (await this.toDtos([await this.load(id)]))[0];
  }

  private async checkRefs(departmentIds?: string[], processBranchId?: string | null) {
    if (departmentIds?.length) {
      const n = await this.prisma.department.count({
        where: { id: { in: departmentIds }, deletedAt: null },
      });
      if (n !== new Set(departmentIds).size) throw badRequest('DEPARTMENT_NOT_FOUND');
    }
    if (processBranchId) {
      const p = await this.prisma.process.findFirst({
        where: { id: processBranchId, deletedAt: null },
        select: { id: true },
      });
      if (!p) throw badRequest('PROCESS_NOT_FOUND');
    }
  }

  async create(
    input: WebhookCreateInput,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<WebhookSecretDto> {
    const box = this.sealer();
    const url = await checkDestination(
      input.url,
      input.kind,
      await this.settings.get(),
      this.http.policy,
    );
    await this.checkRefs(input.departmentIds, input.processBranchId);
    const secret = input.kind === 'WEBHOOK' ? generateWebhookSecret() : null;
    const hook = await this.prisma.$transaction(async (tx) => {
      const w = await tx.webhook.create({
        data: {
          kind: input.kind,
          name: input.name,
          urlSealed: box.encrypt(url.toString()),
          urlDisplay: displayUrl(url),
          secretSealed: secret ? box.encrypt(secret) : null,
          events: [...new Set(input.events)],
          departmentIds: [...new Set(input.departmentIds)],
          processBranchId: input.processBranchId,
          language: input.language,
          active: input.active,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Webhook',
          entityId: w.id,
          userId: actor.id,
          summary: { after: this.auditView(w) },
          meta,
        },
        tx,
      );
      return w;
    });
    return { webhook: (await this.toDtos([hook]))[0], secret };
  }

  async update(
    id: string,
    input: WebhookUpdateInput,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<WebhookDto> {
    const before = await this.load(id);
    await this.checkRefs(input.departmentIds, input.processBranchId);
    const data: Prisma.WebhookUpdateInput = { updatedById: actor.id };
    if (input.url !== undefined) {
      const url = await checkDestination(
        input.url,
        before.kind,
        await this.settings.get(),
        this.http.policy,
      );
      data.urlSealed = this.sealer().encrypt(url.toString());
      data.urlDisplay = displayUrl(url);
    }
    if (input.name !== undefined) data.name = input.name;
    if (input.events !== undefined) data.events = [...new Set(input.events)];
    if (input.departmentIds !== undefined) data.departmentIds = [...new Set(input.departmentIds)];
    if (input.processBranchId !== undefined) data.processBranchId = input.processBranchId;
    if (input.language !== undefined) data.language = input.language;
    if (input.active !== undefined) {
      data.active = input.active;
      // Switching on again clears an automatic switch-off.
      if (input.active) {
        data.disabledAt = null;
        data.disabledReason = null;
        data.consecutiveFailures = 0;
      }
    }
    const after = await this.prisma.$transaction(async (tx) => {
      const w = await tx.webhook.update({ where: { id }, data });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Webhook',
          entityId: id,
          userId: actor.id,
          summary: {
            before: this.auditView(before),
            after: this.auditView(w),
            urlChanged: input.url !== undefined,
          },
          meta,
        },
        tx,
      );
      return w;
    });
    return (await this.toDtos([after]))[0];
  }

  async rotateSecret(id: string, actor: AuthUser, meta: RequestMeta): Promise<WebhookSecretDto> {
    const hook = await this.load(id);
    if (hook.kind !== 'WEBHOOK') throw badRequest('NO_SECRET_FOR_TEAMS');
    const secret = generateWebhookSecret();
    const w = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.webhook.update({
        where: { id },
        data: { secretSealed: this.sealer().encrypt(secret), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'ROTATE',
          entityType: 'Webhook',
          entityId: id,
          userId: actor.id,
          summary: { name: hook.name },
          meta,
        },
        tx,
      );
      return updated;
    });
    return { webhook: (await this.toDtos([w]))[0], secret };
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const hook = await this.load(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.webhook.update({
        where: { id },
        data: { deletedAt: new Date(), active: false, updatedById: actor.id },
      });
      await tx.webhookDelivery.updateMany({
        where: { webhookId: id, status: 'PENDING' },
        data: { status: 'GAVE_UP', nextAttemptAt: null, lastError: 'DESTINATION_DELETED' },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Webhook',
          entityId: id,
          userId: actor.id,
          summary: { before: this.auditView(hook) },
          meta,
        },
        tx,
      );
    });
  }

  async deliveries(id: string, q: WebhookDeliveryQuery): Promise<Paginated<WebhookDeliveryDto>> {
    await this.load(id);
    const where: Prisma.WebhookDeliveryWhereInput = {
      webhookId: id,
      ...(q.status ? { status: q.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.webhookDelivery.count({ where }),
    ]);
    return { items: rows.map(toDeliveryDto), total, page: q.page, pageSize: q.pageSize };
  }

  /** Sends a test event now (also to a switched-off destination) and returns its result. */
  async sendTest(id: string, actor: AuthUser): Promise<WebhookDeliveryDto> {
    const hook = await this.load(id);
    const payload = testPayload(this.config.APP_URL);
    const d = await this.prisma.webhookDelivery.create({
      data: {
        webhookId: hook.id,
        eventId: payload.id,
        eventType: 'test',
        test: true,
        payload: (hook.kind === 'TEAMS'
          ? teamsCard(
              { ...payload, owner: { nameEn: actor.nameEn, nameAr: actor.nameAr } },
              hook.language as TeamsLanguage,
            )
          : payload) as unknown as Prisma.InputJsonValue,
      },
    });
    await this.dispatcher.attempt(d.id);
    return toDeliveryDto(
      await this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } }),
    );
  }

  /** Sends a logged delivery again as a new delivery (same event id and payload). */
  async resend(
    id: string,
    deliveryId: string,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<WebhookDeliveryDto> {
    const hook = await this.load(id);
    const old = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, webhookId: hook.id },
    });
    if (!old) throw notFound('Delivery');
    const d = await this.prisma.webhookDelivery.create({
      data: {
        webhookId: hook.id,
        eventId: old.eventId,
        eventType: old.eventType,
        payload: old.payload as Prisma.InputJsonValue,
        // One immediate attempt, also to a switched-off destination: a manual resend is deliberate.
        test: true,
      },
    });
    await this.audit.log({
      action: 'RETRY',
      entityType: 'Webhook',
      entityId: hook.id,
      userId: actor.id,
      summary: { deliveryId: old.id, eventType: old.eventType },
      meta,
    });
    await this.dispatcher.attempt(d.id);
    return toDeliveryDto(
      await this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } }),
    );
  }

  private auditView(w: Webhook) {
    return {
      kind: w.kind,
      name: w.name,
      url: w.urlDisplay,
      events: w.events,
      departmentIds: w.departmentIds,
      processBranchId: w.processBranchId,
      language: w.language,
      active: w.active,
    };
  }

  private async toDtos(rows: Webhook[]): Promise<WebhookDto[]> {
    const branchIds = rows.map((r) => r.processBranchId).filter((v): v is string => !!v);
    const [branches, last] = await Promise.all([
      this.prisma.process.findMany({
        where: { id: { in: branchIds } },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      Promise.all(
        rows.map((r) =>
          this.prisma.webhookDelivery.findFirst({
            where: { webhookId: r.id, status: { not: 'PENDING' } },
            orderBy: { createdAt: 'desc' },
            select: { status: true, createdAt: true, lastStatusCode: true },
          }),
        ),
      ),
    ]);
    const byId = new Map(branches.map((b) => [b.id, b]));
    return rows.map((w, i) => ({
      id: w.id,
      kind: w.kind,
      name: w.name,
      urlDisplay: w.urlDisplay,
      events: w.events as WebhookEventType[],
      departmentIds: w.departmentIds,
      processBranch: w.processBranchId ? (byId.get(w.processBranchId) ?? null) : null,
      language: w.language as TeamsLanguage,
      active: w.active,
      disabledAt: w.disabledAt?.toISOString() ?? null,
      disabledReason: w.disabledReason,
      consecutiveFailures: w.consecutiveFailures,
      hasSecret: !!w.secretSealed,
      lastDelivery: last[i]
        ? {
            status: last[i]!.status,
            at: last[i]!.createdAt.toISOString(),
            statusCode: last[i]!.lastStatusCode,
          }
        : null,
      createdAt: w.createdAt.toISOString(),
    }));
  }
}
