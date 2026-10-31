import { importOrigin } from '../imports/import-origin';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_RELATION_FOR_TYPE,
  DIAGRAM_CODE_PREFIX,
  PERMISSIONS,
  diagramElementIds,
  diagramElements,
  emptyDiagramContent,
  extractBpmnLabels,
  extractDecisionRefs,
  emptyDmnXml,
  isGrcObjectType,
  parseDiagramContent,
  type CreateDiagramInput,
  type CreateDiagramLinkInput,
  type CreateDiagramVersionInput,
  type DiagramContentDto,
  type DiagramDto,
  type DiagramLinkDto,
  type DiagramListQuery,
  type DiagramSummaryDto,
  type DiagramType,
  type DiagramUsageDto,
  type DiagramVersionDto,
  type LinkRelation,
  type ObjectType,
  type ProcessStatus,
  type RestoreVersionInput,
  type UpdateDiagramInput,
  type VersionLabelInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, diffFields } from '../audit/audit.service';
import { badRequest, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { orderBy, pageArgs, paginated } from '../common/pagination';
import { assertEditable, markEdited, withdrawReviewsOf } from '../governance/edit-guard';
import { canEditModel, canEditProcess } from '../processes/processes.service';
import { assertSafeDmnXml } from './dmn-xml';

const userRef = { select: { id: true, email: true, nameEn: true, nameAr: true } } as const;

const summarySelect = {
  id: true,
  type: true,
  code: true,
  nameEn: true,
  nameAr: true,
  status: true,
  processId: true,
  ownerId: true,
  departmentId: true,
  sortOrder: true,
  updatedAt: true,
} satisfies Prisma.DiagramSelect;

type SummaryRow = Prisma.DiagramGetPayload<{ select: typeof summarySelect }>;

const AUDIT_FIELDS = [
  'nameEn',
  'nameAr',
  'descriptionEn',
  'descriptionAr',
  'processId',
  'ownerId',
  'departmentId',
];

export function toDiagramSummary(d: SummaryRow): DiagramSummaryDto {
  return {
    ...d,
    type: d.type as DiagramType,
    status: d.status as ProcessStatus,
    updatedAt: d.updatedAt.toISOString(),
  };
}

/** Diagram rights follow the process model (D-120): metadata like a process, content like a model. */
export const canEditDiagram = canEditProcess;
export const canEditDiagramContent = canEditModel;

/** Validates content of a diagram type; DMN additionally passes the unsafe-XML checks. */
export function assertValidContent(type: DiagramType, content: string) {
  if (type === 'DMN') assertSafeDmnXml(content);
  const parsed = parseDiagramContent(type, content);
  if (!parsed.ok)
    throw badRequest(
      type === 'DMN' ? 'INVALID_DMN' : 'INVALID_DIAGRAM',
      'Invalid diagram content',
      parsed.issues,
    );
}

/** Next generated code of a diagram type (e.g. "EPC-004"). */
export async function nextDiagramCode(tx: Prisma.TransactionClient, type: DiagramType) {
  const prefix = DIAGRAM_CODE_PREFIX[type];
  const rows = await tx.diagram.findMany({
    where: { code: { startsWith: `${prefix}-` } },
    select: { code: true },
  });
  const max = rows.reduce((m, r) => {
    const n = Number(r.code.slice(prefix.length + 1));
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

@Injectable()
export class DiagramsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(q: DiagramListQuery) {
    const where: Prisma.DiagramWhereInput = {
      deletedAt: null,
      type: q.type,
      status: q.status,
      processId: q.processId === 'none' ? null : q.processId,
      ownerId: q.ownerId,
      departmentId: q.departmentId,
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
      this.prisma.diagram.findMany({
        where,
        select: summarySelect,
        orderBy: orderBy(q, ['code', 'nameEn', 'nameAr', 'type', 'updatedAt'], 'code'),
        ...pageArgs(q),
      }),
      this.prisma.diagram.count({ where }),
    ]);
    return paginated(rows.map(toDiagramSummary), total, q);
  }

  /** Every active diagram (repository tree). */
  async all(): Promise<DiagramSummaryDto[]> {
    const rows = await this.prisma.diagram.findMany({
      where: { deletedAt: null },
      select: summarySelect,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map(toDiagramSummary);
  }

  async findActive(id: string) {
    const d = await this.prisma.diagram.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw notFound('Diagram');
    return d;
  }

  async get(id: string, user: AuthUser): Promise<DiagramDto> {
    const d = await this.prisma.diagram.findFirst({
      where: { id, deletedAt: null },
      include: {
        owner: userRef,
        department: { select: { id: true, nameEn: true, nameAr: true } },
        process: {
          select: { id: true, code: true, nameEn: true, nameAr: true, deletedAt: true },
        },
      },
    });
    if (!d) throw notFound('Diagram');
    const last = await this.prisma.diagramVersion.aggregate({
      where: { diagramId: id },
      _max: { versionNumber: true },
    });
    return {
      ...toDiagramSummary(d),
      descriptionEn: d.descriptionEn,
      descriptionAr: d.descriptionAr,
      owner: d.owner,
      department: d.department,
      process:
        d.process && !d.process.deletedAt
          ? {
              id: d.process.id,
              code: d.process.code,
              nameEn: d.process.nameEn,
              nameAr: d.process.nameAr,
            }
          : null,
      aiGenerated: d.aiGenerated,
      importOrigin: await importOrigin(this.prisma, 'DIAGRAM', d.id, d.importBatchId),
      latestVersion: last._max.versionNumber ?? null,
      canEdit: canEditDiagram(user, d),
      canEditContent: canEditDiagramContent(user, d),
      canDelete: user.permissions.has(PERMISSIONS.PROCESSES_DELETE),
      createdAt: d.createdAt.toISOString(),
    };
  }

  /** Next free code of a type: VC-001, VC-002 … (deleted diagrams keep their codes). */
  private nextCode(tx: Prisma.TransactionClient, type: DiagramType) {
    return nextDiagramCode(tx, type);
  }

  async create(input: CreateDiagramInput, actor: AuthUser, meta: RequestMeta) {
    await this.assertRefs(input.processId, input.ownerId, input.departmentId);
    const content =
      input.content ??
      (input.type === 'DMN'
        ? emptyDmnXml(Date.now().toString(36), input.nameEn ?? '', input.nameAr ?? '')
        : emptyDiagramContent(input.type));
    assertValidContent(input.type, content);
    const created = await this.prisma.$transaction(async (tx) => {
      const code = await this.nextCode(tx, input.type);
      const d = await tx.diagram.create({
        data: {
          type: input.type,
          code,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          descriptionEn: input.descriptionEn ?? '',
          descriptionAr: input.descriptionAr ?? '',
          processId: input.processId ?? null,
          ownerId: input.ownerId === undefined ? actor.id : input.ownerId,
          departmentId: input.departmentId ?? null,
          content,
          contentUpdatedById: actor.id,
          createdById: actor.id,
          updatedById: actor.id,
        },
        select: summarySelect,
      });
      if (input.changeNote) {
        const v = await tx.diagramVersion.create({
          data: {
            diagramId: d.id,
            versionNumber: 1,
            content,
            changeNote: input.changeNote,
            createdById: actor.id,
          },
        });
        await this.audit.log(
          {
            action: 'VERSION',
            entityType: 'DiagramVersion',
            entityId: v.id,
            userId: actor.id,
            summary: { diagramId: d.id, versionNumber: 1, changeNote: input.changeNote },
            meta,
          },
          tx,
        );
      }
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Diagram',
          entityId: d.id,
          userId: actor.id,
          summary: {
            after: {
              type: d.type,
              code,
              nameEn: d.nameEn,
              nameAr: d.nameAr,
              processId: d.processId,
            },
          },
          meta,
        },
        tx,
      );
      return d;
    });
    return toDiagramSummary(created);
  }

  async update(id: string, input: UpdateDiagramInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.findActive(id);
    if (!canEditDiagram(actor, before)) throw forbidden('You cannot edit this diagram');
    if (
      input.ownerId !== undefined &&
      input.ownerId !== before.ownerId &&
      !actor.permissions.has(PERMISSIONS.PROCESSES_EDIT)
    )
      throw forbidden('Only editors can change the diagram owner');
    await this.assertRefs(input.processId, input.ownerId, input.departmentId);
    const nameEn = input.nameEn ?? before.nameEn;
    const nameAr = input.nameAr ?? before.nameAr;
    if (!nameEn && !nameAr) throw badRequest('NAME_REQUIRED');
    const contentChanged = (['nameEn', 'nameAr', 'descriptionEn', 'descriptionAr'] as const).some(
      (f) => input[f] !== undefined && input[f] !== before[f],
    );
    if (contentChanged) await assertEditable(this.prisma, 'DIAGRAM', id);
    const d = await this.prisma.$transaction(async (tx) => {
      if (contentChanged) await markEdited(tx, 'DIAGRAM', id, actor.id);
      const row = await tx.diagram.update({
        where: { id },
        data: {
          nameEn,
          nameAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          processId: input.processId,
          ownerId: input.ownerId,
          departmentId: input.departmentId,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Diagram',
          entityId: id,
          userId: actor.id,
          summary: { changes: diffFields(before, row, AUDIT_FIELDS) },
          meta,
        },
        tx,
      );
      return row;
    });
    return toDiagramSummary(d);
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const d = await this.findActive(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.diagram.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await withdrawReviewsOf(tx, 'DIAGRAM', [id]);
      await tx.publication.updateMany({
        where: { entityType: 'DIAGRAM', entityId: id, current: true },
        data: { current: false, endedAt: new Date() },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Diagram',
          entityId: id,
          userId: actor.id,
          summary: { before: { type: d.type, code: d.code, nameEn: d.nameEn, nameAr: d.nameAr } },
          meta,
        },
        tx,
      );
    });
  }

  private async assertRefs(
    processId?: string | null,
    ownerId?: string | null,
    departmentId?: string | null,
  ) {
    if (processId) {
      const p = await this.prisma.process.findFirst({ where: { id: processId, deletedAt: null } });
      if (!p) throw badRequest('PROCESS_NOT_FOUND');
    }
    if (ownerId) {
      const u = await this.prisma.user.findFirst({ where: { id: ownerId, deletedAt: null } });
      if (!u) throw badRequest('OWNER_NOT_FOUND');
    }
    if (departmentId) {
      const dep = await this.prisma.department.findFirst({
        where: { id: departmentId, deletedAt: null },
      });
      if (!dep) throw badRequest('DEPARTMENT_NOT_FOUND');
    }
  }

  // ---------- Content ----------

  private async assertCanChange(id: string, user: AuthUser) {
    const d = await this.findActive(id);
    if (!canEditDiagramContent(user, d)) throw forbidden('You cannot edit this diagram');
    await assertEditable(this.prisma, 'DIAGRAM', id);
    return d;
  }

  async getContent(id: string): Promise<DiagramContentDto> {
    const d = await this.findActive(id);
    const updatedBy = d.contentUpdatedById
      ? await this.prisma.user.findUnique({ where: { id: d.contentUpdatedById }, ...userRef })
      : null;
    return {
      diagramId: id,
      type: d.type as DiagramType,
      content: d.content,
      updatedAt: d.contentUpdatedAt.toISOString(),
      updatedBy,
    };
  }

  /** Saves the working content (autosave); links to removed elements are pruned. */
  async saveContent(
    id: string,
    content: string,
    actor: AuthUser,
    meta: RequestMeta,
    aiGenerated = false,
  ) {
    const d = await this.assertCanChange(id, actor);
    const type = d.type as DiagramType;
    assertValidContent(type, content);
    const ids = [...diagramElementIds(type, content)];
    await this.prisma.$transaction(async (tx) => {
      const changed = d.content !== content;
      if (changed) await markEdited(tx, 'DIAGRAM', id, actor.id);
      await tx.diagram.update({
        where: { id },
        data: {
          content,
          contentUpdatedAt: new Date(),
          contentUpdatedById: actor.id,
          ...(changed ? { aiGenerated } : {}),
        },
      });
      const pruned = await tx.diagramLink.deleteMany({
        where: { diagramId: id, elementId: { notIn: ids } },
      });
      if (changed || pruned.count)
        await this.audit.log(
          {
            action: 'UPDATE',
            entityType: 'Diagram',
            entityId: id,
            userId: actor.id,
            summary: {
              content: { elements: ids.length, bytes: content.length },
              prunedLinks: pruned.count,
            },
            meta,
          },
          tx,
        );
    });
    return this.getContent(id);
  }

  // ---------- Versions ----------

  async listVersions(id: string): Promise<DiagramVersionDto[]> {
    await this.findActive(id);
    const rows = await this.prisma.diagramVersion.findMany({
      where: { diagramId: id },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        changeNote: true,
        label: true,
        restoredFrom: true,
        createdAt: true,
        createdById: true,
      },
    });
    const userIds = [...new Set(rows.map((r) => r.createdById).filter((v): v is string => !!v))];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, ...userRef });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      versionNumber: r.versionNumber,
      changeNote: r.changeNote,
      label: r.label,
      restoredFrom: r.restoredFrom,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdById ? (byId.get(r.createdById) ?? null) : null,
    }));
  }

  async getVersion(id: string, versionId: string) {
    await this.findActive(id);
    const v = await this.prisma.diagramVersion.findFirst({
      where: { id: versionId, diagramId: id },
    });
    if (!v) throw notFound('Version');
    return {
      id: v.id,
      versionNumber: v.versionNumber,
      changeNote: v.changeNote,
      label: v.label,
      restoredFrom: v.restoredFrom,
      content: v.content,
      createdAt: v.createdAt.toISOString(),
    };
  }

  /** Saves the working content and snapshots it as the next version. */
  async createVersion(
    id: string,
    input: CreateDiagramVersionInput,
    actor: AuthUser,
    meta: RequestMeta,
    restoredFrom: number | null = null,
  ): Promise<DiagramVersionDto> {
    await this.saveContent(id, input.content, actor, meta, input.aiGenerated);
    const version = await this.prisma.$transaction(async (tx) => {
      const last = await tx.diagramVersion.aggregate({
        where: { diagramId: id },
        _max: { versionNumber: true },
      });
      const v = await tx.diagramVersion.create({
        data: {
          diagramId: id,
          versionNumber: (last._max.versionNumber ?? 0) + 1,
          content: input.content,
          changeNote: input.changeNote,
          restoredFrom,
          createdById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: restoredFrom ? 'RESTORE' : 'VERSION',
          entityType: 'DiagramVersion',
          entityId: v.id,
          userId: actor.id,
          summary: {
            diagramId: id,
            versionNumber: v.versionNumber,
            changeNote: v.changeNote,
            ...(restoredFrom ? { restoredFrom } : {}),
          },
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
      label: null,
      restoredFrom,
      createdAt: version.createdAt.toISOString(),
      createdBy: { id: actor.id, email: actor.email, nameEn: actor.nameEn, nameAr: actor.nameAr },
    };
  }

  async restoreVersion(
    id: string,
    versionId: string,
    input: RestoreVersionInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    await this.assertCanChange(id, actor);
    const old = await this.prisma.diagramVersion.findFirst({
      where: { id: versionId, diagramId: id },
    });
    if (!old) throw notFound('Version');
    return this.createVersion(
      id,
      {
        content: old.content,
        changeNote: input.changeNote || `Restored version ${old.versionNumber}`,
      },
      actor,
      meta,
      old.versionNumber,
    );
  }

  async labelVersion(
    id: string,
    versionId: string,
    input: VersionLabelInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const d = await this.findActive(id);
    if (!canEditDiagramContent(actor, d)) throw forbidden('You cannot edit this diagram');
    const v = await this.prisma.diagramVersion.findFirst({
      where: { id: versionId, diagramId: id },
    });
    if (!v) throw notFound('Version');
    const label = input.label || null;
    await this.prisma.$transaction(async (tx) => {
      await tx.diagramVersion.update({ where: { id: versionId }, data: { label } });
      await this.audit.log(
        {
          action: 'LABEL',
          entityType: 'DiagramVersion',
          entityId: versionId,
          userId: actor.id,
          summary: { diagramId: id, versionNumber: v.versionNumber, from: v.label, to: label },
          meta,
        },
        tx,
      );
    });
    return this.listVersions(id);
  }

  // ---------- Object links ----------

  async listLinks(id: string): Promise<DiagramLinkDto[]> {
    const d = await this.findActive(id);
    const rows = await this.prisma.diagramLink.findMany({
      where: { diagramId: id, repoObject: { deletedAt: null } },
      include: {
        repoObject: { select: { id: true, type: true, code: true, nameEn: true, nameAr: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const labels = new Map(diagramElements(d.type as DiagramType, d.content).map((e) => [e.id, e]));
    return rows.map((r) => {
      const l = labels.get(r.elementId);
      return {
        id: r.id,
        diagramId: r.diagramId,
        elementId: r.elementId,
        element: l ? { nameEn: l.nameEn, nameAr: l.nameAr } : null,
        relation: r.relation as LinkRelation,
        repoObject: r.repoObject,
      };
    });
  }

  /** Same rule as process links: content editors link anything, GRC editors risks / controls (D-091). */
  private async assertCanLink(id: string, actor: AuthUser, type: string) {
    const d = await this.findActive(id);
    const grc = isGrcObjectType(type) && actor.permissions.has(PERMISSIONS.GRC_EDIT);
    if (!canEditDiagramContent(actor, d) && !grc) throw forbidden('You cannot edit this diagram');
    if (isGrcObjectType(type) && !grc && !actor.permissions.has(PERMISSIONS.GRC_PROPOSE))
      throw forbidden('You cannot link risks and controls');
    await assertEditable(this.prisma, 'DIAGRAM', id);
    return d;
  }

  async createLink(id: string, input: CreateDiagramLinkInput, actor: AuthUser, meta: RequestMeta) {
    const d = await this.findActive(id);
    const obj = await this.prisma.repoObject.findFirst({
      where: { id: input.repoObjectId, deletedAt: null },
    });
    if (!obj) {
      await this.assertCanChange(id, actor);
      throw badRequest('OBJECT_NOT_FOUND');
    }
    await this.assertCanLink(id, actor, obj.type);
    if (!diagramElementIds(d.type as DiagramType, d.content).has(input.elementId))
      throw badRequest('ELEMENT_NOT_FOUND');
    const relation = input.relation ?? DEFAULT_RELATION_FOR_TYPE[obj.type as ObjectType];
    const existing = await this.prisma.diagramLink.findFirst({
      where: { diagramId: id, elementId: input.elementId, repoObjectId: obj.id, relation },
    });
    if (!existing)
      await this.prisma.$transaction(async (tx) => {
        await markEdited(tx, 'DIAGRAM', id, actor.id);
        const link = await tx.diagramLink.create({
          data: {
            diagramId: id,
            elementId: input.elementId,
            repoObjectId: obj.id,
            relation,
            createdById: actor.id,
          },
        });
        await this.audit.log(
          {
            action: 'CREATE',
            entityType: 'DiagramLink',
            entityId: link.id,
            userId: actor.id,
            summary: { diagramId: id, elementId: input.elementId, repoObjectId: obj.id, relation },
            meta,
          },
          tx,
        );
      });
    return this.listLinks(id);
  }

  async deleteLink(id: string, linkId: string, actor: AuthUser, meta: RequestMeta) {
    await this.findActive(id);
    const link = await this.prisma.diagramLink.findFirst({
      where: { id: linkId, diagramId: id },
      include: { repoObject: { select: { type: true } } },
    });
    if (!link) {
      await this.assertCanChange(id, actor);
      throw notFound('Link');
    }
    await this.assertCanLink(id, actor, link.repoObject.type);
    await this.prisma.$transaction(async (tx) => {
      await tx.diagramLink.delete({ where: { id: linkId } });
      await markEdited(tx, 'DIAGRAM', id, actor.id);
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'DiagramLink',
          entityId: linkId,
          userId: actor.id,
          summary: {
            diagramId: id,
            elementId: link.elementId,
            repoObjectId: link.repoObjectId,
            relation: link.relation,
          },
          meta,
        },
        tx,
      );
    });
    return this.listLinks(id);
  }

  // ---------- Where used ----------

  /**
   * Diagrams that refer to a process (child diagrams, drill-down targets, SIPOC source), another
   * diagram (drill-down) or a library object (element links). References inside the content are
   * found by a text search on the id, then confirmed by parsing (D-120).
   */
  async whereUsed(target: {
    processId?: string;
    diagramId?: string;
    objectId?: string;
  }): Promise<DiagramUsageDto[]> {
    const out: DiagramUsageDto[] = [];
    const pick = (d: SummaryRow) => ({
      id: d.id,
      type: d.type as DiagramType,
      code: d.code,
      nameEn: d.nameEn,
      nameAr: d.nameAr,
      status: d.status as ProcessStatus,
    });
    if (target.objectId) {
      const links = await this.prisma.diagramLink.findMany({
        where: { repoObjectId: target.objectId, diagram: { deletedAt: null } },
        include: { diagram: { select: { ...summarySelect, content: true } } },
      });
      for (const l of links) {
        const el = diagramElements(l.diagram.type as DiagramType, l.diagram.content).find(
          (e) => e.id === l.elementId,
        );
        out.push({
          diagram: pick(l.diagram),
          elementId: l.elementId,
          element: el ? { nameEn: el.nameEn, nameAr: el.nameAr } : null,
          relation: l.relation as LinkRelation,
        });
      }
      return out;
    }
    const id = target.processId ?? target.diagramId;
    if (!id) return out;
    if (target.processId) {
      const children = await this.prisma.diagram.findMany({
        where: { processId: id, deletedAt: null },
        select: summarySelect,
      });
      for (const d of children)
        out.push({ diagram: pick(d), elementId: null, element: null, relation: 'SOURCE' });
    }
    if (target.diagramId) {
      // Decision tables: BPMN business rule tasks with ph:decisionRef (D-123).
      const models = await this.prisma.processModel.findMany({
        where: { bpmnXml: { contains: id }, process: { deletedAt: null } },
        include: {
          process: { select: { id: true, code: true, nameEn: true, nameAr: true, status: true } },
        },
      });
      for (const m of models) {
        const labels = extractBpmnLabels(m.bpmnXml);
        for (const [elementId, ref] of extractDecisionRefs(m.bpmnXml)) {
          if (ref.diagramId !== id) continue;
          const l = labels.get(elementId);
          out.push({
            diagram: null,
            process: { ...m.process, status: m.process.status as ProcessStatus },
            elementId,
            element: l ? { nameEn: l.nameEn || l.name, nameAr: l.nameAr } : null,
            relation: 'DECISION',
          });
        }
      }
    }
    const candidates = await this.prisma.diagram.findMany({
      where: { deletedAt: null, content: { contains: id } },
      select: { ...summarySelect, content: true },
    });
    for (const d of candidates) {
      const type = d.type as DiagramType;
      const parsed = parseDiagramContent(type, d.content);
      if (!parsed.ok || !parsed.content) continue;
      const c = parsed.content;
      if (c.type === 'SIPOC') {
        if (c.processId === id && !out.some((u) => u.diagram?.id === d.id))
          out.push({ diagram: pick(d), elementId: null, element: null, relation: 'SOURCE' });
        continue;
      }
      for (const n of c.nodes)
        if (n.processId === id || n.diagramId === id)
          out.push({
            diagram: pick(d),
            elementId: n.id,
            element: { nameEn: n.nameEn, nameAr: n.nameAr },
            relation: 'DRILLDOWN',
          });
    }
    return out;
  }
}
