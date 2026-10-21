import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PERMISSIONS,
  type CreateProcessInput,
  type MoveProcessInput,
  type ProcessCategory,
  type ProcessDto,
  type ProcessListQuery,
  type ProcessStatus,
  type ProcessSummaryDto,
  type UpdateProcessInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, diffFields } from '../audit/audit.service';
import { badRequest, conflict, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { orderBy, pageArgs, paginated } from '../common/pagination';
import { DomainEvents } from '../events/domain-events';
import { MoveError, nextSortOrder, planMove } from './process-tree';
import { assertEditable, markEdited, withdrawReviewsOf } from '../governance/edit-guard';

const summarySelect = {
  id: true,
  code: true,
  nameEn: true,
  nameAr: true,
  category: true,
  status: true,
  parentId: true,
  level: true,
  sortOrder: true,
  ownerId: true,
  departmentId: true,
} satisfies Prisma.ProcessSelect;

type SummaryRow = Prisma.ProcessGetPayload<{ select: typeof summarySelect }>;

const AUDIT_FIELDS = [
  'code',
  'nameEn',
  'nameAr',
  'descriptionEn',
  'descriptionAr',
  'category',
  'ownerId',
  'departmentId',
];

export function toSummary(p: SummaryRow): ProcessSummaryDto {
  return { ...p, category: p.category as ProcessCategory, status: p.status as ProcessStatus };
}

/** Whether the user may edit the process metadata. */
export function canEditProcess(user: AuthUser, p: { ownerId: string | null }): boolean {
  return (
    user.permissions.has(PERMISSIONS.PROCESSES_EDIT) ||
    (user.permissions.has(PERMISSIONS.PROCESSES_EDIT_OWN) && p.ownerId === user.id)
  );
}

/** Whether the user may edit the BPMN model and its object links. */
export function canEditModel(user: AuthUser, p: { ownerId: string | null }): boolean {
  return (
    user.permissions.has(PERMISSIONS.MODELS_EDIT) ||
    (user.permissions.has(PERMISSIONS.MODELS_EDIT_OWN) && p.ownerId === user.id)
  );
}

@Injectable()
export class ProcessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEvents,
  ) {}

  async list(q: ProcessListQuery) {
    const where: Prisma.ProcessWhereInput = {
      deletedAt: null,
      category: q.category,
      parentId: q.parentId === 'root' ? null : q.parentId,
      ownerId: q.ownerId,
      departmentId: q.departmentId,
      status: q.status,
      ...(q.q
        ? {
            OR: [
              { code: { contains: q.q, mode: 'insensitive' } },
              { nameEn: { contains: q.q, mode: 'insensitive' } },
              { nameAr: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.process.findMany({
        where,
        select: summarySelect,
        orderBy: orderBy(
          q,
          ['code', 'nameEn', 'nameAr', 'sortOrder', 'level', 'updatedAt'],
          'code',
        ),
        ...pageArgs(q),
      }),
      this.prisma.process.count({ where }),
    ]);
    return paginated(rows.map(toSummary), total, q);
  }

  /** Flat list of every active process; the client builds the tree and the process house. */
  async tree(): Promise<ProcessSummaryDto[]> {
    const rows = await this.prisma.process.findMany({
      where: { deletedAt: null },
      select: summarySelect,
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
    });
    return rows.map(toSummary);
  }

  async findActive(id: string) {
    const p = await this.prisma.process.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw notFound('Process');
    return p;
  }

  async get(id: string, user: AuthUser): Promise<ProcessDto> {
    const p = await this.prisma.process.findFirst({
      where: { id, deletedAt: null },
      include: {
        owner: { select: { id: true, email: true, nameEn: true, nameAr: true } },
        department: { select: { id: true, nameEn: true, nameAr: true } },
        children: {
          where: { deletedAt: null },
          select: summarySelect,
          orderBy: { sortOrder: 'asc' },
        },
        model: { select: { processId: true } },
      },
    });
    if (!p) throw notFound('Process');
    return {
      ...toSummary(p),
      descriptionEn: p.descriptionEn,
      descriptionAr: p.descriptionAr,
      owner: p.owner,
      department: p.department,
      children: p.children.map(toSummary),
      ancestors: await this.ancestors(p.parentId),
      hasModel: !!p.model,
      aiGenerated: p.aiGenerated,
      canEdit: canEditProcess(user, p),
      canEditModel: canEditModel(user, p),
      canDelete: user.permissions.has(PERMISSIONS.PROCESSES_DELETE),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private async ancestors(parentId: string | null) {
    const chain: ProcessDto['ancestors'] = [];
    let current = parentId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const p = await this.prisma.process.findUnique({
        where: { id: current },
        select: { id: true, code: true, nameEn: true, nameAr: true, parentId: true },
      });
      if (!p) break;
      chain.unshift({ id: p.id, code: p.code, nameEn: p.nameEn, nameAr: p.nameAr });
      current = p.parentId;
    }
    return chain;
  }

  async create(input: CreateProcessInput, actor: AuthUser, meta: RequestMeta) {
    await this.assertCodeFree(input.code);
    await this.assertRefs(input.ownerId, input.departmentId);
    const parent = input.parentId ? await this.findActive(input.parentId).catch(() => null) : null;
    if (input.parentId && !parent) throw badRequest('PARENT_NOT_FOUND');
    const category = (parent?.category ?? input.category) as ProcessCategory;
    const siblings = await this.prisma.process.findMany({
      where: { deletedAt: null, parentId: parent?.id ?? null },
      select: { id: true, parentId: true, category: true, level: true, sortOrder: true },
    });

    return this.prisma.$transaction(async (tx) => {
      const p = await tx.process.create({
        data: {
          code: input.code,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          descriptionEn: input.descriptionEn ?? '',
          descriptionAr: input.descriptionAr ?? '',
          category,
          parentId: parent?.id ?? null,
          level: parent ? parent.level + 1 : 1,
          sortOrder: nextSortOrder(siblings, parent?.id ?? null, category),
          ownerId: input.ownerId ?? null,
          departmentId: input.departmentId ?? null,
          createdById: actor.id,
          updatedById: actor.id,
        },
        select: summarySelect,
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Process',
          entityId: p.id,
          userId: actor.id,
          summary: {
            after: {
              code: p.code,
              nameEn: p.nameEn,
              nameAr: p.nameAr,
              category,
              parentId: p.parentId,
            },
          },
          meta,
        },
        tx,
      );
      return toSummary(p);
    });
  }

  async update(id: string, input: UpdateProcessInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.findActive(id);
    if (!canEditProcess(actor, before)) throw forbidden('You cannot edit this process');
    if (
      input.ownerId !== undefined &&
      input.ownerId !== before.ownerId &&
      !actor.permissions.has(PERMISSIONS.PROCESSES_EDIT)
    ) {
      throw forbidden('Only editors can change the process owner');
    }
    if (input.code && input.code.toLowerCase() !== before.code.toLowerCase()) {
      await this.assertCodeFree(input.code, id);
    }
    if (input.category && input.category !== before.category && before.parentId) {
      throw badRequest('CATEGORY_INHERITED', 'Sub-processes inherit the category of their parent');
    }
    await this.assertRefs(input.ownerId, input.departmentId);
    const nameEn = input.nameEn ?? before.nameEn;
    const nameAr = input.nameAr ?? before.nameAr;
    if (!nameEn && !nameAr) throw badRequest('NAME_REQUIRED');
    // Name, code and description are published content; owner and department are not.
    const contentChanged = (
      ['code', 'nameEn', 'nameAr', 'descriptionEn', 'descriptionAr', 'category'] as const
    ).some((f) => input[f] !== undefined && input[f] !== before[f]);
    if (contentChanged) await assertEditable(this.prisma, 'PROCESS', id);

    return this.prisma.$transaction(async (tx) => {
      if (contentChanged) await markEdited(tx, 'PROCESS', id, actor.id);
      const p = await tx.process.update({
        where: { id },
        data: {
          code: input.code,
          nameEn,
          nameAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          category: input.category,
          ownerId: input.ownerId,
          departmentId: input.departmentId,
          updatedById: actor.id,
        },
      });
      if (input.category && input.category !== before.category) {
        await this.cascadeCategory(tx, id, input.category);
      }
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Process',
          entityId: id,
          userId: actor.id,
          summary: { changes: diffFields(before, p, AUDIT_FIELDS) },
          meta,
        },
        tx,
      );
      return toSummary(p);
    });
  }

  private async cascadeCategory(
    tx: Prisma.TransactionClient,
    rootId: string,
    category: ProcessCategory,
  ) {
    let frontier = [rootId];
    while (frontier.length) {
      const children = await tx.process.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      });
      frontier = children.map((c) => c.id);
      if (frontier.length) {
        await tx.process.updateMany({ where: { id: { in: frontier } }, data: { category } });
      }
    }
  }

  async move(id: string, input: MoveProcessInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.findActive(id);
    const all = await this.prisma.process.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true, category: true, level: true, sortOrder: true },
    });
    let updates;
    try {
      updates = planMove(all, id, input);
    } catch (err) {
      if (err instanceof MoveError) {
        throw err.code === 'NOT_FOUND' ? notFound('Process') : badRequest(err.code);
      }
      throw err;
    }
    await this.prisma.$transaction(async (tx) => {
      for (const { id: rowId, ...data } of updates) {
        await tx.process.update({
          where: { id: rowId },
          data: rowId === id ? { ...data, updatedById: actor.id } : data,
        });
      }
      await this.audit.log(
        {
          action: 'MOVE',
          entityType: 'Process',
          entityId: id,
          userId: actor.id,
          summary: {
            from: {
              parentId: before.parentId,
              category: before.category,
              sortOrder: before.sortOrder,
            },
            to: input,
            affected: updates.length,
          },
          meta,
        },
        tx,
      );
    });
    return this.tree();
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const p = await this.findActive(id);
    const children = await this.prisma.process.count({ where: { parentId: id, deletedAt: null } });
    if (children) {
      throw conflict('PROCESS_HAS_CHILDREN', 'Delete or move the sub-processes first');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.process.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await withdrawReviewsOf(tx, 'PROCESS', [id]);
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Process',
          entityId: id,
          userId: actor.id,
          summary: {
            before: { code: p.code, nameEn: p.nameEn, nameAr: p.nameAr, category: p.category },
          },
          meta,
        },
        tx,
      );
    });
    this.events.emit({ type: 'process.removed', processId: id, actorId: actor.id });
  }

  private async assertCodeFree(code: string, exceptId?: string) {
    const existing = await this.prisma.process.findFirst({
      where: {
        code: { equals: code, mode: 'insensitive' },
        deletedAt: null,
        id: exceptId ? { not: exceptId } : undefined,
      },
    });
    if (existing) throw conflict('CODE_TAKEN', 'Process code is already in use');
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
