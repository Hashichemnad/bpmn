import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  PERMISSIONS,
  SETTING_KEYS,
  extractBpmnLabels,
  publishedForest,
  referencedAttachmentIds,
  reviewDateState,
  type ContentType,
  type InvolvementReason,
  type LinkRelation,
  type MyPortalDto,
  type MyPortalItemDto,
  type ObjectType,
  type PageRefDto,
  type PortalHomeDto,
  type PortalItemDto,
  type PortalMetaDto,
  type PortalPageDto,
  type PortalPageNodeDto,
  type PortalProcessDto,
  type PortalProcessNodeDto,
  type PortalSearchQuery,
  type PortalSearchResultDto,
  type PortalSettingsDto,
  type PortalSettingsInput,
  type PortalSpaceDto,
  type ProcessCategory,
  type SpaceIcon,
  type TextDirection,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { badRequest, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { PortalAccessService } from '../governance/portal-access.service';
import { ContentService } from '../governance/content.service';
import { WorkflowsService } from '../governance/workflows.service';
import { escapeLike, toPrefixTsQuery } from '../search/search-query';

type Pub = Prisma.PublicationGetPayload<object>;
type SpaceRow = Prisma.SpaceGetPayload<{ include: { grants: true } }>;

const HEADLINE = `StartSel=${HIGHLIGHT_START}, StopSel=${HIGHLIGHT_END}, MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" … "`;
const dir = (v: string): TextDirection => (v === 'rtl' ? 'rtl' : 'ltr');
const key = (type: ContentType, id: string) => `${type}:${id}`;
const LINKED_PROCESS = /ph:linkedProcessId="([0-9a-f-]{36})"/gi;
const excerpt = (text: string) => (text.length > 220 ? `${text.slice(0, 217).trimEnd()}…` : text);

/**
 * Knowledge Portal: read-only, published content only. Every query goes through the current
 * publications returned by PortalAccessService, so drafts, items in review and archived items
 * are never reachable here.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly access: PortalAccessService,
    private readonly content: ContentService,
    private readonly workflows: WorkflowsService,
  ) {}

  // ---------- Settings ----------

  getSettings(): Promise<PortalSettingsDto> {
    return this.access.settings();
  }

  async updateSettings(input: PortalSettingsInput, actor: AuthUser, meta: RequestMeta) {
    if (input.access.departmentIds.length) {
      const n = await this.prisma.department.count({
        where: { id: { in: input.access.departmentIds }, deletedAt: null },
      });
      if (n !== new Set(input.access.departmentIds).size) throw badRequest('DEPARTMENT_NOT_FOUND');
    }
    const before = await this.access.settings();
    await this.prisma.$transaction(async (tx) => {
      const value = input as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.PORTAL },
        create: { key: SETTING_KEYS.PORTAL, value, updatedById: actor.id },
        update: { value, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: SETTING_KEYS.PORTAL,
          userId: actor.id,
          summary: { before, after: input },
          meta,
        },
        tx,
      );
    });
    return this.access.settings();
  }

  // ---------- Building blocks ----------

  /** Visible current publications with the live items they belong to. */
  private async visible(user: AuthUser, where: Prisma.PublicationWhereInput = {}) {
    const pubs = await this.access.publications(user, where);
    const ids = (t: ContentType) => pubs.filter((p) => p.entityType === t).map((p) => p.entityId);
    const [processes, pages] = await Promise.all([
      this.prisma.process.findMany({
        where: { id: { in: ids('PROCESS') } },
        select: {
          id: true,
          parentId: true,
          category: true,
          sortOrder: true,
          level: true,
          ownerId: true,
          departmentId: true,
        },
      }),
      this.prisma.page.findMany({
        where: { id: { in: ids('PAGE') } },
        select: {
          id: true,
          spaceId: true,
          parentId: true,
          sortOrder: true,
          ownerId: true,
          space: {
            select: {
              id: true,
              key: true,
              nameEn: true,
              nameAr: true,
              icon: true,
              ownerId: true,
              departmentId: true,
            },
          },
        },
      }),
    ]);
    return {
      pubs,
      byKey: new Map(pubs.map((p) => [key(p.entityType, p.entityId), p])),
      processes: new Map(processes.map((p) => [p.id, p])),
      pages: new Map(pages.map((p) => [p.id, p])),
    };
  }

  private toItem(pub: Pub, v: Awaited<ReturnType<PortalService['visible']>>): PortalItemDto | null {
    const base = {
      type: pub.entityType,
      id: pub.entityId,
      titleEn: pub.titleEn,
      titleAr: pub.titleAr,
      versionLabel: pub.versionLabel,
      versionNumber: pub.versionNumber,
      publishedAt: pub.publishedAt.toISOString(),
    };
    if (pub.entityType === 'PROCESS') {
      const p = v.processes.get(pub.entityId);
      if (!p) return null;
      return {
        ...base,
        code: pub.code ?? undefined,
        category: p.category as ProcessCategory,
        descriptionEn: excerpt(pub.descriptionEn),
        descriptionAr: excerpt(pub.descriptionAr),
      };
    }
    const page = v.pages.get(pub.entityId);
    if (!page) return null;
    const { ownerId: _o, departmentId: _d, ...space } = page.space;
    return {
      ...base,
      space: { ...space, icon: space.icon as SpaceIcon },
      descriptionEn: excerpt(pub.textEn),
      descriptionAr: excerpt(pub.textAr),
    };
  }

  private async meta(
    pub: Pub,
    ownerId: string | null,
    nextReviewAt: Date | null,
  ): Promise<PortalMetaDto> {
    const [users, settings] = await Promise.all([
      this.content.users([ownerId, ...pub.approverIds]),
      this.workflows.settings(),
    ]);
    return {
      versionNumber: pub.versionNumber,
      versionLabel: pub.versionLabel,
      publishedAt: pub.publishedAt.toISOString(),
      approvedAt: pub.approvedAt?.toISOString() ?? null,
      approvedBy: pub.approverIds.map((id) => users.get(id)).filter((u) => !!u),
      owner: ownerId ? (users.get(ownerId) ?? null) : null,
      nextReviewAt: nextReviewAt?.toISOString() ?? null,
      reviewState: reviewDateState(nextReviewAt, new Date(), settings.reminderDays),
    };
  }

  // ---------- Home ----------

  async home(user: AuthUser): Promise<PortalHomeDto> {
    const settings = await this.access.assertAccess(user);
    const v = await this.visible(user);
    const items = (pubs: Pub[]) =>
      pubs.map((p) => this.toItem(p, v)).filter((i): i is PortalItemDto => !!i);
    const featured = settings.featured
      .map((f) => v.byKey.get(key(f.entityType, f.entityId)))
      .filter((p): p is Pub => !!p);
    return {
      nameEn: settings.nameEn,
      nameAr: settings.nameAr,
      taglineEn: settings.taglineEn,
      taglineAr: settings.taglineAr,
      quickLinks: settings.quickLinks,
      featured: items(featured),
      recent: items(v.pubs.slice(0, 8)),
      counts: { processes: v.processes.size, pages: v.pages.size },
      canManage: user.permissions.has(PERMISSIONS.PORTAL_MANAGE),
    };
  }

  // ---------- Processes ----------

  async processTree(user: AuthUser): Promise<PortalProcessNodeDto[]> {
    await this.access.assertAccess(user);
    const v = await this.visible(user, { entityType: 'PROCESS' });
    const all = await this.prisma.process.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true },
    });
    const nodes = v.pubs.flatMap((pub) => {
      const p = v.processes.get(pub.entityId);
      return p
        ? [
            {
              id: p.id,
              code: pub.code ?? '',
              nameEn: pub.titleEn,
              nameAr: pub.titleAr,
              category: p.category as ProcessCategory,
              parentId: p.parentId,
              sortOrder: p.sortOrder,
              level: p.level,
            },
          ]
        : [];
    });
    return publishedForest(all, nodes)
      .sort((a, b) => a.level - b.level || a.sortOrder - b.sortOrder)
      .map(({ level: _l, ...n }) => n);
  }

  async process(id: string, user: AuthUser): Promise<PortalProcessDto> {
    await this.access.assertAccess(user);
    const { pub, process } = await this.access.publicationOf('PROCESS', id, user);
    const p = process!;
    const [version, department, tree, links] = await Promise.all([
      this.prisma.processVersion.findUnique({
        where: { processId_versionNumber: { processId: id, versionNumber: pub.versionNumber } },
        select: { bpmnXml: true },
      }),
      p.departmentId
        ? this.prisma.department.findUnique({
            where: { id: p.departmentId },
            select: { id: true, nameEn: true, nameAr: true },
          })
        : null,
      this.processTree(user),
      this.prisma.publishedLink.findMany({
        where: { publicationId: pub.id, repoObject: { deletedAt: null } },
        include: {
          repoObject: {
            select: {
              id: true,
              type: true,
              code: true,
              nameEn: true,
              nameAr: true,
              descriptionEn: true,
              descriptionAr: true,
            },
          },
        },
      }),
    ]);
    const byId = new Map(tree.map((n) => [n.id, n]));
    const node = byId.get(id)!;
    const ancestors: PortalProcessDto['ancestors'] = [];
    let parent = node.parentId;
    while (parent && byId.has(parent)) {
      const a = byId.get(parent)!;
      ancestors.unshift({ id: a.id, code: a.code, nameEn: a.nameEn, nameAr: a.nameAr });
      parent = a.parentId;
    }
    const xml = version?.bpmnXml ?? null;
    const drill = new Set([...(xml ?? '').matchAll(LINKED_PROCESS)].map((m) => m[1].toLowerCase()));
    const related = await this.relatedPages(id, user);
    return {
      ...node,
      descriptionEn: pub.descriptionEn,
      descriptionAr: pub.descriptionAr,
      department,
      bpmnXml: xml,
      meta: await this.meta(pub, p.ownerId, p.nextReviewAt),
      ancestors,
      children: tree.filter((n) => n.parentId === id),
      links: links.map((l) => ({
        bpmnElementId: l.bpmnElementId,
        relation: l.relation as LinkRelation,
        object: { ...l.repoObject, type: l.repoObject.type as ObjectType },
      })),
      drillTargets: tree
        .filter((n) => drill.has(n.id))
        .map((n) => ({ id: n.id, code: n.code, nameEn: n.nameEn, nameAr: n.nameAr })),
      relatedPages: related,
    };
  }

  private async relatedPages(processId: string, user: AuthUser): Promise<PortalItemDto[]> {
    const links = await this.prisma.pageLink.findMany({
      where: { processId },
      select: { pageId: true },
    });
    if (!links.length) return [];
    const v = await this.visible(user, {
      entityType: 'PAGE',
      entityId: { in: links.map((l) => l.pageId) },
    });
    return v.pubs.map((p) => this.toItem(p, v)).filter((i): i is PortalItemDto => !!i);
  }

  // ---------- Documentation ----------

  async spaces(user: AuthUser): Promise<PortalSpaceDto[]> {
    await this.access.assertAccess(user);
    const spaces = await this.access.visibleSpaces(user);
    const v = await this.visible(user, { entityType: 'PAGE' });
    const counts = new Map<string, number>();
    for (const p of v.pages.values()) counts.set(p.spaceId, (counts.get(p.spaceId) ?? 0) + 1);
    return spaces
      .filter((s) => counts.get(s.id))
      .map((s) => this.spaceDto(s, counts.get(s.id) ?? 0));
  }

  private spaceDto(s: SpaceRow, pageCount: number): PortalSpaceDto {
    return {
      id: s.id,
      key: s.key,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      descriptionEn: s.descriptionEn,
      descriptionAr: s.descriptionAr,
      icon: s.icon as SpaceIcon,
      pageCount,
    };
  }

  async spacePages(spaceId: string, user: AuthUser): Promise<PortalPageNodeDto[]> {
    await this.access.assertAccess(user);
    const space = (await this.access.visibleSpaces(user)).find((s) => s.id === spaceId);
    if (!space) throw notFound('Space');
    return this.pageNodes(spaceId, user);
  }

  private async pageNodes(spaceId: string, user: AuthUser): Promise<PortalPageNodeDto[]> {
    const v = await this.visible(user, { entityType: 'PAGE' });
    const all = await this.prisma.page.findMany({
      where: { spaceId, deletedAt: null },
      select: { id: true, parentId: true },
    });
    const nodes = v.pubs.flatMap((pub) => {
      const p = v.pages.get(pub.entityId);
      if (!p || p.spaceId !== spaceId) return [];
      return [
        {
          id: p.id,
          spaceId,
          parentId: p.parentId,
          sortOrder: p.sortOrder,
          titleEn: pub.titleEn,
          titleAr: pub.titleAr,
          hasEn: !!(pub.titleEn.trim() || pub.textEn.trim()),
          hasAr: !!(pub.titleAr.trim() || pub.textAr.trim()),
        },
      ];
    });
    return publishedForest(all, nodes).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async page(id: string, user: AuthUser): Promise<PortalPageDto> {
    await this.access.assertAccess(user);
    const { pub, page, space } = await this.access.publicationOf('PAGE', id, user);
    const [version, nodes, links] = await Promise.all([
      this.prisma.pageVersion.findUniqueOrThrow({
        where: { pageId_versionNumber: { pageId: id, versionNumber: pub.versionNumber } },
      }),
      this.pageNodes(page!.spaceId, user),
      this.prisma.pageLink.findMany({
        where: { pageId: id, processId: { not: null } },
        select: { processId: true },
      }),
    ]);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const node = byId.get(id)!;
    const ancestors: PageRefDto[] = [];
    let parent = node.parentId;
    while (parent && byId.has(parent)) {
      const a = byId.get(parent)!;
      ancestors.unshift({ id: a.id, titleEn: a.titleEn, titleAr: a.titleAr });
      parent = a.parentId;
    }
    const processIds = links.map((l) => l.processId!);
    const v = processIds.length
      ? await this.visible(user, { entityType: 'PROCESS', entityId: { in: processIds } })
      : null;
    return {
      ...node,
      space: this.spaceDto(space!, nodes.length),
      titleEn: version.titleEn,
      titleAr: version.titleAr,
      contentEn: version.contentEn,
      contentAr: version.contentAr,
      dirEn: dir(version.dirEn),
      dirAr: dir(version.dirAr),
      meta: await this.meta(pub, page!.ownerId ?? space!.ownerId, page!.nextReviewAt),
      ancestors,
      children: nodes
        .filter((n) => n.parentId === id)
        .map((n) => ({ id: n.id, titleEn: n.titleEn, titleAr: n.titleAr })),
      relatedProcesses: v
        ? v.pubs.map((p) => this.toItem(p, v)).filter((i): i is PortalItemDto => !!i)
        : [],
    };
  }

  /** Files of a published page: only those its published version references. */
  async attachment(id: string, user: AuthUser) {
    await this.access.assertAccess(user);
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    if (!a) throw notFound('Attachment');
    const { pub } = await this.access.publicationOf('PAGE', a.pageId, user).catch(() => {
      throw notFound('Attachment');
    });
    const v = await this.prisma.pageVersion.findUniqueOrThrow({
      where: { pageId_versionNumber: { pageId: a.pageId, versionNumber: pub.versionNumber } },
      select: { contentEn: true, contentAr: true },
    });
    if (!referencedAttachmentIds(v.contentEn + v.contentAr).includes(id.toLowerCase())) {
      throw notFound('Attachment');
    }
    return {
      stream: await this.storage.get(a.storageKey),
      contentType: a.contentType,
      fileName: a.fileName,
      isImage: a.contentType.startsWith('image/'),
      size: a.size,
    };
  }

  // ---------- Search ----------

  async search(q: PortalSearchQuery, user: AuthUser): Promise<PortalSearchResultDto> {
    await this.access.assertAccess(user);
    const empty = { items: [], total: 0, page: q.page, pageSize: q.pageSize };
    const tsq = toPrefixTsQuery(q.q);
    if (!tsq) return empty;
    const v = await this.visible(user);
    const processIds =
      q.type === 'pages' || q.spaceId
        ? []
        : [...v.processes.values()]
            .filter((p) => !q.category || p.category === q.category)
            .map((p) => p.id);
    const pageIds =
      q.type === 'processes' || q.category
        ? []
        : [...v.pages.values()]
            .filter((p) => !q.spaceId || p.spaceId === q.spaceId)
            .map((p) => p.id);
    if (!processIds.length && !pageIds.length) return empty;
    const prefix = `${escapeLike(q.q.trim())}%`;
    const where = Prisma.sql`p."current"
      AND (p."searchVector" @@ query OR p."code" ILIKE ${prefix})
      AND ((p."entityType"::text = 'PROCESS' AND p."entityId" = ANY(${processIds}::uuid[]))
        OR (p."entityType"::text = 'PAGE' AND p."entityId" = ANY(${pageIds}::uuid[])))`;
    const withQuery = Prisma.sql`WITH q AS (SELECT to_tsquery('english', ${tsq}) || to_tsquery('arabic', ${tsq}) AS query)`;
    const [rows, count] = await Promise.all([
      this.prisma.$queryRaw<
        { id: string; type: ContentType; snippet: string | null; rank: number }[]
      >`${withQuery}
        SELECT p."id", p."entityType"::text AS "type",
          (ts_rank(p."searchVector", query) + CASE WHEN p."code" ILIKE ${prefix} THEN 1 ELSE 0 END)::real AS "rank",
          CASE WHEN to_tsvector('english', p."descriptionEn" || ' ' || p."textEn") @@ query
            THEN ts_headline('english', p."descriptionEn" || ' ' || p."textEn", query, ${HEADLINE})
            ELSE ts_headline('arabic', p."descriptionAr" || ' ' || p."textAr", query, ${HEADLINE}) END AS "snippet"
        FROM "Publication" p, q
        WHERE ${where}
        ORDER BY "rank" DESC, p."publishedAt" DESC
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`${withQuery}
        SELECT count(*) AS total FROM "Publication" p, q WHERE ${where}`,
    ]);
    const pubById = new Map(v.pubs.map((p) => [p.id, p]));
    const items = rows.flatMap((r) => {
      const pub = pubById.get(r.id);
      const item = pub ? this.toItem(pub, v) : null;
      return item ? [{ ...item, snippet: r.snippet ?? '', rank: Number(r.rank) }] : [];
    });
    return { items, total: Number(count[0]?.total ?? 0), page: q.page, pageSize: q.pageSize };
  }

  // ---------- My processes ----------

  async my(user: AuthUser): Promise<MyPortalDto> {
    await this.access.assertAccess(user);
    const [jobRoles, department] = await Promise.all([
      this.prisma.userJobRole.findMany({
        where: { userId: user.id, repoObject: { deletedAt: null } },
        include: { repoObject: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
      }),
      user.departmentId
        ? this.prisma.department.findUnique({
            where: { id: user.departmentId },
            select: { id: true, nameEn: true, nameAr: true },
          })
        : null,
    ]);
    const roleIds = jobRoles.map((j) => j.repoObjectId);
    const v = await this.visible(user);
    const processPubs = v.pubs.filter((p) => p.entityType === 'PROCESS');
    const performed = roleIds.length
      ? await this.prisma.publishedLink.findMany({
          where: {
            publicationId: { in: processPubs.map((p) => p.id) },
            repoObjectId: { in: roleIds },
            relation: 'PERFORMS',
          },
        })
      : [];
    const stepsByPub = new Map<string, string[]>();
    for (const l of performed)
      stepsByPub.set(l.publicationId, [
        ...(stepsByPub.get(l.publicationId) ?? []),
        l.bpmnElementId,
      ]);

    const processes: MyPortalItemDto[] = [];
    const reasonsByProcess = new Map<string, InvolvementReason[]>();
    for (const pub of processPubs) {
      const p = v.processes.get(pub.entityId)!;
      const reasons: InvolvementReason[] = [];
      if (p.ownerId === user.id) reasons.push('OWNER');
      if (user.departmentId && p.departmentId === user.departmentId) reasons.push('DEPARTMENT');
      const stepIds = stepsByPub.get(pub.id) ?? [];
      if (stepIds.length) reasons.push('ROLE');
      if (!reasons.length) continue;
      reasonsByProcess.set(p.id, reasons);
      let steps: MyPortalItemDto['steps'] = [];
      if (stepIds.length) {
        const ver = await this.prisma.processVersion.findUnique({
          where: { processId_versionNumber: { processId: p.id, versionNumber: pub.versionNumber } },
          select: { bpmnXml: true },
        });
        const labels = extractBpmnLabels(ver?.bpmnXml ?? '');
        steps = [...new Set(stepIds)].map((id) => {
          const l = labels.get(id);
          return { bpmnElementId: id, nameEn: l?.nameEn || l?.name || '', nameAr: l?.nameAr ?? '' };
        });
      }
      processes.push({ ...this.toItem(pub, v)!, reasons, steps });
    }

    const pageLinks = await this.prisma.pageLink.findMany({
      where: {
        pageId: { in: [...v.pages.keys()] },
        OR: [
          { processId: { in: [...reasonsByProcess.keys()] } },
          { repoObjectId: { in: roleIds } },
        ],
      },
    });
    const pages: MyPortalItemDto[] = [];
    for (const pub of v.pubs.filter((p) => p.entityType === 'PAGE')) {
      const p = v.pages.get(pub.entityId)!;
      const reasons = new Set<InvolvementReason>();
      if ((p.ownerId ?? p.space.ownerId) === user.id) reasons.add('OWNER');
      if (user.departmentId && p.space.departmentId === user.departmentId)
        reasons.add('DEPARTMENT');
      for (const l of pageLinks.filter((x) => x.pageId === p.id)) {
        if (l.repoObjectId) reasons.add('ROLE');
        if (l.processId) for (const r of reasonsByProcess.get(l.processId) ?? []) reasons.add(r);
      }
      if (reasons.size) pages.push({ ...this.toItem(pub, v)!, reasons: [...reasons], steps: [] });
    }
    return { processes, pages, jobRoles: jobRoles.map((j) => j.repoObject), department };
  }
}
