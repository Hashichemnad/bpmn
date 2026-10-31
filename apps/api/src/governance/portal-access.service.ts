import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type ProcessCategory } from '@prisma/client';
import {
  SETTING_KEYS,
  portalAccessAllowed,
  portalSpaceVisible,
  type ContentType,
  type DiagramType,
  type PortalSettingsDto,
  type SpacePrincipalType,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException, notFound } from '../common/app-exception';
import type { AuthUser } from '../common/auth-user';
import { AUDIT_ENTITY } from './edit-guard';

export const DEFAULT_PORTAL: PortalSettingsDto = {
  nameEn: 'Knowledge Portal',
  nameAr: 'بوابة المعرفة',
  taglineEn: 'Official processes, procedures and policies — always the approved version.',
  taglineAr: 'العمليات والإجراءات والسياسات الرسمية — دائماً بالإصدار المعتمد.',
  access: { mode: 'ALL', departmentIds: [], roleKeys: [] },
  quickLinks: [],
  featured: [],
  startDiagramId: null,
};

type SpaceWithGrants = Prisma.SpaceGetPayload<{ include: { grants: true } }>;
/** A current publication as returned by `publications` (text empty until `withText`). */
export type Pub = Prisma.PublicationGetPayload<object>;

/** Limits `visibleItems`: to some content types, or (per type) to some item IDs. */
export interface PubFilter {
  types?: ContentType[];
  ids?: Partial<Record<ContentType, string[]>>;
}

/** Visible publications with the attributes of their items, by item ID. */
export interface VisibleItems {
  pubs: Pub[];
  /** `<type>:<item id>` → publication. */
  byKey: Map<string, Pub>;
  processes: Map<
    string,
    {
      id: string;
      parentId: string | null;
      category: ProcessCategory;
      sortOrder: number;
      level: number;
      ownerId: string | null;
      departmentId: string | null;
    }
  >;
  pages: Map<
    string,
    {
      id: string;
      spaceId: string;
      parentId: string | null;
      sortOrder: number;
      ownerId: string | null;
      space: {
        id: string;
        key: string;
        nameEn: string;
        nameAr: string;
        icon: string;
        ownerId: string | null;
        departmentId: string | null;
      };
    }
  >;
  diagrams: Map<
    string,
    {
      id: string;
      type: DiagramType;
      processId: string | null;
      ownerId: string | null;
      departmentId: string | null;
    }
  >;
}

type VisibleRow = Omit<Pub, 'textEn' | 'textAr'> & {
  prParentId: string | null;
  prCategory: string | null;
  prSortOrder: number | null;
  prLevel: number | null;
  prOwnerId: string | null;
  prDepartmentId: string | null;
  pgSpaceId: string | null;
  pgParentId: string | null;
  pgSortOrder: number | null;
  pgOwnerId: string | null;
  dType: string | null;
  dProcessId: string | null;
  dOwnerId: string | null;
  dDepartmentId: string | null;
};
/** Characters of the search text loaded for excerpts (the portal shows 220). */
const EXCERPT_CHARS = 240;

/**
 * The single gate for published content. Only current publications of items that are not
 * deleted or archived are ever returned, and pages only from spaces the user may see.
 */
@Injectable()
export class PortalAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async settings(): Promise<PortalSettingsDto> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.PORTAL } });
    const v = (row?.value ?? {}) as Partial<PortalSettingsDto>;
    return { ...DEFAULT_PORTAL, ...v, access: { ...DEFAULT_PORTAL.access, ...(v.access ?? {}) } };
  }

  async assertAccess(user: AuthUser): Promise<PortalSettingsDto> {
    const settings = await this.settings();
    if (!portalAccessAllowed(user, settings.access)) {
      throw new AppException(HttpStatus.FORBIDDEN, 'PORTAL_FORBIDDEN', 'No access to the portal');
    }
    return settings;
  }

  spaceVisible(user: AuthUser, space: SpaceWithGrants): boolean {
    return portalSpaceVisible(user, {
      ownerId: space.ownerId,
      viewRestricted: space.viewRestricted,
      editRestricted: space.editRestricted,
      grants: space.grants.map((g) => ({
        principalType: g.principalType as SpacePrincipalType,
        principalId: g.principalId,
        access: g.access,
      })),
    });
  }

  /** Spaces whose published pages the user may read in the portal. */
  async visibleSpaces(user: AuthUser): Promise<SpaceWithGrants[]> {
    const spaces = await this.prisma.space.findMany({
      where: { deletedAt: null },
      include: { grants: true },
      orderBy: { nameEn: 'asc' },
    });
    return spaces.filter((s) => this.spaceVisible(user, s));
  }

  /**
   * Current publications of live items, limited to what the user may see, with the attributes of
   * the item each one belongs to — one SQL query (was seven queries and ~20,000 rows on a full
   * repository, final session A). The search text (`textEn` / `textAr`, often several KB per page)
   * is not loaded: it comes back empty — use `withText` for the few publications whose excerpt or
   * full text is shown.
   */
  async visibleItems(user: AuthUser, filter: PubFilter = {}): Promise<VisibleItems> {
    const spaces = await this.visibleSpaces(user);
    const spaceById = new Map(spaces.map((sp) => [sp.id, sp]));
    const conditions: Prisma.Sql[] = [];
    if (filter.types) conditions.push(Prisma.sql`pub."entityType"::text = ANY(${filter.types})`);
    if (filter.ids) {
      const parts = Object.entries(filter.ids).map(
        ([type, ids]) =>
          Prisma.sql`(pub."entityType"::text = ${type} AND pub."entityId" = ANY(${ids ?? []}::uuid[]))`,
      );
      conditions.push(
        parts.length ? Prisma.sql`(${Prisma.join(parts, ' OR ')})` : Prisma.sql`FALSE`,
      );
    }
    const rows = await this.prisma.$queryRaw<VisibleRow[]>`
      SELECT pub."id", pub."entityType"::text AS "entityType", pub."entityId", pub."versionNumber",
        pub."versionLabel", pub."code", pub."titleEn", pub."titleAr", pub."descriptionEn",
        pub."descriptionAr", pub."reviewId", pub."approvedAt", pub."approverIds", pub."publishedAt",
        pub."publishedById", pub."current", pub."endedAt",
        pr."parentId" AS "prParentId", pr."category"::text AS "prCategory",
        pr."sortOrder" AS "prSortOrder", pr."level" AS "prLevel", pr."ownerId" AS "prOwnerId",
        pr."departmentId" AS "prDepartmentId",
        pg."spaceId" AS "pgSpaceId", pg."parentId" AS "pgParentId", pg."sortOrder" AS "pgSortOrder",
        pg."ownerId" AS "pgOwnerId",
        d."type"::text AS "dType", d."processId" AS "dProcessId", d."ownerId" AS "dOwnerId",
        d."departmentId" AS "dDepartmentId"
      FROM "Publication" pub
      LEFT JOIN "Process" pr ON pub."entityType" = 'PROCESS' AND pr."id" = pub."entityId"
        AND pr."deletedAt" IS NULL AND pr."status" <> 'ARCHIVED'
      LEFT JOIN "Page" pg ON pub."entityType" = 'PAGE' AND pg."id" = pub."entityId"
        AND pg."deletedAt" IS NULL AND pg."status" <> 'ARCHIVED'
        AND pg."spaceId" = ANY(${spaces.map((sp) => sp.id)}::uuid[])
      LEFT JOIN "Diagram" d ON pub."entityType" = 'DIAGRAM' AND d."id" = pub."entityId"
        AND d."deletedAt" IS NULL AND d."status" <> 'ARCHIVED'
      WHERE pub."current" AND (pr."id" IS NOT NULL OR pg."id" IS NOT NULL OR d."id" IS NOT NULL)
        ${conditions.length ? Prisma.sql`AND ${Prisma.join(conditions, ' AND ')}` : Prisma.empty}
      ORDER BY pub."publishedAt" DESC, pub."id"`;
    const result: VisibleItems = {
      pubs: [],
      byKey: new Map(),
      processes: new Map(),
      pages: new Map(),
      diagrams: new Map(),
    };
    for (const r of rows) {
      const pub: Pub = {
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        versionNumber: r.versionNumber,
        versionLabel: r.versionLabel,
        code: r.code,
        titleEn: r.titleEn,
        titleAr: r.titleAr,
        descriptionEn: r.descriptionEn,
        descriptionAr: r.descriptionAr,
        textEn: '',
        textAr: '',
        reviewId: r.reviewId,
        approvedAt: r.approvedAt,
        approverIds: r.approverIds ?? [],
        publishedAt: r.publishedAt,
        publishedById: r.publishedById,
        current: r.current,
        endedAt: r.endedAt,
      };
      result.pubs.push(pub);
      result.byKey.set(`${r.entityType}:${r.entityId}`, pub);
      if (r.entityType === 'PROCESS')
        result.processes.set(r.entityId, {
          id: r.entityId,
          parentId: r.prParentId,
          category: r.prCategory as ProcessCategory,
          sortOrder: r.prSortOrder!,
          level: r.prLevel!,
          ownerId: r.prOwnerId,
          departmentId: r.prDepartmentId,
        });
      else if (r.entityType === 'PAGE') {
        const sp = spaceById.get(r.pgSpaceId!)!;
        result.pages.set(r.entityId, {
          id: r.entityId,
          spaceId: sp.id,
          parentId: r.pgParentId,
          sortOrder: r.pgSortOrder!,
          ownerId: r.pgOwnerId,
          space: {
            id: sp.id,
            key: sp.key,
            nameEn: sp.nameEn,
            nameAr: sp.nameAr,
            icon: sp.icon,
            ownerId: sp.ownerId,
            departmentId: sp.departmentId,
          },
        });
      } else
        result.diagrams.set(r.entityId, {
          id: r.entityId,
          type: r.dType as DiagramType,
          processId: r.dProcessId,
          ownerId: r.dOwnerId,
          departmentId: r.dDepartmentId,
        });
    }
    return result;
  }

  /** The visible current publications only (see `visibleItems`). */
  async publications(user: AuthUser, filter: PubFilter = {}): Promise<Pub[]> {
    return (await this.visibleItems(user, filter)).pubs;
  }

  /**
   * Fills `textEn` / `textAr` of the given publications: the first characters (enough for an
   * excerpt and the "has content" check) or, with `full`, the whole search text.
   */
  async withText<T extends Pub>(pubs: T[], full = false): Promise<T[]> {
    const ids = pubs.filter((p) => full || p.entityType === 'PAGE').map((p) => p.id);
    if (!ids.length) return pubs;
    const rows = full
      ? await this.prisma.publication.findMany({
          where: { id: { in: ids } },
          select: { id: true, textEn: true, textAr: true },
        })
      : await this.prisma.$queryRaw<{ id: string; textEn: string; textAr: string }[]>`
          SELECT "id", left(btrim("textEn"), ${EXCERPT_CHARS}::int) AS "textEn",
            left(btrim("textAr"), ${EXCERPT_CHARS}::int) AS "textAr"
          FROM "Publication" WHERE "id" = ANY(${ids}::uuid[])`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    return pubs.map((p) => {
      const r = byId.get(p.id);
      return r ? { ...p, textEn: r.textEn, textAr: r.textAr } : p;
    });
  }

  /** The current publication of one item, or NOT_FOUND (never reveals unpublished items). */
  async publicationOf(type: ContentType, id: string, user: AuthUser) {
    const pub = await this.prisma.publication.findFirst({
      where: { entityType: type, entityId: id, current: true },
    });
    const missing = () => notFound(AUDIT_ENTITY[type]);
    if (!pub) throw missing();
    if (type === 'PROCESS') {
      const p = await this.prisma.process.findFirst({
        where: { id, deletedAt: null, status: { not: 'ARCHIVED' } },
      });
      if (!p) throw missing();
      return { pub, process: p, page: null, space: null, diagram: null };
    }
    if (type === 'DIAGRAM') {
      const d = await this.prisma.diagram.findFirst({
        where: { id, deletedAt: null, status: { not: 'ARCHIVED' } },
      });
      if (!d) throw missing();
      return { pub, process: null, page: null, space: null, diagram: d };
    }
    const page = await this.prisma.page.findFirst({
      where: { id, deletedAt: null, status: { not: 'ARCHIVED' }, space: { deletedAt: null } },
      include: { space: { include: { grants: true } } },
    });
    if (!page || !this.spaceVisible(user, page.space)) throw missing();
    return { pub, process: null, page, space: page.space, diagram: null };
  }
}
