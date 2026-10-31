import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  PERMISSIONS,
  commentPlainText,
  extractBpmnLabels,
  parseMentions,
  type CommentDto,
  type ContentType,
  type CreateCommentInput,
  type UpdateCommentInput,
  type DiagramType,
  diagramElements,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUserLoader } from '../auth/auth-user.loader';
import { badRequest, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import {
  ContentService,
  itemLink,
  itemParams,
  type ContentItem,
} from '../governance/content.service';
import { actorParams } from '../governance/reviews.service';
import { elementLabel } from '../models/bpmn-xml';

type Row = Prisma.CommentGetPayload<object>;

/** Threaded discussions on processes and pages, optionally attached to a BPMN element. */
@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly content: ContentService,
    private readonly notifications: NotificationsService,
    private readonly loader: AuthUserLoader,
  ) {}

  private link(item: ContentItem, elementId?: string | null) {
    if (item.type === 'PROCESS' || item.type === 'DIAGRAM') {
      return itemLink(
        item,
        `?tab=comments${elementId ? `&element=${encodeURIComponent(elementId)}` : ''}`,
      );
    }
    return itemLink(item, '?comments=1');
  }

  private canModerate(item: ContentItem, user: AuthUser) {
    return item.canEdit || item.canManage || user.permissions.has(PERMISSIONS.GOVERNANCE_MANAGE);
  }

  async list(type: ContentType, id: string, user: AuthUser): Promise<CommentDto[]> {
    const item = await this.content.load(type, id, user);
    const rows = await this.prisma.comment.findMany({
      where: { entityType: type, entityId: id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return this.toThreads(item, rows, user);
  }

  private async toThreads(item: ContentItem, rows: Row[], user: AuthUser): Promise<CommentDto[]> {
    const users = await this.content.users(rows.flatMap((r) => [r.createdById, r.resolvedById]));
    const model =
      item.type === 'PROCESS' && rows.some((r) => r.bpmnElementId)
        ? await this.prisma.processModel.findUnique({
            where: { processId: item.id },
            select: { bpmnXml: true },
          })
        : null;
    const labels = extractBpmnLabels(model?.bpmnXml ?? '');
    const diagram =
      item.type === 'DIAGRAM' && rows.some((r) => r.bpmnElementId)
        ? await this.prisma.diagram.findUnique({
            where: { id: item.id },
            select: { type: true, content: true },
          })
        : null;
    const diagramLabels = new Map(
      diagram
        ? diagramElements(diagram.type as DiagramType, diagram.content).map((e) => [
            e.id,
            { nameEn: e.nameEn, nameAr: e.nameAr },
          ])
        : [],
    );
    const moderate = this.canModerate(item, user);
    const toDto = (r: Row): CommentDto => ({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      parentId: r.parentId,
      bpmnElementId: r.bpmnElementId,
      element: r.bpmnElementId
        ? item.type === 'DIAGRAM'
          ? (diagramLabels.get(r.bpmnElementId) ?? null)
          : elementLabel(labels, r.bpmnElementId)
        : null,
      body: r.body,
      author: r.createdById ? (users.get(r.createdById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedBy: r.resolvedById ? (users.get(r.resolvedById) ?? null) : null,
      canEdit: r.createdById === user.id,
      canResolve: !r.parentId && (r.createdById === user.id || moderate),
      replies: [],
    });
    const roots = rows.filter((r) => !r.parentId).map(toDto);
    const byId = new Map(roots.map((r) => [r.id, r]));
    for (const r of rows) {
      if (r.parentId) byId.get(r.parentId)?.replies.push(toDto(r));
    }
    return roots;
  }

  /** Mentioned users who exist and may read the item. */
  private async readableMentions(item: ContentItem, body: string): Promise<string[]> {
    const ids = parseMentions(body);
    const ok: string[] = [];
    for (const id of ids) {
      const u = await this.loader.load(id);
      if (!u) continue;
      const seen = await this.content.find(item.type, item.id, u);
      if (seen?.canRead) ok.push(id);
    }
    return ok;
  }

  async create(
    type: ContentType,
    id: string,
    input: CreateCommentInput,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const item = await this.content.load(type, id, user);
    let parent: Row | null = null;
    if (input.parentId) {
      parent = await this.prisma.comment.findFirst({
        where: { id: input.parentId, entityType: type, entityId: id, deletedAt: null },
      });
      if (!parent) throw badRequest('PARENT_NOT_FOUND');
      if (parent.parentId) {
        parent = await this.prisma.comment.findUniqueOrThrow({ where: { id: parent.parentId } });
      }
    }
    if (input.bpmnElementId && (type === 'PAGE' || parent)) throw badRequest('INVALID_ELEMENT_ID');
    const mentionIds = await this.readableMentions(item, input.body);
    const row = await this.prisma.$transaction(async (tx) => {
      const c = await tx.comment.create({
        data: {
          entityType: type,
          entityId: id,
          parentId: parent?.id ?? null,
          bpmnElementId: parent ? parent.bpmnElementId : (input.bpmnElementId ?? null),
          body: input.body,
          mentionIds,
          createdById: user.id,
        },
      });
      if (parent?.resolvedAt) {
        // A new reply reopens a resolved thread.
        await tx.comment.update({
          where: { id: parent.id },
          data: { resolvedAt: null, resolvedById: null },
        });
      }
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Comment',
          entityId: c.id,
          userId: user.id,
          summary: {
            entityType: type,
            entityId: id,
            parentId: c.parentId,
            bpmnElementId: c.bpmnElementId,
            mentions: mentionIds.length,
          },
          meta,
        },
        tx,
      );
      return c;
    });

    const params = {
      ...itemParams(item),
      ...actorParams(user),
      comment: commentPlainText(input.body).slice(0, 300),
    };
    const link = this.link(item, row.bpmnElementId);
    await this.notifications.notify({
      userIds: mentionIds,
      type: 'MENTIONED',
      entityType: type,
      entityId: id,
      actorId: user.id,
      params,
      link,
    });
    if (parent) {
      const participants = await this.prisma.comment.findMany({
        where: { OR: [{ id: parent.id }, { parentId: parent.id }], deletedAt: null },
        select: { createdById: true },
      });
      const mentioned = new Set(mentionIds);
      await this.notifications.notify({
        userIds: participants.map((p) => p.createdById).filter((u) => !!u && !mentioned.has(u)),
        type: 'COMMENT_REPLY',
        entityType: type,
        entityId: id,
        actorId: user.id,
        params,
        link,
      });
    }
    return this.list(type, id, user);
  }

  private async own(commentId: string, user: AuthUser) {
    const c = await this.prisma.comment.findFirst({ where: { id: commentId, deletedAt: null } });
    if (!c) throw notFound('Comment');
    const item = await this.content.load(c.entityType, c.entityId, user);
    return { c, item };
  }

  async update(commentId: string, input: UpdateCommentInput, user: AuthUser, meta: RequestMeta) {
    const { c, item } = await this.own(commentId, user);
    if (c.createdById !== user.id) throw forbidden('Only the author can edit a comment');
    const mentionIds = await this.readableMentions(item, input.body);
    const added = mentionIds.filter((m) => !c.mentionIds.includes(m));
    await this.prisma.$transaction(async (tx) => {
      await tx.comment.update({
        where: { id: commentId },
        data: { body: input.body, mentionIds, editedAt: new Date() },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Comment',
          entityId: commentId,
          userId: user.id,
          summary: { edited: true },
          meta,
        },
        tx,
      );
    });
    await this.notifications.notify({
      userIds: added,
      type: 'MENTIONED',
      entityType: item.type,
      entityId: item.id,
      actorId: user.id,
      params: {
        ...itemParams(item),
        ...actorParams(user),
        comment: commentPlainText(input.body).slice(0, 300),
      },
      link: this.link(item, c.bpmnElementId),
    });
    return this.list(item.type, item.id, user);
  }

  async remove(commentId: string, user: AuthUser, meta: RequestMeta) {
    const { c, item } = await this.own(commentId, user);
    if (c.createdById !== user.id && !user.permissions.has(PERMISSIONS.GOVERNANCE_MANAGE)) {
      throw forbidden('You cannot delete this comment');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.comment.updateMany({
        where: { OR: [{ id: commentId }, { parentId: commentId }] },
        data: { deletedAt: new Date() },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Comment',
          entityId: commentId,
          userId: user.id,
          summary: {
            entityType: c.entityType,
            entityId: c.entityId,
            body: commentPlainText(c.body).slice(0, 200),
          },
          meta,
        },
        tx,
      );
    });
    return this.list(item.type, item.id, user);
  }

  async setResolved(commentId: string, resolved: boolean, user: AuthUser, meta: RequestMeta) {
    const { c, item } = await this.own(commentId, user);
    if (c.parentId) throw badRequest('NOT_A_THREAD');
    if (c.createdById !== user.id && !this.canModerate(item, user)) {
      throw forbidden('You cannot resolve this thread');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.comment.update({
        where: { id: commentId },
        data: resolved
          ? { resolvedAt: new Date(), resolvedById: user.id }
          : { resolvedAt: null, resolvedById: null },
      });
      await this.audit.log(
        {
          action: resolved ? 'RESOLVE' : 'REOPEN',
          entityType: 'Comment',
          entityId: commentId,
          userId: user.id,
          meta,
        },
        tx,
      );
    });
    return this.list(item.type, item.id, user);
  }
}
