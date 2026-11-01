import { Injectable } from '@nestjs/common';
import { revokeUserSessions } from '../auth/sessions';
import { Prisma } from '@prisma/client';
import type {
  CreateUserInput,
  Locale,
  ResetPasswordInput,
  SystemRoleKey,
  UpdateUserInput,
  UserDto,
  UserListQuery,
  UserRef,
  UserStatus,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { badRequest, conflict, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { orderBy, pageArgs, paginated } from '../common/pagination';

const include = {
  roles: { include: { role: true } },
  department: { select: { id: true, nameEn: true, nameAr: true } },
  jobRoles: {
    where: { repoObject: { deletedAt: null } },
    include: { repoObject: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
  },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof include }>;

function toDto(u: UserRow): UserDto {
  return {
    id: u.id,
    email: u.email,
    nameEn: u.nameEn,
    nameAr: u.nameAr,
    locale: u.locale as Locale,
    status: u.status as UserStatus,
    roles: u.roles.map((r) => r.role.key as SystemRoleKey),
    department: u.department,
    jobRoles: u.jobRoles.map((j) => j.repoObject),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
    mfaEnabled: !!u.totpEnabledAt,
    ssoLinked: !!u.ssoSubject,
    hasPassword: u.passwordHash !== '',
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

const snapshot = (u: UserDto) => ({
  email: u.email,
  nameEn: u.nameEn,
  nameAr: u.nameAr,
  locale: u.locale,
  status: u.status,
  roles: u.roles,
  departmentId: u.department?.id ?? null,
  jobRoleIds: u.jobRoles.map((j) => j.id),
});

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
  ) {}

  async list(q: UserListQuery) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      status: q.status,
      departmentId: q.departmentId,
      roles: q.role ? { some: { role: { key: q.role } } } : undefined,
      ...(q.q
        ? {
            OR: [
              { email: { contains: q.q, mode: 'insensitive' } },
              { nameEn: { contains: q.q, mode: 'insensitive' } },
              { nameAr: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include,
        orderBy: orderBy(
          q,
          ['email', 'nameEn', 'nameAr', 'createdAt', 'lastLoginAt', 'status'],
          'email',
        ),
        ...pageArgs(q),
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, q);
  }

  async get(id: string): Promise<UserDto> {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, include });
    if (!u) throw notFound('User');
    return toDto(u);
  }

  async create(input: CreateUserInput, actor: AuthUser, meta: RequestMeta): Promise<UserDto> {
    this.assertCanGrant(input.roles, actor);
    this.passwords.assertPolicy(input.password);
    await this.assertEmailFree(input.email);
    if (input.departmentId) await this.assertDepartment(input.departmentId);
    if (input.jobRoleIds) await this.assertJobRoles(input.jobRoleIds);
    const roleIds = await this.roleIds(input.roles);
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          locale: input.locale,
          departmentId: input.departmentId ?? null,
          passwordHash,
          createdById: actor.id,
          updatedById: actor.id,
          roles: { create: roleIds.map((roleId) => ({ roleId })) },
          jobRoles: {
            create: [...new Set(input.jobRoleIds ?? [])].map((repoObjectId) => ({ repoObjectId })),
          },
        },
        include,
      });
      const dto = toDto(created);
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'User',
          entityId: created.id,
          userId: actor.id,
          summary: { after: snapshot(dto) },
          meta,
        },
        tx,
      );
      return dto;
    });
    return user;
  }

  async update(id: string, input: UpdateUserInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.get(id);
    if (input.roles) this.assertCanGrant(input.roles, actor);
    if (id === actor.id && (input.status === 'INACTIVE' || input.roles)) {
      throw badRequest(
        'CANNOT_CHANGE_OWN_ACCESS',
        'You cannot deactivate or change roles of yourself',
      );
    }
    if (before.roles.includes('SUPER_ADMIN') && !actor.roles.includes('SUPER_ADMIN')) {
      throw forbidden('Only a Super Admin can change a Super Admin');
    }
    if (input.email && input.email !== before.email) await this.assertEmailFree(input.email);
    if (input.departmentId) await this.assertDepartment(input.departmentId);
    if (input.jobRoleIds) await this.assertJobRoles(input.jobRoleIds);
    const nameEn = input.nameEn ?? before.nameEn;
    const nameAr = input.nameAr ?? before.nameAr;
    if (!nameEn && !nameAr) throw badRequest('NAME_REQUIRED');
    if (input.roles?.includes('SUPER_ADMIN') === false || input.status === 'INACTIVE') {
      await this.assertNotLastSuperAdmin(before, input);
    }
    const roleIds = input.roles ? await this.roleIds(input.roles) : null;

    return this.prisma.$transaction(async (tx) => {
      if (roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) });
      }
      if (input.jobRoleIds) {
        await tx.userJobRole.deleteMany({ where: { userId: id } });
        await tx.userJobRole.createMany({
          data: [...new Set(input.jobRoleIds)].map((repoObjectId) => ({
            userId: id,
            repoObjectId,
          })),
        });
      }
      const updated = await tx.user.update({
        where: { id },
        data: {
          email: input.email,
          nameEn,
          nameAr,
          locale: input.locale,
          departmentId: input.departmentId,
          status: input.status,
          updatedById: actor.id,
        },
        include,
      });
      if (input.status === 'INACTIVE') {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      const dto = toDto(updated);
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'User',
          entityId: id,
          userId: actor.id,
          summary: { before: snapshot(before), after: snapshot(dto) },
          meta,
        },
        tx,
      );
      return dto;
    });
  }

  async resetPassword(id: string, input: ResetPasswordInput, actor: AuthUser, meta: RequestMeta) {
    const target = await this.get(id);
    // Administrators cannot take over each other's accounts (SEC-38): resetting the password of an
    // Admin or Super Admin needs a Super Admin.
    if (
      target.id !== actor.id &&
      target.roles.some((r) => r === 'SUPER_ADMIN' || r === 'ADMIN') &&
      !actor.roles.includes('SUPER_ADMIN')
    ) {
      throw forbidden('Only a Super Admin can reset the password of an administrator');
    }
    this.passwords.assertPolicy(input.newPassword);
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(Math.floor(Date.now() / 1000) * 1000),
          failedLoginCount: 0,
          lockedUntil: null,
          updatedById: actor.id,
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(
        { action: 'PASSWORD_RESET', entityType: 'User', entityId: id, userId: actor.id, meta },
        tx,
      );
    });
  }

  /** Ends all sessions of a user (lost device, suspected misuse) — SEC-38. */
  async revokeSessions(id: string, actor: AuthUser, meta: RequestMeta) {
    const target = await this.get(id);
    if (target.roles.includes('SUPER_ADMIN') && !actor.roles.includes('SUPER_ADMIN'))
      throw forbidden('Only a Super Admin can end the sessions of a Super Admin');
    await this.prisma.$transaction(async (tx) => {
      await revokeUserSessions(tx, id);
      await this.audit.log(
        {
          action: 'REVOKE',
          entityType: 'User',
          entityId: id,
          userId: actor.id,
          summary: { sessions: 'all' },
          meta,
        },
        tx,
      );
    });
  }

  async unlock(id: string, actor: AuthUser, meta: RequestMeta) {
    await this.get(id);
    await this.prisma.user.update({
      where: { id },
      data: { failedLoginCount: 0, lockedUntil: null, updatedById: actor.id },
    });
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'User',
      entityId: id,
      userId: actor.id,
      summary: { unlocked: true },
      meta,
    });
    return this.get(id);
  }

  /** Only a Super Admin may grant the Super Admin role. */
  private assertCanGrant(roles: SystemRoleKey[], actor: AuthUser) {
    if (roles.includes('SUPER_ADMIN') && !actor.roles.includes('SUPER_ADMIN')) {
      throw forbidden('Only a Super Admin can grant the Super Admin role');
    }
  }

  private async assertNotLastSuperAdmin(before: UserDto, input: UpdateUserInput) {
    if (!before.roles.includes('SUPER_ADMIN')) return;
    const losesRole = input.roles && !input.roles.includes('SUPER_ADMIN');
    if (!losesRole && input.status !== 'INACTIVE') return;
    const others = await this.prisma.user.count({
      where: {
        id: { not: before.id },
        deletedAt: null,
        status: 'ACTIVE',
        roles: { some: { role: { key: 'SUPER_ADMIN' } } },
      },
    });
    if (others === 0)
      throw conflict('LAST_SUPER_ADMIN', 'At least one active Super Admin is required');
  }

  private async assertEmailFree(email: string) {
    const exists = await this.prisma.user.findFirst({ where: { email } });
    if (exists) throw conflict('EMAIL_TAKEN', 'Email is already in use');
  }

  private async assertJobRoles(ids: string[]) {
    const unique = [...new Set(ids)];
    const n = await this.prisma.repoObject.count({
      where: { id: { in: unique }, type: 'ROLE', deletedAt: null },
    });
    if (n !== unique.length) throw badRequest('OBJECT_NOT_FOUND');
  }

  /** Active users matching a name or email (mentions, workflow assignees). */
  async directory(q: string): Promise<UserRef[]> {
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: 'insensitive' } },
                { nameEn: { contains: q, mode: 'insensitive' } },
                { nameAr: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: { id: true, email: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: 'asc' },
      take: 20,
    });
  }

  private async assertDepartment(id: string) {
    const d = await this.prisma.department.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw badRequest('DEPARTMENT_NOT_FOUND');
  }

  private async roleIds(keys: SystemRoleKey[]): Promise<string[]> {
    const roles = await this.prisma.role.findMany({ where: { key: { in: keys } } });
    if (roles.length !== new Set(keys).size) throw badRequest('UNKNOWN_ROLE');
    return roles.map((r) => r.id);
  }
}
