import { Injectable } from '@nestjs/common';
import { Prisma, type EventLog } from '@prisma/client';
import {
  PERMISSIONS,
  autoMatchActivities,
  isStepNode,
  normaliseLabel,
  parseBpmnGraph,
  type ActivityMappingInput,
  type CreateEventLogInput,
  type EventLogDto,
  type EventLogListQuery,
  type ImportReportDto,
  type LogActivitiesDto,
  type LogGrantDto,
  type MappingTemplateDto,
  type MappingTemplateInput,
  type MatchStep,
  type MiningFileFormat,
  type MiningMapping,
  type MiningStepDto,
  type Paginated,
  type UpdateEventLogInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { badRequest, forbidden, notFound } from '../common/app-exception';
import { pageArgs, paginated } from '../common/pagination';
import { toJobDto } from './jobs/mining-jobs.service';

const userRef = { select: { id: true, email: true, nameEn: true, nameAr: true } } as const;
const LOG_INCLUDE = {
  owner: userRef,
  department: { select: { id: true, nameEn: true, nameAr: true } },
  process: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  jobs: { orderBy: { createdAt: 'desc' as const }, take: 1 },
} satisfies Prisma.EventLogInclude;
type LogRow = Prisma.EventLogGetPayload<{ include: typeof LOG_INCLUDE }>;

/**
 * Event logs (Phase 5.1, D-129 – D-131): list / detail / update, access (owner, department,
 * grants; Super Admins see all), activity ↔ BPMN step mapping and import mapping templates.
 */
@Injectable()
export class EventLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Access ----------

  /** Logs the user may see (never those being deleted). */
  visibleWhere(user: AuthUser): Prisma.EventLogWhereInput {
    const base: Prisma.EventLogWhereInput = { status: { not: 'DELETING' } };
    if (user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)) return base;
    return {
      ...base,
      OR: [
        { ownerId: user.id },
        ...(user.departmentId ? [{ departmentId: user.departmentId }] : []),
        { grants: { some: { userId: user.id } } },
      ],
    };
  }

  canManage(log: Pick<EventLog, 'ownerId' | 'departmentId'>, user: AuthUser): boolean {
    if (user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)) return true;
    if (!user.permissions.has(PERMISSIONS.MINING_MANAGE)) return false;
    return (
      log.ownerId === user.id || (!!user.departmentId && log.departmentId === user.departmentId)
    );
  }

  /** The log if the user may see it (404 otherwise, so ids are not confirmed). */
  async visible(id: string, user: AuthUser): Promise<EventLog> {
    const log = await this.prisma.eventLog.findFirst({ where: { id, ...this.visibleWhere(user) } });
    if (!log) throw notFound('Event log');
    return log;
  }

  async manageable(id: string, user: AuthUser): Promise<EventLog> {
    const log = await this.visible(id, user);
    if (!this.canManage(log, user)) throw forbidden('You may not change this event log');
    return log;
  }

  /** The log must have imported data. */
  async ready(id: string, user: AuthUser): Promise<EventLog> {
    const log = await this.visible(id, user);
    if (log.status !== 'READY')
      throw badRequest('LOG_NOT_READY', 'The event log has no imported data');
    return log;
  }

  // ---------- DTO ----------

  toDto(l: LogRow, user: AuthUser): EventLogDto {
    const job = l.jobs[0];
    return {
      id: l.id,
      code: l.code,
      nameEn: l.nameEn,
      nameAr: l.nameAr,
      descriptionEn: l.descriptionEn,
      descriptionAr: l.descriptionAr,
      source: l.source,
      status: l.status,
      process: l.process,
      owner: l.owner,
      department: l.department,
      fileName: l.fileName,
      fileFormat: (l.fileFormat as MiningFileFormat | null) ?? null,
      fileSize: l.fileSize,
      mapping: (l.mapping as MiningMapping | null) ?? null,
      timeZone: l.timeZone,
      pseudonymised: l.pseudonymised,
      dataVersion: l.dataVersion,
      periodStart: l.periodStart?.toISOString() ?? null,
      periodEnd: l.periodEnd?.toISOString() ?? null,
      caseCount: l.caseCount,
      eventCount: l.eventCount,
      activityCount: l.activityCount,
      resourceCount: l.resourceCount,
      hasStartTimes: l.hasStartTimes,
      attributeNames: l.attributeNames,
      importReport: (l.importReport as ImportReportDto | null) ?? null,
      importedAt: l.importedAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
      canManage: this.canManage(l, user),
      job: job && (job.status === 'QUEUED' || job.status === 'RUNNING') ? toJobDto(job) : null,
    };
  }

  // ---------- CRUD ----------

  async list(q: EventLogListQuery, user: AuthUser): Promise<Paginated<EventLogDto>> {
    const where: Prisma.EventLogWhereInput = {
      AND: [
        this.visibleWhere(user),
        q.processId ? { processId: q.processId } : {},
        q.status ? { status: q.status } : {},
        q.q
          ? {
              OR: [
                { code: { contains: q.q, mode: 'insensitive' } },
                { nameEn: { contains: q.q, mode: 'insensitive' } },
                { nameAr: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };
    const sortable = ['code', 'nameEn', 'nameAr', 'createdAt', 'eventCount', 'caseCount'];
    const sort = q.sort && sortable.includes(q.sort) ? q.sort : 'createdAt';
    const [rows, total] = await Promise.all([
      this.prisma.eventLog.findMany({
        where,
        include: LOG_INCLUDE,
        orderBy: { [sort]: q.sort ? q.order : 'desc' },
        ...pageArgs(q),
      }),
      this.prisma.eventLog.count({ where }),
    ]);
    return paginated(
      rows.map((r) => this.toDto(r, user)),
      total,
      q,
    );
  }

  async detail(id: string, user: AuthUser): Promise<EventLogDto> {
    await this.visible(id, user);
    const row = await this.prisma.eventLog.findUniqueOrThrow({
      where: { id },
      include: LOG_INCLUDE,
    });
    return this.toDto(row, user);
  }

  private async nextCode(tx: Prisma.TransactionClient) {
    const rows = await tx.eventLog.findMany({
      where: { code: { startsWith: 'LOG-' } },
      select: { code: true },
    });
    const max = rows.reduce((m, r) => {
      const n = Number(r.code.slice(4));
      return Number.isInteger(n) && n > m ? n : m;
    }, 0);
    return `LOG-${String(max + 1).padStart(3, '0')}`;
  }

  async assertRefs(
    processId?: string | null,
    departmentId?: string | null,
    ownerId?: string | null,
  ) {
    if (processId) {
      const p = await this.prisma.process.findFirst({ where: { id: processId, deletedAt: null } });
      if (!p) throw badRequest('PROCESS_NOT_FOUND');
    }
    if (departmentId && !(await this.prisma.department.findUnique({ where: { id: departmentId } })))
      throw badRequest('DEPARTMENT_NOT_FOUND');
    if (ownerId) {
      const u = await this.prisma.user.findFirst({ where: { id: ownerId, status: 'ACTIVE' } });
      if (!u) throw badRequest('USER_NOT_FOUND');
    }
  }

  /** Creates a draft log (the import service adds the file). */
  async create(
    input: CreateEventLogInput,
    extra: Partial<Prisma.EventLogUncheckedCreateInput>,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<EventLog> {
    await this.assertRefs(input.processId, input.departmentId);
    return this.prisma.$transaction(async (tx) => {
      const log = await tx.eventLog.create({
        data: {
          code: await this.nextCode(tx),
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          processId: input.processId ?? null,
          departmentId: input.departmentId ?? actor.departmentId ?? null,
          ownerId: actor.id,
          createdById: actor.id,
          updatedById: actor.id,
          ...extra,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'EventLog',
          entityId: log.id,
          userId: actor.id,
          summary: {
            code: log.code,
            nameEn: log.nameEn,
            source: log.source,
            fileName: log.fileName,
          },
          meta,
        },
        tx,
      );
      return log;
    });
  }

  async update(id: string, input: UpdateEventLogInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.manageable(id, actor);
    await this.assertRefs(input.processId, input.departmentId, input.ownerId);
    const after = await this.prisma.eventLog.update({
      where: { id },
      data: { ...input, updatedById: actor.id },
    });
    if (input.processId !== undefined && input.processId !== before.processId)
      await this.autoMatch(id, true);
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'EventLog',
      entityId: id,
      userId: actor.id,
      summary: Object.fromEntries(
        Object.keys(input).map((k) => [
          k,
          { from: before[k as keyof EventLog] ?? null, to: after[k as keyof EventLog] ?? null },
        ]),
      ),
      meta,
    });
    return this.detail(id, actor);
  }

  // ---------- Activities ↔ BPMN steps (D-130) ----------

  /** Steps of the process's working model with the synonyms of linked / same-named terms. */
  async processSteps(processId: string): Promise<(MiningStepDto & { synonyms: string[] })[]> {
    const model = await this.prisma.processModel.findUnique({ where: { processId } });
    if (!model) return [];
    const graph = parseBpmnGraph(model.bpmnXml);
    const nodes = graph.nodes.filter((n) => isStepNode(n) || /Event$/.test(n.type));
    const terms = await this.prisma.repoObject.findMany({
      where: { type: 'TERM', deletedAt: null },
      select: { id: true, nameEn: true, nameAr: true, synonymsEn: true, synonymsAr: true },
    });
    const byId = new Map(terms.map((t) => [t.id, t]));
    const byName = new Map<string, (typeof terms)[number]>();
    for (const t of terms)
      for (const n of [t.nameEn, t.nameAr]) if (n) byName.set(normaliseLabel(n), t);
    return nodes.map((n) => {
      const term =
        (n.labelRef ? byId.get(n.labelRef) : undefined) ??
        byName.get(normaliseLabel(n.nameEn)) ??
        byName.get(normaliseLabel(n.nameAr));
      return {
        id: n.id,
        nameEn: n.nameEn || n.name,
        nameAr: n.nameAr,
        type: n.type,
        synonyms: term
          ? [term.nameEn, term.nameAr, ...term.synonymsEn, ...term.synonymsAr].filter(Boolean)
          : [],
      };
    });
  }

  /** Maps unmapped activities automatically; `reset` (another process linked) clears all first. */
  async autoMatch(logId: string, reset = false): Promise<number> {
    const log = await this.prisma.eventLog.findUniqueOrThrow({ where: { id: logId } });
    if (reset) {
      await this.prisma.miningActivity.updateMany({
        where: { logId },
        data: { bpmnElementId: null, match: null },
      });
      await this.invalidate(logId);
    }
    if (!log.processId) return 0;
    const steps: MatchStep[] = await this.processSteps(log.processId);
    const valid = new Set(steps.map((s) => s.id));
    const acts = await this.prisma.miningActivity.findMany({ where: { logId } });
    // Manual mappings to steps that no longer exist are dropped.
    for (const a of acts)
      if (a.bpmnElementId && !valid.has(a.bpmnElementId))
        await this.prisma.miningActivity.update({
          where: { logId_name: { logId, name: a.name } },
          data: { bpmnElementId: null, match: null },
        });
    const open = acts.filter((a) => !a.bpmnElementId || !valid.has(a.bpmnElementId));
    const matches = autoMatchActivities(
      open.map((a) => a.name),
      steps,
    );
    for (const [name, m] of matches)
      await this.prisma.miningActivity.update({
        where: { logId_name: { logId, name } },
        data: { bpmnElementId: m.elementId, match: m.match },
      });
    return matches.size;
  }

  async activities(id: string, user: AuthUser): Promise<LogActivitiesDto> {
    const log = await this.visible(id, user);
    const [items, steps] = await Promise.all([
      this.prisma.miningActivity.findMany({
        where: { logId: id },
        orderBy: [{ eventCount: 'desc' }, { name: 'asc' }],
      }),
      log.processId ? this.processSteps(log.processId) : Promise.resolve([]),
    ]);
    return {
      items: items.map((a) => ({
        name: a.name,
        eventCount: a.eventCount,
        caseCount: a.caseCount,
        elementId: a.bpmnElementId,
        match: (a.match as 'LABEL' | 'SYNONYM' | 'MANUAL' | null) ?? null,
      })),
      steps: steps.map(({ id: sid, nameEn, nameAr, type }) => ({ id: sid, nameEn, nameAr, type })),
    };
  }

  async mapActivities(id: string, input: ActivityMappingInput, actor: AuthUser, meta: RequestMeta) {
    const log = await this.manageable(id, actor);
    if (!log.processId) throw badRequest('LOG_WITHOUT_PROCESS');
    const steps = new Set((await this.processSteps(log.processId)).map((s) => s.id));
    for (const item of input.items) {
      if (item.elementId && !steps.has(item.elementId))
        throw badRequest('STEP_NOT_FOUND', item.elementId);
    }
    await this.prisma.$transaction(
      input.items.map((item) =>
        this.prisma.miningActivity.updateMany({
          where: { logId: id, name: item.activity },
          data: { bpmnElementId: item.elementId, match: item.elementId ? 'MANUAL' : null },
        }),
      ),
    );
    await this.invalidate(id);
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'EventLog',
      entityId: id,
      userId: actor.id,
      summary: { activityMapping: input.items.length },
      meta,
    });
    return this.activities(id, actor);
  }

  /** Drops cached analysis results of a log (mapping or filters changed meaning). */
  async invalidate(logId: string, kinds?: string[]) {
    await this.prisma.miningResultCache.deleteMany({
      where: { logId, ...(kinds ? { kind: { in: kinds } } : {}) },
    });
  }

  // ---------- Grants ----------

  async grants(id: string, user: AuthUser): Promise<LogGrantDto[]> {
    await this.visible(id, user);
    const rows = await this.prisma.eventLogGrant.findMany({
      where: { logId: id },
      include: { user: userRef },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((g) => ({ user: g.user, createdAt: g.createdAt.toISOString() }));
  }

  async setGrants(id: string, userIds: string[], actor: AuthUser, meta: RequestMeta) {
    await this.manageable(id, actor);
    const unique = [...new Set(userIds)];
    const found = await this.prisma.user.count({ where: { id: { in: unique } } });
    if (found !== unique.length) throw badRequest('USER_NOT_FOUND');
    const before = await this.prisma.eventLogGrant.findMany({ where: { logId: id } });
    await this.prisma.$transaction([
      this.prisma.eventLogGrant.deleteMany({ where: { logId: id, userId: { notIn: unique } } }),
      this.prisma.eventLogGrant.createMany({
        data: unique.map((userId) => ({ logId: id, userId, createdById: actor.id })),
        skipDuplicates: true,
      }),
    ]);
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'EventLog',
      entityId: id,
      userId: actor.id,
      summary: { grants: { from: before.map((g) => g.userId), to: unique } },
      meta,
    });
    return this.grants(id, actor);
  }

  // ---------- Mapping templates ----------

  private templateDto(
    t: Prisma.MiningMappingTemplateGetPayload<{ include: { owner: typeof userRef } }>,
  ): MappingTemplateDto {
    return {
      id: t.id,
      name: t.name,
      format: t.format as MiningFileFormat,
      mapping: t.mapping as MiningMapping,
      owner: t.owner,
      createdAt: t.createdAt.toISOString(),
    };
  }

  async templates(): Promise<MappingTemplateDto[]> {
    const rows = await this.prisma.miningMappingTemplate.findMany({
      include: { owner: userRef },
      orderBy: { name: 'asc' },
    });
    return rows.map((t) => this.templateDto(t));
  }

  async createTemplate(input: MappingTemplateInput, actor: AuthUser) {
    const t = await this.prisma.miningMappingTemplate.create({
      data: { name: input.name, format: input.format, mapping: input.mapping, ownerId: actor.id },
      include: { owner: userRef },
    });
    return this.templateDto(t);
  }

  async deleteTemplate(id: string, actor: AuthUser) {
    const t = await this.prisma.miningMappingTemplate.findUnique({ where: { id } });
    if (!t) throw notFound('Template');
    if (t.ownerId !== actor.id && !actor.permissions.has(PERMISSIONS.SETTINGS_MANAGE))
      throw forbidden('Only the owner may delete the template');
    await this.prisma.miningMappingTemplate.delete({ where: { id } });
  }
}
