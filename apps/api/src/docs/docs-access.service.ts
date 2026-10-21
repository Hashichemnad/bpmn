import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { spaceAccess, type SpaceAccess, type SpacePrincipalType } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { forbidden, notFound } from '../common/app-exception';
import type { AuthUser } from '../common/auth-user';

const spaceWithGrants = { grants: true } satisfies Prisma.SpaceInclude;
export type SpaceWithGrants = Prisma.SpaceGetPayload<{ include: typeof spaceWithGrants }>;

export type AccessNeed = 'view' | 'edit' | 'manage';

/** Resolves per-space permissions (see `spaceAccess` in the shared package). */
@Injectable()
export class DocsAccessService {
  constructor(private readonly prisma: PrismaService) {}

  access(user: AuthUser, space: SpaceWithGrants): SpaceAccess {
    return spaceAccess(user, {
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

  /** Throws NOT_FOUND when the user cannot see the space (its existence is not revealed). */
  check(user: AuthUser, space: SpaceWithGrants, need: AccessNeed): SpaceAccess {
    const a = this.access(user, space);
    if (!a.canView) throw notFound('Space');
    if (need === 'edit' && !a.canEdit) throw forbidden('You cannot edit this space');
    if (need === 'manage' && !a.canManage) throw forbidden('You cannot manage this space');
    return a;
  }

  async space(spaceId: string, user: AuthUser, need: AccessNeed = 'view') {
    const space = await this.prisma.space.findFirst({
      where: { id: spaceId, deletedAt: null },
      include: spaceWithGrants,
    });
    if (!space) throw notFound('Space');
    return { space, access: this.check(user, space, need) };
  }

  /** Loads an active page (or a deleted one with `deleted: true`) and checks access to its space. */
  async page(pageId: string, user: AuthUser, need: AccessNeed = 'view', deleted = false) {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, deletedAt: deleted ? { not: null } : null, space: { deletedAt: null } },
      include: { space: { include: spaceWithGrants } },
    });
    if (!page) throw notFound('Page');
    return { page, access: this.check(user, page.space, need) };
  }

  /** Ids of every active space the user may view (used to filter lists and search). */
  async visibleSpaceIds(user: AuthUser): Promise<string[]> {
    const spaces = await this.prisma.space.findMany({
      where: { deletedAt: null },
      include: spaceWithGrants,
    });
    return spaces.filter((s) => this.access(user, s).canView).map((s) => s.id);
  }
}
