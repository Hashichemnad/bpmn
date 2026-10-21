import { Injectable } from '@nestjs/common';
import type { Locale, Permission, SystemRoleKey } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/auth-user';

export const userWithRolesInclude = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
} as const;

/** Loads the current user with effective permissions on every request (so changes apply immediately). */
@Injectable()
export class AuthUserLoader {
  constructor(private readonly prisma: PrismaService) {}

  async load(userId: string, tokenIssuedAt?: number): Promise<AuthUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: 'ACTIVE' },
      include: userWithRolesInclude,
    });
    if (!user) return null;
    // Tokens issued before the last password change are no longer valid.
    if (
      tokenIssuedAt !== undefined &&
      user.passwordChangedAt &&
      Math.floor(user.passwordChangedAt.getTime() / 1000) > tokenIssuedAt
    ) {
      return null;
    }
    const permissions = new Set<Permission>();
    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) permissions.add(rp.permission.key as Permission);
    }
    return {
      id: user.id,
      email: user.email,
      nameEn: user.nameEn,
      nameAr: user.nameAr,
      locale: user.locale as Locale,
      departmentId: user.departmentId,
      roles: user.roles.map((r) => r.role.key as SystemRoleKey),
      permissions,
    };
  }
}
