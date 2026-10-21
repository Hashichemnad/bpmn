import { Injectable } from '@nestjs/common';
import {
  DEFAULT_RELATION_FOR_TYPE,
  extractBpmnElementIds,
  type CreateLinkInput,
  type CreateVersionInput,
  type LinkRelation,
  type ObjectLinkDto,
  type ObjectType,
  type ProcessModelDto,
  type ProcessVersionDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProcessesService, canEditModel } from '../processes/processes.service';
import { badRequest, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { assertSafeBpmnXml, countFlowElements } from './bpmn-xml';

const userRef = { select: { id: true, email: true, nameEn: true, nameAr: true } } as const;

@Injectable()
export class ModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly processes: ProcessesService,
  ) {}

  private async assertCanEdit(processId: string, user: AuthUser) {
    const p = await this.processes.findActive(processId);
    if (!canEditModel(user, p)) throw forbidden('You cannot edit this model');
    return p;
  }

  async getModel(processId: string): Promise<ProcessModelDto> {
    await this.processes.findActive(processId);
    const m = await this.prisma.processModel.findUnique({ where: { processId } });
    const updatedBy = m?.updatedById
      ? await this.prisma.user.findUnique({ where: { id: m.updatedById }, ...userRef })
      : null;
    return {
      processId,
      bpmnXml: m?.bpmnXml ?? null,
      updatedAt: m?.updatedAt.toISOString() ?? null,
      updatedBy,
    };
  }

  /** Saves the working model and removes object links to elements that no longer exist. */
  async saveModel(processId: string, bpmnXml: string, actor: AuthUser, meta: RequestMeta) {
    await this.assertCanEdit(processId, actor);
    assertSafeBpmnXml(bpmnXml);
    const ids = [...extractBpmnElementIds(bpmnXml)];
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.processModel.findUnique({ where: { processId }, select: { processId: true } });
      await tx.processModel.upsert({
        where: { processId },
        create: { processId, bpmnXml, createdById: actor.id, updatedById: actor.id },
        update: { bpmnXml, updatedById: actor.id },
      });
      const pruned = await tx.objectLink.deleteMany({
        where: { processId, bpmnElementId: { notIn: ids } },
      });
      await this.audit.log(
        {
          action: existing ? 'UPDATE' : 'CREATE',
          entityType: 'ProcessModel',
          entityId: processId,
          userId: actor.id,
          summary: { elements: countFlowElements(bpmnXml), bytes: bpmnXml.length, prunedLinks: pruned.count },
          meta,
        },
        tx,
      );
    });
    return this.getModel(processId);
  }

  async listVersions(processId: string): Promise<ProcessVersionDto[]> {
    await this.processes.findActive(processId);
    const rows = await this.prisma.processVersion.findMany({
      where: { processId },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, versionNumber: true, changeNote: true, createdAt: true, createdById: true },
    });
    const userIds = [...new Set(rows.map((r) => r.createdById).filter((v): v is string => !!v))];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, ...userRef });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      versionNumber: r.versionNumber,
      changeNote: r.changeNote,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdById ? (byId.get(r.createdById) ?? null) : null,
    }));
  }

  async getVersion(processId: string, versionId: string) {
    await this.processes.findActive(processId);
    const v = await this.prisma.processVersion.findFirst({ where: { id: versionId, processId } });
    if (!v) throw notFound('Version');
    return { id: v.id, versionNumber: v.versionNumber, changeNote: v.changeNote, bpmnXml: v.bpmnXml, createdAt: v.createdAt.toISOString() };
  }

  /** Saves the working model and snapshots it as the next version. */
  async createVersion(processId: string, input: CreateVersionInput, actor: AuthUser, meta: RequestMeta) {
    await this.saveModel(processId, input.bpmnXml, actor, meta);
    const version = await this.prisma.$transaction(async (tx) => {
      const last = await tx.processVersion.aggregate({ where: { processId }, _max: { versionNumber: true } });
      const v = await tx.processVersion.create({
        data: {
          processId,
          versionNumber: (last._max.versionNumber ?? 0) + 1,
          bpmnXml: input.bpmnXml,
          changeNote: input.changeNote,
          createdById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'VERSION',
          entityType: 'ProcessVersion',
          entityId: v.id,
          userId: actor.id,
          summary: { processId, versionNumber: v.versionNumber, changeNote: v.changeNote },
          meta,
        },
        tx,
      );
      return v;
    });
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      changeNote: version.changeNote,
      createdAt: version.createdAt.toISOString(),
      createdBy: { id: actor.id, email: actor.email, nameEn: actor.nameEn, nameAr: actor.nameAr },
    } satisfies ProcessVersionDto;
  }

  // ---------- Object links ----------

  async listLinks(processId: string): Promise<ObjectLinkDto[]> {
    await this.processes.findActive(processId);
    const rows = await this.prisma.objectLink.findMany({
      where: { processId, repoObject: { deletedAt: null } },
      include: { repoObject: { select: { id: true, type: true, code: true, nameEn: true, nameAr: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      processId: r.processId,
      bpmnElementId: r.bpmnElementId,
      relation: r.relation as LinkRelation,
      repoObject: { ...r.repoObject, type: r.repoObject.type as ObjectType },
    }));
  }

  async createLink(processId: string, input: CreateLinkInput, actor: AuthUser, meta: RequestMeta) {
    await this.assertCanEdit(processId, actor);
    const obj = await this.prisma.repoObject.findFirst({ where: { id: input.repoObjectId, deletedAt: null } });
    if (!obj) throw badRequest('OBJECT_NOT_FOUND');
    const relation = input.relation ?? DEFAULT_RELATION_FOR_TYPE[obj.type as ObjectType];
    const existing = await this.prisma.objectLink.findFirst({
      where: { processId, bpmnElementId: input.bpmnElementId, repoObjectId: obj.id, relation },
    });
    if (!existing) {
      await this.prisma.$transaction(async (tx) => {
        const link = await tx.objectLink.create({
          data: { processId, bpmnElementId: input.bpmnElementId, repoObjectId: obj.id, relation, createdById: actor.id },
        });
        await this.audit.log(
          {
            action: 'CREATE',
            entityType: 'ObjectLink',
            entityId: link.id,
            userId: actor.id,
            summary: { processId, bpmnElementId: input.bpmnElementId, repoObjectId: obj.id, relation },
            meta,
          },
          tx,
        );
      });
    }
    return this.listLinks(processId);
  }

  async deleteLink(processId: string, linkId: string, actor: AuthUser, meta: RequestMeta) {
    await this.assertCanEdit(processId, actor);
    const link = await this.prisma.objectLink.findFirst({ where: { id: linkId, processId } });
    if (!link) throw notFound('Link');
    await this.prisma.$transaction(async (tx) => {
      await tx.objectLink.delete({ where: { id: linkId } });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'ObjectLink',
          entityId: linkId,
          userId: actor.id,
          summary: { processId, bpmnElementId: link.bpmnElementId, repoObjectId: link.repoObjectId, relation: link.relation },
          meta,
        },
        tx,
      );
    });
    return this.listLinks(processId);
  }
}
