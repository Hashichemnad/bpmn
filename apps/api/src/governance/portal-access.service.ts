import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  SETTING_KEYS,
  portalAccessAllowed,
  portalSpaceVisible,
  type ContentType,
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

  /** Current publications of live items, limited to what the user may see. */
  async publications(user: AuthUser, where: Prisma.PublicationWhereInput = {}) {
    const spaceIds = (await this.visibleSpaces(user)).map((s) => s.id);
    const [processIds, pageIds, diagramIds] = await Promise.all([
      this.liveProcessIds(),
      this.livePageIds(spaceIds),
      this.liveDiagramIds(),
    ]);
    return this.prisma.publication.findMany({
      where: {
        ...where,
        current: true,
        OR: [
          { entityType: 'PROCESS', entityId: { in: processIds } },
          { entityType: 'PAGE', entityId: { in: pageIds } },
          { entityType: 'DIAGRAM', entityId: { in: diagramIds } },
        ],
      },
      orderBy: { publishedAt: 'desc' },
    });
  }

  async liveProcessIds(): Promise<string[]> {
    const rows = await this.prisma.process.findMany({
      where: { deletedAt: null, status: { not: 'ARCHIVED' } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async liveDiagramIds(): Promise<string[]> {
    const rows = await this.prisma.diagram.findMany({
      where: { deletedAt: null, status: { not: 'ARCHIVED' } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async livePageIds(spaceIds: string[]): Promise<string[]> {
    const rows = await this.prisma.page.findMany({
      where: { deletedAt: null, status: { not: 'ARCHIVED' }, spaceId: { in: spaceIds } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
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
