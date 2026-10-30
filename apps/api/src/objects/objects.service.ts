import { Injectable } from '@nestjs/common';
import { Prisma, type RepoObject } from '@prisma/client';
import {
  PERMISSIONS,
  isGrcObjectType,
  extractBpmnLabels,
  type BpmnElementLabel,
  type ObjectStatus,
  type UserRef,
  type CreateObjectInput,
  type LinkRelation,
  type ObjectListQuery,
  type ObjectType,
  type ObjectUsageDto,
  type ProcessCategory,
  type RepoObjectDto,
  type UpdateObjectInput,
} from '@processhub/shared';
import { elementLabel } from '../models/bpmn-xml';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, diffFields } from '../audit/audit.service';
import { badRequest, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { orderBy, pageArgs, paginated } from '../common/pagination';

const FIELDS = [
  'code',
  'nameEn',
  'nameAr',
  'descriptionEn',
  'descriptionAr',
  'attributes',
  'category',
  'synonymsEn',
  'synonymsAr',
  'ownerId',
  'status',
];
/** Only links from active processes count as usage. */
export const activeLinks = { process: { deletedAt: null } } satisfies Prisma.ObjectLinkWhereInput;
const userRef = { select: { id: true, email: true, nameEn: true, nameAr: true } } as const;

type ObjectRow = RepoObject & { _count?: { links: number }; owner?: UserRef | null };

function toDto(o: ObjectRow, users: Map<string, UserRef> = new Map()): RepoObjectDto {
  return {
    id: o.id,
    type: o.type as ObjectType,
    code: o.code,
    nameEn: o.nameEn,
    nameAr: o.nameAr,
    descriptionEn: o.descriptionEn,
    descriptionAr: o.descriptionAr,
    attributes: (o.attributes ?? {}) as RepoObjectDto['attributes'],
    usageCount: o._count?.links ?? 0,
    status: o.status as ObjectStatus,
    category: o.category,
    synonymsEn: o.synonymsEn ?? [],
    synonymsAr: o.synonymsAr ?? [],
    owner: o.owner ?? null,
    createdBy: (o.createdById && users.get(o.createdById)) || null,
    approvedAt: o.approvedAt?.toISOString() ?? null,
    approvedBy: (o.approvedById && users.get(o.approvedById)) || null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

@Injectable()
export class ObjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(q: ObjectListQuery) {
    const where: Prisma.RepoObjectWhereInput = {
      deletedAt: null,
      type: q.type,
      status: q.status,
      ...(q.q
        ? {
            OR: [
              { code: { contains: q.q, mode: 'insensitive' } },
              { nameEn: { contains: q.q, mode: 'insensitive' } },
              { nameAr: { contains: q.q, mode: 'insensitive' } },
              { synonymsEn: { has: q.q } },
              { synonymsAr: { has: q.q } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.repoObject.findMany({
        where,
        include: {
          _count: { select: { links: { where: activeLinks } } },
          owner: userRef,
        },
        orderBy: orderBy(
          q,
          ['code', 'nameEn', 'nameAr', 'category', 'status', 'createdAt', 'updatedAt'],
          'nameEn',
        ),
        ...pageArgs(q),
      }),
      this.prisma.repoObject.count({ where }),
    ]);
    const users = await this.userRefs(rows);
    return paginated(
      rows.map((r) => toDto(r, users)),
      total,
      q,
    );
  }

  /** Proposers and approvers of the given objects (ids without a relation in the schema). */
  private async userRefs(rows: Pick<RepoObject, 'createdById' | 'approvedById'>[]) {
    const ids = [
      ...new Set(rows.flatMap((r) => [r.createdById, r.approvedById]).filter((v) => !!v)),
    ] as string[];
    if (!ids.length) return new Map<string, UserRef>();
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, ...userRef });
    return new Map(users.map((u) => [u.id, u]));
  }

  /** Active object or 404 (with owner). */
  async findActive(id: string) {
    const o = await this.prisma.repoObject.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { links: { where: activeLinks } } }, owner: userRef },
    });
    if (!o) throw notFound('Object');
    return o;
  }

  async get(id: string): Promise<RepoObjectDto> {
    const o = await this.findActive(id);
    return toDto(o, await this.userRefs([o]));
  }

  async usage(id: string): Promise<ObjectUsageDto[]> {
    await this.get(id);
    const links = await this.prisma.objectLink.findMany({
      where: { repoObjectId: id, ...activeLinks },
      include: {
        process: { select: { id: true, code: true, nameEn: true, nameAr: true, category: true } },
      },
      orderBy: [{ process: { code: 'asc' } }, { bpmnElementId: 'asc' }],
    });
    const models = await this.prisma.processModel.findMany({
      where: { processId: { in: [...new Set(links.map((l) => l.processId))] } },
      select: { processId: true, bpmnXml: true },
    });
    const labels = new Map<string, Map<string, BpmnElementLabel>>(
      models.map((m) => [m.processId, extractBpmnLabels(m.bpmnXml)]),
    );
    return links.map((l) => ({
      linkId: l.id,
      bpmnElementId: l.bpmnElementId,
      element: elementLabel(labels.get(l.processId) ?? new Map(), l.bpmnElementId),
      relation: l.relation as LinkRelation,
      process: { ...l.process, category: l.process.category as ProcessCategory },
    }));
  }

  /**
   * Dictionary terms are created as DRAFT (a proposal) unless the user may approve terms; an
   * approver may still choose DRAFT. Every other object type is always APPROVED.
   */
  async create(input: CreateObjectInput, actor: AuthUser, meta: RequestMeta) {
    // Risks, controls and requirements have their own register (Risk & Compliance, D-089).
    if (isGrcObjectType(input.type)) throw badRequest('USE_GRC_REGISTER');
    const approver = actor.permissions.has(PERMISSIONS.DICTIONARY_APPROVE);
    const status: ObjectStatus =
      input.type !== 'TERM' ? 'APPROVED' : approver ? (input.status ?? 'APPROVED') : 'DRAFT';
    await this.assertOwner(input.ownerId);
    const created = await this.prisma.$transaction(async (tx) => {
      const o = await tx.repoObject.create({
        data: {
          type: input.type,
          code: input.code || null,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          descriptionEn: input.descriptionEn ?? '',
          descriptionAr: input.descriptionAr ?? '',
          attributes: input.attributes,
          category: input.category || null,
          synonymsEn: input.synonymsEn ?? [],
          synonymsAr: input.synonymsAr ?? [],
          ownerId: input.ownerId ?? null,
          status,
          ...(status === 'APPROVED' && input.type === 'TERM'
            ? { approvedAt: new Date(), approvedById: actor.id }
            : {}),
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'RepoObject',
          entityId: o.id,
          userId: actor.id,
          summary: {
            after: {
              type: o.type,
              code: o.code,
              nameEn: o.nameEn,
              nameAr: o.nameAr,
              ...(o.type === 'TERM' ? { status: o.status } : {}),
            },
          },
          meta,
        },
        tx,
      );
      return o;
    });
    return this.get(created.id);
  }

  private async assertOwner(ownerId: string | null | undefined) {
    if (!ownerId) return;
    const user = await this.prisma.user.findFirst({ where: { id: ownerId, deletedAt: null } });
    if (!user) throw badRequest('INVALID_OWNER');
  }

  /** An approved term may only be changed by users who approve terms (others propose drafts). */
  private assertMayChange(o: RepoObject, actor: AuthUser) {
    if (
      o.type === 'TERM' &&
      o.status === 'APPROVED' &&
      !actor.permissions.has(PERMISSIONS.DICTIONARY_APPROVE)
    )
      throw forbidden('Only dictionary approvers can change an approved term');
  }

  async update(id: string, input: UpdateObjectInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.prisma.repoObject.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Object');
    if (isGrcObjectType(before.type)) throw badRequest('USE_GRC_REGISTER');
    this.assertMayChange(before, actor);
    const nameEn = input.nameEn ?? before.nameEn;
    const nameAr = input.nameAr ?? before.nameAr;
    if (!nameEn && !nameAr) throw badRequest('NAME_REQUIRED');
    await this.assertOwner(input.ownerId);
    await this.prisma.$transaction(async (tx) => {
      const o = await tx.repoObject.update({
        where: { id },
        data: {
          code: input.code === undefined ? undefined : input.code || null,
          nameEn,
          nameAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          attributes: input.attributes,
          category: input.category === undefined ? undefined : input.category || null,
          synonymsEn: input.synonymsEn,
          synonymsAr: input.synonymsAr,
          ownerId: input.ownerId,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'RepoObject',
          entityId: id,
          userId: actor.id,
          summary: { changes: diffFields(before, o, FIELDS) },
          meta,
        },
        tx,
      );
    });
    return this.get(id);
  }

  /** Approves a proposed dictionary term: it is suggested in the modeler from now on. */
  async approve(id: string, actor: AuthUser, meta: RequestMeta) {
    const o = await this.findActive(id);
    if (o.type !== 'TERM') throw badRequest('NOT_A_TERM');
    if (o.status === 'APPROVED') throw badRequest('TERM_ALREADY_APPROVED');
    await this.prisma.$transaction(async (tx) => {
      await tx.repoObject.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'APPROVE',
          entityType: 'RepoObject',
          entityId: id,
          userId: actor.id,
          summary: { type: 'TERM', nameEn: o.nameEn, nameAr: o.nameAr },
          meta,
        },
        tx,
      );
    });
    return this.get(id);
  }

  /** Rejects a proposed term: it is removed (soft delete) together with its links. */
  async reject(id: string, reason: string | undefined, actor: AuthUser, meta: RequestMeta) {
    const o = await this.findActive(id);
    if (o.type !== 'TERM') throw badRequest('NOT_A_TERM');
    if (o.status !== 'DRAFT') throw badRequest('TERM_NOT_PROPOSED');
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.objectLink.deleteMany({ where: { repoObjectId: id } });
      await tx.repoObject.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'REJECT',
          entityType: 'RepoObject',
          entityId: id,
          userId: actor.id,
          summary: {
            type: 'TERM',
            nameEn: o.nameEn,
            nameAr: o.nameAr,
            removedLinks: removed.count,
            ...(reason ? { reason } : {}),
          },
          meta,
        },
        tx,
      );
    });
  }

  /** Soft-deletes the object and removes its links (the UI warns about usage first). */
  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const o = await this.prisma.repoObject.findFirst({ where: { id, deletedAt: null } });
    if (!o) throw notFound('Object');
    if (isGrcObjectType(o.type)) throw badRequest('USE_GRC_REGISTER');
    this.assertMayChange(o, actor);
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.objectLink.deleteMany({ where: { repoObjectId: id } });
      await tx.repoObject.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'RepoObject',
          entityId: id,
          userId: actor.id,
          summary: {
            before: { type: o.type, code: o.code, nameEn: o.nameEn, nameAr: o.nameAr },
            removedLinks: removed.count,
          },
          meta,
        },
        tx,
      );
    });
  }
}
