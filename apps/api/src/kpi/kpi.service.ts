import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  PERMISSIONS,
  PROCESS_ELEMENT_ID,
  assuranceFileUrl,
  calculatedProcessKpis,
  calculatedValue,
  duePeriod,
  extractBpmnLabels,
  isPeriod,
  kpiRag,
  parseBpmnGraph,
  periodStart,
  thresholdsFor,
  type BpmnElementLabel,
  type CalculatedMetric,
  type CreateKpiInput,
  type CreateObjectiveInput,
  type KpiDetailDto,
  type KpiDto,
  type KpiFrequency,
  type KpiListQuery,
  type KpiMeasurementDto,
  type KpiTaskDto,
  type MeasurementInput,
  type ObjectiveDto,
  type Paginated,
  type ProcessKpisDto,
  type ProcessStatus,
  type PortalKpiDto,
  type RagCounts,
  type ScorecardDto,
  type ScorecardQuery,
  RAG_SEVERITY,
  worstRag,
  type UpdateKpiInput,
  type UpdateObjectiveInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, diffFields } from '../audit/audit.service';
import { badRequest, conflict, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { elementLabel } from '../models/bpmn-xml';

type Tx = Prisma.TransactionClient | PrismaClient;

const userRef = { select: { id: true, email: true, nameEn: true, nameAr: true } } as const;
const procRef = { select: { id: true, code: true, nameEn: true, nameAr: true, status: true } };
const activeLinks = { process: { deletedAt: null } } satisfies Prisma.ObjectLinkWhereInput;

const kpiInclude = {
  owner: userRef,
  _count: { select: { links: { where: activeLinks } } },
  kpi: {
    include: {
      department: { select: { id: true, nameEn: true, nameAr: true } },
      calculatedProcess: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      periodTargets: { orderBy: { period: 'asc' } },
      objectives: {
        where: { objective: { deletedAt: null } },
        include: {
          objective: {
            select: { id: true, code: true, nameEn: true, nameAr: true, parentId: true },
          },
        },
      },
      capabilities: {
        where: { capability: { deletedAt: null } },
        include: { capability: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
      },
      risks: {
        where: { risk: { object: { deletedAt: null } } },
        include: {
          risk: {
            select: { object: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
          },
        },
      },
      measurements: { orderBy: { periodStart: 'desc' }, take: 36 },
    },
  },
} satisfies Prisma.RepoObjectInclude;
type KpiRow = Prisma.RepoObjectGetPayload<{ include: typeof kpiInclude }>;

/** Fields a Salesforce-linked KPI takes from Salesforce (read-only in ProcessHub, D-114). */
export const SALESFORCE_FIELDS = [
  'code',
  'nameEn',
  'nameAr',
  'descriptionEn',
  'descriptionAr',
  'unit',
  'direction',
  'frequency',
  'target',
] as const;

const NAME_FIELDS = ['code', 'nameEn', 'nameAr', 'descriptionEn', 'descriptionAr', 'ownerId'];
const KPI_FIELDS = [
  'formulaEn',
  'formulaAr',
  'unit',
  'direction',
  'frequency',
  'target',
  'greenThreshold',
  'redThreshold',
  'baseline',
  'baselinePeriod',
  'departmentId',
  'dataSource',
  'status',
  'calculatedMetric',
  'calculatedProcessId',
];

const codeOrNull = (v: string | null | undefined) => (v === undefined ? undefined : v || null);

export function toKpiDto(o: KpiRow, now = new Date(), asOf?: string): KpiDto {
  const k = o.kpi!;
  const thresholds = {
    direction: k.direction,
    target: k.target,
    greenThreshold: k.greenThreshold,
    redThreshold: k.redThreshold,
  };
  const rag = (p: string, v: number) => kpiRag(v, thresholdsFor(thresholds, p, k.periodTargets));
  // "As of" a month: only periods that started by then count (dashboard period filter).
  const cutoff = asOf ? periodStart(asOf).getTime() : Infinity;
  const measured = [...k.measurements]
    .filter((m) => m.periodStart.getTime() <= cutoff)
    .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())
    .slice(-12);
  const latestRow = measured[measured.length - 1];
  const due = duePeriod(now, k.frequency);
  const manual = k.dataSource === 'MANUAL' || k.dataSource === 'EXCEL';
  return {
    id: o.id,
    code: o.code,
    nameEn: o.nameEn,
    nameAr: o.nameAr,
    descriptionEn: o.descriptionEn,
    descriptionAr: o.descriptionAr,
    unit: k.unit,
    frequency: k.frequency,
    status: k.status,
    formulaEn: k.formulaEn,
    formulaAr: k.formulaAr,
    direction: k.direction,
    target: k.target,
    greenThreshold: k.greenThreshold,
    redThreshold: k.redThreshold,
    baseline: k.baseline,
    baselinePeriod: k.baselinePeriod,
    owner: o.owner ?? null,
    department: k.department ?? null,
    dataSource: k.dataSource,
    calculatedMetric: (k.calculatedMetric as CalculatedMetric | null) ?? null,
    calculatedProcess: k.calculatedProcess ?? null,
    periodTargets: k.periodTargets.map((p) => ({
      period: p.period,
      target: p.target,
      greenThreshold: p.greenThreshold,
      redThreshold: p.redThreshold,
    })),
    objectives: k.objectives.map((x) => x.objective),
    capabilities: k.capabilities.map((x) => x.capability),
    risks: k.risks.map((x) => x.risk.object),
    latest: latestRow
      ? {
          period: latestRow.period,
          value: latestRow.value,
          rag: rag(latestRow.period, latestRow.value),
          target: thresholdsFor(thresholds, latestRow.period, k.periodTargets).target,
          updatedAt: latestRow.updatedAt.toISOString(),
        }
      : null,
    trend: measured.map((m) => ({ period: m.period, value: m.value, rag: rag(m.period, m.value) })),
    due: k.status === 'ACTIVE' && manual && !measured.some((m) => m.period === due),
    duePeriod: due,
    stepCount: o._count.links,
    salesforceId: k.salesforceId,
    salesforceUrl: k.salesforceUrl,
    lastSyncedAt: k.lastSyncedAt?.toISOString() ?? null,
    lockedFields: k.lockedFields,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

/** Sorts and pages in memory (status and trend are computed). */
function pageOf<T>(
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

@Injectable()
export class KpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Access ----------

  canEdit(user: AuthUser) {
    return user.permissions.has(PERMISSIONS.KPI_EDIT);
  }

  /** Editors enter any value; owners with `kpi.measure` the values of their own KPIs. */
  async assertMayMeasure(kpiId: string, user: AuthUser) {
    if (this.canEdit(user)) return;
    const o = await this.prisma.repoObject.findFirst({ where: { id: kpiId, deletedAt: null } });
    if (!o) throw notFound('KPI');
    if (!user.permissions.has(PERMISSIONS.KPI_MEASURE) || o.ownerId !== user.id)
      throw forbidden('Only the KPI owner or a KPI editor can enter values');
  }

  // ---------- Reference checks ----------

  private async assertRefs(tx: Tx, input: CreateKpiInput | UpdateKpiInput) {
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
    const count = async (n: number, ids: string[] | undefined, code: string) => {
      if (ids?.length && n !== ids.length) throw badRequest(code);
    };
    if (input.objectiveIds?.length)
      await count(
        await tx.strategicObjective.count({
          where: { id: { in: input.objectiveIds }, deletedAt: null },
        }),
        input.objectiveIds,
        'INVALID_OBJECTIVE',
      );
    if (input.capabilityIds?.length)
      await count(
        await tx.capability.count({ where: { id: { in: input.capabilityIds }, deletedAt: null } }),
        input.capabilityIds,
        'INVALID_CAPABILITY',
      );
    if (input.riskIds?.length)
      await count(
        await tx.risk.count({
          where: { objectId: { in: input.riskIds }, object: { deletedAt: null } },
        }),
        input.riskIds,
        'INVALID_RISK_REFERENCE',
      );
    const processIds = [
      ...new Set([
        ...(input.links ?? []).map((l) => l.processId),
        ...(input.calculatedProcessId ? [input.calculatedProcessId] : []),
      ]),
    ];
    if (processIds.length)
      await count(
        await tx.process.count({ where: { id: { in: processIds }, deletedAt: null } }),
        processIds,
        'INVALID_PROCESS',
      );
  }

  private assertPeriods(
    frequency: KpiFrequency,
    input: { periodTargets?: { period: string }[]; baselinePeriod?: string | null },
  ) {
    for (const p of input.periodTargets ?? [])
      if (!isPeriod(p.period, frequency)) throw badRequest('INVALID_PERIOD');
    if (input.baselinePeriod && !isPeriod(input.baselinePeriod, frequency))
      throw badRequest('INVALID_PERIOD');
  }

  // ---------- KPIs ----------

  async listAll(): Promise<KpiDto[]> {
    await this.ensureKpiRows();
    const rows = await this.prisma.repoObject.findMany({
      where: { type: 'KPI', deletedAt: null },
      include: kpiInclude,
    });
    return rows.map((r) => toKpiDto(r));
  }

  /** KPI objects created outside the register (older data, seeds) get their row (as the migration did). */
  async ensureKpiRows() {
    const missing = await this.prisma.repoObject.findMany({
      where: { type: 'KPI', kpi: { is: null } },
      select: { id: true },
    });
    if (missing.length)
      await this.prisma.kpi.createMany({
        data: missing.map((m) => ({ objectId: m.id })),
        skipDuplicates: true,
      });
  }

  async list(q: KpiListQuery): Promise<Paginated<KpiDto>> {
    await this.ensureKpiRows();
    const rows = await this.prisma.repoObject.findMany({
      where: {
        type: 'KPI',
        deletedAt: null,
        ownerId: q.ownerId,
        ...(q.processId
          ? {
              OR: [
                { links: { some: { processId: q.processId } } },
                { kpi: { is: { calculatedProcessId: q.processId } } },
              ],
            }
          : {}),
        kpi: {
          is: {
            status: q.status,
            departmentId: q.departmentId,
            dataSource: q.dataSource,
            ...(q.objectiveId ? { objectives: { some: { objectiveId: q.objectiveId } } } : {}),
          },
        },
        ...(q.q
          ? {
              AND: [
                {
                  OR: [
                    { code: { contains: q.q, mode: 'insensitive' } },
                    { nameEn: { contains: q.q, mode: 'insensitive' } },
                    { nameAr: { contains: q.q, mode: 'insensitive' } },
                  ],
                },
              ],
            }
          : {}),
      },
      include: kpiInclude,
    });
    let items = rows.map((r) => toKpiDto(r, new Date(), q.asOf));
    if (q.rag) items = items.filter((k) => k.latest?.rag === q.rag);
    if (q.due !== undefined) items = items.filter((k) => k.due === q.due);
    const rank = { RED: 0, AMBER: 1, GREEN: 2 } as Record<string, number>;
    return pageOf(
      items,
      q,
      {
        code: (x) => x.code ?? '',
        nameEn: (x) => x.nameEn,
        rag: (x) => (x.latest?.rag ? rank[x.latest.rag] : 3),
        frequency: (x) => x.frequency,
        updatedAt: (x) => x.updatedAt,
      },
      'code',
    );
  }

  private async find(id: string) {
    const o = await this.prisma.repoObject.findFirst({
      where: { id, type: 'KPI', deletedAt: null },
      include: { kpi: true },
    });
    if (!o) throw notFound('KPI');
    if (!o.kpi) o.kpi = await this.prisma.kpi.create({ data: { objectId: id } });
    return o as typeof o & { kpi: NonNullable<typeof o.kpi> };
  }

  async get(id: string): Promise<KpiDetailDto> {
    await this.find(id);
    const row = await this.prisma.repoObject.findUniqueOrThrow({
      where: { id },
      include: kpiInclude,
    });
    const item = toKpiDto(row);
    const [all, links] = await Promise.all([
      this.prisma.kpiMeasurement.findMany({
        where: { kpiId: id },
        orderBy: { periodStart: 'asc' },
      }),
      this.prisma.objectLink.findMany({
        where: { repoObjectId: id, ...activeLinks },
        include: { process: procRef },
        orderBy: [{ process: { code: 'asc' } }, { bpmnElementId: 'asc' }],
      }),
    ]);
    const files = await this.prisma.assuranceFile.findMany({
      where: {
        ownerType: 'KPI_MEASUREMENT',
        deletedAt: null,
        ownerId: { in: all.map((m) => m.id) },
      },
      select: { id: true, ownerId: true, fileName: true },
      orderBy: { createdAt: 'asc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: all.map((m) => m.updatedById).filter((v): v is string => !!v) } },
      ...userRef,
    });
    const byUser = new Map(users.map((u) => [u.id, u]));
    const k = row.kpi!;
    const thresholds = {
      direction: k.direction,
      target: k.target,
      greenThreshold: k.greenThreshold,
      redThreshold: k.redThreshold,
    };
    const measurements: KpiMeasurementDto[] = all.map((m) => {
      const t = thresholdsFor(thresholds, m.period, k.periodTargets);
      return {
        id: m.id,
        period: m.period,
        periodStart: m.periodStart.toISOString(),
        value: m.value,
        comment: m.comment,
        source: m.source,
        target: t.target,
        rag: kpiRag(m.value, t),
        evidence: files
          .filter((f) => f.ownerId === m.id)
          .map((f) => ({ id: f.id, fileName: f.fileName, url: assuranceFileUrl(f.id) })),
        updatedAt: m.updatedAt.toISOString(),
        updatedBy: (m.updatedById && byUser.get(m.updatedById)) || null,
      };
    });
    const labels = await this.labels([...new Set(links.map((l) => l.processId))]);
    return {
      item,
      measurements,
      links: links.map((l) => ({
        linkId: l.id,
        process: { ...l.process, status: l.process.status as ProcessStatus },
        bpmnElementId: l.bpmnElementId,
        element: elementLabel(labels.get(l.processId) ?? new Map(), l.bpmnElementId),
      })),
      calculatedNow: await this.calculatedNow(k.calculatedMetric, k.calculatedProcessId),
    };
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

  /** Current value of a calculated KPI from the working model of its process. */
  async calculatedNow(metric: string | null, processId: string | null) {
    if (!metric || !processId) return null;
    const model = await this.prisma.processModel.findUnique({ where: { processId } });
    if (!model) return null;
    return calculatedValue(
      calculatedProcessKpis(parseBpmnGraph(model.bpmnXml)),
      metric as CalculatedMetric,
    );
  }

  /** Salesforce-owned fields cannot be changed in ProcessHub (D-114). */
  private assertNotLocked(
    locked: string[],
    input: Record<string, unknown>,
    before: Record<string, unknown>,
  ) {
    for (const f of locked)
      if (input[f] !== undefined && input[f] !== before[f])
        throw badRequest('SALESFORCE_OWNED', `${f} comes from Salesforce`);
  }

  private kpiData(input: CreateKpiInput | UpdateKpiInput) {
    return {
      formulaEn: input.formulaEn,
      formulaAr: input.formulaAr,
      unit: input.unit,
      direction: input.direction,
      frequency: input.frequency,
      target: input.target,
      greenThreshold: input.greenThreshold,
      redThreshold: input.redThreshold,
      baseline: input.baseline,
      baselinePeriod: input.baselinePeriod,
      departmentId: input.departmentId,
      dataSource: input.dataSource,
      status: input.status,
      calculatedMetric: input.calculatedMetric,
      calculatedProcessId: input.calculatedProcessId,
    };
  }

  private async replaceRelations(
    tx: Tx,
    id: string,
    input: CreateKpiInput | UpdateKpiInput,
    actorId: string,
  ) {
    if (input.objectiveIds) {
      await tx.kpiObjective.deleteMany({ where: { kpiId: id } });
      if (input.objectiveIds.length)
        await tx.kpiObjective.createMany({
          data: input.objectiveIds.map((objectiveId) => ({ kpiId: id, objectiveId })),
        });
    }
    if (input.capabilityIds) {
      await tx.kpiCapability.deleteMany({ where: { kpiId: id } });
      if (input.capabilityIds.length)
        await tx.kpiCapability.createMany({
          data: input.capabilityIds.map((capabilityId) => ({ kpiId: id, capabilityId })),
        });
    }
    if (input.riskIds) {
      await tx.kpiRisk.deleteMany({ where: { kpiId: id } });
      if (input.riskIds.length)
        await tx.kpiRisk.createMany({
          data: input.riskIds.map((riskId) => ({ kpiId: id, riskId })),
        });
    }
    if (input.periodTargets) {
      await tx.kpiPeriodTarget.deleteMany({ where: { kpiId: id } });
      const unique = [...new Map(input.periodTargets.map((p) => [p.period, p])).values()];
      if (unique.length)
        await tx.kpiPeriodTarget.createMany({ data: unique.map((p) => ({ kpiId: id, ...p })) });
    }
    if (input.links) {
      const wanted = [
        ...new Map(input.links.map((l) => [`${l.processId}|${l.bpmnElementId}`, l])).values(),
      ];
      const current = await tx.objectLink.findMany({
        where: { repoObjectId: id, relation: 'MEASURES' },
      });
      const key = (l: { processId: string; bpmnElementId: string }) =>
        `${l.processId}|${l.bpmnElementId}`;
      const removed = current.filter((c) => !wanted.some((w) => key(w) === key(c)));
      const added = wanted.filter((w) => !current.some((c) => key(c) === key(w)));
      if (removed.length)
        await tx.objectLink.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
      if (added.length)
        await tx.objectLink.createMany({
          data: added.map((l) => ({
            processId: l.processId,
            bpmnElementId: l.bpmnElementId,
            repoObjectId: id,
            relation: 'MEASURES' as const,
            createdById: actorId,
          })),
        });
    }
  }

  async create(
    input: CreateKpiInput,
    actor: AuthUser,
    meta: RequestMeta,
    opts: { auditNote?: Record<string, unknown> } = {},
  ) {
    this.assertPeriods(input.frequency ?? 'MONTHLY', input);
    const id = await this.prisma.$transaction(async (tx) => {
      await this.assertRefs(tx, input);
      const o = await tx.repoObject.create({
        data: {
          type: 'KPI',
          code: input.code || null,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          descriptionEn: input.descriptionEn ?? '',
          descriptionAr: input.descriptionAr ?? '',
          ownerId: input.ownerId ?? null,
          createdById: actor.id,
          updatedById: actor.id,
          kpi: { create: this.kpiData(input) },
        },
      });
      await this.replaceRelations(tx, o.id, input, actor.id);
      await this.audit.log(
        {
          action: opts.auditNote ? 'SYNC' : 'CREATE',
          entityType: 'Kpi',
          entityId: o.id,
          userId: actor.id,
          summary: {
            ...opts.auditNote,
            after: {
              code: o.code,
              nameEn: o.nameEn,
              nameAr: o.nameAr,
              target: input.target ?? null,
            },
          },
          meta,
        },
        tx,
      );
      return o.id;
    });
    return this.get(id);
  }

  async update(
    id: string,
    input: UpdateKpiInput,
    actor: AuthUser,
    meta: RequestMeta,
    opts: { sync?: boolean; auditNote?: Record<string, unknown> } = {},
  ) {
    const before = await this.find(id);
    if (!opts.sync)
      this.assertNotLocked(
        before.kpi.lockedFields,
        input as Record<string, unknown>,
        {
          ...before,
          ...before.kpi,
        } as Record<string, unknown>,
      );
    const frequency = input.frequency ?? before.kpi.frequency;
    this.assertPeriods(frequency, input);
    const dataSource = input.dataSource ?? before.kpi.dataSource;
    const metric =
      input.calculatedMetric === undefined ? before.kpi.calculatedMetric : input.calculatedMetric;
    const proc =
      input.calculatedProcessId === undefined
        ? before.kpi.calculatedProcessId
        : input.calculatedProcessId;
    if (dataSource === 'CALCULATED' && (!metric || !proc)) throw badRequest('CALCULATION_REQUIRED');
    if (input.frequency && input.frequency !== before.kpi.frequency) {
      const n = await this.prisma.kpiMeasurement.count({ where: { kpiId: id } });
      if (n) throw conflict('FREQUENCY_HAS_VALUES');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.assertRefs(tx, input);
      const o = await tx.repoObject.update({
        where: { id },
        data: {
          code: codeOrNull(input.code),
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          ownerId: input.ownerId,
          updatedById: actor.id,
        },
      });
      const k = await tx.kpi.update({ where: { objectId: id }, data: this.kpiData(input) });
      await this.replaceRelations(tx, id, input, actor.id);
      await this.audit.log(
        {
          action: opts.sync ? 'SYNC' : 'UPDATE',
          entityType: 'Kpi',
          entityId: id,
          userId: actor.id,
          summary: {
            ...opts.auditNote,
            changes: {
              ...diffFields(before, o, NAME_FIELDS),
              ...diffFields(before.kpi, k, KPI_FIELDS),
            },
            ...(input.objectiveIds ? { objectiveIds: input.objectiveIds } : {}),
            ...(input.riskIds ? { riskIds: input.riskIds } : {}),
            ...(input.links ? { links: input.links.length } : {}),
          },
          meta,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const o = await this.find(id);
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.objectLink.deleteMany({ where: { repoObjectId: id } });
      await tx.repoObject.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Kpi',
          entityId: id,
          userId: actor.id,
          summary: {
            before: { code: o.code, nameEn: o.nameEn, nameAr: o.nameAr },
            removedLinks: removed.count,
          },
          meta,
        },
        tx,
      );
    });
  }

  // ---------- Measurements ----------

  async measure(
    id: string,
    input: MeasurementInput,
    actor: AuthUser,
    meta: RequestMeta,
    opts: {
      source?: 'MANUAL' | 'EXCEL' | 'SALESFORCE' | 'CALCULATED';
      salesforceId?: string | null;
      auditNote?: Record<string, unknown>;
    } = {},
  ) {
    const o = await this.find(id);
    const source = opts.source ?? 'MANUAL';
    if (source !== 'SALESFORCE') await this.assertMayMeasure(id, actor);
    if (o.kpi.dataSource === 'SALESFORCE' && source !== 'SALESFORCE')
      throw badRequest('SALESFORCE_OWNED');
    if (!isPeriod(input.period, o.kpi.frequency)) throw badRequest('INVALID_PERIOD');
    if (periodStart(input.period).getTime() > Date.now()) throw badRequest('FUTURE_PERIOD');
    const before = await this.prisma.kpiMeasurement.findUnique({
      where: { kpiId_period: { kpiId: id, period: input.period } },
    });
    const saved = await this.prisma.$transaction(async (tx) => {
      const m = await tx.kpiMeasurement.upsert({
        where: { kpiId_period: { kpiId: id, period: input.period } },
        create: {
          kpiId: id,
          period: input.period,
          periodStart: periodStart(input.period),
          value: input.value,
          comment: input.comment ?? '',
          source,
          salesforceId: opts.salesforceId ?? null,
          createdById: actor.id,
          updatedById: actor.id,
        },
        update: {
          value: input.value,
          comment: input.comment ?? '',
          source,
          ...(opts.salesforceId ? { salesforceId: opts.salesforceId } : {}),
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: source === 'SALESFORCE' ? 'SYNC' : before ? 'UPDATE' : 'CREATE',
          entityType: 'KpiMeasurement',
          entityId: m.id,
          userId: actor.id,
          summary: {
            ...opts.auditNote,
            kpiId: id,
            code: o.code,
            period: input.period,
            value: { from: before?.value ?? null, to: input.value },
            source,
          },
          meta,
        },
        tx,
      );
      return m;
    });
    return saved;
  }

  async removeMeasurement(id: string, measurementId: string, actor: AuthUser, meta: RequestMeta) {
    const m = await this.prisma.kpiMeasurement.findFirst({
      where: { id: measurementId, kpiId: id },
    });
    if (!m) throw notFound('Measurement');
    await this.assertMayMeasure(id, actor);
    const o = await this.find(id);
    if (o.kpi.dataSource === 'SALESFORCE') throw badRequest('SALESFORCE_OWNED');
    await this.prisma.$transaction(async (tx) => {
      await tx.kpiMeasurement.delete({ where: { id: measurementId } });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'KpiMeasurement',
          entityId: measurementId,
          userId: actor.id,
          summary: { kpiId: id, period: m.period, value: m.value },
          meta,
        },
        tx,
      );
    });
  }

  async kpiOfMeasurement(measurementId: string) {
    const m = await this.prisma.kpiMeasurement.findFirst({
      where: { id: measurementId, kpi: { object: { deletedAt: null } } },
    });
    if (!m) throw notFound('Measurement');
    return m.kpiId;
  }

  /** Calculated KPIs: records the current value of the working model for the due period. */
  async recalculate(id: string, actor: AuthUser, meta: RequestMeta) {
    const o = await this.find(id);
    if (o.kpi.dataSource !== 'CALCULATED') throw badRequest('NOT_CALCULATED');
    const value = await this.calculatedNow(o.kpi.calculatedMetric, o.kpi.calculatedProcessId);
    if (value === null) throw badRequest('NO_CALCULATED_VALUE');
    await this.measure(
      id,
      { period: duePeriod(new Date(), o.kpi.frequency), value, comment: '' },
      actor,
      meta,
      { source: 'CALCULATED' },
    );
    return this.get(id);
  }

  // ---------- Process view, tasks ----------

  async forProcess(processId: string): Promise<ProcessKpisDto> {
    await this.ensureKpiRows();
    const [links, model, calculatedKpis] = await Promise.all([
      this.prisma.objectLink.findMany({
        where: { processId, relation: 'MEASURES', repoObject: { type: 'KPI', deletedAt: null } },
        include: { repoObject: { include: kpiInclude } },
      }),
      this.prisma.processModel.findUnique({ where: { processId } }),
      this.prisma.repoObject.findMany({
        where: { type: 'KPI', deletedAt: null, kpi: { is: { calculatedProcessId: processId } } },
        include: kpiInclude,
      }),
    ]);
    const items: ProcessKpisDto['items'] = links.map((l) => {
      const k = toKpiDto(l.repoObject);
      return {
        id: k.id,
        code: k.code,
        nameEn: k.nameEn,
        nameAr: k.nameAr,
        unit: k.unit,
        frequency: k.frequency,
        status: k.status,
        linkId: l.id,
        bpmnElementId: l.bpmnElementId,
        rag: k.latest?.rag ?? null,
        latest: k.latest,
      };
    });
    // Calculated KPIs of the process count as process-level KPIs.
    for (const c of calculatedKpis)
      if (!items.some((i) => i.id === c.id && i.bpmnElementId === PROCESS_ELEMENT_ID)) {
        const k = toKpiDto(c);
        items.push({
          id: k.id,
          code: k.code,
          nameEn: k.nameEn,
          nameAr: k.nameAr,
          unit: k.unit,
          frequency: k.frequency,
          status: k.status,
          linkId: '',
          bpmnElementId: PROCESS_ELEMENT_ID,
          rag: k.latest?.rag ?? null,
          latest: k.latest,
        });
      }
    return {
      processId,
      items: items.filter((i) => i.status !== 'RETIRED'),
      calculated: model ? calculatedProcessKpis(parseBpmnGraph(model.bpmnXml)) : null,
    };
  }

  /** KPIs of the user whose last completed period has no value (My tasks). */
  async myTasks(user: AuthUser, now = new Date()): Promise<KpiTaskDto[]> {
    if (!user.permissions.has(PERMISSIONS.KPI_MEASURE) && !this.canEdit(user)) return [];
    const rows = await this.prisma.repoObject.findMany({
      where: {
        type: 'KPI',
        deletedAt: null,
        ownerId: user.id,
        kpi: { is: { status: 'ACTIVE', dataSource: { in: ['MANUAL', 'EXCEL'] } } },
      },
      include: kpiInclude,
    });
    return rows
      .map((r) => toKpiDto(r, now))
      .filter((k) => k.due)
      .map((k) => ({
        kpi: {
          id: k.id,
          code: k.code,
          nameEn: k.nameEn,
          nameAr: k.nameAr,
          unit: k.unit,
          frequency: k.frequency,
          status: k.status,
        },
        period: k.duePeriod,
        // More than a month after the period ended.
        overdue: now.getTime() - periodStart(k.duePeriod).getTime() > 62 * 86_400_000,
      }));
  }

  // ---------- Dashboard ----------

  /** Objectives (with their ancestors) and the KPIs in scope, as of a month. */
  async scorecard(q: ScorecardQuery): Promise<ScorecardDto> {
    const list = await this.list({
      page: 1,
      pageSize: 100_000,
      order: 'asc',
      sort: 'code',
      status: 'ACTIVE',
      departmentId: q.departmentId,
      processId: q.processId,
      ownerId: q.ownerId,
      asOf: q.asOf,
    });
    const kpis = list.items;
    const objectives = await this.objectives();
    const byId = new Map(objectives.map((o) => [o.id, o]));
    const counts = (l: KpiDto[]): RagCounts => ({
      GREEN: l.filter((k) => k.latest?.rag === 'GREEN').length,
      AMBER: l.filter((k) => k.latest?.rag === 'AMBER').length,
      RED: l.filter((k) => k.latest?.rag === 'RED').length,
      none: l.filter((k) => !k.latest?.rag).length,
    });
    const rank = (k: KpiDto) => (k.latest?.rag ? RAG_SEVERITY[k.latest.rag] : -1);
    const sortKpis = (l: KpiDto[]) =>
      [...l].sort(
        (a, b) =>
          rank(b) - rank(a) ||
          (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true }),
      );
    // Objectives with KPIs in scope and their ancestors, in tree order.
    const direct = new Map<string, KpiDto[]>();
    for (const k of kpis)
      for (const o of k.objectives) direct.set(o.id, [...(direct.get(o.id) ?? []), k]);
    const keep = new Set<string>();
    for (const id of direct.keys()) {
      let cur: string | null = id;
      while (cur && byId.has(cur) && !keep.has(cur)) {
        keep.add(cur);
        cur = byId.get(cur)!.parentId;
      }
    }
    const rows: ScorecardDto['objectives'] = [];
    const walk = (parentId: string | null, level: number) => {
      for (const o of objectives.filter((x) => x.parentId === parentId && keep.has(x.id))) {
        const own = sortKpis(direct.get(o.id) ?? []);
        rows.push({
          objective: {
            id: o.id,
            code: o.code,
            nameEn: o.nameEn,
            nameAr: o.nameAr,
            parentId: o.parentId,
          },
          level,
          kpis: own,
          counts: counts(own),
          worst: worstRag(own.map((k) => k.latest?.rag)),
        });
        walk(o.id, level + 1);
      }
    };
    walk(null, 1);
    const orphans = sortKpis(kpis.filter((k) => !k.objectives.length));
    if (orphans.length)
      rows.push({
        objective: null,
        level: 1,
        kpis: orphans,
        counts: counts(orphans),
        worst: worstRag(orphans.map((k) => k.latest?.rag)),
      });
    return {
      asOf: q.asOf ?? null,
      summary: { ...counts(kpis), total: kpis.length, due: kpis.filter((k) => k.due).length },
      objectives: rows,
    };
  }

  /** KPIs of the given library objects for the Knowledge Portal (active ones only). */
  async portalKpis(links: { objectId: string; bpmnElementId: string }[]): Promise<PortalKpiDto[]> {
    if (!links.length) return [];
    const rows = await this.prisma.repoObject.findMany({
      where: {
        id: { in: links.map((l) => l.objectId) },
        type: 'KPI',
        deletedAt: null,
        kpi: { is: { status: 'ACTIVE' } },
      },
      include: kpiInclude,
    });
    const byId = new Map(rows.map((r) => [r.id, toKpiDto(r)]));
    return links.flatMap((l) => {
      const k = byId.get(l.objectId);
      return k
        ? [
            {
              id: k.id,
              code: k.code,
              nameEn: k.nameEn,
              nameAr: k.nameAr,
              unit: k.unit,
              frequency: k.frequency,
              status: k.status,
              direction: k.direction,
              bpmnElementId: l.bpmnElementId,
              latest: k.latest,
              trend: k.trend,
            },
          ]
        : [];
    });
  }

  // ---------- Objectives ----------

  async objectives(): Promise<ObjectiveDto[]> {
    const rows = await this.prisma.strategicObjective.findMany({
      where: { deletedAt: null },
      include: {
        owner: userRef,
        _count: { select: { kpis: { where: { kpi: { object: { deletedAt: null } } } } } },
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map((o) => ({
      id: o.id,
      code: o.code,
      nameEn: o.nameEn,
      nameAr: o.nameAr,
      descriptionEn: o.descriptionEn,
      descriptionAr: o.descriptionAr,
      parentId: o.parentId,
      owner: o.owner ?? null,
      sortOrder: o.sortOrder,
      salesforceId: o.salesforceId,
      kpiCount: o._count.kpis,
    }));
  }

  private async findObjective(id: string) {
    const o = await this.prisma.strategicObjective.findFirst({ where: { id, deletedAt: null } });
    if (!o) throw notFound('Objective');
    return o;
  }

  private async assertObjectiveParent(tx: Tx, parentId: string | null | undefined, self?: string) {
    if (!parentId) return;
    let cursor: string | null = parentId;
    while (cursor) {
      if (cursor === self) throw badRequest('INVALID_PARENT');
      const p: { parentId: string | null; deletedAt: Date | null } | null =
        await tx.strategicObjective.findUnique({
          where: { id: cursor },
          select: { parentId: true, deletedAt: true },
        });
      if (!p || (cursor === parentId && p.deletedAt)) throw badRequest('INVALID_PARENT');
      cursor = p.parentId;
    }
  }

  async createObjective(
    input: CreateObjectiveInput,
    actor: AuthUser,
    meta: RequestMeta,
    extra: { salesforceId?: string; auditNote?: Record<string, unknown> } = {},
  ) {
    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertObjectiveParent(tx, input.parentId);
      const o = await tx.strategicObjective.create({
        data: {
          code: input.code || null,
          nameEn: input.nameEn ?? '',
          nameAr: input.nameAr ?? '',
          descriptionEn: input.descriptionEn ?? '',
          descriptionAr: input.descriptionAr ?? '',
          parentId: input.parentId ?? null,
          ownerId: input.ownerId ?? null,
          sortOrder: input.sortOrder ?? 0,
          salesforceId: extra.salesforceId ?? null,
          lastSyncedAt: extra.salesforceId ? new Date() : null,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: extra.salesforceId ? 'SYNC' : 'CREATE',
          entityType: 'StrategicObjective',
          entityId: o.id,
          userId: actor.id,
          summary: {
            ...extra.auditNote,
            after: { code: o.code, nameEn: o.nameEn, nameAr: o.nameAr },
          },
          meta,
        },
        tx,
      );
      return o;
    });
    return created;
  }

  async updateObjective(
    id: string,
    input: UpdateObjectiveInput,
    actor: AuthUser,
    meta: RequestMeta,
    opts: { sync?: boolean; auditNote?: Record<string, unknown> } = {},
  ) {
    const before = await this.findObjective(id);
    return this.prisma.$transaction(async (tx) => {
      await this.assertObjectiveParent(tx, input.parentId, id);
      const after = await tx.strategicObjective.update({
        where: { id },
        data: {
          code: codeOrNull(input.code),
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          parentId: input.parentId,
          ownerId: input.ownerId,
          sortOrder: input.sortOrder,
          ...(opts.sync ? { lastSyncedAt: new Date() } : {}),
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: opts.sync ? 'SYNC' : 'UPDATE',
          entityType: 'StrategicObjective',
          entityId: id,
          userId: actor.id,
          summary: {
            ...opts.auditNote,
            changes: diffFields(before, after, [...NAME_FIELDS, 'parentId', 'sortOrder']),
          },
          meta,
        },
        tx,
      );
      return after;
    });
  }

  async removeObjective(id: string, actor: AuthUser, meta: RequestMeta) {
    const o = await this.findObjective(id);
    const children = await this.prisma.strategicObjective.count({
      where: { parentId: id, deletedAt: null },
    });
    if (children) throw conflict('OBJECTIVE_HAS_CHILDREN');
    await this.prisma.$transaction(async (tx) => {
      await tx.kpiObjective.deleteMany({ where: { objectiveId: id } });
      await tx.strategicObjective.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'StrategicObjective',
          entityId: id,
          userId: actor.id,
          summary: { before: { code: o.code, nameEn: o.nameEn, nameAr: o.nameAr } },
          meta,
        },
        tx,
      );
    });
  }
}
