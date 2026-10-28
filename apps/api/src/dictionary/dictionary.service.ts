import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  editBlockedReason,
  rankSuggestions,
  type ContentStatus,
  type DictionarySuggestQuery,
  type LabelSourceType,
  type LabelSuggestionDto,
  type Locale,
  type ProcessStatus,
  type RenameObjectInput,
  type RenamePreviewDto,
  type RenamePreviewInput,
  type RenameProcessDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ObjectsService } from '../objects/objects.service';
import { ModelsService } from '../models/models.service';
import { canEditModel } from '../processes/processes.service';
import { renameLabelRefs } from '../models/label-ref-xml';
import { forbidden } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';

/** Library objects considered by the autocomplete (terms only once approved). */
const SUGGEST_MAX_CANDIDATES = 5000;

@Injectable()
export class DictionaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly objects: ObjectsService,
    private readonly models: ModelsService,
  ) {}

  /**
   * Label autocomplete: approved dictionary terms, roles and IT systems whose name or synonym
   * matches what the modeler types, best matches first (shared `rankSuggestions`).
   */
  async suggest(q: DictionarySuggestQuery, locale: Locale): Promise<LabelSuggestionDto[]> {
    const rows = await this.prisma.repoObject.findMany({
      where: { deletedAt: null, type: { in: q.types }, status: 'APPROVED' },
      select: {
        id: true,
        type: true,
        code: true,
        nameEn: true,
        nameAr: true,
        descriptionEn: true,
        descriptionAr: true,
        synonymsEn: true,
        synonymsAr: true,
      },
      take: SUGGEST_MAX_CANDIDATES,
      orderBy: { nameEn: 'asc' },
    });
    const candidates = rows.map((r) => ({ ...r, type: r.type as LabelSourceType }));
    return rankSuggestions(candidates, q.q, locale, q.limit).map(({ candidate: c, synonym }) => ({
      id: c.id,
      type: c.type,
      code: c.code,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      descriptionEn: c.descriptionEn,
      descriptionAr: c.descriptionAr,
      synonym,
    }));
  }

  /**
   * What "rename" would do to the diagrams: every process whose working model has elements linked
   * to the object (`ph:labelRef`), with the old and new labels and whether the user may update it.
   */
  async renamePreview(
    id: string,
    names: RenamePreviewInput,
    actor: AuthUser,
  ): Promise<RenamePreviewDto> {
    const { object, processes } = await this.plan(id, names, actor);
    return { object, processes: processes.map(({ xml: _xml, ...p }) => p) };
  }

  /** The rename preview plus the updated XML of each process. */
  private async plan(id: string, names: RenamePreviewInput, actor: AuthUser) {
    const o = await this.objects.findActive(id);
    const models = await this.prisma.processModel.findMany({
      where: { process: { deletedAt: null }, bpmnXml: { contains: id } },
      select: {
        processId: true,
        bpmnXml: true,
        process: {
          select: { id: true, code: true, nameEn: true, nameAr: true, status: true, ownerId: true },
        },
      },
      orderBy: { process: { code: 'asc' } },
    });
    const processes: (RenameProcessDto & { xml: string })[] = [];
    for (const m of models) {
      const { xml, elements } = renameLabelRefs(m.bpmnXml, id, {
        nameEn: names.nameEn ?? '',
        nameAr: names.nameAr ?? '',
      });
      if (!elements.length) continue;
      const status = m.process.status as ContentStatus;
      const locked = editBlockedReason(status);
      const allowed = canEditModel(actor, m.process);
      const { ownerId: _owner, ...process } = m.process;
      processes.push({
        process: { ...process, status: status as ProcessStatus },
        elements,
        canUpdate: allowed && !locked,
        reason: !allowed ? 'NO_PERMISSION' : locked,
        newDraft: status === 'APPROVED' || status === 'PUBLISHED',
        xml,
      });
    }
    return {
      object: { id: o.id, type: o.type as LabelSourceType, nameEn: o.nameEn, nameAr: o.nameAr },
      processes,
    };
  }

  /**
   * Renames the object and, with `updateLabels`, every linked label: each process the user may
   * edit gets its working model updated and a new version (change note), audited per process;
   * the others are reported as skipped. The rename itself is audited on the object.
   */
  async rename(id: string, input: RenameObjectInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.objects.findActive(id);
    const approver = actor.permissions.has(PERMISSIONS.DICTIONARY_APPROVE);
    if (before.type === 'TERM' && before.status === 'APPROVED' && !approver)
      throw forbidden('Only dictionary approvers can rename an approved term');
    const may =
      before.type === 'TERM'
        ? actor.permissions.has(PERMISSIONS.DICTIONARY_PROPOSE)
        : actor.permissions.has(PERMISSIONS.OBJECTS_MANAGE);
    if (!may) throw forbidden('You cannot rename this object');
    const names = { nameEn: input.nameEn ?? '', nameAr: input.nameAr ?? '' };
    const { processes } = input.updateLabels
      ? await this.plan(id, names, actor)
      : { processes: [] };
    await this.objects.update(id, names, actor, meta);
    const label = (n: { nameEn: string; nameAr: string }) => n.nameEn || n.nameAr;
    const changeNote =
      input.changeNote ||
      `Dictionary: “${label(before)}” renamed to “${label(names)}” / ` +
        `القاموس: «${before.nameAr || before.nameEn}» ← «${names.nameAr || names.nameEn}»`;
    const results: RenameProcessDto[] = [];
    for (const p of processes) {
      const { xml, ...dto } = p;
      if (!p.canUpdate) {
        results.push(dto);
        continue;
      }
      const v = await this.models.createVersion(
        p.process.id,
        { bpmnXml: xml, changeNote },
        actor,
        meta,
      );
      results.push({ ...dto, versionNumber: v.versionNumber });
    }
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'RepoObject',
      entityId: id,
      userId: actor.id,
      summary: {
        renamed: {
          from: { nameEn: before.nameEn, nameAr: before.nameAr },
          to: names,
        },
        updatedProcesses: results.filter((r) => r.versionNumber).map((r) => r.process.id),
        skippedProcesses: results.filter((r) => !r.versionNumber).map((r) => r.process.id),
      },
      meta,
    });
    return {
      object: await this.objects.get(id),
      processes: results,
    };
  }
}
