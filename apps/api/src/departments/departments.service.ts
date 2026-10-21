import { Injectable } from '@nestjs/common';
import type { Department } from '@prisma/client';
import {
  isSelfOrDescendant,
  type CreateDepartmentInput,
  type DepartmentDto,
  type UpdateDepartmentInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, diffFields } from '../audit/audit.service';
import { badRequest, conflict, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';

const FIELDS = ['code', 'nameEn', 'nameAr', 'parentId'];

function toDto(d: Department & { _count?: { users: number } }): DepartmentDto {
  return {
    id: d.id,
    code: d.code,
    nameEn: d.nameEn,
    nameAr: d.nameAr,
    parentId: d.parentId,
    userCount: d._count?.users ?? 0,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Departments are few; the full flat list is returned and the client builds the tree. */
  async list(): Promise<DepartmentDto[]> {
    const rows = await this.prisma.department.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
      orderBy: [{ nameEn: 'asc' }],
    });
    return rows.map(toDto);
  }

  async get(id: string) {
    const d = await this.prisma.department.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw notFound('Department');
    return d;
  }

  async create(input: CreateDepartmentInput, actor: AuthUser, meta: RequestMeta) {
    if (input.parentId) await this.assertParent(input.parentId);
    return this.prisma.$transaction(async (tx) => {
      const d = await tx.department.create({
        data: {
          code: input.code || null,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          parentId: input.parentId ?? null,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Department',
          entityId: d.id,
          userId: actor.id,
          summary: {
            after: { code: d.code, nameEn: d.nameEn, nameAr: d.nameAr, parentId: d.parentId },
          },
          meta,
        },
        tx,
      );
      return toDto(d);
    });
  }

  async update(id: string, input: UpdateDepartmentInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.get(id);
    if (input.parentId !== undefined && input.parentId !== null) {
      await this.assertParent(input.parentId);
      const all = await this.prisma.department.findMany({
        where: { deletedAt: null },
        select: { id: true, parentId: true },
      });
      if (isSelfOrDescendant(all, id, input.parentId)) {
        throw badRequest('INVALID_PARENT', 'A department cannot be moved under itself');
      }
    }
    const nameEn = input.nameEn ?? before.nameEn;
    const nameAr = input.nameAr ?? before.nameAr;
    if (!nameEn && !nameAr) throw badRequest('NAME_REQUIRED');
    return this.prisma.$transaction(async (tx) => {
      const d = await tx.department.update({
        where: { id },
        data: {
          code: input.code === undefined ? undefined : input.code || null,
          nameEn,
          nameAr,
          parentId: input.parentId,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Department',
          entityId: id,
          userId: actor.id,
          summary: { changes: diffFields(before, d, FIELDS) },
          meta,
        },
        tx,
      );
      return toDto(d);
    });
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const d = await this.get(id);
    const [children, users, processes] = await Promise.all([
      this.prisma.department.count({ where: { parentId: id, deletedAt: null } }),
      this.prisma.user.count({ where: { departmentId: id, deletedAt: null } }),
      this.prisma.process.count({ where: { departmentId: id, deletedAt: null } }),
    ]);
    if (children || users || processes) {
      throw conflict('DEPARTMENT_IN_USE', 'Department has sub-departments, users or processes');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.department.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Department',
          entityId: id,
          userId: actor.id,
          summary: { before: { code: d.code, nameEn: d.nameEn, nameAr: d.nameAr } },
          meta,
        },
        tx,
      );
    });
  }

  private async assertParent(parentId: string) {
    const p = await this.prisma.department.findFirst({ where: { id: parentId, deletedAt: null } });
    if (!p) throw badRequest('PARENT_NOT_FOUND');
  }
}
