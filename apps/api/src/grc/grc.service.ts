import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  PERMISSIONS,
  extractBpmnLabels,
  isEffectiveControl,
  isOverdue,
  rateRisk,
  riskScore,
  type BpmnElementLabel,
  type ControlDto,
  type ControlEffectiveness,
  type ControlListQuery,
  type CreateControlInput,
  type CreateRequirementInput,
  type CreateRiskInput,
  type GrcActivityDto,
  type GrcItemDetailDto,
  type GrcObjectType,
  type GrcRef,
  type GrcSettings,
  type GrcStatus,
  type GrcStepLinkDto,
  type Paginated,
  type ProcessGrcDto,
  type ProcessStatus,
  type RequirementDto,
  type RequirementListQuery,
  type RiskDto,
  type RiskListQuery,
  type UpdateControlInput,
  type UpdateRequirementInput,
  type UpdateRiskInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { badRequest, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { elementLabel } from '../models/bpmn-xml';
import { GrcSettingsService } from './grc-settings.service';

type Tx = Prisma.TransactionClient | PrismaClient;

const userRef = { select: { id: true, email: true, nameEn: true, nameAr: true } } as const;
const deptRef = { select: { id: true, nameEn: true, nameAr: true } } as const;
const objRef = {
  select: { id: true, type: true, code: true, nameEn: true, nameAr: true, deletedAt: true },
} as const;
/** Only links from active processes count. */
const activeLinks = { process: { deletedAt: null } } satisfies Prisma.ObjectLinkWhereInput;

const riskInclude = {
  owner: userRef,
  _count: { select: { links: { where: activeLinks } } },
  risk: {
    include: {
      department: deptRef,
      controls: {
        include: {
          control: {
            select: {
              status: true,
              effectiveness: true,
              keyControl: true,
              object: objRef,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.RepoObjectInclude;

const controlInclude = {
  owner: userRef,
  _count: { select: { links: { where: activeLinks } } },
  control: {
    include: {
      department: deptRef,
      system: { select: { id: true, code: true, nameEn: true, nameAr: true, deletedAt: true } },
      risks: {
        include: {
          risk: {
            select: {
              status: true,
              inherentLikelihood: true,
              inherentImpact: true,
              residualLikelihood: true,
              residualImpact: true,
              object: objRef,
            },
          },
        },
      },
      requirements: {
        include: { requirement: { select: { status: true, object: objRef } } },
      },
    },
  },
} satisfies Prisma.RepoObjectInclude;

const requirementInclude = {
  owner: userRef,
  _count: { select: { links: { where: activeLinks } } },
  requirement: {
    include: {
      department: deptRef,
      parent: { select: { status: true, object: objRef } },
      _count: { select: { children: { where: { object: { deletedAt: null } } } } },
      controls: {
        include: {
          control: { select: { status: true, effectiveness: true, object: objRef } },
        },
      },
    },
  },
} satisfies Prisma.RepoObjectInclude;

type RiskRow = Prisma.RepoObjectGetPayload<{ include: typeof riskInclude }>;
type ControlRow = Prisma.RepoObjectGetPayload<{ include: typeof controlInclude }>;
type RequirementRow = Prisma.RepoObjectGetPayload<{ include: typeof requirementInclude }>;

const ref = (
  o: { id: string; type: string; code: string | null; nameEn: string; nameAr: string },
  status: string,
): GrcRef => ({
  id: o.id,
  type: o.type as GrcObjectType,
  code: o.code,
  nameEn: o.nameEn,
  nameAr: o.nameAr,
  status: status as GrcStatus,
});

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const toDate = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : new Date(v);

function base(o: RiskRow | ControlRow | RequirementRow, ext: { department: unknown }) {
  return {
    id: o.id,
    code: o.code,
    nameEn: o.nameEn,
    nameAr: o.nameAr,
    descriptionEn: o.descriptionEn,
    descriptionAr: o.descriptionAr,
    owner: o.owner ?? null,
    department: (ext.department as RiskDto['department']) ?? null,
    stepCount: o._count.links,
    createdById: o.createdById,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export function toRiskDto(o: RiskRow, settings: GrcSettings): RiskDto {
  const r = o.risk!;
  const controls = r.controls
    .filter((c) => !c.control.object.deletedAt)
    .map((c) => ({
      ...ref(c.control.object, c.control.status),
      effectiveness: c.control.effectiveness as ControlEffectiveness,
      keyControl: c.control.keyControl,
    }));
  return {
    ...base(o, r),
    type: 'RISK',
    status: r.status,
    nextReviewAt: iso(r.nextReviewAt),
    overdue: r.status === 'ACTIVE' && isOverdue(r.nextReviewAt),
    category: r.category,
    causeEn: r.causeEn,
    causeAr: r.causeAr,
    consequenceEn: r.consequenceEn,
    consequenceAr: r.consequenceAr,
    inherentLikelihood: r.inherentLikelihood,
    inherentImpact: r.inherentImpact,
    residualLikelihood: r.residualLikelihood,
    residualImpact: r.residualImpact,
    response: r.response,
    rating: rateRisk(r, settings.bands),
    controls,
    effectivelyControlled: controls.some(isEffectiveControl),
  };
}

export function toControlDto(o: ControlRow, settings: GrcSettings): ControlDto {
  const c = o.control!;
  return {
    ...base(o, c),
    type: 'CONTROL',
    status: c.status,
    nextReviewAt: iso(c.nextReviewAt),
    overdue: c.status === 'ACTIVE' && isOverdue(c.nextReviewAt),
    controlType: c.controlType,
    nature: c.nature,
    frequency: c.frequency,
    keyControl: c.keyControl,
    system:
      c.system && !c.system.deletedAt
        ? { id: c.system.id, code: c.system.code, nameEn: c.system.nameEn, nameAr: c.system.nameAr }
        : null,
    effectiveness: c.effectiveness,
    lastAssessedAt: iso(c.lastAssessedAt),
    risks: c.risks
      .filter((x) => !x.risk.object.deletedAt)
      .map((x) => ({
        ...ref(x.risk.object, x.risk.status),
        rating: rateRisk(x.risk, settings.bands),
      })),
    requirements: c.requirements
      .filter((x) => !x.requirement.object.deletedAt)
      .map((x) => ref(x.requirement.object, x.requirement.status)),
  };
}

export function toRequirementDto(o: RequirementRow): RequirementDto {
  const q = o.requirement!;
  return {
    ...base(o, q),
    type: 'REQUIREMENT',
    status: q.status,
    nextReviewAt: iso(q.nextReviewAt),
    overdue: q.status === 'ACTIVE' && isOverdue(q.nextReviewAt),
    level: q.level,
    parent: q.parent && !q.parent.object.deletedAt ? ref(q.parent.object, q.parent.status) : null,
    sourceRef: q.sourceRef,
    url: q.url,
    effectiveDate: iso(q.effectiveDate),
    childCount: q._count.children,
    controls: q.controls
      .filter((x) => !x.control.object.deletedAt)
      .map((x) => ({
        ...ref(x.control.object, x.control.status),
        effectiveness: x.control.effectiveness as ControlEffectiveness,
      })),
  };
}

/** Sorts and pages in memory (ratings and coverage are computed, not stored). */
function page<T>(
  items: T[],
  q: { page: number; pageSize: number; sort?: string; order: 'asc' | 'desc' },
  sorters: Record<string, (x: T) => string | number>,
  fallback: string,
): Paginated<T> {
  const key = sorters[q.sort ?? ''] ? q.sort! : fallback;
  const get = sorters[key];
  const dir = q.order === 'desc' ? -1 : 1;
  const sorted = [...items].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
  });
  const start = (q.page - 1) * q.pageSize;
  return {
    items: sorted.slice(start, start + q.pageSize),
    total: items.length,
    page: q.page,
    pageSize: q.pageSize,
  };
}

const commonSorters = <T extends { code: string | null; nameEn: string; updatedAt: string }>() => ({
  code: (x: T) => x.code ?? '',
  nameEn: (x: T) => x.nameEn,
  updatedAt: (x: T) => x.updatedAt,
});

/** Fields of the assessment history (who changed a rating or the effectiveness, from / to). */
const RISK_ASSESSMENT = [
  'inherentLikelihood',
  'inherentImpact',
  'residualLikelihood',
  'residualImpact',
] as const;

@Injectable()
export class GrcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: GrcSettingsService,
  ) {}

  // ---------- Access ----------

  private canEdit(actor: AuthUser) {
    return actor.permissions.has(PERMISSIONS.GRC_EDIT);
  }

  /** Editors change anything; proposers only their own drafts (and never the status). */
  private assertMayChange(
    o: { createdById: string | null },
    status: GrcStatus,
    actor: AuthUser,
    input: { status?: GrcStatus },
  ) {
    if (this.canEdit(actor)) return;
    if (!actor.permissions.has(PERMISSIONS.GRC_PROPOSE)) throw forbidden();
    if (o.createdById !== actor.id || status !== 'DRAFT')
      throw forbidden('Only Risk & Compliance editors can change this item');
    if (input.status && input.status !== 'DRAFT')
      throw forbidden('Only Risk & Compliance editors can activate a proposal');
  }

  private async assertRefs(
    tx: Tx,
    input: { ownerId?: string | null; departmentId?: string | null },
  ) {
    if (input.ownerId) {
      const u = await tx.user.findFirst({ where: { id: input.ownerId, deletedAt: null } });
      if (!u) throw badRequest('INVALID_OWNER');
    }
    if (input.departmentId) {
      const d = await tx.department.findFirst({
        where: { id: input.departmentId, deletedAt: null },
      });
      if (!d) throw badRequest('INVALID_DEPARTMENT');
    }
  }

  private async assertObjects(tx: Tx, ids: string[] | undefined, type: GrcObjectType | 'SYSTEM') {
    if (!ids?.length) return;
    const n = await tx.repoObject.count({ where: { id: { in: ids }, type, deletedAt: null } });
    if (n !== ids.length) throw badRequest(`INVALID_${type}_REFERENCE`);
  }

  private assertCategory(category: string | undefined, settings: GrcSettings) {
    if (category && !settings.categories.some((c) => c.key === category))
      throw badRequest('INVALID_CATEGORY');
  }

  // ---------- Risks ----------

  async listRisks(q: RiskListQuery): Promise<Paginated<RiskDto>> {
    const settings = await this.settings.get();
    const rows = await this.prisma.repoObject.findMany({
      where: {
        type: 'RISK',
        deletedAt: null,
        ownerId: q.ownerId,
        ...this.textFilter(q.q),
        ...(q.processId ? { links: { some: { processId: q.processId } } } : {}),
        risk: {
          status: q.status,
          category: q.category,
          departmentId: q.departmentId,
        },
      },
      include: riskInclude,
    });
    let items = rows.map((r) => toRiskDto(r, settings));
    if (q.overdue !== undefined) items = items.filter((r) => r.overdue === q.overdue);
    if (q.rating) items = items.filter((r) => r.rating.residualBand === q.rating);
    if (q.inherentRating) items = items.filter((r) => r.rating.inherentBand === q.inherentRating);
    if (q.cell) {
      const [l, i] = q.cell.split(',').map(Number);
      items = items.filter((r) =>
        q.matrix === 'inherent'
          ? r.inherentLikelihood === l && r.inherentImpact === i
          : (r.residualLikelihood ?? r.inherentLikelihood) === l &&
            (r.residualImpact ?? r.inherentImpact) === i,
      );
    }
    if (q.withoutControls !== undefined)
      items = items.filter((r) => (r.controls.length === 0) === q.withoutControls);
    if (q.alertWithoutEffectiveControl)
      items = items.filter((r) => r.rating.alert && !r.effectivelyControlled);
    return page(
      items,
      q,
      {
        ...commonSorters<RiskDto>(),
        category: (x) => x.category,
        inherentScore: (x) => x.rating.inherentScore,
        residualScore: (x) => x.rating.residualScore,
        status: (x) => x.status,
        nextReviewAt: (x) => x.nextReviewAt ?? '9999',
        stepCount: (x) => x.stepCount,
      },
      'code',
    );
  }

  private textFilter(q?: string): Prisma.RepoObjectWhereInput {
    return q
      ? {
          OR: [
            { code: { contains: q, mode: 'insensitive' } },
            { nameEn: { contains: q, mode: 'insensitive' } },
            { nameAr: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
  }

  private async findItem(id: string, type: GrcObjectType) {
    const o = await this.prisma.repoObject.findFirst({ where: { id, type, deletedAt: null } });
    if (!o)
      throw notFound(type === 'RISK' ? 'Risk' : type === 'CONTROL' ? 'Control' : 'Requirement');
    return o;
  }

  async getRisk(id: string): Promise<GrcItemDetailDto<RiskDto>> {
    await this.findItem(id, 'RISK');
    const [row, settings, steps] = await Promise.all([
      this.prisma.repoObject.findUniqueOrThrow({ where: { id }, include: riskInclude }),
      this.settings.get(),
      this.steps(id),
    ]);
    return { item: toRiskDto(row, settings), steps };
  }

  /** Proposers (no `grc.edit`) always create drafts. */
  private initialStatus(input: { status?: GrcStatus }, actor: AuthUser, fallback: GrcStatus) {
    return this.canEdit(actor) ? (input.status ?? fallback) : 'DRAFT';
  }

  async createRisk(input: CreateRiskInput, actor: AuthUser, meta: RequestMeta) {
    const settings = await this.settings.get();
    this.assertCategory(input.category, settings);
    const status = this.initialStatus(input, actor, 'ACTIVE');
    const id = await this.prisma.$transaction(async (tx) => {
      await this.assertRefs(tx, input);
      await this.assertObjects(tx, input.controlIds, 'CONTROL');
      const o = await tx.repoObject.create({
        data: {
          type: 'RISK',
          ...this.objectData(input),
          createdById: actor.id,
          updatedById: actor.id,
          risk: {
            create: {
              category: input.category,
              causeEn: input.causeEn ?? '',
              causeAr: input.causeAr ?? '',
              consequenceEn: input.consequenceEn ?? '',
              consequenceAr: input.consequenceAr ?? '',
              departmentId: input.departmentId ?? null,
              inherentLikelihood: input.inherentLikelihood,
              inherentImpact: input.inherentImpact,
              residualLikelihood: input.residualLikelihood ?? null,
              residualImpact: input.residualImpact ?? null,
              response: input.response ?? 'MITIGATE',
              status,
              nextReviewAt: toDate(input.nextReviewAt) ?? null,
              lastAssessedAt: new Date(),
            },
          },
        },
      });
      if (input.controlIds?.length)
        await tx.riskControl.createMany({
          data: input.controlIds.map((controlId) => ({
            riskId: o.id,
            controlId,
            createdById: actor.id,
          })),
        });
      const initial = {
        status: { from: null, to: status },
        ...Object.fromEntries(
          RISK_ASSESSMENT.map((f) => [f, { from: null, to: (input[f] as number | null) ?? null }]),
        ),
      };
      await this.activity(tx, o.id, 'CREATED', initial, input.comment, actor.id);
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Risk',
          entityId: o.id,
          userId: actor.id,
          summary: {
            after: {
              code: o.code,
              nameEn: o.nameEn,
              nameAr: o.nameAr,
              status,
              inherent: riskScore(input.inherentLikelihood, input.inherentImpact),
            },
          },
          meta,
        },
        tx,
      );
      return o.id;
    });
    return this.getRisk(id);
  }

  private objectData(input: {
    code?: string | null;
    nameEn?: string;
    nameAr?: string;
    descriptionEn?: string;
    descriptionAr?: string;
    ownerId?: string | null;
  }) {
    return {
      code: input.code === undefined ? undefined : input.code || null,
      nameEn: input.nameEn,
      nameAr: input.nameAr,
      descriptionEn: input.descriptionEn,
      descriptionAr: input.descriptionAr,
      ownerId: input.ownerId,
    };
  }

  async updateRisk(id: string, input: UpdateRiskInput, actor: AuthUser, meta: RequestMeta) {
    const o = await this.findItem(id, 'RISK');
    const before = await this.prisma.risk.findUniqueOrThrow({ where: { objectId: id } });
    this.assertMayChange(o, before.status, actor, input);
    const settings = await this.settings.get();
    this.assertCategory(input.category, settings);
    if (input.controlIds && !this.canEdit(actor) && input.controlIds.length)
      await this.assertOwnDrafts(input.controlIds, actor);
    await this.prisma.$transaction(async (tx) => {
      await this.assertRefs(tx, input);
      await this.assertObjects(tx, input.controlIds, 'CONTROL');
      const after = await tx.risk.update({
        where: { objectId: id },
        data: {
          category: input.category,
          causeEn: input.causeEn,
          causeAr: input.causeAr,
          consequenceEn: input.consequenceEn,
          consequenceAr: input.consequenceAr,
          departmentId: input.departmentId,
          inherentLikelihood: input.inherentLikelihood,
          inherentImpact: input.inherentImpact,
          residualLikelihood: input.residualLikelihood,
          residualImpact: input.residualImpact,
          response: input.response,
          status: input.status,
          nextReviewAt: toDate(input.nextReviewAt),
        },
      });
      const assessed = diff(before, after, RISK_ASSESSMENT);
      if (Object.keys(assessed).length)
        await tx.risk.update({ where: { objectId: id }, data: { lastAssessedAt: new Date() } });
      const objAfter = await tx.repoObject.update({
        where: { id },
        data: { ...this.objectData(input), updatedById: actor.id },
      });
      const controls = input.controlIds
        ? await this.replaceRiskControls(tx, id, input.controlIds, actor.id)
        : null;
      await this.recordChanges(tx, id, before.status, after.status, assessed, input.comment, actor);
      await this.audit.log(
        {
          action: Object.keys(assessed).length ? 'ASSESS' : 'UPDATE',
          entityType: 'Risk',
          entityId: id,
          userId: actor.id,
          summary: {
            changes: {
              ...diff(o, objAfter, ['code', 'nameEn', 'nameAr', 'ownerId'] as const),
              ...diff(before, after, [
                'category',
                'departmentId',
                'response',
                'status',
                'nextReviewAt',
                ...RISK_ASSESSMENT,
              ] as const),
            },
            ...(controls ? { controls } : {}),
          },
          meta,
        },
        tx,
      );
    });
    return this.getRisk(id);
  }

  /** Proposers may relate only their own draft items. */
  private async assertOwnDrafts(ids: string[], actor: AuthUser) {
    const own = await this.prisma.repoObject.count({
      where: {
        id: { in: ids },
        createdById: actor.id,
        OR: [{ risk: { status: 'DRAFT' } }, { control: { status: 'DRAFT' } }],
      },
    });
    if (own !== ids.length)
      throw forbidden('Only Risk & Compliance editors can relate these items');
  }

  private async replaceRiskControls(tx: Tx, riskId: string, controlIds: string[], actorId: string) {
    const current = await tx.riskControl.findMany({ where: { riskId } });
    const added = controlIds.filter((c) => !current.some((x) => x.controlId === c));
    const removed = current
      .filter((x) => !controlIds.includes(x.controlId))
      .map((x) => x.controlId);
    if (removed.length)
      await tx.riskControl.deleteMany({ where: { riskId, controlId: { in: removed } } });
    if (added.length)
      await tx.riskControl.createMany({
        data: added.map((controlId) => ({ riskId, controlId, createdById: actorId })),
      });
    return added.length || removed.length ? { added, removed } : null;
  }

  private async recordChanges(
    tx: Tx,
    objectId: string,
    statusBefore: GrcStatus,
    statusAfter: GrcStatus,
    assessed: Record<string, { from: unknown; to: unknown }>,
    comment: string | undefined,
    actor: AuthUser,
  ) {
    if (Object.keys(assessed).length)
      await this.activity(tx, objectId, 'ASSESSMENT', assessed, comment, actor.id);
    if (statusBefore !== statusAfter)
      await this.activity(
        tx,
        objectId,
        'STATUS',
        { status: { from: statusBefore, to: statusAfter } },
        Object.keys(assessed).length ? '' : comment,
        actor.id,
      );
  }

  private activity(
    tx: Tx,
    objectId: string,
    kind: 'CREATED' | 'ASSESSMENT' | 'STATUS' | 'COMMENT',
    changes: object,
    comment: string | undefined,
    actorId: string,
  ) {
    return tx.grcActivity.create({
      data: {
        objectId,
        kind,
        changes: changes as Prisma.InputJsonValue,
        comment: comment ?? '',
        createdById: actorId,
      },
    });
  }

  // ---------- Controls ----------

  async listControls(q: ControlListQuery): Promise<Paginated<ControlDto>> {
    const settings = await this.settings.get();
    const rows = await this.prisma.repoObject.findMany({
      where: {
        type: 'CONTROL',
        deletedAt: null,
        ownerId: q.ownerId,
        ...this.textFilter(q.q),
        ...(q.processId ? { links: { some: { processId: q.processId } } } : {}),
        control: {
          status: q.status,
          departmentId: q.departmentId,
          controlType: q.controlType,
          nature: q.nature,
          effectiveness: q.effectiveness,
          keyControl: q.keyAttention ? true : q.keyControl,
          ...(q.keyAttention ? { effectiveness: { in: ['NOT_ASSESSED', 'NOT_EFFECTIVE'] } } : {}),
        },
      },
      include: controlInclude,
    });
    let items = rows.map((r) => toControlDto(r, settings));
    if (q.overdue !== undefined) items = items.filter((r) => r.overdue === q.overdue);
    return page(
      items,
      q,
      {
        ...commonSorters<ControlDto>(),
        controlType: (x) => x.controlType,
        effectiveness: (x) => x.effectiveness,
        keyControl: (x) => (x.keyControl ? 1 : 0),
        status: (x) => x.status,
        nextReviewAt: (x) => x.nextReviewAt ?? '9999',
        stepCount: (x) => x.stepCount,
      },
      'code',
    );
  }

  async getControl(id: string): Promise<GrcItemDetailDto<ControlDto>> {
    await this.findItem(id, 'CONTROL');
    const [row, settings, steps] = await Promise.all([
      this.prisma.repoObject.findUniqueOrThrow({ where: { id }, include: controlInclude }),
      this.settings.get(),
      this.steps(id),
    ]);
    return { item: toControlDto(row, settings), steps };
  }

  async createControl(input: CreateControlInput, actor: AuthUser, meta: RequestMeta) {
    const status = this.initialStatus(input, actor, 'ACTIVE');
    if (!this.canEdit(actor) && input.requirementIds?.length)
      throw forbidden('Only Risk & Compliance editors can map requirements');
    if (!this.canEdit(actor) && input.riskIds?.length)
      await this.assertOwnDrafts(input.riskIds, actor);
    const id = await this.prisma.$transaction(async (tx) => {
      await this.assertRefs(tx, input);
      await this.assertObjects(tx, input.riskIds, 'RISK');
      await this.assertObjects(tx, input.requirementIds, 'REQUIREMENT');
      if (input.systemId) await this.assertObjects(tx, [input.systemId], 'SYSTEM');
      const effectiveness = this.canEdit(actor)
        ? (input.effectiveness ?? 'NOT_ASSESSED')
        : 'NOT_ASSESSED';
      const o = await tx.repoObject.create({
        data: {
          type: 'CONTROL',
          ...this.objectData(input),
          createdById: actor.id,
          updatedById: actor.id,
          control: {
            create: {
              controlType: input.controlType,
              nature: input.nature,
              frequency: input.frequency,
              departmentId: input.departmentId ?? null,
              keyControl: input.keyControl ?? false,
              systemId: input.systemId ?? null,
              effectiveness,
              status,
              nextReviewAt: toDate(input.nextReviewAt) ?? null,
              lastAssessedAt: effectiveness === 'NOT_ASSESSED' ? null : new Date(),
            },
          },
        },
      });
      if (input.riskIds?.length)
        await tx.riskControl.createMany({
          data: input.riskIds.map((riskId) => ({ riskId, controlId: o.id, createdById: actor.id })),
        });
      if (input.requirementIds?.length)
        await tx.requirementControl.createMany({
          data: input.requirementIds.map((requirementId) => ({
            requirementId,
            controlId: o.id,
            createdById: actor.id,
          })),
        });
      await this.activity(
        tx,
        o.id,
        'CREATED',
        { status: { from: null, to: status }, effectiveness: { from: null, to: effectiveness } },
        input.comment,
        actor.id,
      );
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Control',
          entityId: o.id,
          userId: actor.id,
          summary: {
            after: { code: o.code, nameEn: o.nameEn, nameAr: o.nameAr, status, effectiveness },
          },
          meta,
        },
        tx,
      );
      return o.id;
    });
    return this.getControl(id);
  }

  async updateControl(id: string, input: UpdateControlInput, actor: AuthUser, meta: RequestMeta) {
    const o = await this.findItem(id, 'CONTROL');
    const before = await this.prisma.control.findUniqueOrThrow({ where: { objectId: id } });
    this.assertMayChange(o, before.status, actor, input);
    if (!this.canEdit(actor)) {
      if (input.effectiveness && input.effectiveness !== before.effectiveness)
        throw forbidden('Only Risk & Compliance editors can assess controls');
      if (input.requirementIds?.length)
        throw forbidden('Only Risk & Compliance editors can map requirements');
      if (input.riskIds?.length) await this.assertOwnDrafts(input.riskIds, actor);
    }
    await this.prisma.$transaction(async (tx) => {
      await this.assertRefs(tx, input);
      await this.assertObjects(tx, input.riskIds, 'RISK');
      await this.assertObjects(tx, input.requirementIds, 'REQUIREMENT');
      if (input.systemId) await this.assertObjects(tx, [input.systemId], 'SYSTEM');
      const after = await tx.control.update({
        where: { objectId: id },
        data: {
          controlType: input.controlType,
          nature: input.nature,
          frequency: input.frequency,
          departmentId: input.departmentId,
          keyControl: input.keyControl,
          systemId: input.systemId,
          effectiveness: input.effectiveness,
          status: input.status,
          nextReviewAt: toDate(input.nextReviewAt),
        },
      });
      const assessed = diff(before, after, ['effectiveness'] as const);
      if (input.effectiveness)
        // Confirming the same effectiveness is an assessment too (it dates the last review).
        await tx.control.update({ where: { objectId: id }, data: { lastAssessedAt: new Date() } });
      const objAfter = await tx.repoObject.update({
        where: { id },
        data: { ...this.objectData(input), updatedById: actor.id },
      });
      const risks = input.riskIds
        ? await this.replaceLinks(tx, 'risk', id, input.riskIds, actor.id)
        : null;
      const requirements = input.requirementIds
        ? await this.replaceLinks(tx, 'requirement', id, input.requirementIds, actor.id)
        : null;
      await this.recordChanges(tx, id, before.status, after.status, assessed, input.comment, actor);
      await this.audit.log(
        {
          action: Object.keys(assessed).length ? 'ASSESS' : 'UPDATE',
          entityType: 'Control',
          entityId: id,
          userId: actor.id,
          summary: {
            changes: {
              ...diff(o, objAfter, ['code', 'nameEn', 'nameAr', 'ownerId'] as const),
              ...diff(before, after, [
                'controlType',
                'nature',
                'frequency',
                'departmentId',
                'keyControl',
                'systemId',
                'effectiveness',
                'status',
                'nextReviewAt',
              ] as const),
            },
            ...(risks ? { risks } : {}),
            ...(requirements ? { requirements } : {}),
          },
          meta,
        },
        tx,
      );
    });
    return this.getControl(id);
  }

  /** Replaces the risks or requirements of a control. */
  private async replaceLinks(
    tx: Tx,
    kind: 'risk' | 'requirement',
    controlId: string,
    ids: string[],
    actorId: string,
  ) {
    const current =
      kind === 'risk'
        ? (await tx.riskControl.findMany({ where: { controlId } })).map((x) => x.riskId)
        : (await tx.requirementControl.findMany({ where: { controlId } })).map(
            (x) => x.requirementId,
          );
    const added = ids.filter((i) => !current.includes(i));
    const removed = current.filter((i) => !ids.includes(i));
    if (kind === 'risk') {
      if (removed.length)
        await tx.riskControl.deleteMany({ where: { controlId, riskId: { in: removed } } });
      if (added.length)
        await tx.riskControl.createMany({
          data: added.map((riskId) => ({ riskId, controlId, createdById: actorId })),
        });
    } else {
      if (removed.length)
        await tx.requirementControl.deleteMany({
          where: { controlId, requirementId: { in: removed } },
        });
      if (added.length)
        await tx.requirementControl.createMany({
          data: added.map((requirementId) => ({ requirementId, controlId, createdById: actorId })),
        });
    }
    return added.length || removed.length ? { added, removed } : null;
  }

  // ---------- Requirements ----------

  async listRequirements(q: RequirementListQuery): Promise<Paginated<RequirementDto>> {
    const rows = await this.prisma.repoObject.findMany({
      where: {
        type: 'REQUIREMENT',
        deletedAt: null,
        ownerId: q.ownerId,
        ...this.textFilter(q.q),
        ...(q.processId ? { links: { some: { processId: q.processId } } } : {}),
        requirement: {
          status: q.status,
          departmentId: q.departmentId,
          level: q.level,
          parentId: q.parentId,
        },
      },
      include: requirementInclude,
    });
    let items = rows.map((r) => toRequirementDto(r));
    if (q.overdue !== undefined) items = items.filter((r) => r.overdue === q.overdue);
    if (q.withoutControls !== undefined)
      items = items.filter((r) => (r.controls.length === 0) === q.withoutControls);
    return page(
      items,
      q,
      {
        ...commonSorters<RequirementDto>(),
        level: (x) => x.level,
        sourceRef: (x) => x.sourceRef,
        effectiveDate: (x) => x.effectiveDate ?? '',
        status: (x) => x.status,
        stepCount: (x) => x.stepCount,
      },
      'code',
    );
  }

  async getRequirement(id: string): Promise<GrcItemDetailDto<RequirementDto>> {
    await this.findItem(id, 'REQUIREMENT');
    const [row, steps] = await Promise.all([
      this.prisma.repoObject.findUniqueOrThrow({ where: { id }, include: requirementInclude }),
      this.steps(id),
    ]);
    return { item: toRequirementDto(row), steps };
  }

  /** A parent must be a requirement one level up (source → section → clause), never a descendant. */
  private async assertParent(
    tx: Tx,
    id: string | null,
    parentId: string | null | undefined,
    level: string,
  ) {
    if (!parentId) {
      if (level !== 'SOURCE') throw badRequest('PARENT_REQUIRED');
      return;
    }
    if (parentId === id) throw badRequest('INVALID_PARENT');
    const parent = await tx.requirement.findFirst({
      where: { objectId: parentId, object: { deletedAt: null } },
    });
    if (!parent) throw badRequest('INVALID_REQUIREMENT_REFERENCE');
    const expected =
      level === 'SECTION' ? 'SOURCE' : level === 'CLAUSE' ? ['SOURCE', 'SECTION'] : [];
    if (!([] as string[]).concat(expected).includes(parent.level))
      throw badRequest('INVALID_PARENT_LEVEL');
  }

  async createRequirement(input: CreateRequirementInput, actor: AuthUser, meta: RequestMeta) {
    const level = input.level ?? (input.parentId ? 'CLAUSE' : 'SOURCE');
    const status = input.status ?? 'ACTIVE';
    const id = await this.prisma.$transaction(async (tx) => {
      await this.assertRefs(tx, input);
      await this.assertParent(tx, null, input.parentId, level);
      await this.assertObjects(tx, input.controlIds, 'CONTROL');
      const o = await tx.repoObject.create({
        data: {
          type: 'REQUIREMENT',
          ...this.objectData(input),
          createdById: actor.id,
          updatedById: actor.id,
          requirement: {
            create: {
              level,
              parentId: input.parentId ?? null,
              sourceRef: input.sourceRef ?? '',
              url: input.url ?? null,
              departmentId: input.departmentId ?? null,
              effectiveDate: toDate(input.effectiveDate) ?? null,
              status,
              nextReviewAt: toDate(input.nextReviewAt) ?? null,
            },
          },
        },
      });
      if (input.controlIds?.length)
        await tx.requirementControl.createMany({
          data: input.controlIds.map((controlId) => ({
            requirementId: o.id,
            controlId,
            createdById: actor.id,
          })),
        });
      await this.activity(
        tx,
        o.id,
        'CREATED',
        { status: { from: null, to: status } },
        input.comment,
        actor.id,
      );
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Requirement',
          entityId: o.id,
          userId: actor.id,
          summary: { after: { code: o.code, nameEn: o.nameEn, nameAr: o.nameAr, level, status } },
          meta,
        },
        tx,
      );
      return o.id;
    });
    return this.getRequirement(id);
  }

  async updateRequirement(
    id: string,
    input: UpdateRequirementInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const o = await this.findItem(id, 'REQUIREMENT');
    const before = await this.prisma.requirement.findUniqueOrThrow({ where: { objectId: id } });
    await this.prisma.$transaction(async (tx) => {
      await this.assertRefs(tx, input);
      await this.assertObjects(tx, input.controlIds, 'CONTROL');
      const level = input.level ?? before.level;
      const parentId = input.parentId === undefined ? before.parentId : input.parentId;
      if (input.level !== undefined || input.parentId !== undefined) {
        await this.assertParent(tx, id, parentId, level);
        if (parentId && (await this.isDescendant(tx, parentId, id)))
          throw badRequest('INVALID_PARENT');
      }
      const after = await tx.requirement.update({
        where: { objectId: id },
        data: {
          level: input.level,
          parentId: input.parentId,
          sourceRef: input.sourceRef,
          url: input.url,
          departmentId: input.departmentId,
          effectiveDate: toDate(input.effectiveDate),
          status: input.status,
          nextReviewAt: toDate(input.nextReviewAt),
        },
      });
      const objAfter = await tx.repoObject.update({
        where: { id },
        data: { ...this.objectData(input), updatedById: actor.id },
      });
      let controls = null;
      if (input.controlIds) {
        const current = (
          await tx.requirementControl.findMany({ where: { requirementId: id } })
        ).map((x) => x.controlId);
        const added = input.controlIds.filter((c) => !current.includes(c));
        const removed = current.filter((c) => !input.controlIds!.includes(c));
        if (removed.length)
          await tx.requirementControl.deleteMany({
            where: { requirementId: id, controlId: { in: removed } },
          });
        if (added.length)
          await tx.requirementControl.createMany({
            data: added.map((controlId) => ({
              requirementId: id,
              controlId,
              createdById: actor.id,
            })),
          });
        if (added.length || removed.length) controls = { added, removed };
      }
      await this.recordChanges(tx, id, before.status, after.status, {}, input.comment, actor);
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Requirement',
          entityId: id,
          userId: actor.id,
          summary: {
            changes: {
              ...diff(o, objAfter, ['code', 'nameEn', 'nameAr', 'ownerId'] as const),
              ...diff(before, after, [
                'level',
                'parentId',
                'sourceRef',
                'url',
                'departmentId',
                'effectiveDate',
                'status',
                'nextReviewAt',
              ] as const),
            },
            ...(controls ? { controls } : {}),
          },
          meta,
        },
        tx,
      );
    });
    return this.getRequirement(id);
  }

  private async isDescendant(tx: Tx, candidate: string, ancestor: string) {
    let current: string | null = candidate;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (current === ancestor) return true;
      seen.add(current);
      const row: { parentId: string | null } | null = await tx.requirement.findUnique({
        where: { objectId: current },
        select: { parentId: true },
      });
      current = row?.parentId ?? null;
    }
    return false;
  }

  // ---------- Shared: delete, steps, timeline, comments ----------

  /** Soft-deletes the item and removes its step links (admins; proposers their own drafts). */
  async remove(id: string, type: GrcObjectType, actor: AuthUser, meta: RequestMeta) {
    const o = await this.findItem(id, type);
    const status = await this.statusOf(id, type);
    const ownDraft = o.createdById === actor.id && status === 'DRAFT';
    if (!actor.permissions.has(PERMISSIONS.GRC_ADMIN) && !ownDraft) throw forbidden();
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.objectLink.deleteMany({ where: { repoObjectId: id } });
      await tx.repoObject.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: type === 'RISK' ? 'Risk' : type === 'CONTROL' ? 'Control' : 'Requirement',
          entityId: id,
          userId: actor.id,
          summary: {
            before: { code: o.code, nameEn: o.nameEn, nameAr: o.nameAr, status },
            removedLinks: removed.count,
          },
          meta,
        },
        tx,
      );
    });
  }

  private async statusOf(id: string, type: GrcObjectType): Promise<GrcStatus> {
    const row =
      type === 'RISK'
        ? await this.prisma.risk.findUnique({ where: { objectId: id } })
        : type === 'CONTROL'
          ? await this.prisma.control.findUnique({ where: { objectId: id } })
          : await this.prisma.requirement.findUnique({ where: { objectId: id } });
    return (row?.status ?? 'DRAFT') as GrcStatus;
  }

  /** Steps (and processes) the item is linked to, with labels from the working models. */
  async steps(objectId: string): Promise<GrcStepLinkDto[]> {
    const links = await this.prisma.objectLink.findMany({
      where: { repoObjectId: objectId, ...activeLinks },
      include: {
        process: { select: { id: true, code: true, nameEn: true, nameAr: true, status: true } },
      },
      orderBy: [{ process: { code: 'asc' } }, { bpmnElementId: 'asc' }],
    });
    const labels = await this.labels([...new Set(links.map((l) => l.processId))]);
    return links.map((l) => ({
      linkId: l.id,
      process: { ...l.process, status: l.process.status as ProcessStatus },
      bpmnElementId: l.bpmnElementId,
      element: elementLabel(labels.get(l.processId) ?? new Map(), l.bpmnElementId),
    }));
  }

  async labels(processIds: string[]) {
    const models = await this.prisma.processModel.findMany({
      where: { processId: { in: processIds } },
      select: { processId: true, bpmnXml: true },
    });
    return new Map<string, Map<string, BpmnElementLabel>>(
      models.map((m) => [m.processId, extractBpmnLabels(m.bpmnXml)]),
    );
  }

  async timeline(id: string): Promise<GrcActivityDto[]> {
    const o = await this.prisma.repoObject.findFirst({
      where: { id, deletedAt: null, type: { in: ['RISK', 'CONTROL', 'REQUIREMENT'] } },
    });
    if (!o) throw notFound('Item');
    const rows = await this.prisma.grcActivity.findMany({
      where: { objectId: id },
      include: { createdBy: userRef },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      changes: (r.changes ?? {}) as GrcActivityDto['changes'],
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      author: r.createdBy ?? null,
    }));
  }

  /** Risks, controls and requirements linked to the steps of one process (modeler, badges). */
  async forProcess(processId: string): Promise<ProcessGrcDto> {
    const p = await this.prisma.process.findFirst({ where: { id: processId, deletedAt: null } });
    if (!p) throw notFound('Process');
    const settings = await this.settings.get();
    const links = await this.prisma.objectLink.findMany({
      where: {
        processId,
        repoObject: { deletedAt: null, type: { in: ['RISK', 'CONTROL', 'REQUIREMENT'] } },
      },
      include: {
        repoObject: {
          include: {
            risk: {
              include: {
                controls: {
                  include: {
                    control: {
                      select: {
                        status: true,
                        effectiveness: true,
                        object: { select: { deletedAt: true } },
                      },
                    },
                  },
                },
              },
            },
            control: true,
            requirement: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      processId,
      items: links.map((l) => {
        const o = l.repoObject;
        const status = (o.risk?.status ??
          o.control?.status ??
          o.requirement?.status ??
          'DRAFT') as GrcStatus;
        return {
          ...ref(o, status),
          linkId: l.id,
          bpmnElementId: l.bpmnElementId,
          descriptionEn: o.descriptionEn,
          descriptionAr: o.descriptionAr,
          ...(o.risk
            ? {
                rating: rateRisk(o.risk, settings.bands),
                effectivelyControlled: o.risk.controls.some(
                  (c) => !c.control.object.deletedAt && isEffectiveControl(c.control),
                ),
              }
            : {}),
          ...(o.control
            ? {
                effectiveness: o.control.effectiveness,
                keyControl: o.control.keyControl,
                controlType: o.control.controlType,
              }
            : {}),
        };
      }),
    };
  }

  async comment(id: string, body: string, actor: AuthUser, meta: RequestMeta) {
    const o = await this.prisma.repoObject.findFirst({
      where: { id, deletedAt: null, type: { in: ['RISK', 'CONTROL', 'REQUIREMENT'] } },
    });
    if (!o) throw notFound('Item');
    await this.prisma.$transaction(async (tx) => {
      const a = await this.activity(tx, id, 'COMMENT', {}, body, actor.id);
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: o.type === 'RISK' ? 'Risk' : o.type === 'CONTROL' ? 'Control' : 'Requirement',
          entityId: id,
          userId: actor.id,
          summary: { comment: a.id },
          meta,
        },
        tx,
      );
    });
    return this.timeline(id);
  }
}

/** Changed fields between two records (dates compared as ISO strings). */
function diff<T extends Record<string, unknown>, K extends keyof T & string>(
  before: T,
  after: T,
  fields: readonly K[],
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : (v ?? null));
  for (const f of fields) {
    const a = norm(before[f]);
    const b = norm(after[f]);
    if (a !== b) out[f] = { from: a, to: b };
  }
  return out;
}
