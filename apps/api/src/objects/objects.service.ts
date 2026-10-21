import { Injectable } from '@nestjs/common';
import { Prisma, type RepoObject } from '@prisma/client';
import {
  extractBpmnLabels,
  type BpmnElementLabel,
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
import { badRequest, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { orderBy, pageArgs, paginated } from '../common/pagination';

const FIELDS = ['code', 'nameEn', 'nameAr', 'descriptionEn', 'descriptionAr', 'attributes'];
/** Only links from active processes count as usage. */
const activeLinks = { process: { deletedAt: null } } satisfies Prisma.ObjectLinkWhereInput;

function toDto(o: RepoObject & { _count?: { links: number } }): RepoObjectDto {
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
      this.prisma.repoObject.findMany({
        where,
        include: { _count: { select: { links: { where: activeLinks } } } },
        orderBy: orderBy(q, ['code', 'nameEn', 'nameAr', 'createdAt', 'updatedAt'], 'nameEn'),
        ...pageArgs(q),
      }),
      this.prisma.repoObject.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, q);
  }

  async get(id: string): Promise<RepoObjectDto> {
    const o = await this.prisma.repoObject.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { links: { where: activeLinks } } } },
    });
    if (!o) throw notFound('Object');
    return toDto(o);
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

  async create(input: CreateObjectInput, actor: AuthUser, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.repoObject.create({
        data: {
          type: input.type,
          code: input.code || null,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          descriptionEn: input.descriptionEn ?? '',
          descriptionAr: input.descriptionAr ?? '',
          attributes: input.attributes,
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
          summary: { after: { type: o.type, code: o.code, nameEn: o.nameEn, nameAr: o.nameAr } },
          meta,
        },
        tx,
      );
      return toDto(o);
    });
  }

  async update(id: string, input: UpdateObjectInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.prisma.repoObject.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Object');
    const nameEn = input.nameEn ?? before.nameEn;
    const nameAr = input.nameAr ?? before.nameAr;
    if (!nameEn && !nameAr) throw badRequest('NAME_REQUIRED');
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.repoObject.update({
        where: { id },
        data: {
          code: input.code === undefined ? undefined : input.code || null,
          nameEn,
          nameAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          attributes: input.attributes,
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
      return toDto(o);
    });
  }

  /** Soft-deletes the object and removes its links (the UI warns about usage first). */
  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const o = await this.prisma.repoObject.findFirst({ where: { id, deletedAt: null } });
    if (!o) throw notFound('Object');
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
