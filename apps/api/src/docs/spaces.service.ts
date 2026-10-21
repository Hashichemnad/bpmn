import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  SYSTEM_ROLES,
  type CreateSpaceInput,
  type SpaceDto,
  type SpaceGrantDto,
  type SpaceIcon,
  type SpacePermissionsDto,
  type SpacePermissionsInput,
  type SpacePrincipalType,
  type SystemRoleKey,
  type UpdateSpaceInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, diffFields } from '../audit/audit.service';
import { badRequest, conflict } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { DocsAccessService, type SpaceWithGrants } from './docs-access.service';

const spaceInclude = {
  grants: true,
  owner: { select: { id: true, email: true, nameEn: true, nameAr: true } },
  department: { select: { id: true, nameEn: true, nameAr: true } },
  _count: { select: { pages: { where: { deletedAt: null } } } },
} satisfies Prisma.SpaceInclude;
type SpaceRow = Prisma.SpaceGetPayload<{ include: typeof spaceInclude }>;

const AUDIT_FIELDS = [
  'nameEn',
  'nameAr',
  'descriptionEn',
  'descriptionAr',
  'icon',
  'ownerId',
  'departmentId',
];

@Injectable()
export class SpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: DocsAccessService,
  ) {}

  private toDto(s: SpaceRow, user: AuthUser): SpaceDto {
    const a = this.access.access(user, s as SpaceWithGrants);
    return {
      id: s.id,
      key: s.key,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      descriptionEn: s.descriptionEn,
      descriptionAr: s.descriptionAr,
      icon: s.icon as SpaceIcon,
      owner: s.owner,
      department: s.department,
      viewRestricted: s.viewRestricted,
      editRestricted: s.editRestricted,
      workflowId: s.workflowId,
      pageCount: s._count.pages,
      canEdit: a.canEdit,
      canManage: a.canManage,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  async list(user: AuthUser): Promise<SpaceDto[]> {
    const rows = await this.prisma.space.findMany({
      where: { deletedAt: null },
      include: spaceInclude,
      orderBy: { key: 'asc' },
    });
    return rows
      .filter((s) => this.access.access(user, s as SpaceWithGrants).canView)
      .map((s) => this.toDto(s, user));
  }

  async get(id: string, user: AuthUser): Promise<SpaceDto> {
    await this.access.space(id, user);
    const row = await this.prisma.space.findUniqueOrThrow({ where: { id }, include: spaceInclude });
    return this.toDto(row, user);
  }

  async create(input: CreateSpaceInput, actor: AuthUser, meta: RequestMeta) {
    const existing = await this.prisma.space.findUnique({ where: { key: input.key } });
    if (existing) throw conflict('SPACE_KEY_TAKEN', 'Space key is already in use');
    await this.assertRefs(input.ownerId, input.departmentId);
    const space = await this.prisma.$transaction(async (tx) => {
      const s = await tx.space.create({
        data: {
          key: input.key,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          descriptionEn: input.descriptionEn ?? '',
          descriptionAr: input.descriptionAr ?? '',
          icon: input.icon ?? 'book',
          ownerId: input.ownerId ?? null,
          departmentId: input.departmentId ?? null,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Space',
          entityId: s.id,
          userId: actor.id,
          summary: { after: { key: s.key, nameEn: s.nameEn, nameAr: s.nameAr } },
          meta,
        },
        tx,
      );
      return s;
    });
    return this.get(space.id, actor);
  }

  async update(id: string, input: UpdateSpaceInput, actor: AuthUser, meta: RequestMeta) {
    const { space: before } = await this.access.space(id, actor, 'manage');
    await this.assertRefs(input.ownerId, input.departmentId);
    const nameEn = input.nameEn ?? before.nameEn;
    const nameAr = input.nameAr ?? before.nameAr;
    if (!nameEn && !nameAr) throw badRequest('NAME_REQUIRED');
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.space.update({
        where: { id },
        data: {
          nameEn,
          nameAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          icon: input.icon,
          ownerId: input.ownerId,
          departmentId: input.departmentId,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Space',
          entityId: id,
          userId: actor.id,
          summary: { changes: diffFields(before, after, AUDIT_FIELDS) },
          meta,
        },
        tx,
      );
    });
    return this.get(id, actor);
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const { space } = await this.access.space(id, actor, 'manage');
    const pages = await this.prisma.page.count({ where: { spaceId: id, deletedAt: null } });
    if (pages) throw conflict('SPACE_NOT_EMPTY', 'Delete or move the pages first');
    await this.prisma.$transaction(async (tx) => {
      await tx.space.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Space',
          entityId: id,
          userId: actor.id,
          summary: { before: { key: space.key, nameEn: space.nameEn, nameAr: space.nameAr } },
          meta,
        },
        tx,
      );
    });
  }

  async getPermissions(id: string, user: AuthUser): Promise<SpacePermissionsDto> {
    const { space } = await this.access.space(id, user, 'manage');
    return {
      viewRestricted: space.viewRestricted,
      editRestricted: space.editRestricted,
      grants: await this.labelGrants(space.grants),
    };
  }

  async setPermissions(
    id: string,
    input: SpacePermissionsInput,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<SpacePermissionsDto> {
    const { space } = await this.access.space(id, actor, 'manage');
    // One grant per principal: the highest access wins.
    const byPrincipal = new Map<string, SpacePermissionsInput['grants'][number]>();
    for (const g of input.grants) {
      const k = `${g.principalType}:${g.principalId}`;
      const prev = byPrincipal.get(k);
      if (!prev || g.access === 'EDIT') byPrincipal.set(k, g);
    }
    const grants = [...byPrincipal.values()];
    const userIds = grants.filter((g) => g.principalType === 'USER').map((g) => g.principalId);
    const deptIds = grants
      .filter((g) => g.principalType === 'DEPARTMENT')
      .map((g) => g.principalId);
    const [users, depts] = await Promise.all([
      this.prisma.user.count({ where: { id: { in: userIds }, deletedAt: null } }),
      this.prisma.department.count({ where: { id: { in: deptIds }, deletedAt: null } }),
    ]);
    if (users !== new Set(userIds).size || depts !== new Set(deptIds).size) {
      throw badRequest('INVALID_PRINCIPAL');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.space.update({
        where: { id },
        data: {
          viewRestricted: input.viewRestricted,
          editRestricted: input.editRestricted,
          updatedById: actor.id,
        },
      });
      await tx.spaceGrant.deleteMany({ where: { spaceId: id } });
      if (grants.length) {
        await tx.spaceGrant.createMany({ data: grants.map((g) => ({ ...g, spaceId: id })) });
      }
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Space',
          entityId: id,
          userId: actor.id,
          summary: {
            permissions: {
              before: {
                viewRestricted: space.viewRestricted,
                editRestricted: space.editRestricted,
                grants: space.grants.map((g) => `${g.principalType}:${g.principalId}:${g.access}`),
              },
              after: {
                viewRestricted: input.viewRestricted,
                editRestricted: input.editRestricted,
                grants: grants.map((g) => `${g.principalType}:${g.principalId}:${g.access}`),
              },
            },
          },
          meta,
        },
        tx,
      );
    });
    return this.getPermissions(id, actor);
  }

  private async labelGrants(grants: SpaceWithGrants['grants']): Promise<SpaceGrantDto[]> {
    const ids = (t: SpacePrincipalType) =>
      grants.filter((g) => g.principalType === t).map((g) => g.principalId);
    const [users, depts] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids('USER') } },
        select: { id: true, email: true, nameEn: true, nameAr: true },
      }),
      this.prisma.department.findMany({
        where: { id: { in: ids('DEPARTMENT') } },
        select: { id: true, nameEn: true, nameAr: true },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const deptById = new Map(depts.map((d) => [d.id, d]));
    return grants.map((g) => {
      let label: SpaceGrantDto['label'] = null;
      if (g.principalType === 'USER') {
        const u = userById.get(g.principalId);
        label = u ? { nameEn: u.nameEn, nameAr: u.nameAr, email: u.email } : null;
      } else if (g.principalType === 'DEPARTMENT') {
        const d = deptById.get(g.principalId);
        label = d ? { nameEn: d.nameEn, nameAr: d.nameAr } : null;
      } else {
        const r = SYSTEM_ROLES[g.principalId as SystemRoleKey];
        label = r ? { nameEn: r.nameEn, nameAr: r.nameAr } : null;
      }
      return {
        principalType: g.principalType as SpacePrincipalType,
        principalId: g.principalId,
        access: g.access,
        label,
      };
    });
  }

  private async assertRefs(ownerId?: string | null, departmentId?: string | null) {
    if (ownerId) {
      const u = await this.prisma.user.findFirst({ where: { id: ownerId, deletedAt: null } });
      if (!u) throw badRequest('OWNER_NOT_FOUND');
    }
    if (departmentId) {
      const d = await this.prisma.department.findFirst({
        where: { id: departmentId, deletedAt: null },
      });
      if (!d) throw badRequest('DEPARTMENT_NOT_FOUND');
    }
  }
}
