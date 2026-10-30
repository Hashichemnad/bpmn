import { Injectable } from '@nestjs/common';
import { PERMISSIONS, type Permission, type SystemRoleKey } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/auth-user';

/**
 * A task assigned to a user, to everyone with a system role, or (both empty) to anyone holding the
 * permission the task needs (notified: the Risk & Compliance editors among them).
 */
export interface Assignment {
  userId: string | null;
  roleKey: string | null;
}

/** Whether `user` is (one of) the assignees; the caller checks the task's permission. */
export function isAssignee(a: Assignment, user: AuthUser): boolean {
  if (a.userId) return a.userId === user.id;
  if (a.roleKey) return user.roles.includes(a.roleKey as SystemRoleKey);
  return true;
}

/** Resolves assignments to active users holding a permission (for notifications). */
@Injectable()
export class AssigneeResolver {
  constructor(private readonly prisma: PrismaService) {}

  async userIds(a: Assignment, permission: Permission): Promise<string[]> {
    if (a.userId) return [a.userId];
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        roles: {
          some: {
            role: {
              ...(a.roleKey ? { key: a.roleKey } : {}),
              permissions: {
                some: { permission: { key: a.roleKey ? permission : PERMISSIONS.GRC_EDIT } },
              },
            },
          },
        },
      },
      select: {
        id: true,
        roles: {
          select: {
            role: {
              select: { permissions: { select: { permission: { select: { key: true } } } } },
            },
          },
        },
      },
    });
    return users
      .filter((u) =>
        u.roles.some((r) => r.role.permissions.some((p) => p.permission.key === permission)),
      )
      .map((u) => u.id);
  }
}
