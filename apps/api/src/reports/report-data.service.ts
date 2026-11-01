import { HttpStatus, Injectable } from '@nestjs/common';
import {
  HANDBOOK_MAX_PROCESSES,
  PERMISSIONS,
  type LinkRelation,
  type ObjectType,
  type ProcessCategory,
  type ProcessStatus,
  type ReportSource,
  type UserRef,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PortalAccessService } from '../governance/portal-access.service';
import { ContentService } from '../governance/content.service';
import { DocsAccessService } from '../docs/docs-access.service';
import { AppException, badRequest, forbidden, notFound } from '../common/app-exception';
import type { AuthUser } from '../common/auth-user';

/** A process as the reports see it: names, governance data, model and links of one version. */
export interface ReportProcess {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  category: ProcessCategory;
  status: ProcessStatus;
  level: number;
  parentId: string | null;
  owner: UserRef | null;
  department: { nameEn: string; nameAr: string } | null;
  /** Working: latest saved version; published: the published version. */
  versionNumber: number | null;
  versionLabel: string | null;
  approvedAt: Date | null;
  approvedBy: UserRef[];
  publishedAt: Date | null;
  bpmnXml: string | null;
  links: {
    bpmnElementId: string;
    relation: LinkRelation;
    object: { id: string; type: ObjectType; code: string | null; nameEn: string; nameAr: string };
  }[];
  /** Linked documentation pages the user may read (published text in the published source). */
  pages: { id: string; titleEn: string; titleAr: string; textEn: string; textAr: string }[];
}

const objectSelect = { id: true, type: true, code: true, nameEn: true, nameAr: true } as const;

/**
 * Collects the content of reports (Modeler design B2, D-087) with the same rules as the screens:
 * the working source needs `processes.read` (and shows linked pages from spaces the user can
 * read); users without it — Viewers — always get the published source, limited to what the
 * Knowledge Portal shows them.
 */
@Injectable()
export class ReportDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portal: PortalAccessService,
    private readonly content: ContentService,
    private readonly docsAccess: DocsAccessService,
  ) {}

  /** The source a user gets: Viewers (no workspace access) are limited to published content. */
  sourceFor(user: AuthUser, wanted: ReportSource | undefined): ReportSource {
    const workspace = user.permissions.has(PERMISSIONS.PROCESSES_READ);
    if (!workspace) {
      if (!user.permissions.has(PERMISSIONS.PORTAL_READ)) throw forbidden();
      return 'published';
    }
    return wanted ?? 'working';
  }

  /** The process and (optionally) its branch, in process-house order (depth first, sort order). */
  private async branch(rootId: string, includeChildren: boolean, onlyIds?: Set<string>) {
    const all = await this.prisma.process.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true, sortOrder: true, code: true },
    });
    const root = all.find((p) => p.id === rootId);
    if (!root || (onlyIds && !onlyIds.has(rootId))) throw notFound('Process');
    if (!includeChildren) return [rootId];
    const children = new Map<string, typeof all>();
    for (const p of all) {
      if (!p.parentId) continue;
      children.set(p.parentId, [...(children.get(p.parentId) ?? []), p]);
    }
    const order: string[] = [];
    const walk = (id: string) => {
      if (onlyIds && !onlyIds.has(id)) return;
      order.push(id);
      for (const c of (children.get(id) ?? []).sort(
        (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
      ))
        walk(c.id);
    };
    walk(rootId);
    if (order.length > HANDBOOK_MAX_PROCESSES) throw badRequest('REPORT_TOO_LARGE');
    return order;
  }

  async collect(
    rootId: string,
    includeChildren: boolean,
    user: AuthUser,
    source: ReportSource,
  ): Promise<ReportProcess[]> {
    return source === 'published'
      ? this.collectPublished(rootId, includeChildren, user)
      : this.collectWorking(rootId, includeChildren, user);
  }

  private async processRows(ids: string[]) {
    const rows = await this.prisma.process.findMany({
      where: { id: { in: ids } },
      include: {
        department: { select: { nameEn: true, nameAr: true } },
        model: { select: { bpmnXml: true } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)!).filter(Boolean);
  }

  private async collectWorking(rootId: string, includeChildren: boolean, user: AuthUser) {
    const ids = await this.branch(rootId, includeChildren);
    const rows = await this.processRows(ids);
    const [links, versions, pubs, pageLinks] = await Promise.all([
      this.prisma.objectLink.findMany({
        where: { processId: { in: ids }, repoObject: { deletedAt: null } },
        include: { repoObject: { select: objectSelect } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.processVersion.findMany({
        where: { processId: { in: ids } },
        orderBy: { versionNumber: 'desc' },
        select: { processId: true, versionNumber: true, label: true },
      }),
      this.prisma.publication.findMany({
        where: { entityType: 'PROCESS', entityId: { in: ids }, current: true },
      }),
      this.prisma.pageLink.findMany({ where: { processId: { in: ids } } }),
    ]);
    // Linked pages from spaces the user may read in the workspace.
    const spaceIds = user.permissions.has(PERMISSIONS.DOCS_READ)
      ? await this.docsAccess.visibleSpaceIds(user)
      : [];
    const pages = await this.prisma.page.findMany({
      where: {
        id: { in: pageLinks.map((l) => l.pageId) },
        deletedAt: null,
        spaceId: { in: spaceIds },
      },
      select: { id: true, titleEn: true, titleAr: true, textEn: true, textAr: true },
      orderBy: { titleEn: 'asc' },
    });
    const users = await this.content.users([
      ...rows.map((r) => r.ownerId),
      ...pubs.flatMap((p) => p.approverIds),
    ]);
    return rows.map((p): ReportProcess => {
      const latest = versions.find((v) => v.processId === p.id);
      const pub = pubs.find((x) => x.entityId === p.id);
      const pageIds = new Set(pageLinks.filter((l) => l.processId === p.id).map((l) => l.pageId));
      return {
        ...this.base(p, users),
        versionNumber: latest?.versionNumber ?? null,
        versionLabel: latest?.label ?? null,
        approvedAt: pub?.approvedAt ?? null,
        approvedBy: (pub?.approverIds ?? []).map((id) => users.get(id)).filter((u) => !!u),
        publishedAt: pub?.publishedAt ?? null,
        bpmnXml: p.model?.bpmnXml ?? null,
        links: links
          .filter((l) => l.processId === p.id)
          .map((l) => ({
            bpmnElementId: l.bpmnElementId,
            relation: l.relation as LinkRelation,
            object: { ...l.repoObject, type: l.repoObject.type as ObjectType },
          })),
        pages: pages.filter((pg) => pageIds.has(pg.id)),
      };
    });
  }

  private async collectPublished(rootId: string, includeChildren: boolean, user: AuthUser) {
    await this.portal.assertAccess(user);
    const visible = await this.portal.publications(user);
    const processPubs = new Map(
      visible.filter((p) => p.entityType === 'PROCESS').map((p) => [p.entityId, p]),
    );
    if (!processPubs.has(rootId)) throw new AppException(HttpStatus.NOT_FOUND, 'NOT_PUBLISHED');
    const ids = await this.branch(rootId, includeChildren, new Set(processPubs.keys()));
    const rows = await this.processRows(ids);
    const pubIds = ids.map((id) => processPubs.get(id)!.id);
    const [versions, links, pageLinks] = await Promise.all([
      this.prisma.processVersion.findMany({
        where: {
          OR: ids.map((id) => ({
            processId: id,
            versionNumber: processPubs.get(id)!.versionNumber,
          })),
        },
        select: { processId: true, bpmnXml: true },
      }),
      this.prisma.publishedLink.findMany({
        where: { publicationId: { in: pubIds }, repoObject: { deletedAt: null } },
        include: { repoObject: { select: objectSelect } },
      }),
      this.prisma.pageLink.findMany({ where: { processId: { in: ids } } }),
    ]);
    const linkedPages = new Set(pageLinks.map((l) => l.pageId));
    const pagePubs = new Map(
      (
        await this.portal.withText(
          visible.filter((p) => p.entityType === 'PAGE' && linkedPages.has(p.entityId)),
          true,
        )
      ).map((p) => [p.entityId, p]),
    );
    const users = await this.content.users([
      ...rows.map((r) => r.ownerId),
      ...[...processPubs.values()].flatMap((p) => p.approverIds),
    ]);
    return rows.map((p): ReportProcess => {
      const pub = processPubs.get(p.id)!;
      return {
        ...this.base(p, users),
        // The published snapshot of name and description.
        nameEn: pub.titleEn || p.nameEn,
        nameAr: pub.titleAr || p.nameAr,
        descriptionEn: pub.descriptionEn,
        descriptionAr: pub.descriptionAr,
        versionNumber: pub.versionNumber,
        versionLabel: pub.versionLabel,
        approvedAt: pub.approvedAt,
        approvedBy: pub.approverIds.map((id) => users.get(id)).filter((u) => !!u),
        publishedAt: pub.publishedAt,
        bpmnXml: versions.find((v) => v.processId === p.id)?.bpmnXml ?? null,
        links: links
          .filter((l) => l.publicationId === pub.id)
          .map((l) => ({
            bpmnElementId: l.bpmnElementId,
            relation: l.relation as LinkRelation,
            object: { ...l.repoObject, type: l.repoObject.type as ObjectType },
          })),
        pages: pageLinks
          .filter((l) => l.processId === p.id && pagePubs.has(l.pageId))
          .map((l) => {
            const pp = pagePubs.get(l.pageId)!;
            return {
              id: l.pageId,
              titleEn: pp.titleEn,
              titleAr: pp.titleAr,
              textEn: pp.textEn,
              textAr: pp.textAr,
            };
          }),
      };
    });
  }

  private base(
    p: Awaited<ReturnType<ReportDataService['processRows']>>[number],
    users: Map<string, UserRef>,
  ) {
    return {
      id: p.id,
      code: p.code,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      descriptionEn: p.descriptionEn,
      descriptionAr: p.descriptionAr,
      category: p.category as ProcessCategory,
      status: p.status as ProcessStatus,
      level: p.level,
      parentId: p.parentId,
      owner: p.ownerId ? (users.get(p.ownerId) ?? null) : null,
      department: p.department,
    };
  }
}
