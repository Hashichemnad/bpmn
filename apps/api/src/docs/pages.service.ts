import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  descendantIds,
  embeddedProcessIds,
  frontMatter,
  type CreatePageInput,
  type CreatePageLinkInput,
  type Locale,
  type MovePageInput,
  type ObjectType,
  type PageDraftDto,
  type PageDraftInput,
  type PageDto,
  type PageLinkDto,
  type PageLinkTarget,
  type PageRefDto,
  type PageSummaryDto,
  type PageVersionDetailDto,
  type PageVersionDto,
  type ProcessCategory,
  type RelatedPageDto,
  type RestoreVersionInput,
  type SavePageInput,
  type SpaceIcon,
  type TextDirection,
  type TrashedPageDto,
  type UserRef,
  type VersionLabelInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { DomainEvents } from '../events/domain-events';
import { badRequest, conflict, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { DocsAccessService } from './docs-access.service';
import { htmlToText, sanitizeRichText } from './rich-text';
import { htmlToMarkdown } from './markdown';
import { PageMoveError, nextPageSortOrder, planPageMove } from './page-tree';

type Tx = Prisma.TransactionClient;
type PageRow = Prisma.PageGetPayload<object>;

const userSelect = { id: true, email: true, nameEn: true, nameAr: true } as const;

export interface PageContent {
  titleEn: string;
  titleAr: string;
  contentEn: string;
  contentAr: string;
  dirEn: TextDirection;
  dirAr: TextDirection;
  textEn: string;
  textAr: string;
}

/** Sanitises editor input and derives the plain text used for search. */
export function preparePageContent(input: {
  titleEn?: string;
  titleAr?: string;
  contentEn?: string;
  contentAr?: string;
  dirEn?: TextDirection;
  dirAr?: TextDirection;
}): PageContent {
  const contentEn = sanitizeRichText(input.contentEn ?? '');
  const contentAr = sanitizeRichText(input.contentAr ?? '');
  return {
    titleEn: input.titleEn ?? '',
    titleAr: input.titleAr ?? '',
    contentEn,
    contentAr,
    dirEn: input.dirEn ?? 'ltr',
    dirAr: input.dirAr ?? 'rtl',
    textEn: htmlToText(contentEn),
    textAr: htmlToText(contentAr),
  };
}

const dir = (v: string): TextDirection => (v === 'rtl' ? 'rtl' : 'ltr');

export function toPageSummary(
  p: Pick<
    PageRow,
    | 'id'
    | 'spaceId'
    | 'parentId'
    | 'sortOrder'
    | 'titleEn'
    | 'titleAr'
    | 'textEn'
    | 'textAr'
    | 'updatedAt'
  >,
): PageSummaryDto {
  return {
    id: p.id,
    spaceId: p.spaceId,
    parentId: p.parentId,
    sortOrder: p.sortOrder,
    titleEn: p.titleEn,
    titleAr: p.titleAr,
    hasEn: !!(p.titleEn.trim() || p.textEn.trim()),
    hasAr: !!(p.titleAr.trim() || p.textAr.trim()),
    updatedAt: p.updatedAt.toISOString(),
  };
}

const summarySelect = {
  id: true,
  spaceId: true,
  parentId: true,
  sortOrder: true,
  titleEn: true,
  titleAr: true,
  textEn: true,
  textAr: true,
  updatedAt: true,
} satisfies Prisma.PageSelect;

@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: DocsAccessService,
    private readonly storage: StorageService,
    private readonly events: DomainEvents,
  ) {}

  private async users(ids: (string | null | undefined)[]): Promise<Map<string, UserRef>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    const rows = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: userSelect,
    });
    return new Map(rows.map((u) => [u.id, u]));
  }

  // ---------- Tree ----------

  async tree(spaceId: string, user: AuthUser): Promise<PageSummaryDto[]> {
    await this.access.space(spaceId, user);
    const rows = await this.prisma.page.findMany({
      where: { spaceId, deletedAt: null },
      select: summarySelect,
      orderBy: [{ sortOrder: 'asc' }],
    });
    return rows.map(toPageSummary);
  }

  async get(id: string, user: AuthUser): Promise<PageDto> {
    const { page, access } = await this.access.page(id, user);
    const [ancestors, children, users] = await Promise.all([
      this.ancestors(page.parentId),
      this.prisma.page.findMany({
        where: { parentId: id, deletedAt: null },
        select: { id: true, titleEn: true, titleAr: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.users([page.createdById, page.updatedById]),
    ]);
    return {
      ...toPageSummary(page),
      space: {
        id: page.space.id,
        key: page.space.key,
        nameEn: page.space.nameEn,
        nameAr: page.space.nameAr,
        icon: page.space.icon as SpaceIcon,
      },
      contentEn: page.contentEn,
      contentAr: page.contentAr,
      dirEn: dir(page.dirEn),
      dirAr: dir(page.dirAr),
      version: page.version,
      ancestors,
      children,
      createdBy: page.createdById ? (users.get(page.createdById) ?? null) : null,
      updatedBy: page.updatedById ? (users.get(page.updatedById) ?? null) : null,
      createdAt: page.createdAt.toISOString(),
      canEdit: access.canEdit,
      canManage: access.canManage,
    };
  }

  private async ancestors(parentId: string | null): Promise<PageRefDto[]> {
    const chain: PageRefDto[] = [];
    const seen = new Set<string>();
    let current = parentId;
    while (current && !seen.has(current)) {
      seen.add(current);
      const p = await this.prisma.page.findUnique({
        where: { id: current },
        select: { id: true, titleEn: true, titleAr: true, parentId: true },
      });
      if (!p) break;
      chain.unshift({ id: p.id, titleEn: p.titleEn, titleAr: p.titleAr });
      current = p.parentId;
    }
    return chain;
  }

  // ---------- Create / save ----------

  async create(spaceId: string, input: CreatePageInput, actor: AuthUser, meta: RequestMeta) {
    await this.access.space(spaceId, actor, 'edit');
    if (input.parentId) {
      const parent = await this.prisma.page.findFirst({
        where: { id: input.parentId, spaceId, deletedAt: null },
      });
      if (!parent) throw badRequest('PARENT_NOT_FOUND');
    }
    const template = input.templateId
      ? await this.prisma.pageTemplate.findFirst({
          where: { id: input.templateId, deletedAt: null },
        })
      : null;
    if (input.templateId && !template) throw badRequest('TEMPLATE_NOT_FOUND');
    const siblings = await this.prisma.page.findMany({
      where: { spaceId, deletedAt: null },
      select: { id: true, parentId: true, sortOrder: true },
    });
    const content = preparePageContent({
      titleEn: input.titleEn,
      titleAr: input.titleAr,
      contentEn: template?.contentEn,
      contentAr: template?.contentAr,
    });
    const page = await this.prisma.$transaction(async (tx) => {
      const p = await tx.page.create({
        data: {
          spaceId,
          parentId: input.parentId ?? null,
          sortOrder: nextPageSortOrder(siblings, input.parentId ?? null),
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      const note = template
        ? `Created from template: ${template.nameEn || template.nameAr}`
        : 'Page created';
      await this.writeVersion(tx, p, content, note, actor);
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Page',
          entityId: p.id,
          userId: actor.id,
          summary: {
            after: {
              spaceId,
              parentId: p.parentId,
              titleEn: content.titleEn,
              titleAr: content.titleAr,
            },
            templateKey: template?.key ?? template?.id ?? null,
          },
          meta,
        },
        tx,
      );
      return p;
    });
    this.events.emit({
      type: 'page.versioned',
      pageId: page.id,
      versionNumber: 1,
      actorId: actor.id,
    });
    return this.get(page.id, actor);
  }

  /** Writes the content to the page as the next version (the only way versions are created). */
  private async writeVersion(
    tx: Tx,
    page: Pick<PageRow, 'id' | 'version'>,
    content: PageContent,
    changeNote: string,
    actor: AuthUser,
    restoredFrom: number | null = null,
  ) {
    const versionNumber = page.version + 1;
    await tx.page.update({
      where: { id: page.id },
      data: { ...content, version: versionNumber, updatedById: actor.id },
    });
    const v = await tx.pageVersion.create({
      data: {
        pageId: page.id,
        versionNumber,
        titleEn: content.titleEn,
        titleAr: content.titleAr,
        contentEn: content.contentEn,
        contentAr: content.contentAr,
        dirEn: content.dirEn,
        dirAr: content.dirAr,
        changeNote,
        restoredFrom,
        createdById: actor.id,
      },
    });
    await tx.pageDraft.deleteMany({ where: { pageId: page.id, userId: actor.id } });
    await this.syncEmbeddedLinks(tx, page.id, content.contentEn + content.contentAr, actor.id);
    return v;
  }

  /** Keeps automatic process links in line with the diagrams embedded in the page. */
  private async syncEmbeddedLinks(tx: Tx, pageId: string, html: string, actorId: string) {
    const ids = embeddedProcessIds(html);
    const valid = ids.length
      ? (
          await tx.process.findMany({
            where: { id: { in: ids }, deletedAt: null },
            select: { id: true },
          })
        ).map((p) => p.id)
      : [];
    await tx.pageLink.deleteMany({
      where: { pageId, embedded: true, processId: { notIn: valid } },
    });
    const existing = await tx.pageLink.findMany({
      where: { pageId, processId: { in: valid } },
      select: { processId: true },
    });
    const have = new Set(existing.map((l) => l.processId));
    const missing = valid.filter((id) => !have.has(id));
    if (missing.length) {
      await tx.pageLink.createMany({
        data: missing.map((processId) => ({
          pageId,
          processId,
          targetType: 'PROCESS' as const,
          embedded: true,
          createdById: actorId,
        })),
      });
    }
  }

  async save(id: string, input: SavePageInput, actor: AuthUser, meta: RequestMeta) {
    const { page } = await this.access.page(id, actor, 'edit');
    if (input.baseVersion !== undefined && input.baseVersion !== page.version) {
      throw conflict('PAGE_CHANGED', 'The page was saved by someone else in the meantime');
    }
    const content = preparePageContent(input);
    const version = await this.prisma.$transaction(async (tx) => {
      const v = await this.writeVersion(tx, page, content, input.changeNote, actor);
      await this.audit.log(
        {
          action: 'VERSION',
          entityType: 'Page',
          entityId: id,
          userId: actor.id,
          summary: {
            versionNumber: v.versionNumber,
            changeNote: v.changeNote,
            titleEn: content.titleEn,
            titleAr: content.titleAr,
            bytes: content.contentEn.length + content.contentAr.length,
          },
          meta,
        },
        tx,
      );
      return v;
    });
    this.events.emit({
      type: 'page.versioned',
      pageId: id,
      versionNumber: version.versionNumber,
      actorId: actor.id,
    });
    return this.get(id, actor);
  }

  // ---------- Drafts (autosave, never versions) ----------

  private toDraft(d: Prisma.PageDraftGetPayload<object>): PageDraftDto {
    return {
      titleEn: d.titleEn,
      titleAr: d.titleAr,
      contentEn: d.contentEn,
      contentAr: d.contentAr,
      dirEn: dir(d.dirEn),
      dirAr: dir(d.dirAr),
      baseVersion: d.baseVersion,
      updatedAt: d.updatedAt.toISOString(),
    };
  }

  async getDraft(id: string, user: AuthUser): Promise<{ draft: PageDraftDto | null }> {
    await this.access.page(id, user, 'edit');
    const d = await this.prisma.pageDraft.findUnique({
      where: { pageId_userId: { pageId: id, userId: user.id } },
    });
    return { draft: d ? this.toDraft(d) : null };
  }

  async saveDraft(id: string, input: PageDraftInput, user: AuthUser) {
    await this.access.page(id, user, 'edit');
    const c = preparePageContent(input);
    const data = {
      titleEn: c.titleEn,
      titleAr: c.titleAr,
      contentEn: c.contentEn,
      contentAr: c.contentAr,
      dirEn: c.dirEn,
      dirAr: c.dirAr,
      baseVersion: input.baseVersion ?? null,
    };
    const d = await this.prisma.pageDraft.upsert({
      where: { pageId_userId: { pageId: id, userId: user.id } },
      create: { pageId: id, userId: user.id, ...data },
      update: data,
    });
    return { draft: this.toDraft(d) };
  }

  async deleteDraft(id: string, user: AuthUser) {
    await this.access.page(id, user, 'edit');
    await this.prisma.pageDraft.deleteMany({ where: { pageId: id, userId: user.id } });
  }

  // ---------- Move / delete / trash ----------

  async move(id: string, input: MovePageInput, actor: AuthUser, meta: RequestMeta) {
    const { page } = await this.access.page(id, actor, 'edit');
    const rows = await this.prisma.page.findMany({
      where: { spaceId: page.spaceId, deletedAt: null },
      select: { id: true, parentId: true, sortOrder: true },
    });
    let updates;
    try {
      updates = planPageMove(rows, id, input.parentId, input.index);
    } catch (err) {
      if (err instanceof PageMoveError)
        throw badRequest(err.code === 'NOT_FOUND' ? 'PARENT_NOT_FOUND' : err.code);
      throw err;
    }
    await this.prisma.$transaction(async (tx) => {
      for (const u of updates) {
        await tx.page.update({
          where: { id: u.id },
          data: { parentId: u.parentId, sortOrder: u.sortOrder },
        });
      }
      await this.audit.log(
        {
          action: 'MOVE',
          entityType: 'Page',
          entityId: id,
          userId: actor.id,
          summary: { from: { parentId: page.parentId, sortOrder: page.sortOrder }, to: input },
          meta,
        },
        tx,
      );
    });
    // Paths in the Git export mirror the tree.
    this.events.emit({
      type: 'page.versioned',
      pageId: id,
      versionNumber: page.version,
      actorId: actor.id,
    });
    return this.tree(page.spaceId, actor);
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const { page } = await this.access.page(id, actor, 'edit');
    const rows = await this.prisma.page.findMany({
      where: { spaceId: page.spaceId, deletedAt: null },
      select: { id: true, parentId: true },
    });
    const ids = [id, ...descendantIds(rows, id)];
    const batch = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.page.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt: new Date(), deletedById: actor.id, deleteBatchId: batch },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Page',
          entityId: id,
          userId: actor.id,
          summary: {
            before: { titleEn: page.titleEn, titleAr: page.titleAr, spaceId: page.spaceId },
            subPages: ids.length - 1,
          },
          meta,
        },
        tx,
      );
    });
    this.events.emit({ type: 'page.removed', pageIds: ids, actorId: actor.id });
  }

  async trash(spaceId: string, user: AuthUser): Promise<TrashedPageDto[]> {
    await this.access.space(spaceId, user, 'edit');
    const rows = await this.prisma.page.findMany({
      where: { spaceId, deletedAt: { not: null } },
      select: {
        id: true,
        parentId: true,
        titleEn: true,
        titleAr: true,
        deletedAt: true,
        deletedById: true,
        deleteBatchId: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
    const batchOf = new Map(rows.map((r) => [r.id, r.deleteBatchId]));
    const batchSize = new Map<string, number>();
    for (const r of rows) {
      if (r.deleteBatchId)
        batchSize.set(r.deleteBatchId, (batchSize.get(r.deleteBatchId) ?? 0) + 1);
    }
    const roots = rows.filter((r) => !r.parentId || batchOf.get(r.parentId) !== r.deleteBatchId);
    const users = await this.users(roots.map((r) => r.deletedById));
    return roots.map((r) => ({
      id: r.id,
      titleEn: r.titleEn,
      titleAr: r.titleAr,
      deletedAt: r.deletedAt!.toISOString(),
      deletedBy: r.deletedById ? (users.get(r.deletedById) ?? null) : null,
      descendantCount: (r.deleteBatchId ? (batchSize.get(r.deleteBatchId) ?? 1) : 1) - 1,
    }));
  }

  private async batchOf(page: Pick<PageRow, 'id' | 'deleteBatchId'>) {
    if (!page.deleteBatchId) return [page.id];
    const rows = await this.prisma.page.findMany({
      where: { deleteBatchId: page.deleteBatchId },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Restores a deleted page together with the sub-pages deleted with it. */
  async restore(id: string, actor: AuthUser, meta: RequestMeta) {
    const { page } = await this.access.page(id, actor, 'edit', true);
    const ids = await this.batchOf(page);
    const batchRows = await this.prisma.page.findMany({
      where: { id: { in: ids } },
      select: { id: true, parentId: true },
    });
    const inBatch = new Set(ids);
    const roots = batchRows.filter((r) => !r.parentId || !inBatch.has(r.parentId));
    await this.prisma.$transaction(async (tx) => {
      for (const root of roots) {
        const parent = root.parentId
          ? await tx.page.findFirst({ where: { id: root.parentId, deletedAt: null } })
          : null;
        if (root.parentId && !parent) {
          // The original parent is gone: restore at the top level of the space.
          const top = await tx.page.findMany({
            where: { spaceId: page.spaceId, deletedAt: null },
            select: { id: true, parentId: true, sortOrder: true },
          });
          await tx.page.update({
            where: { id: root.id },
            data: { parentId: null, sortOrder: nextPageSortOrder(top, null) },
          });
        }
      }
      await tx.page.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt: null, deletedById: null, deleteBatchId: null },
      });
      await this.audit.log(
        {
          action: 'RESTORE',
          entityType: 'Page',
          entityId: id,
          userId: actor.id,
          summary: { titleEn: page.titleEn, titleAr: page.titleAr, pages: ids.length },
          meta,
        },
        tx,
      );
    });
    this.events.emit({ type: 'page.restored', pageIds: ids, actorId: actor.id });
    return this.get(id, actor);
  }

  /** Permanently deletes a page from the trash (with its batch, versions and attachments). */
  async purge(id: string, actor: AuthUser, meta: RequestMeta) {
    const { page } = await this.access.page(id, actor, 'manage', true);
    const ids = await this.batchOf(page);
    const files = await this.prisma.attachment.findMany({
      where: { pageId: { in: ids } },
      select: { storageKey: true },
    });
    await this.prisma.$transaction(async (tx) => {
      // Pages deleted earlier may still point at a page of this batch.
      await tx.page.updateMany({ where: { parentId: { in: ids } }, data: { parentId: null } });
      await tx.page.deleteMany({ where: { id: { in: ids } } });
      await this.audit.log(
        {
          action: 'PURGE',
          entityType: 'Page',
          entityId: id,
          userId: actor.id,
          summary: {
            titleEn: page.titleEn,
            titleAr: page.titleAr,
            pages: ids.length,
            attachments: files.length,
          },
          meta,
        },
        tx,
      );
    });
    for (const f of files) await this.storage.remove(f.storageKey).catch(() => undefined);
  }

  // ---------- Versions ----------

  async listVersions(id: string, user: AuthUser): Promise<PageVersionDto[]> {
    await this.access.page(id, user);
    const rows = await this.prisma.pageVersion.findMany({
      where: { pageId: id },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        changeNote: true,
        label: true,
        restoredFrom: true,
        titleEn: true,
        titleAr: true,
        createdAt: true,
        createdById: true,
      },
    });
    const users = await this.users(rows.map((r) => r.createdById));
    return rows.map(({ createdById, createdAt, ...r }) => ({
      ...r,
      createdAt: createdAt.toISOString(),
      createdBy: createdById ? (users.get(createdById) ?? null) : null,
    }));
  }

  async getVersion(id: string, versionId: string, user: AuthUser): Promise<PageVersionDetailDto> {
    await this.access.page(id, user);
    const v = await this.prisma.pageVersion.findFirst({ where: { id: versionId, pageId: id } });
    if (!v) throw notFound('Version');
    const users = await this.users([v.createdById]);
    return {
      id: v.id,
      versionNumber: v.versionNumber,
      changeNote: v.changeNote,
      label: v.label,
      restoredFrom: v.restoredFrom,
      titleEn: v.titleEn,
      titleAr: v.titleAr,
      contentEn: v.contentEn,
      contentAr: v.contentAr,
      dirEn: dir(v.dirEn),
      dirAr: dir(v.dirAr),
      createdAt: v.createdAt.toISOString(),
      createdBy: v.createdById ? (users.get(v.createdById) ?? null) : null,
    };
  }

  /** Restoring never deletes history: the old content becomes a new version. */
  async restoreVersion(
    id: string,
    versionId: string,
    input: RestoreVersionInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const { page } = await this.access.page(id, actor, 'edit');
    const old = await this.prisma.pageVersion.findFirst({ where: { id: versionId, pageId: id } });
    if (!old) throw notFound('Version');
    const content = preparePageContent({ ...old, dirEn: dir(old.dirEn), dirAr: dir(old.dirAr) });
    const note = input.changeNote || `Restored version ${old.versionNumber}`;
    const v = await this.prisma.$transaction(async (tx) => {
      const created = await this.writeVersion(tx, page, content, note, actor, old.versionNumber);
      await this.audit.log(
        {
          action: 'RESTORE',
          entityType: 'PageVersion',
          entityId: created.id,
          userId: actor.id,
          summary: {
            pageId: id,
            restoredFrom: old.versionNumber,
            versionNumber: created.versionNumber,
            changeNote: note,
          },
          meta,
        },
        tx,
      );
      return created;
    });
    this.events.emit({
      type: 'page.versioned',
      pageId: id,
      versionNumber: v.versionNumber,
      actorId: actor.id,
    });
    return this.get(id, actor);
  }

  async labelVersion(
    id: string,
    versionId: string,
    input: VersionLabelInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    await this.access.page(id, actor, 'edit');
    const v = await this.prisma.pageVersion.findFirst({ where: { id: versionId, pageId: id } });
    if (!v) throw notFound('Version');
    const label = input.label || null;
    await this.prisma.$transaction(async (tx) => {
      await tx.pageVersion.update({ where: { id: versionId }, data: { label } });
      await this.audit.log(
        {
          action: 'LABEL',
          entityType: 'PageVersion',
          entityId: versionId,
          userId: actor.id,
          summary: { pageId: id, versionNumber: v.versionNumber, from: v.label, to: label },
          meta,
        },
        tx,
      );
    });
    return this.listVersions(id, actor);
  }

  // ---------- Links to processes and repository objects ----------

  async listLinks(id: string, user: AuthUser): Promise<PageLinkDto[]> {
    await this.access.page(id, user);
    const rows = await this.prisma.pageLink.findMany({
      where: {
        pageId: id,
        OR: [{ process: { deletedAt: null } }, { repoObject: { deletedAt: null } }],
      },
      include: {
        process: { select: { id: true, code: true, nameEn: true, nameAr: true, category: true } },
        repoObject: { select: { id: true, type: true, code: true, nameEn: true, nameAr: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      targetType: r.targetType as PageLinkTarget,
      process: r.process ? { ...r.process, category: r.process.category as ProcessCategory } : null,
      object: r.repoObject ? { ...r.repoObject, type: r.repoObject.type as ObjectType } : null,
      embedded: r.embedded,
    }));
  }

  async addLink(id: string, input: CreatePageLinkInput, actor: AuthUser, meta: RequestMeta) {
    await this.access.page(id, actor, 'edit');
    const isProcess = input.targetType === 'PROCESS';
    const target = isProcess
      ? await this.prisma.process.findFirst({ where: { id: input.targetId, deletedAt: null } })
      : await this.prisma.repoObject.findFirst({ where: { id: input.targetId, deletedAt: null } });
    if (!target) throw badRequest(isProcess ? 'PROCESS_NOT_FOUND' : 'OBJECT_NOT_FOUND');
    const where = isProcess
      ? { pageId: id, processId: input.targetId }
      : { pageId: id, repoObjectId: input.targetId };
    const existing = await this.prisma.pageLink.findFirst({ where });
    if (!existing) {
      await this.prisma.$transaction(async (tx) => {
        const link = await tx.pageLink.create({
          data: { ...where, targetType: input.targetType, createdById: actor.id },
        });
        await this.audit.log(
          {
            action: 'CREATE',
            entityType: 'PageLink',
            entityId: link.id,
            userId: actor.id,
            summary: { pageId: id, ...input },
            meta,
          },
          tx,
        );
      });
    }
    return this.listLinks(id, actor);
  }

  async removeLink(id: string, linkId: string, actor: AuthUser, meta: RequestMeta) {
    await this.access.page(id, actor, 'edit');
    const link = await this.prisma.pageLink.findFirst({ where: { id: linkId, pageId: id } });
    if (!link) throw notFound('Link');
    await this.prisma.$transaction(async (tx) => {
      await tx.pageLink.delete({ where: { id: linkId } });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'PageLink',
          entityId: linkId,
          userId: actor.id,
          summary: {
            pageId: id,
            targetType: link.targetType,
            targetId: link.processId ?? link.repoObjectId,
          },
          meta,
        },
        tx,
      );
    });
    return this.listLinks(id, actor);
  }

  /** "Related documentation" for a process or repository object, limited to visible spaces. */
  async related(
    target: { processId?: string; repoObjectId?: string },
    user: AuthUser,
  ): Promise<RelatedPageDto[]> {
    const spaceIds = await this.access.visibleSpaceIds(user);
    const pages = await this.prisma.page.findMany({
      where: { deletedAt: null, spaceId: { in: spaceIds }, links: { some: target } },
      select: {
        id: true,
        titleEn: true,
        titleAr: true,
        updatedAt: true,
        space: { select: { id: true, key: true, nameEn: true, nameAr: true, icon: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return pages.map((p) => ({
      id: p.id,
      titleEn: p.titleEn,
      titleAr: p.titleAr,
      updatedAt: p.updatedAt.toISOString(),
      space: { ...p.space, icon: p.space.icon as SpaceIcon },
    }));
  }

  // ---------- Export ----------

  /** Markdown with front-matter for one language (falls back to the other when empty). */
  async exportMarkdown(id: string, lang: Locale, user: AuthUser) {
    const page = await this.get(id, user);
    const other: Locale = lang === 'ar' ? 'en' : 'ar';
    const pick = (l: Locale) => (l === 'ar' ? page.hasAr : page.hasEn);
    const language = pick(lang) || !pick(other) ? lang : other;
    const title = language === 'ar' ? page.titleAr || page.titleEn : page.titleEn || page.titleAr;
    const html = language === 'ar' ? page.contentAr : page.contentEn;
    const diagrams = await this.diagramLabels(html);
    const author = page.updatedBy;
    const body =
      frontMatter({
        id: page.id,
        title,
        space: page.space.key,
        language,
        version: page.version,
        author: author ? author.nameEn || author.nameAr || author.email : null,
        updated: page.updatedAt,
      }) +
      `# ${title}\n\n` +
      htmlToMarkdown(html, {
        diagram: (pid) => {
          const d = diagrams.get(pid);
          return d ? { label: d, href: `/processes/${pid}?tab=model` } : null;
        },
      });
    return { body, fileName: `${title || 'page'}.${language}.md`, language };
  }

  /** `code name` of processes embedded in the HTML. */
  async diagramLabels(html: string): Promise<Map<string, string>> {
    const ids = embeddedProcessIds(html);
    if (!ids.length) return new Map();
    const rows = await this.prisma.process.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    return new Map(rows.map((p) => [p.id, `${p.code} ${p.nameEn || p.nameAr}`]));
  }
}
