import { Injectable } from '@nestjs/common';
import {
  DEFAULT_RELATION_FOR_TYPE,
  SETTING_KEYS,
  editBlockedReason,
  extractBpmnElementIds,
  resolveDiagramTheme,
  type ApplyThemeResultDto,
  type ContentStatus,
  extractBpmnLabels,
  type CreateLinkInput,
  type CreateVersionInput,
  type LinkRelation,
  type ObjectLinkDto,
  type ObjectType,
  type ProcessModelDto,
  type ProcessVersionDto,
  type RestoreVersionInput,
  type VersionLabelInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProcessesService, canEditModel } from '../processes/processes.service';
import { badRequest, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { DomainEvents } from '../events/domain-events';
import { assertSafeBpmnXml, countFlowElements, elementLabel } from './bpmn-xml';
import { assertEditable, markEdited } from '../governance/edit-guard';
import { applyThemeToXml } from './diagram-theme-xml';

/** Change note of the versions created by "Apply theme to existing diagrams". */
export const APPLY_THEME_CHANGE_NOTE = 'Applied colour theme';

const userRef = { select: { id: true, email: true, nameEn: true, nameAr: true } } as const;

@Injectable()
export class ModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly processes: ProcessesService,
    private readonly events: DomainEvents,
  ) {}

  private async assertCanEdit(processId: string, user: AuthUser) {
    const p = await this.processes.findActive(processId);
    if (!canEditModel(user, p)) throw forbidden('You cannot edit this model');
    return p;
  }

  /** Edit rights plus the governance lock (not while in review or archived). */
  private async assertCanChange(processId: string, user: AuthUser) {
    const p = await this.assertCanEdit(processId, user);
    await assertEditable(this.prisma, 'PROCESS', processId);
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

  /**
   * Saves the working model and removes object links to elements that no longer exist.
   * `aiGenerated` marks content produced by the AI assistant without human edits since; any
   * other change clears the mark.
   */
  async saveModel(
    processId: string,
    bpmnXml: string,
    actor: AuthUser,
    meta: RequestMeta,
    aiGenerated = false,
  ) {
    await this.assertCanChange(processId, actor);
    assertSafeBpmnXml(bpmnXml);
    const ids = [...extractBpmnElementIds(bpmnXml)];
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.processModel.findUnique({
        where: { processId },
        select: { processId: true, bpmnXml: true },
      });
      const changed = existing?.bpmnXml !== bpmnXml;
      if (changed) {
        await markEdited(tx, 'PROCESS', processId, actor.id);
        await tx.process.update({ where: { id: processId }, data: { aiGenerated } });
      }
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
          summary: {
            elements: countFlowElements(bpmnXml),
            bytes: bpmnXml.length,
            prunedLinks: pruned.count,
            ...(aiGenerated ? { aiGenerated: true } : {}),
          },
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

  async getVersion(processId: string, versionId: string) {
    await this.processes.findActive(processId);
    const v = await this.prisma.processVersion.findFirst({ where: { id: versionId, processId } });
    if (!v) throw notFound('Version');
    return {
      id: v.id,
      versionNumber: v.versionNumber,
      changeNote: v.changeNote,
      label: v.label,
      restoredFrom: v.restoredFrom,
      bpmnXml: v.bpmnXml,
      createdAt: v.createdAt.toISOString(),
    };
  }

  /** Saves the working model and snapshots it as the next version. */
  async createVersion(
    processId: string,
    input: CreateVersionInput,
    actor: AuthUser,
    meta: RequestMeta,
    restoredFrom: number | null = null,
  ) {
    await this.saveModel(processId, input.bpmnXml, actor, meta, input.aiGenerated);
    const version = await this.prisma.$transaction(async (tx) => {
      const last = await tx.processVersion.aggregate({
        where: { processId },
        _max: { versionNumber: true },
      });
      const v = await tx.processVersion.create({
        data: {
          processId,
          versionNumber: (last._max.versionNumber ?? 0) + 1,
          bpmnXml: input.bpmnXml,
          changeNote: input.changeNote,
          restoredFrom,
          createdById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: restoredFrom ? 'RESTORE' : 'VERSION',
          entityType: 'ProcessVersion',
          entityId: v.id,
          userId: actor.id,
          summary: {
            processId,
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
    this.events.emit({
      type: 'process.versioned',
      processId,
      versionNumber: version.versionNumber,
      actorId: actor.id,
    });
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      changeNote: version.changeNote,
      label: null,
      restoredFrom,
      createdAt: version.createdAt.toISOString(),
      createdBy: { id: actor.id, email: actor.email, nameEn: actor.nameEn, nameAr: actor.nameAr },
    } satisfies ProcessVersionDto;
  }

  /** Restoring never deletes history: the old model becomes the working model and a new version. */
  async restoreVersion(
    processId: string,
    versionId: string,
    input: RestoreVersionInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    await this.assertCanChange(processId, actor);
    const old = await this.prisma.processVersion.findFirst({ where: { id: versionId, processId } });
    if (!old) throw notFound('Version');
    return this.createVersion(
      processId,
      {
        bpmnXml: old.bpmnXml,
        changeNote: input.changeNote || `Restored version ${old.versionNumber}`,
      },
      actor,
      meta,
      old.versionNumber,
    );
  }

  async labelVersion(
    processId: string,
    versionId: string,
    input: VersionLabelInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    await this.assertCanEdit(processId, actor);
    const v = await this.prisma.processVersion.findFirst({ where: { id: versionId, processId } });
    if (!v) throw notFound('Version');
    const label = input.label || null;
    await this.prisma.$transaction(async (tx) => {
      await tx.processVersion.update({ where: { id: versionId }, data: { label } });
      await this.audit.log(
        {
          action: 'LABEL',
          entityType: 'ProcessVersion',
          entityId: versionId,
          userId: actor.id,
          summary: { processId, versionNumber: v.versionNumber, from: v.label, to: label },
          meta,
        },
        tx,
      );
    });
    return this.listVersions(processId);
  }

  // ---------- Object links ----------

  async listLinks(processId: string): Promise<ObjectLinkDto[]> {
    await this.processes.findActive(processId);
    const [rows, model] = await Promise.all([
      this.prisma.objectLink.findMany({
        where: { processId, repoObject: { deletedAt: null } },
        include: {
          repoObject: { select: { id: true, type: true, code: true, nameEn: true, nameAr: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.processModel.findUnique({ where: { processId }, select: { bpmnXml: true } }),
    ]);
    const labels = extractBpmnLabels(model?.bpmnXml ?? '');
    return rows.map((r) => ({
      id: r.id,
      processId: r.processId,
      bpmnElementId: r.bpmnElementId,
      element: elementLabel(labels, r.bpmnElementId),
      relation: r.relation as LinkRelation,
      repoObject: { ...r.repoObject, type: r.repoObject.type as ObjectType },
    }));
  }

  async createLink(processId: string, input: CreateLinkInput, actor: AuthUser, meta: RequestMeta) {
    await this.assertCanChange(processId, actor);
    const obj = await this.prisma.repoObject.findFirst({
      where: { id: input.repoObjectId, deletedAt: null },
    });
    if (!obj) throw badRequest('OBJECT_NOT_FOUND');
    const relation = input.relation ?? DEFAULT_RELATION_FOR_TYPE[obj.type as ObjectType];
    const existing = await this.prisma.objectLink.findFirst({
      where: { processId, bpmnElementId: input.bpmnElementId, repoObjectId: obj.id, relation },
    });
    if (!existing) {
      await this.prisma.$transaction(async (tx) => {
        await markEdited(tx, 'PROCESS', processId, actor.id);
        const link = await tx.objectLink.create({
          data: {
            processId,
            bpmnElementId: input.bpmnElementId,
            repoObjectId: obj.id,
            relation,
            createdById: actor.id,
          },
        });
        await this.audit.log(
          {
            action: 'CREATE',
            entityType: 'ObjectLink',
            entityId: link.id,
            userId: actor.id,
            summary: {
              processId,
              bpmnElementId: input.bpmnElementId,
              repoObjectId: obj.id,
              relation,
            },
            meta,
          },
          tx,
        );
      });
    }
    return this.listLinks(processId);
  }

  async deleteLink(processId: string, linkId: string, actor: AuthUser, meta: RequestMeta) {
    await this.assertCanChange(processId, actor);
    const link = await this.prisma.objectLink.findFirst({ where: { id: linkId, processId } });
    if (!link) throw notFound('Link');
    await this.prisma.$transaction(async (tx) => {
      await tx.objectLink.delete({ where: { id: linkId } });
      await markEdited(tx, 'PROCESS', processId, actor.id);
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'ObjectLink',
          entityId: linkId,
          userId: actor.id,
          summary: {
            processId,
            bpmnElementId: link.bpmnElementId,
            repoObjectId: link.repoObjectId,
            relation: link.relation,
          },
          meta,
        },
        tx,
      );
    });
    return this.listLinks(processId);
  }

  // ---------- Colour theme ----------

  /**
   * "Apply theme to existing diagrams" (Settings → Branding): gives elements without colours the
   * theme colour in every working model, saved as a new version. Elements with colours are never
   * changed. Processes in review or archived are skipped (they are locked); approved / published
   * ones get a new draft working copy like any other edit, the published version stays live.
   * With `dryRun` nothing is written and only the counts are returned.
   */
  async applyTheme(
    dryRun: boolean,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<ApplyThemeResultDto> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.DIAGRAM_THEME },
    });
    const theme = resolveDiagramTheme(setting?.value);
    const rows = await this.prisma.processModel.findMany({
      where: { process: { deletedAt: null } },
      select: { processId: true, bpmnXml: true, process: { select: { status: true } } },
      orderBy: { processId: 'asc' },
    });
    const result: ApplyThemeResultDto = {
      dryRun,
      models: 0,
      elements: 0,
      published: 0,
      skipped: 0,
    };
    const recoloured: string[] = [];
    for (const row of rows) {
      const { xml, changed } = applyThemeToXml(row.bpmnXml, theme);
      if (!changed) continue;
      const status = row.process.status as ContentStatus;
      if (editBlockedReason(status)) {
        result.skipped++;
        continue;
      }
      result.models++;
      result.elements += changed;
      if (status === 'APPROVED' || status === 'PUBLISHED') result.published++;
      if (!dryRun) {
        await this.createVersion(
          row.processId,
          { bpmnXml: xml, changeNote: APPLY_THEME_CHANGE_NOTE },
          actor,
          meta,
        );
        recoloured.push(row.processId);
      }
    }
    if (!dryRun) {
      await this.audit.log({
        action: 'UPDATE',
        entityType: 'Setting',
        entityId: SETTING_KEYS.DIAGRAM_THEME,
        userId: actor.id,
        summary: { appliedToDiagrams: { ...result, processIds: recoloured } },
        meta,
      });
    }
    return result;
  }
}
