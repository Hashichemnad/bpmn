import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type Permission, type RoleDto, type SystemRoleKey, SYSTEM_ROLE_KEYS } from '@processhub/shared';
import { RequireAnyPermission } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireAnyPermission(PERMISSIONS.ROLES_READ, PERMISSIONS.USERS_MANAGE)
  async list(): Promise<RoleDto[]> {
    const roles = await this.prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
    });
    const order = (k: string) => SYSTEM_ROLE_KEYS.indexOf(k as SystemRoleKey);
    return roles
      .sort((a, b) => order(a.key) - order(b.key))
      .map((r) => ({
        id: r.id,
        key: r.key as SystemRoleKey,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        permissions: r.permissions.map((p) => p.permission.key as Permission).sort(),
      }));
  }
}
