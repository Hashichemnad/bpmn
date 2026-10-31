import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  PERMISSIONS,
  type ContentType,
  type CreateFeedbackInput,
  type FeedbackDto,
  type FeedbackListQuery,
  type FeedbackStatus,
  type Paginated,
  type UpdateFeedbackInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { pageArgs, paginated } from '../common/pagination';
import { ContentService } from './content.service';
import { PortalAccessService } from './portal-access.service';

type Row = Prisma.FeedbackGetPayload<object>;

/** "Suggest an improvement / report outdated content" from the portal, routed to the owner. */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly content: ContentService,
    private readonly portal: PortalAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  private canManage(row: Row, user: AuthUser) {
    return row.assigneeId === user.id || user.permissions.has(PERMISSIONS.GOVERNANCE_MANAGE);
  }

  async toDtos(rows: Row[], user: AuthUser): Promise<FeedbackDto[]> {
    const refs = await this.content.refs(
      rows.map((r) => ({ entityType: r.entityType, entityId: r.entityId })),
    );
    const users = await this.content.users(
      rows.flatMap((r) => [r.createdById, r.assigneeId, r.repliedById]),
    );
    return rows.map((r) => ({
      id: r.id,
      item: refs.get(`${r.entityType}:${r.entityId}`) ?? {
        entityType: r.entityType,
        entityId: r.entityId,
        titleEn: '',
        titleAr: '',
      },
      kind: r.kind,
      message: r.message,
      status: r.status,
      reply: r.reply,
      repliedAt: r.repliedAt?.toISOString() ?? null,
      repliedBy: r.repliedById ? (users.get(r.repliedById) ?? null) : null,
      createdBy: r.createdById ? (users.get(r.createdById) ?? null) : null,
      assignee: r.assigneeId ? (users.get(r.assigneeId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      canManage: this.canManage(r, user),
    }));
  }

  async create(input: CreateFeedbackInput, user: AuthUser, meta: RequestMeta) {
    await this.portal.assertAccess(user);
    const { process, page, space, diagram } = await this.portal.publicationOf(
      input.entityType,
      input.entityId,
      user,
    );
    const assigneeId = process
      ? process.ownerId
      : diagram
        ? diagram.ownerId
        : (page?.ownerId ?? space?.ownerId ?? null);
    const row = await this.prisma.$transaction(async (tx) => {
      const f = await tx.feedback.create({
        data: {
          entityType: input.entityType,
          entityId: input.entityId,
          kind: input.kind,
          message: input.message,
          assigneeId,
          createdById: user.id,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Feedback',
          entityId: f.id,
          userId: user.id,
          summary: {
            entityType: input.entityType,
            entityId: input.entityId,
            kind: input.kind,
            assigneeId,
          },
          meta,
        },
        tx,
      );
      return f;
    });
    await this.notifications.notify({
      userIds: [assigneeId],
      type: 'FEEDBACK_RECEIVED',
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: user.id,
      params: {
        titleEn: process?.nameEn ?? page?.titleEn ?? '',
        titleAr: process?.nameAr ?? page?.titleAr ?? '',
        ...(process ? { code: process.code } : {}),
        actorEn: user.nameEn || user.email,
        actorAr: user.nameAr || user.nameEn || user.email,
        kind: input.kind,
        comment: input.message.slice(0, 300),
      },
      link: '/tasks?tab=feedback',
    });
    return (await this.toDtos([row], user))[0];
  }

  async list(q: FeedbackListQuery, user: AuthUser): Promise<Paginated<FeedbackDto>> {
    if (q.scope === 'all' && !user.permissions.has(PERMISSIONS.GOVERNANCE_MANAGE)) {
      throw forbidden('Only governance managers see all feedback');
    }
    const where: Prisma.FeedbackWhereInput = {
      status: q.status,
      ...(q.scope === 'mine'
        ? { createdById: user.id }
        : q.scope === 'assigned'
          ? { assigneeId: user.id }
          : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.feedback.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.feedback.count({ where }),
    ]);
    return paginated(await this.toDtos(rows, user), total, q);
  }

  async listAssigned(user: AuthUser): Promise<FeedbackDto[]> {
    const rows = await this.prisma.feedback.findMany({
      where: { assigneeId: user.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return this.toDtos(rows, user);
  }

  async update(id: string, input: UpdateFeedbackInput, user: AuthUser, meta: RequestMeta) {
    const before = await this.prisma.feedback.findUnique({ where: { id } });
    if (!before || (!this.canManage(before, user) && before.createdById !== user.id))
      throw notFound('Feedback');
    if (!this.canManage(before, user)) throw forbidden('Only the owner can handle this feedback');
    const replyChanged = input.reply !== undefined && input.reply !== (before.reply ?? '');
    const row = await this.prisma.$transaction(async (tx) => {
      const f = await tx.feedback.update({
        where: { id },
        data: {
          status: input.status,
          ...(replyChanged
            ? { reply: input.reply || null, repliedAt: new Date(), repliedById: user.id }
            : {}),
        },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Feedback',
          entityId: id,
          userId: user.id,
          summary: {
            status:
              input.status && input.status !== before.status
                ? { from: before.status, to: input.status }
                : undefined,
            replied: replyChanged || undefined,
          },
          meta,
        },
        tx,
      );
      return f;
    });
    if (replyChanged || (input.status && input.status !== before.status)) {
      const ref = (
        await this.content.refs([{ entityType: row.entityType, entityId: row.entityId }])
      ).get(`${row.entityType}:${row.entityId}`);
      await this.notifications.notify({
        userIds: [row.createdById],
        type: 'FEEDBACK_UPDATED',
        entityType: row.entityType,
        entityId: row.entityId,
        actorId: user.id,
        params: {
          titleEn: ref?.titleEn ?? '',
          titleAr: ref?.titleAr ?? '',
          ...(ref?.code ? { code: ref.code } : {}),
          status: row.status as FeedbackStatus,
          reply: row.reply ?? '',
        },
        link: `/portal/feedback`,
      });
    }
    return (await this.toDtos([row], user))[0];
  }

  /** Feedback the user sent about one portal item. */
  async forItem(type: ContentType, id: string, user: AuthUser) {
    const rows = await this.prisma.feedback.findMany({
      where: { entityType: type, entityId: id, createdById: user.id },
      orderBy: { createdAt: 'desc' },
    });
    return this.toDtos(rows, user);
  }
}
