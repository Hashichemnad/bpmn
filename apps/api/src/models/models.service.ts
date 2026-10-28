import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_RELATION_FOR_TYPE,
  SETTING_KEYS,
  editBlockedReason,
  extractBpmnElementIds,
  extractLaneRoles,
  resolveDiagramTheme,
  type ApplyThemeResultDto,
  type ContentStatus,
  type DiagramThemeNoticeDto,
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
import { applyThemeToXml, differsOnlyInColours } from './diagram-theme-xml';

/** Change note of the versions created by "Apply theme to existing diagrams". */
export const APPLY_THEME_CHANGE_NOTE = 'Applied colour theme';
/** Label of the version created when a published / approved diagram is recoloured in place. */
export const THEME_ONLY_VERSION_LABEL = 'Theme applied (colours only)';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      const laneRoles = await this.syncLaneRoleLinks(tx, processId, bpmnXml, actor.id);
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
            ...(laneRoles.added.length || laneRoles.removed.length ? { laneRoles } : {}),
            ...(aiGenerated ? { aiGenerated: true } : {}),
          },
          meta,
        },
        tx,
      );
    });
    return this.getModel(processId);
  }

  /**
   * Lanes linked to a library Role (`ph:roleId`) have one PERFORMS object link from the lane to
   * that role, so the role shows in Linked objects, the object's usage and the portal (D-081).
   * Changing a lane's role replaces the link, removing it deletes the link. Role ids that are not
   * an existing Role are ignored (no link, the save itself never fails because of them).
   */
  private async syncLaneRoleLinks(
    tx: Prisma.TransactionClient,
    processId: string,
    bpmnXml: string,
    actorId: string,
  ) {
    const lanes = extractLaneRoles(bpmnXml);
    const result = { added: [] as string[], removed: [] as string[] };
    if (!lanes.size) return result;
    const wanted = [...new Set([...lanes.values()].filter((v): v is string => !!v))];
    const roles = await tx.repoObject.findMany({
      where: { id: { in: wanted.filter((id) => UUID_RE.test(id)) }, type: 'ROLE', deletedAt: null },
      select: { id: true },
    });
    const valid = new Set(roles.map((r) => r.id));
    const current = await tx.objectLink.findMany({
      where: {
        processId,
        relation: 'PERFORMS',
        bpmnElementId: { in: [...lanes.keys()] },
        repoObject: { type: 'ROLE' },
      },
      select: { id: true, bpmnElementId: true, repoObjectId: true },
    });
    const stale = current.filter((l) => {
      const role = lanes.get(l.bpmnElementId);
      return !role || !valid.has(role) || role !== l.repoObjectId;
    });
    if (stale.length) {
      await tx.objectLink.deleteMany({ where: { id: { in: stale.map((l) => l.id) } } });
      result.removed = stale.map((l) => `${l.bpmnElementId}:${l.repoObjectId}`);
    }
    for (const [laneId, roleId] of lanes) {
      if (!roleId || !valid.has(roleId)) continue;
      if (current.some((l) => l.bpmnElementId === laneId && l.repoObjectId === roleId)) continue;
      await tx.objectLink.create({
        data: {
          processId,
          bpmnElementId: laneId,
          repoObjectId: roleId,
          relation: 'PERFORMS',
          createdById: actorId,
        },
      });
      result.added.push(`${laneId}:${roleId}`);
    }
    return result;
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
   * The official (approved or published) version of a process and the records pointing to it:
   * the current publication for PUBLISHED, the approving review for APPROVED (D-072).
   */
  private async officialVersion(processId: string, status: ContentStatus) {
    if (status === 'PUBLISHED') {
      const pub = await this.prisma.publication.findFirst({
        where: { entityType: 'PROCESS', entityId: processId, current: true },
        select: { id: true, versionNumber: true },
      });
      if (!pub) return null;
      const v = await this.prisma.processVersion.findUnique({
        where: { processId_versionNumber: { processId, versionNumber: pub.versionNumber } },
        select: { bpmnXml: true },
      });
      return v ? { versionNumber: pub.versionNumber, xml: v.bpmnXml, publicationId: pub.id } : null;
    }
    const review = await this.prisma.review.findFirst({
      where: { entityType: 'PROCESS', entityId: processId, status: 'APPROVED' },
      orderBy: { completedAt: 'desc' },
      select: { id: true, versionNumber: true },
    });
    if (!review) return null;
    const v = await this.prisma.processVersion.findUnique({
      where: { processId_versionNumber: { processId, versionNumber: review.versionNumber } },
      select: { bpmnXml: true },
    });
    return v ? { versionNumber: review.versionNumber, xml: v.bpmnXml, reviewId: review.id } : null;
  }

  /**
   * Colours-only update of an approved / published process (D-072): new version labelled
   * "Theme applied (colours only)", working model updated, the publication (or the approving
   * review) moves to that version so the portal shows the colours; the status does not change.
   */
  private async applyThemeInPlace(
    processId: string,
    xml: string,
    official: NonNullable<Awaited<ReturnType<ModelsService['officialVersion']>>>,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const version = await this.prisma.$transaction(async (tx) => {
      const last = await tx.processVersion.aggregate({
        where: { processId },
        _max: { versionNumber: true },
      });
      const v = await tx.processVersion.create({
        data: {
          processId,
          versionNumber: (last._max.versionNumber ?? 0) + 1,
          bpmnXml: xml,
          changeNote: APPLY_THEME_CHANGE_NOTE,
          label: THEME_ONLY_VERSION_LABEL,
          createdById: actor.id,
        },
      });
      await tx.processModel.update({
        where: { processId },
        data: { bpmnXml: xml, updatedById: actor.id },
      });
      if (official.publicationId)
        await tx.publication.update({
          where: { id: official.publicationId },
          data: { versionNumber: v.versionNumber },
        });
      if (official.reviewId)
        await tx.review.update({
          where: { id: official.reviewId },
          data: { versionNumber: v.versionNumber },
        });
      await this.audit.log(
        {
          action: 'VERSION',
          entityType: 'ProcessVersion',
          entityId: v.id,
          userId: actor.id,
          summary: {
            processId,
            versionNumber: v.versionNumber,
            changeNote: v.changeNote,
            label: v.label,
          },
          meta,
        },
        tx,
      );
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Process',
          entityId: processId,
          userId: actor.id,
          summary: {
            themeApplied: 'colours only',
            fromVersion: official.versionNumber,
            toVersion: v.versionNumber,
            ...(official.publicationId ? { publicationId: official.publicationId } : {}),
            ...(official.reviewId ? { reviewId: official.reviewId } : {}),
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
  }

  /**
   * "Apply theme to existing diagrams" (Settings → Diagram colours): gives elements without colours
   * the theme colour in every working model. Elements with colours are never changed. Processes in
   * review or archived are skipped (they are locked). Drafts get a new version. Approved /
   * published processes whose recoloured model differs from the official version in colours only
   * are recoloured in place (status kept, portal updated); otherwise they get a new draft like any
   * other edit (D-072). With `dryRun` nothing is written and only the counts are returned.
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
      inPlace: 0,
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
      const official =
        status === 'APPROVED' || status === 'PUBLISHED'
          ? await this.officialVersion(row.processId, status)
          : null;
      const inPlace = !!official && differsOnlyInColours(official.xml, xml);
      if (inPlace) result.inPlace++;
      else if (status === 'APPROVED' || status === 'PUBLISHED') result.published++;
      if (dryRun) continue;
      if (inPlace) await this.applyThemeInPlace(row.processId, xml, official, actor, meta);
      else
        await this.createVersion(
          row.processId,
          { bpmnXml: xml, changeNote: APPLY_THEME_CHANGE_NOTE },
          actor,
          meta,
        );
      recoloured.push(row.processId);
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
      await this.closeThemeNotice('applied', actor);
    }
    return result;
  }

  /**
   * After the upgrade Super Admins see a notice "Diagrams can now be coloured: run Apply theme"
   * until it is dismissed or the theme is applied, and only while uncoloured diagrams exist.
   */
  async themeNotice(actor: AuthUser, meta: RequestMeta): Promise<DiagramThemeNoticeDto> {
    const done = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.DIAGRAM_THEME_NOTICE },
    });
    if (done) return { show: false, models: 0 };
    const { models } = await this.applyTheme(true, actor, meta);
    return { show: models > 0, models };
  }

  async dismissThemeNotice(actor: AuthUser, meta: RequestMeta): Promise<DiagramThemeNoticeDto> {
    await this.closeThemeNotice('dismissed', actor);
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'Setting',
      entityId: SETTING_KEYS.DIAGRAM_THEME_NOTICE,
      userId: actor.id,
      summary: { notice: 'dismissed' },
      meta,
    });
    return { show: false, models: 0 };
  }

  private async closeThemeNotice(reason: 'applied' | 'dismissed', actor: AuthUser) {
    const key = SETTING_KEYS.DIAGRAM_THEME_NOTICE;
    const value = { reason, at: new Date().toISOString(), userId: actor.id };
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value, updatedById: actor.id },
      update: { value, updatedById: actor.id },
    });
  }
}
