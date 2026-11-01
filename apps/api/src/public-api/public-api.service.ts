import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SETTING_KEYS,
  resolveDiagramTheme,
  type Locale,
  type PublicListQuery,
  type PublicPage,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException, notFound } from '../common/app-exception';
import { RendererService } from '../renderer/renderer.service';
import { htmlToText } from '../docs/rich-text';
import type { ApiKeyPrincipal } from './api-keys.service';

/** Body plus the newest change among the returned rows (Last-Modified). */
export interface Dated<T> {
  body: T;
  lastModified: Date | null;
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const hours = (v: number | null | undefined) =>
  typeof v === 'number' ? Math.round(v * 10) / 10 : null;
const maxDate = (dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

function paging(q: PublicListQuery) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

function page<T>(items: T[], total: number, q: PublicListQuery): PublicPage<T> {
  return { items, total, page: q.page, pageSize: q.pageSize };
}

const textSearch = (q: string | undefined, fields: string[]) =>
  q
    ? {
        OR: fields.map((f) => ({ [f]: { contains: q, mode: 'insensitive' as const } })),
      }
    : {};

const unavailable = () =>
  new AppException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'RENDERER_UNAVAILABLE',
    'Diagram images are not available on this installation',
  );

/**
 * Data of the public REST API (`/api/public/v1`, D-173). What a key sees depends on its content
 * filter (published content only — default — or workspace drafts) and its department filter
 * (items without a department are then left out). Wiki pages of view-restricted spaces are never
 * returned; workflow statistics are aggregated (case-level data needs `workflow:cases:read`).
 */
@Injectable()
export class PublicApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: RendererService,
  ) {}

  private dept(key: ApiKeyPrincipal): { departmentId?: { in: string[] } } {
    return key.departmentIds.length ? { departmentId: { in: key.departmentIds } } : {};
  }

  private published(key: ApiKeyPrincipal) {
    return key.content === 'PUBLISHED';
  }

  // ---------- Processes ----------

  /** Current publications of processes (published mode), by process id. */
  private async processPubs(ids?: string[]) {
    const pubs = await this.prisma.publication.findMany({
      where: { entityType: 'PROCESS', current: true, ...(ids ? { entityId: { in: ids } } : {}) },
    });
    return new Map(pubs.map((p) => [p.entityId, p]));
  }

  private async visibleProcessWhere(key: ApiKeyPrincipal): Promise<Prisma.ProcessWhereInput> {
    const base: Prisma.ProcessWhereInput = { deletedAt: null, ...this.dept(key) };
    if (!this.published(key)) return base;
    const ids = (
      await this.prisma.publication.findMany({
        where: { entityType: 'PROCESS', current: true },
        select: { entityId: true },
      })
    ).map((p) => p.entityId);
    return { ...base, id: { in: ids } };
  }

  async processes(
    key: ApiKeyPrincipal,
    q: PublicListQuery & { category?: string; departmentId?: string; status?: string },
  ): Promise<Dated<PublicPage<unknown>>> {
    const where: Prisma.ProcessWhereInput = {
      AND: [
        await this.visibleProcessWhere(key),
        q.category ? { category: q.category as Prisma.EnumProcessCategoryFilter['equals'] } : {},
        q.departmentId ? { departmentId: q.departmentId } : {},
        q.status && !this.published(key)
          ? { status: q.status as Prisma.EnumProcessStatusFilter['equals'] }
          : {},
        q.updatedSince ? { updatedAt: { gt: new Date(q.updatedSince) } } : {},
        textSearch(q.q, ['code', 'nameEn', 'nameAr']),
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.process.findMany({
        where,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        ...paging(q),
        include: {
          owner: { select: { id: true, nameEn: true, nameAr: true } },
          department: { select: { id: true, nameEn: true, nameAr: true } },
        },
      }),
      this.prisma.process.count({ where }),
    ]);
    const pubs = await this.processPubs(rows.map((r) => r.id));
    const items = rows.map((p) => this.processDto(p, pubs.get(p.id) ?? null, key));
    return {
      body: page(items, total, q),
      lastModified: maxDate(rows.map((r) => r.updatedAt)),
    };
  }

  private processDto(
    p: Prisma.ProcessGetPayload<{
      include: {
        owner: { select: { id: true; nameEn: true; nameAr: true } };
        department: { select: { id: true; nameEn: true; nameAr: true } };
      };
    }>,
    pub: Prisma.PublicationGetPayload<object> | null,
    key: ApiKeyPrincipal,
  ) {
    // Published mode shows the published title / description (the draft may already differ).
    const usePub = this.published(key) && pub;
    return {
      id: p.id,
      code: usePub ? (pub.code ?? p.code) : p.code,
      nameEn: usePub ? pub.titleEn : p.nameEn,
      nameAr: usePub ? pub.titleAr : p.nameAr,
      descriptionEn: usePub ? pub.descriptionEn : p.descriptionEn,
      descriptionAr: usePub ? pub.descriptionAr : p.descriptionAr,
      category: p.category,
      level: p.level,
      parentId: p.parentId,
      sortOrder: p.sortOrder,
      status: this.published(key) ? 'PUBLISHED' : p.status,
      owner: p.owner,
      department: p.department,
      nextReviewAt: iso(p.nextReviewAt),
      publishedVersion: pub
        ? {
            versionNumber: pub.versionNumber,
            label: pub.versionLabel,
            approvedAt: iso(pub.approvedAt),
            publishedAt: iso(pub.publishedAt),
          }
        : null,
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async process(key: ApiKeyPrincipal, id: string): Promise<Dated<unknown>> {
    const p = await this.prisma.process.findFirst({
      where: { AND: [{ id }, await this.visibleProcessWhere(key)] },
      include: {
        owner: { select: { id: true, nameEn: true, nameAr: true } },
        department: { select: { id: true, nameEn: true, nameAr: true } },
      },
    });
    if (!p) throw notFound('Process');
    const pub = (await this.processPubs([id])).get(id) ?? null;
    return { body: this.processDto(p, pub, key), lastModified: p.updatedAt };
  }

  /** Process house: the visible processes as a tree per category. */
  async processHouse(key: ApiKeyPrincipal): Promise<Dated<unknown>> {
    const rows = await this.prisma.process.findMany({
      where: await this.visibleProcessWhere(key),
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        category: true,
        parentId: true,
        level: true,
        updatedAt: true,
      },
    });
    const pubs = this.published(key) ? await this.processPubs() : new Map();
    type Node = {
      id: string;
      code: string;
      nameEn: string;
      nameAr: string;
      level: number;
      children: Node[];
    };
    const nodes = new Map<string, Node & { category: string; parentId: string | null }>();
    for (const r of rows) {
      const pub = pubs.get(r.id);
      nodes.set(r.id, {
        id: r.id,
        code: pub?.code ?? r.code,
        nameEn: pub?.titleEn ?? r.nameEn,
        nameAr: pub?.titleAr ?? r.nameAr,
        level: r.level,
        category: r.category,
        parentId: r.parentId,
        children: [],
      });
    }
    const roots: Record<string, Node[]> = { MANAGEMENT: [], CORE: [], SUPPORT: [] };
    for (const n of nodes.values()) {
      const parent = n.parentId ? nodes.get(n.parentId) : undefined;
      // A process whose parent is not visible is shown at the top of its category.
      if (parent) parent.children.push(n);
      else (roots[n.category] ??= []).push(n);
    }
    const strip = (n: Node & { category?: string; parentId?: string | null }): Node => ({
      id: n.id,
      code: n.code,
      nameEn: n.nameEn,
      nameAr: n.nameAr,
      level: n.level,
      children: n.children.map(strip),
    });
    return {
      body: Object.fromEntries(Object.entries(roots).map(([k, v]) => [k, v.map(strip)])),
      lastModified: maxDate(rows.map((r) => r.updatedAt)),
    };
  }

  async processVersions(key: ApiKeyPrincipal, id: string): Promise<Dated<unknown>> {
    await this.process(key, id);
    if (this.published(key)) {
      const pubs = await this.prisma.publication.findMany({
        where: { entityType: 'PROCESS', entityId: id },
        orderBy: { publishedAt: 'desc' },
      });
      return {
        body: pubs.map((p) => ({
          versionNumber: p.versionNumber,
          label: p.versionLabel,
          current: p.current,
          approvedAt: iso(p.approvedAt),
          publishedAt: iso(p.publishedAt),
          endedAt: iso(p.endedAt),
        })),
        lastModified: maxDate(pubs.map((p) => p.endedAt ?? p.publishedAt)),
      };
    }
    const versions = await this.prisma.processVersion.findMany({
      where: { processId: id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true, label: true, changeNote: true, createdAt: true },
    });
    return {
      body: versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
      lastModified: maxDate(versions.map((v) => v.createdAt)),
    };
  }

  /** BPMN XML: the published version (or a given earlier published one); workspace keys get the working model. */
  async processBpmn(
    key: ApiKeyPrincipal,
    id: string,
    version?: number,
  ): Promise<Dated<{ xml: string; versionNumber: number | null }>> {
    await this.process(key, id);
    if (this.published(key) || version) {
      let versionNumber = version;
      if (this.published(key)) {
        const pub = version
          ? await this.prisma.publication.findFirst({
              where: { entityType: 'PROCESS', entityId: id, versionNumber: version },
            })
          : (await this.processPubs([id])).get(id);
        if (!pub) throw notFound('Published version');
        versionNumber = pub.versionNumber;
      }
      const v = await this.prisma.processVersion.findUnique({
        where: { processId_versionNumber: { processId: id, versionNumber: versionNumber! } },
      });
      if (!v) throw notFound('Version');
      return {
        body: { xml: v.bpmnXml, versionNumber: v.versionNumber },
        lastModified: v.createdAt,
      };
    }
    const model = await this.prisma.processModel.findUnique({ where: { processId: id } });
    if (!model) throw notFound('Model');
    return { body: { xml: model.bpmnXml, versionNumber: null }, lastModified: model.updatedAt };
  }

  async processSvg(
    key: ApiKeyPrincipal,
    id: string,
    locale: Locale,
    version?: number,
  ): Promise<Dated<Buffer>> {
    if (!this.renderer.enabled()) throw unavailable();
    const { body, lastModified } = await this.processBpmn(key, id, version);
    const image = await this.renderer.diagram({
      kind: 'bpmn',
      source: body.xml,
      locale,
      format: 'svg',
    });
    if (!image) throw unavailable();
    return { body: image.data, lastModified };
  }

  // ---------- Wiki ----------

  private spaceWhere(key: ApiKeyPrincipal): Prisma.SpaceWhereInput {
    return { deletedAt: null, viewRestricted: false, ...this.dept(key) };
  }

  async spaces(key: ApiKeyPrincipal, q: PublicListQuery): Promise<Dated<PublicPage<unknown>>> {
    const where: Prisma.SpaceWhereInput = {
      AND: [this.spaceWhere(key), textSearch(q.q, ['key', 'nameEn', 'nameAr'])],
    };
    const [rows, total] = await Promise.all([
      this.prisma.space.findMany({ where, orderBy: { key: 'asc' }, ...paging(q) }),
      this.prisma.space.count({ where }),
    ]);
    return {
      body: page(
        rows.map((s) => ({
          id: s.id,
          key: s.key,
          nameEn: s.nameEn,
          nameAr: s.nameAr,
          descriptionEn: s.descriptionEn,
          descriptionAr: s.descriptionAr,
          departmentId: s.departmentId,
          updatedAt: s.updatedAt.toISOString(),
        })),
        total,
        q,
      ),
      lastModified: maxDate(rows.map((r) => r.updatedAt)),
    };
  }

  private async pageWhere(key: ApiKeyPrincipal): Promise<Prisma.PageWhereInput> {
    const base: Prisma.PageWhereInput = { deletedAt: null, space: this.spaceWhere(key) };
    if (!this.published(key)) return base;
    const ids = (
      await this.prisma.publication.findMany({
        where: { entityType: 'PAGE', current: true },
        select: { entityId: true },
      })
    ).map((p) => p.entityId);
    return { ...base, id: { in: ids } };
  }

  async pages(
    key: ApiKeyPrincipal,
    q: PublicListQuery & { spaceId?: string },
  ): Promise<Dated<PublicPage<unknown>>> {
    const where: Prisma.PageWhereInput = {
      AND: [
        await this.pageWhere(key),
        q.spaceId ? { spaceId: q.spaceId } : {},
        q.updatedSince ? { updatedAt: { gt: new Date(q.updatedSince) } } : {},
        textSearch(q.q, ['titleEn', 'titleAr']),
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.page.findMany({
        where,
        orderBy: [{ spaceId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
        ...paging(q),
        select: {
          id: true,
          spaceId: true,
          parentId: true,
          sortOrder: true,
          titleEn: true,
          titleAr: true,
          status: true,
          updatedAt: true,
        },
      }),
      this.prisma.page.count({ where }),
    ]);
    const pubs = await this.pagePubs(rows.map((r) => r.id));
    return {
      body: page(
        rows.map((p) => {
          const pub = this.published(key) ? pubs.get(p.id) : undefined;
          return {
            id: p.id,
            spaceId: p.spaceId,
            parentId: p.parentId,
            sortOrder: p.sortOrder,
            titleEn: pub?.titleEn ?? p.titleEn,
            titleAr: pub?.titleAr ?? p.titleAr,
            status: this.published(key) ? 'PUBLISHED' : p.status,
            publishedVersion: pubs.get(p.id)?.versionNumber ?? null,
            updatedAt: p.updatedAt.toISOString(),
          };
        }),
        total,
        q,
      ),
      lastModified: maxDate(rows.map((r) => r.updatedAt)),
    };
  }

  private async pagePubs(ids: string[]) {
    const pubs = await this.prisma.publication.findMany({
      where: { entityType: 'PAGE', current: true, entityId: { in: ids } },
    });
    return new Map(pubs.map((p) => [p.entityId, p]));
  }

  async pageContent(
    key: ApiKeyPrincipal,
    id: string,
    format: 'html' | 'text',
  ): Promise<Dated<unknown>> {
    const p = await this.prisma.page.findFirst({
      where: { AND: [{ id }, await this.pageWhere(key)] },
    });
    if (!p) throw notFound('Page');
    let content = {
      versionNumber: null as number | null,
      titleEn: p.titleEn,
      titleAr: p.titleAr,
      contentEn: p.contentEn,
      contentAr: p.contentAr,
      dirEn: p.dirEn,
      dirAr: p.dirAr,
    };
    let lastModified = p.updatedAt;
    if (this.published(key)) {
      const pub = (await this.pagePubs([id])).get(id);
      const v = pub
        ? await this.prisma.pageVersion.findUnique({
            where: { pageId_versionNumber: { pageId: id, versionNumber: pub.versionNumber } },
          })
        : null;
      if (!v) throw notFound('Published version');
      content = {
        versionNumber: v.versionNumber,
        titleEn: v.titleEn,
        titleAr: v.titleAr,
        contentEn: v.contentEn,
        contentAr: v.contentAr,
        dirEn: v.dirEn,
        dirAr: v.dirAr,
      };
      lastModified = v.createdAt;
    }
    // Stored HTML is sanitised on save (same allow-list as the app); text is derived from it.
    const body = {
      id: p.id,
      spaceId: p.spaceId,
      versionNumber: content.versionNumber,
      titleEn: content.titleEn,
      titleAr: content.titleAr,
      dirEn: content.dirEn,
      dirAr: content.dirAr,
      ...(format === 'html'
        ? { htmlEn: content.contentEn, htmlAr: content.contentAr }
        : { textEn: htmlToText(content.contentEn), textAr: htmlToText(content.contentAr) }),
      updatedAt: lastModified.toISOString(),
    };
    return { body, lastModified };
  }

  // ---------- Diagrams ----------

  private async diagramWhere(key: ApiKeyPrincipal): Promise<Prisma.DiagramWhereInput> {
    const base: Prisma.DiagramWhereInput = { deletedAt: null, ...this.dept(key) };
    if (!this.published(key)) return base;
    const ids = (
      await this.prisma.publication.findMany({
        where: { entityType: 'DIAGRAM', current: true },
        select: { entityId: true },
      })
    ).map((p) => p.entityId);
    return { ...base, id: { in: ids } };
  }

  async diagrams(
    key: ApiKeyPrincipal,
    q: PublicListQuery & { type?: string },
  ): Promise<Dated<PublicPage<unknown>>> {
    const where: Prisma.DiagramWhereInput = {
      AND: [
        await this.diagramWhere(key),
        q.type ? { type: q.type as Prisma.EnumDiagramTypeFilter['equals'] } : {},
        q.updatedSince ? { updatedAt: { gt: new Date(q.updatedSince) } } : {},
        textSearch(q.q, ['code', 'nameEn', 'nameAr']),
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.diagram.findMany({
        where,
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        ...paging(q),
        select: {
          id: true,
          type: true,
          code: true,
          nameEn: true,
          nameAr: true,
          descriptionEn: true,
          descriptionAr: true,
          status: true,
          processId: true,
          departmentId: true,
          updatedAt: true,
        },
      }),
      this.prisma.diagram.count({ where }),
    ]);
    return {
      body: page(
        rows.map((d) => ({
          ...d,
          status: this.published(key) ? 'PUBLISHED' : d.status,
          updatedAt: d.updatedAt.toISOString(),
        })),
        total,
        q,
      ),
      lastModified: maxDate(rows.map((r) => r.updatedAt)),
    };
  }

  /** Diagram content: DMN 1.3 XML or the versioned JSON of the other types. */
  async diagram(key: ApiKeyPrincipal, id: string): Promise<Dated<unknown>> {
    const d = await this.prisma.diagram.findFirst({
      where: { AND: [{ id }, await this.diagramWhere(key)] },
    });
    if (!d) throw notFound('Diagram');
    let content = d.content;
    let versionNumber: number | null = null;
    let lastModified = d.contentUpdatedAt;
    if (this.published(key)) {
      const pub = await this.prisma.publication.findFirst({
        where: { entityType: 'DIAGRAM', entityId: id, current: true },
      });
      const v = pub
        ? await this.prisma.diagramVersion.findUnique({
            where: { diagramId_versionNumber: { diagramId: id, versionNumber: pub.versionNumber } },
          })
        : null;
      if (!v) throw notFound('Published version');
      content = v.content;
      versionNumber = v.versionNumber;
      lastModified = v.createdAt;
    }
    return {
      body: {
        id: d.id,
        type: d.type,
        code: d.code,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        versionNumber,
        format: d.type === 'DMN' ? 'dmn-xml' : 'json',
        content: d.type === 'DMN' ? content : (JSON.parse(content) as unknown),
      },
      lastModified,
    };
  }

  async diagramSvg(key: ApiKeyPrincipal, id: string, locale: Locale): Promise<Dated<Buffer>> {
    if (!this.renderer.enabled()) throw unavailable();
    const { body, lastModified } = (await this.diagram(key, id)) as Dated<{
      type: string;
      content: unknown;
    }>;
    if (body.type === 'DMN' || body.type === 'SIPOC') {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'NO_IMAGE_FOR_TYPE',
        'This diagram type is a table',
      );
    }
    const theme = resolveDiagramTheme(
      (await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.DIAGRAM_THEME } }))?.value,
    );
    const image = await this.renderer.diagram({
      kind: 'graph',
      source: JSON.stringify(body.content),
      locale,
      format: 'svg',
      theme,
    });
    if (!image) throw unavailable();
    return { body: image.data, lastModified };
  }

  // ---------- Library objects ----------

  async objects(
    key: ApiKeyPrincipal,
    q: PublicListQuery & { type?: string },
  ): Promise<Dated<PublicPage<unknown>>> {
    // Risks, controls, requirements and KPIs have their own scopes and endpoints.
    const types = ['ROLE', 'SYSTEM', 'DOCUMENT', 'TERM'] as const;
    const type = q.type && (types as readonly string[]).includes(q.type) ? q.type : undefined;
    const where: Prisma.RepoObjectWhereInput = {
      AND: [
        { deletedAt: null, type: type ? (type as (typeof types)[number]) : { in: [...types] } },
        // Dictionary drafts are not content yet.
        this.published(key) ? { OR: [{ type: { not: 'TERM' } }, { status: 'APPROVED' }] } : {},
        q.updatedSince ? { updatedAt: { gt: new Date(q.updatedSince) } } : {},
        textSearch(q.q, ['code', 'nameEn', 'nameAr']),
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.repoObject.findMany({
        where,
        orderBy: [{ type: 'asc' }, { nameEn: 'asc' }, { id: 'asc' }],
        ...paging(q),
        select: {
          id: true,
          type: true,
          code: true,
          nameEn: true,
          nameAr: true,
          descriptionEn: true,
          descriptionAr: true,
          status: true,
          category: true,
          updatedAt: true,
        },
      }),
      this.prisma.repoObject.count({ where }),
    ]);
    return {
      body: page(
        rows.map((o) => ({ ...o, updatedAt: o.updatedAt.toISOString() })),
        total,
        q,
      ),
      lastModified: maxDate(rows.map((r) => r.updatedAt)),
    };
  }

  // ---------- GRC ----------

  private grcStatus(key: ApiKeyPrincipal) {
    return this.published(key) ? { status: 'ACTIVE' as const } : {};
  }

  private objectBase(q: PublicListQuery) {
    return {
      deletedAt: null,
      ...(q.updatedSince ? { updatedAt: { gt: new Date(q.updatedSince) } } : {}),
      ...textSearch(q.q, ['code', 'nameEn', 'nameAr']),
    };
  }

  private objectFields(o: {
    id: string;
    code: string | null;
    nameEn: string;
    nameAr: string;
    descriptionEn: string;
    descriptionAr: string;
    updatedAt: Date;
  }) {
    return {
      id: o.id,
      code: o.code,
      nameEn: o.nameEn,
      nameAr: o.nameAr,
      descriptionEn: o.descriptionEn,
      descriptionAr: o.descriptionAr,
      updatedAt: o.updatedAt.toISOString(),
    };
  }

  async risks(key: ApiKeyPrincipal, q: PublicListQuery): Promise<Dated<PublicPage<unknown>>> {
    const where: Prisma.RiskWhereInput = {
      ...this.grcStatus(key),
      ...this.dept(key),
      object: this.objectBase(q),
    };
    const [rows, total] = await Promise.all([
      this.prisma.risk.findMany({
        where,
        orderBy: { object: { code: 'asc' } },
        ...paging(q),
        include: { object: true, controls: { select: { controlId: true } } },
      }),
      this.prisma.risk.count({ where }),
    ]);
    return {
      body: page(
        rows.map((r) => ({
          ...this.objectFields(r.object),
          category: r.category,
          departmentId: r.departmentId,
          status: r.status,
          response: r.response,
          inherentLikelihood: r.inherentLikelihood,
          inherentImpact: r.inherentImpact,
          inherentScore: r.inherentLikelihood * r.inherentImpact,
          residualLikelihood: r.residualLikelihood,
          residualImpact: r.residualImpact,
          residualScore:
            r.residualLikelihood && r.residualImpact
              ? r.residualLikelihood * r.residualImpact
              : null,
          lastAssessedAt: iso(r.lastAssessedAt),
          nextReviewAt: iso(r.nextReviewAt),
          controlIds: r.controls.map((c) => c.controlId),
        })),
        total,
        q,
      ),
      lastModified: maxDate(rows.map((r) => r.object.updatedAt)),
    };
  }

  async controls(key: ApiKeyPrincipal, q: PublicListQuery): Promise<Dated<PublicPage<unknown>>> {
    const where: Prisma.ControlWhereInput = {
      ...this.grcStatus(key),
      ...this.dept(key),
      object: this.objectBase(q),
    };
    const [rows, total] = await Promise.all([
      this.prisma.control.findMany({
        where,
        orderBy: { object: { code: 'asc' } },
        ...paging(q),
        include: { object: true },
      }),
      this.prisma.control.count({ where }),
    ]);
    return {
      body: page(
        rows.map((c) => ({
          ...this.objectFields(c.object),
          controlType: c.controlType,
          nature: c.nature,
          frequency: c.frequency,
          keyControl: c.keyControl,
          departmentId: c.departmentId,
          systemId: c.systemId,
          status: c.status,
          designEffectiveness: c.effectiveness,
          operatingEffectiveness: c.operatingEffectiveness,
          lastTestedAt: iso(c.lastTestedAt),
          nextReviewAt: iso(c.nextReviewAt),
        })),
        total,
        q,
      ),
      lastModified: maxDate(rows.map((r) => r.object.updatedAt)),
    };
  }

  async requirements(
    key: ApiKeyPrincipal,
    q: PublicListQuery,
  ): Promise<Dated<PublicPage<unknown>>> {
    const where: Prisma.RequirementWhereInput = {
      ...this.grcStatus(key),
      ...this.dept(key),
      object: this.objectBase(q),
    };
    const [rows, total] = await Promise.all([
      this.prisma.requirement.findMany({
        where,
        orderBy: { object: { code: 'asc' } },
        ...paging(q),
        include: { object: true },
      }),
      this.prisma.requirement.count({ where }),
    ]);
    return {
      body: page(
        rows.map((r) => ({
          ...this.objectFields(r.object),
          level: r.level,
          parentId: r.parentId,
          sourceRef: r.sourceRef,
          url: r.url,
          departmentId: r.departmentId,
          status: r.status,
          effectiveDate: iso(r.effectiveDate),
        })),
        total,
        q,
      ),
      lastModified: maxDate(rows.map((r) => r.object.updatedAt)),
    };
  }

  // ---------- Enterprise architecture ----------

  async applications(
    key: ApiKeyPrincipal,
    q: PublicListQuery,
  ): Promise<Dated<PublicPage<unknown>>> {
    const where: Prisma.ApplicationWhereInput = { ...this.dept(key), object: this.objectBase(q) };
    const [rows, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        orderBy: { object: { nameEn: 'asc' } },
        ...paging(q),
        include: { object: true },
      }),
      this.prisma.application.count({ where }),
    ]);
    return {
      body: page(
        rows.map((a) => ({
          ...this.objectFields(a.object),
          appType: a.appType,
          vendor: a.vendor,
          version: a.version,
          departmentId: a.departmentId,
          businessOwnerId: a.businessOwnerId,
          itOwnerId: a.itOwnerId,
          hosting: a.hosting,
          hostingCountry: a.hostingCountry,
          lifecycle: a.lifecycle,
          liveFrom: iso(a.liveFrom),
          phaseOutFrom: iso(a.phaseOutFrom),
          retiredAt: iso(a.retiredAt),
          criticality: a.criticality,
          dataClassification: a.dataClassification,
          url: a.url,
        })),
        total,
        q,
      ),
      lastModified: maxDate(rows.map((r) => r.object.updatedAt)),
    };
  }

  async capabilities(q: PublicListQuery): Promise<Dated<PublicPage<unknown>>> {
    const where: Prisma.CapabilityWhereInput = {
      deletedAt: null,
      ...(q.updatedSince ? { updatedAt: { gt: new Date(q.updatedSince) } } : {}),
      ...textSearch(q.q, ['code', 'nameEn', 'nameAr']),
    };
    const [rows, total] = await Promise.all([
      this.prisma.capability.findMany({
        where,
        orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
        ...paging(q),
        include: {
          processes: { select: { processId: true } },
          applications: { select: { applicationId: true } },
        },
      }),
      this.prisma.capability.count({ where }),
    ]);
    return {
      body: page(
        rows.map((c) => ({
          id: c.id,
          code: c.code,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          descriptionEn: c.descriptionEn,
          descriptionAr: c.descriptionAr,
          parentId: c.parentId,
          level: c.level,
          importance: c.importance,
          processIds: c.processes.map((p) => p.processId),
          applicationIds: c.applications.map((a) => a.applicationId),
          updatedAt: c.updatedAt.toISOString(),
        })),
        total,
        q,
      ),
      lastModified: maxDate(rows.map((r) => r.updatedAt)),
    };
  }

  // ---------- KPIs ----------

  private kpiWhere(key: ApiKeyPrincipal, q: PublicListQuery): Prisma.KpiWhereInput {
    return {
      ...(this.published(key) ? { status: 'ACTIVE' as const } : {}),
      ...this.dept(key),
      object: this.objectBase(q),
    };
  }

  async kpis(key: ApiKeyPrincipal, q: PublicListQuery): Promise<Dated<PublicPage<unknown>>> {
    const where = this.kpiWhere(key, q);
    const [rows, total] = await Promise.all([
      this.prisma.kpi.findMany({
        where,
        orderBy: { object: { code: 'asc' } },
        ...paging(q),
        include: {
          object: true,
          measurements: { orderBy: { periodStart: 'desc' }, take: 1 },
        },
      }),
      this.prisma.kpi.count({ where }),
    ]);
    return {
      body: page(
        rows.map((k) => ({
          ...this.objectFields(k.object),
          unit: k.unit,
          direction: k.direction,
          frequency: k.frequency,
          target: k.target,
          greenThreshold: k.greenThreshold,
          redThreshold: k.redThreshold,
          baseline: k.baseline,
          departmentId: k.departmentId,
          dataSource: k.dataSource,
          status: k.status,
          latest: k.measurements[0]
            ? {
                period: k.measurements[0].period,
                value: k.measurements[0].value,
                periodStart: k.measurements[0].periodStart.toISOString(),
              }
            : null,
        })),
        total,
        q,
      ),
      lastModified: maxDate(rows.map((r) => r.object.updatedAt)),
    };
  }

  async kpiMeasurements(
    key: ApiKeyPrincipal,
    kpiId: string,
    q: PublicListQuery,
  ): Promise<Dated<PublicPage<unknown>>> {
    const kpi = await this.prisma.kpi.findFirst({
      where: {
        objectId: kpiId,
        ...this.kpiWhere(key, { ...q, q: undefined, updatedSince: undefined }),
      },
    });
    if (!kpi) throw notFound('KPI');
    const where: Prisma.KpiMeasurementWhereInput = {
      kpiId,
      ...(q.updatedSince ? { updatedAt: { gt: new Date(q.updatedSince) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.kpiMeasurement.findMany({
        where,
        orderBy: { periodStart: 'desc' },
        ...paging(q),
      }),
      this.prisma.kpiMeasurement.count({ where }),
    ]);
    return {
      body: page(
        rows.map((m) => ({
          id: m.id,
          period: m.period,
          periodStart: m.periodStart.toISOString(),
          value: m.value,
          comment: m.comment,
          source: m.source,
          updatedAt: m.updatedAt.toISOString(),
        })),
        total,
        q,
      ),
      lastModified: maxDate(rows.map((r) => r.updatedAt)),
    };
  }

  // ---------- Workflow ----------

  /** Per executable process: case counts and durations (no case-level or personal data). */
  async workflowStatistics(key: ApiKeyPrincipal): Promise<Dated<unknown>> {
    const processWhere = await this.visibleProcessWhere(key);
    const processes = await this.prisma.process.findMany({
      where: { AND: [processWhere, { workflowConfig: { isNot: null } }] },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    const ids = processes.map((p) => p.id);
    if (!ids.length) return { body: [], lastModified: null };
    const now = new Date();
    const [byStatus, durations, overdueTasks, latest] = await Promise.all([
      this.prisma.workflowCase.groupBy({
        by: ['processId', 'status'],
        where: { processId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ processId: string; avgHours: number | null }[]>`
        SELECT "processId", avg(extract(epoch FROM ("completedAt" - "startedAt")) / 3600)::float AS "avgHours"
        FROM "WorkflowCase"
        WHERE "processId" = ANY(${ids}::uuid[]) AND status = 'COMPLETED' AND "completedAt" IS NOT NULL
        GROUP BY "processId"`,
      this.prisma.workflowTask.findMany({
        where: {
          status: 'OPEN',
          dueAt: { lt: now },
          case: { processId: { in: ids } },
        },
        select: { case: { select: { processId: true } } },
      }),
      this.prisma.workflowCase.aggregate({
        where: { processId: { in: ids } },
        _max: { updatedAt: true },
      }),
    ]);
    const avg = new Map(durations.map((d) => [d.processId, d.avgHours]));
    const overdue = new Map<string, number>();
    for (const t of overdueTasks)
      overdue.set(t.case.processId, (overdue.get(t.case.processId) ?? 0) + 1);
    return {
      body: processes.map((p) => {
        const counts = Object.fromEntries(
          byStatus.filter((s) => s.processId === p.id).map((s) => [s.status, s._count._all]),
        ) as Record<string, number>;
        return {
          processId: p.id,
          code: p.code,
          nameEn: p.nameEn,
          nameAr: p.nameAr,
          running: counts.RUNNING ?? 0,
          completed: counts.COMPLETED ?? 0,
          cancelled: (counts.CANCELLED ?? 0) + (counts.WITHDRAWN ?? 0),
          overdueTasks: overdue.get(p.id) ?? 0,
          avgCompletionHours: hours(avg.get(p.id)),
        };
      }),
      lastModified: latest._max.updatedAt,
    };
  }

  /** Case-level list (scope `workflow:cases:read`): number, status, dates, initiator. */
  async workflowCases(
    key: ApiKeyPrincipal,
    q: PublicListQuery & { processId?: string; status?: string },
  ): Promise<Dated<PublicPage<unknown>>> {
    const processWhere = await this.visibleProcessWhere(key);
    const where: Prisma.WorkflowCaseWhereInput = {
      process: processWhere,
      ...(q.processId ? { processId: q.processId } : {}),
      ...(q.status ? { status: q.status as Prisma.EnumWorkflowCaseStatusFilter['equals'] } : {}),
      ...(q.updatedSince ? { updatedAt: { gt: new Date(q.updatedSince) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.workflowCase.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        ...paging(q),
        select: {
          id: true,
          number: true,
          processId: true,
          status: true,
          outcome: true,
          titleEn: true,
          titleAr: true,
          initiatorId: true,
          departmentId: true,
          startedAt: true,
          completedAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.workflowCase.count({ where }),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.initiatorId).filter((v): v is string => !!v) } },
      select: { id: true, nameEn: true, nameAr: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      body: page(
        rows.map((c) => ({
          id: c.id,
          number: c.number,
          processId: c.processId,
          status: c.status,
          outcome: c.outcome,
          titleEn: c.titleEn,
          titleAr: c.titleAr,
          initiator: c.initiatorId ? (byId.get(c.initiatorId) ?? null) : null,
          departmentId: c.departmentId,
          startedAt: c.startedAt.toISOString(),
          completedAt: iso(c.completedAt),
          updatedAt: c.updatedAt.toISOString(),
        })),
        total,
        q,
      ),
      lastModified: maxDate(rows.map((r) => r.updatedAt)),
    };
  }
}
