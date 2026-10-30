import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PERMISSIONS,
  engagementMove,
  rateRisk,
  type AuditEngagementDetailDto,
  type AuditEngagementDto,
  type AuditFindingDto,
  type AuditUniverseRow,
  type AuditWorkItemDto,
  type CreateEngagementInput,
  type CreateFindingInput,
  type EngagementListQuery,
  type EngagementStatus,
  type EngagementStatusInput,
  type FindingResponseInput,
  type IssueStatus,
  type ResponseStatus,
  type UpdateEngagementInput,
  type UpdateFindingInput,
  type UserRef,
  type WorkItemInput,
  type WorkItemResult,
  type WorkItemStatus,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { badRequest, conflict, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { GrcService } from '../grc/grc.service';
import { GrcSettingsService } from '../grc/grc-settings.service';
import { elementLabel } from '../models/bpmn-xml';
import { AssuranceFilesService } from './assurance-files.service';
import { AssuranceEventsService } from './assurance-events.service';
import { AssuranceSettingsService } from './assurance-settings.service';
import { IssuesService } from './issues.service';

const ENTITY = 'AuditEngagement';
const userSelect = { id: true, email: true, nameEn: true, nameAr: true } as const;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const day = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
const toDay = (v: string | null | undefined) => (v === undefined ? undefined : v ? day(v) : null);
const engagementLink = (id: string) => `/grc/audits/${id}`;

const include = {
  items: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
  findings: { where: { deletedAt: null }, orderBy: { code: 'asc' } },
} satisfies Prisma.AuditEngagementInclude;
type EngagementRow = Prisma.AuditEngagementGetPayload<{ include: typeof include }>;
type FindingRow = EngagementRow['findings'][number];

/**
 * Audit management (Phase 4.2, D-101): audit universe, annual plan of engagements, work
 * programme, findings with management responses; an agreed finding creates an issue with its
 * action, linked to the same process, step, risk, control and requirement (root-cause trace).
 */
@Injectable()
export class AuditsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly grc: GrcService,
    private readonly grcSettings: GrcSettingsService,
    private readonly files: AssuranceFilesService,
    private readonly events: AssuranceEventsService,
    private readonly settings: AssuranceSettingsService,
    private readonly issues: IssuesService,
  ) {}

  onModuleInit() {
    const read = (user: AuthUser) => this.reads(user);
    this.files.register('AUDIT_ITEM', {
      canRead: async (_id, user) => read(user),
      canWrite: async (id, user) => {
        const item = await this.prisma.auditWorkItem.findFirst({
          where: { id, deletedAt: null },
          include: { engagement: true },
        });
        return !!item && this.manages(user) && item.engagement.status !== 'CLOSED';
      },
    });
    this.files.register('AUDIT_FINDING', {
      canRead: async (id, user) => {
        if (read(user)) return true;
        const f = await this.prisma.auditFinding.findFirst({ where: { id, deletedAt: null } });
        return !!f && f.responseOwnerId === user.id;
      },
      canWrite: async (_id, user) => this.manages(user),
    });
    this.issues.registerSource('AUDIT_FINDING', async (id) => {
      const f = await this.prisma.auditFinding.findFirst({ where: { id, deletedAt: null } });
      return f
        ? {
            link: `${engagementLink(f.engagementId)}?finding=${f.id}`,
            defaults: {
              processId: f.processId,
              bpmnElementId: f.bpmnElementId,
              riskId: f.riskId,
              controlId: f.controlId,
              requirementId: f.requirementId,
            },
          }
        : null;
    });
  }

  // ---------- Access ----------

  private manages(user: AuthUser) {
    return user.permissions.has(PERMISSIONS.AUDIT_MANAGE);
  }
  /** Internal audit, Risk & Compliance editors and the read-only Auditors (audit log readers). */
  private reads(user: AuthUser) {
    return (
      this.manages(user) ||
      user.permissions.has(PERMISSIONS.GRC_EDIT) ||
      user.permissions.has(PERMISSIONS.AUDIT_READ)
    );
  }
  private assertManage(user: AuthUser) {
    if (!this.manages(user)) throw forbidden();
  }

  // ---------- DTOs ----------

  private async refs(
    rows: { ids: string[]; kind: 'object' | 'process' | 'department' | 'user' }[],
  ) {
    const all = (k: string) => [...new Set(rows.filter((r) => r.kind === k).flatMap((r) => r.ids))];
    const [objects, processes, departments, users] = await Promise.all([
      this.prisma.repoObject.findMany({
        where: { id: { in: all('object') } },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.prisma.process.findMany({
        where: { id: { in: all('process') } },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.prisma.department.findMany({
        where: { id: { in: all('department') } },
        select: { id: true, nameEn: true, nameAr: true },
      }),
      this.prisma.user.findMany({ where: { id: { in: all('user') } }, select: userSelect }),
    ]);
    return {
      o: new Map(objects.map((x) => [x.id, x])),
      p: new Map(processes.map((x) => [x.id, x])),
      d: new Map(departments.map((x) => [x.id, x])),
      u: new Map<string, UserRef>(users.map((x) => [x.id, x])),
    };
  }

  private async toDtos(rows: EngagementRow[], user: AuthUser): Promise<AuditEngagementDto[]> {
    const r = await this.refs([
      { kind: 'user', ids: rows.flatMap((e) => [...e.teamIds, ...(e.leadId ? [e.leadId] : [])]) },
      { kind: 'process', ids: rows.flatMap((e) => e.processIds) },
      { kind: 'department', ids: rows.flatMap((e) => e.departmentIds) },
      {
        kind: 'object',
        ids: rows.flatMap((e) => [...e.riskIds, ...e.controlIds, ...e.requirementIds]),
      },
    ]);
    const list = <T>(m: Map<string, T>, ids: string[]) =>
      ids.map((id) => m.get(id)).filter((v): v is T => !!v);
    const now = new Date();
    return rows.map((e) => {
      const byRating: Record<string, number> = {};
      for (const f of e.findings) byRating[f.rating] = (byRating[f.rating] ?? 0) + 1;
      const status = e.status as EngagementStatus;
      return {
        id: e.id,
        code: e.code,
        year: e.year,
        titleEn: e.titleEn,
        titleAr: e.titleAr,
        objectiveEn: e.objectiveEn,
        objectiveAr: e.objectiveAr,
        scopeEn: e.scopeEn,
        scopeAr: e.scopeAr,
        status,
        lead: e.leadId ? (r.u.get(e.leadId) ?? null) : null,
        team: list(r.u, e.teamIds),
        plannedStart: iso(e.plannedStart),
        plannedEnd: iso(e.plannedEnd),
        actualStart: iso(e.actualStart),
        actualEnd: iso(e.actualEnd),
        scope: {
          processes: list(r.p, e.processIds),
          departments: list(r.d, e.departmentIds),
          risks: list(r.o, e.riskIds),
          controls: list(r.o, e.controlIds),
          requirements: list(r.o, e.requirementIds),
        },
        summaryEn: e.summaryEn,
        summaryAr: e.summaryAr,
        itemCount: e.items.length,
        itemsDone: e.items.filter((i) => i.status !== 'OPEN').length,
        findingCount: e.findings.length,
        findingsByRating: byRating,
        late:
          (status === 'PLANNED' || status === 'FIELDWORK') && !!e.plannedEnd && e.plannedEnd < now,
        canManage: this.manages(user),
        updatedAt: e.updatedAt.toISOString(),
      };
    });
  }

  private async findingDtos(
    rows: (FindingRow & {
      engagement?: { id: string; code: string; titleEn: string; titleAr: string; status: string };
    })[],
    user: AuthUser,
    engagement?: { id: string; code: string; titleEn: string; titleAr: string; status: string },
  ): Promise<AuditFindingDto[]> {
    const r = await this.refs([
      { kind: 'user', ids: rows.map((f) => f.responseOwnerId).filter((v): v is string => !!v) },
      { kind: 'process', ids: rows.map((f) => f.processId).filter((v): v is string => !!v) },
      {
        kind: 'object',
        ids: rows
          .flatMap((f) => [f.riskId, f.controlId, f.requirementId])
          .filter((v): v is string => !!v),
      },
    ]);
    const issues = await this.prisma.issue.findMany({
      where: { id: { in: rows.map((f) => f.issueId).filter((v): v is string => !!v) } },
      select: { id: true, code: true, status: true },
    });
    const labels = await this.grc.labels([
      ...new Set(rows.map((f) => f.processId).filter((v): v is string => !!v)),
    ]);
    const files = await this.files.list(
      'AUDIT_FINDING',
      rows.map((f) => f.id),
    );
    const get = <T>(m: Map<string, T>, id: string | null) => (id ? (m.get(id) ?? null) : null);
    return rows.map((f) => {
      const e = f.engagement ?? engagement!;
      const el =
        f.processId && f.bpmnElementId
          ? elementLabel(labels.get(f.processId) ?? new Map(), f.bpmnElementId)
          : null;
      const issue = issues.find((i) => i.id === f.issueId);
      return {
        id: f.id,
        engagementId: f.engagementId,
        engagement: {
          id: e.id,
          code: e.code,
          titleEn: e.titleEn,
          titleAr: e.titleAr,
          status: e.status as EngagementStatus,
        },
        code: f.code,
        titleEn: f.titleEn,
        titleAr: f.titleAr,
        rating: f.rating,
        conditionEn: f.conditionEn,
        conditionAr: f.conditionAr,
        criteriaEn: f.criteriaEn,
        criteriaAr: f.criteriaAr,
        requirement: get(r.o, f.requirementId),
        causeEn: f.causeEn,
        causeAr: f.causeAr,
        effectEn: f.effectEn,
        effectAr: f.effectAr,
        recommendationEn: f.recommendationEn,
        recommendationAr: f.recommendationAr,
        process: get(r.p, f.processId),
        bpmnElementId: f.bpmnElementId,
        elementLabel: el ? { nameEn: el.nameEn, nameAr: el.nameAr } : null,
        risk: get(r.o, f.riskId),
        control: get(r.o, f.controlId),
        workItemId: f.workItemId,
        responseStatus: f.responseStatus as ResponseStatus,
        responseOwner: get(r.u, f.responseOwnerId),
        agreedActionEn: f.agreedActionEn,
        agreedActionAr: f.agreedActionAr,
        targetDate: iso(f.targetDate),
        responseComment: f.responseComment,
        respondedAt: iso(f.respondedAt),
        issue: issue
          ? { id: issue.id, code: issue.code, status: issue.status as IssueStatus }
          : null,
        files: files.filter((x) => x.ownerId === f.id),
        canRespond:
          f.responseStatus === 'PENDING' &&
          e.status !== 'CLOSED' &&
          (f.responseOwnerId === user.id || this.manages(user)),
      };
    });
  }

  private async row(id: string): Promise<EngagementRow> {
    const e = await this.prisma.auditEngagement.findFirst({
      where: { id, deletedAt: null },
      include,
    });
    if (!e) throw notFound('Engagement');
    return e;
  }

  // ---------- Engagements ----------

  async list(q: EngagementListQuery, user: AuthUser): Promise<AuditEngagementDto[]> {
    if (!this.reads(user)) throw forbidden();
    const rows = await this.prisma.auditEngagement.findMany({
      where: {
        deletedAt: null,
        year: q.year,
        status: q.status,
        ...(q.processId ? { processIds: { has: q.processId } } : {}),
        ...(q.departmentId ? { departmentIds: { has: q.departmentId } } : {}),
        ...(q.q
          ? {
              OR: [
                { code: { contains: q.q, mode: 'insensitive' } },
                { titleEn: { contains: q.q, mode: 'insensitive' } },
                { titleAr: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include,
      orderBy: [{ year: 'desc' }, { plannedStart: 'asc' }, { code: 'asc' }],
    });
    return this.toDtos(rows, user);
  }

  async get(id: string, user: AuthUser): Promise<AuditEngagementDetailDto> {
    if (!this.reads(user)) throw notFound('Engagement');
    const e = await this.row(id);
    const [dto] = await this.toDtos([e], user);
    const r = await this.refs([
      { kind: 'object', ids: e.items.map((i) => i.controlId).filter((v): v is string => !!v) },
      { kind: 'user', ids: e.items.map((i) => i.assigneeId).filter((v): v is string => !!v) },
    ]);
    const files = await this.files.list(
      'AUDIT_ITEM',
      e.items.map((i) => i.id),
    );
    const items: AuditWorkItemDto[] = e.items.map((i) => ({
      id: i.id,
      titleEn: i.titleEn,
      titleAr: i.titleAr,
      procedure: i.procedure as { en: string; ar: string }[],
      control: i.controlId ? (r.o.get(i.controlId) ?? null) : null,
      status: i.status as WorkItemStatus,
      result: (i.result as WorkItemResult) ?? null,
      notes: i.notes,
      assignee: i.assigneeId ? (r.u.get(i.assigneeId) ?? null) : null,
      files: files.filter((f) => f.ownerId === i.id),
    }));
    return {
      ...dto,
      items,
      findings: await this.findingDtos(e.findings, user, e),
      events: await this.events.list(ENTITY, id),
    };
  }

  private async assertScope(input: Partial<CreateEngagementInput>) {
    const count = async (n: number, expected: string[] | undefined, code: string) => {
      if (expected?.length && n !== expected.length) throw badRequest(code);
    };
    const users = [...(input.teamIds ?? []), ...(input.leadId ? [input.leadId] : [])];
    await count(
      await this.prisma.user.count({ where: { id: { in: users }, deletedAt: null } }),
      [...new Set(users)],
      'INVALID_USER',
    );
    await count(
      await this.prisma.process.count({
        where: { id: { in: input.processIds ?? [] }, deletedAt: null },
      }),
      input.processIds,
      'INVALID_PROCESS',
    );
    await count(
      await this.prisma.department.count({
        where: { id: { in: input.departmentIds ?? [] }, deletedAt: null },
      }),
      input.departmentIds,
      'INVALID_DEPARTMENT',
    );
    for (const [list, type] of [
      [input.riskIds, 'RISK'],
      [input.controlIds, 'CONTROL'],
      [input.requirementIds, 'REQUIREMENT'],
    ] as const)
      await count(
        await this.prisma.repoObject.count({
          where: { id: { in: list ?? [] }, type, deletedAt: null },
        }),
        list,
        `INVALID_${type}_REFERENCE`,
      );
  }

  async create(input: CreateEngagementInput, actor: AuthUser, meta: RequestMeta) {
    this.assertManage(actor);
    await this.assertScope(input);
    let id = '';
    for (let attempt = 0; attempt < 5 && !id; attempt++) {
      try {
        id = await this.prisma.$transaction(async (tx) => {
          const n = await tx.auditEngagement.count({ where: { year: input.year } });
          const code = `AUD-${input.year}-${String(n + 1 + attempt).padStart(2, '0')}`;
          const e = await tx.auditEngagement.create({
            data: {
              code,
              year: input.year,
              titleEn: input.titleEn ?? '',
              titleAr: input.titleAr ?? '',
              objectiveEn: input.objectiveEn ?? '',
              objectiveAr: input.objectiveAr ?? '',
              scopeEn: input.scopeEn ?? '',
              scopeAr: input.scopeAr ?? '',
              leadId: input.leadId ?? null,
              teamIds: input.teamIds ?? [],
              plannedStart: input.plannedStart ? day(input.plannedStart) : null,
              plannedEnd: input.plannedEnd ? day(input.plannedEnd) : null,
              processIds: input.processIds ?? [],
              departmentIds: input.departmentIds ?? [],
              riskIds: input.riskIds ?? [],
              controlIds: input.controlIds ?? [],
              requirementIds: input.requirementIds ?? [],
              summaryEn: input.summaryEn ?? '',
              summaryAr: input.summaryAr ?? '',
              createdById: actor.id,
              updatedById: actor.id,
            },
          });
          await this.events.add(
            tx,
            ENTITY,
            e.id,
            'CREATED',
            { status: { from: null, to: 'PLANNED' } },
            '',
            actor.id,
          );
          await this.audit.log(
            {
              action: 'CREATE',
              entityType: 'AuditEngagement',
              entityId: e.id,
              userId: actor.id,
              summary: { after: { code, year: e.year, title: e.titleEn || e.titleAr } },
              meta,
            },
            tx,
          );
          return e.id;
        });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'))
          throw err;
      }
    }
    if (!id) throw conflict('CONFLICT');
    const e = await this.row(id);
    await this.notifyTeam(e, [...e.teamIds, e.leadId], actor.id);
    return this.get(id, actor);
  }

  private notifyTeam(
    e: { id: string; code: string; titleEn: string; titleAr: string },
    userIds: (string | null)[],
    actorId: string,
  ) {
    return this.notifications.notify({
      userIds,
      type: 'AUDIT',
      actorId,
      params: { kind: 'team', code: e.code, titleEn: e.titleEn, titleAr: e.titleAr },
      link: engagementLink(e.id),
    });
  }

  async update(id: string, input: UpdateEngagementInput, actor: AuthUser, meta: RequestMeta) {
    this.assertManage(actor);
    const before = await this.row(id);
    if (before.status === 'CLOSED') throw conflict('ENGAGEMENT_CLOSED');
    await this.assertScope(input);
    await this.prisma.$transaction(async (tx) => {
      await tx.auditEngagement.update({
        where: { id },
        data: {
          year: input.year,
          titleEn: input.titleEn,
          titleAr: input.titleAr,
          objectiveEn: input.objectiveEn,
          objectiveAr: input.objectiveAr,
          scopeEn: input.scopeEn,
          scopeAr: input.scopeAr,
          leadId: input.leadId,
          teamIds: input.teamIds,
          plannedStart: toDay(input.plannedStart),
          plannedEnd: toDay(input.plannedEnd),
          processIds: input.processIds,
          departmentIds: input.departmentIds,
          riskIds: input.riskIds,
          controlIds: input.controlIds,
          requirementIds: input.requirementIds,
          summaryEn: input.summaryEn,
          summaryAr: input.summaryAr,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'AuditEngagement',
          entityId: id,
          userId: actor.id,
          summary: { fields: Object.keys(input) },
          meta,
        },
        tx,
      );
    });
    const added = [...(input.teamIds ?? []), ...(input.leadId ? [input.leadId] : [])].filter(
      (u) => !before.teamIds.includes(u) && u !== before.leadId,
    );
    if (added.length) await this.notifyTeam(before, added, actor.id);
    return this.get(id, actor);
  }

  async setStatus(id: string, input: EngagementStatusInput, actor: AuthUser, meta: RequestMeta) {
    this.assertManage(actor);
    const e = await this.row(id);
    const from = e.status as EngagementStatus;
    if (!engagementMove(from, input.status)) throw conflict('INVALID_TRANSITION');
    if (input.status === 'CLOSED' && e.findings.some((f) => f.responseStatus === 'PENDING'))
      throw badRequest('FINDINGS_UNANSWERED', 'Every finding needs a management response first');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.auditEngagement.updateMany({
        where: { id, status: from },
        data: {
          status: input.status,
          ...(input.status === 'FIELDWORK' && !e.actualStart ? { actualStart: now } : {}),
          ...(input.status === 'REPORTING' && !e.actualEnd ? { actualEnd: now } : {}),
          updatedById: actor.id,
        },
      });
      if (!res.count) throw conflict('INVALID_TRANSITION');
      await this.events.add(
        tx,
        ENTITY,
        id,
        'STATUS',
        { status: { from, to: input.status } },
        input.comment,
        actor.id,
      );
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'AuditEngagement',
          entityId: id,
          userId: actor.id,
          summary: { status: { from, to: input.status } },
          meta,
        },
        tx,
      );
    });
    // Reporting starts: management is asked to respond to the findings.
    if (input.status === 'REPORTING')
      for (const f of e.findings.filter((x) => x.responseStatus === 'PENDING'))
        await this.notifyResponse(e, f, actor.id);
    return this.get(id, actor);
  }

  private notifyResponse(e: EngagementRow, f: FindingRow, actorId: string) {
    return this.notifications.notify({
      userIds: [f.responseOwnerId],
      type: 'AUDIT',
      actorId,
      params: {
        kind: 'response',
        code: `${e.code} ${f.code}`,
        titleEn: f.titleEn,
        titleAr: f.titleAr,
      },
      link: `${engagementLink(e.id)}?finding=${f.id}`,
    });
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    this.assertManage(actor);
    const e = await this.row(id);
    if (e.status !== 'PLANNED')
      throw conflict('ENGAGEMENT_STARTED', 'Only planned engagements can be deleted');
    await this.prisma.$transaction(async (tx) => {
      await tx.auditEngagement.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'AuditEngagement',
          entityId: id,
          userId: actor.id,
          summary: { code: e.code },
          meta,
        },
        tx,
      );
    });
  }

  async comment(id: string, body: string, actor: AuthUser, meta: RequestMeta) {
    if (!this.reads(actor)) throw notFound('Engagement');
    await this.row(id);
    if (!this.manages(actor)) throw forbidden();
    await this.prisma.$transaction(async (tx) => {
      const ev = await this.events.add(tx, ENTITY, id, 'COMMENT', {}, body, actor.id);
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'AuditEngagement',
          entityId: id,
          userId: actor.id,
          summary: { comment: ev.id },
          meta,
        },
        tx,
      );
    });
    return this.events.list(ENTITY, id);
  }

  // ---------- Work programme ----------

  /** The control's current test procedure (latest active plan), reused for audit testing. */
  private async controlProcedure(controlId: string) {
    const plan = await this.prisma.controlTestPlan.findFirst({
      where: { controlId, deletedAt: null, active: true },
      orderBy: { updatedAt: 'desc' },
    });
    return (plan?.procedure as { en: string; ar: string }[] | undefined) ?? [];
  }

  private async openEngagement(id: string, actor: AuthUser) {
    this.assertManage(actor);
    const e = await this.row(id);
    if (e.status === 'CLOSED') throw conflict('ENGAGEMENT_CLOSED');
    return e;
  }

  async addItem(id: string, input: WorkItemInput, actor: AuthUser, meta: RequestMeta) {
    const e = await this.openEngagement(id, actor);
    let title = { en: input.titleEn ?? '', ar: input.titleAr ?? '' };
    if (input.controlId) {
      const c = await this.prisma.repoObject.findFirst({
        where: { id: input.controlId, type: 'CONTROL', deletedAt: null },
      });
      if (!c) throw badRequest('INVALID_CONTROL_REFERENCE');
      if (!title.en && !title.ar)
        title = {
          en: [c.code, c.nameEn].filter(Boolean).join(' '),
          ar: [c.code, c.nameAr].filter(Boolean).join(' '),
        };
    }
    if (!title.en && !title.ar) throw badRequest('NAME_REQUIRED');
    const procedure =
      input.procedure ?? (input.controlId ? await this.controlProcedure(input.controlId) : []);
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.auditWorkItem.create({
        data: {
          engagementId: id,
          sortOrder: e.items.length,
          titleEn: title.en,
          titleAr: title.ar,
          procedure,
          controlId: input.controlId ?? null,
          status: input.status ?? 'OPEN',
          result: input.result ?? null,
          notes: input.notes ?? '',
          assigneeId: input.assigneeId ?? null,
          createdById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'AuditEngagement',
          entityId: id,
          userId: actor.id,
          summary: { workItem: item.id, title: title.en || title.ar },
          meta,
        },
        tx,
      );
    });
    return this.get(id, actor);
  }

  async updateItem(itemId: string, input: WorkItemInput, actor: AuthUser, meta: RequestMeta) {
    const item = await this.prisma.auditWorkItem.findFirst({
      where: { id: itemId, deletedAt: null },
    });
    if (!item) throw notFound('Work item');
    await this.openEngagement(item.engagementId, actor);
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.auditWorkItem.update({
        where: { id: itemId },
        data: {
          titleEn: input.titleEn,
          titleAr: input.titleAr,
          procedure: input.procedure,
          status: input.status,
          result: input.result,
          notes: input.notes,
          assigneeId: input.assigneeId,
        },
      });
      if (after.status !== item.status || after.result !== item.result)
        await this.events.add(
          tx,
          ENTITY,
          item.engagementId,
          'UPDATED',
          {
            [`item:${after.titleEn || after.titleAr}`]: {
              from: `${item.status}/${item.result ?? ''}`,
              to: `${after.status}/${after.result ?? ''}`,
            },
          },
          '',
          actor.id,
        );
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'AuditEngagement',
          entityId: item.engagementId,
          userId: actor.id,
          summary: { workItem: itemId, status: after.status, result: after.result },
          meta,
        },
        tx,
      );
    });
    return this.get(item.engagementId, actor);
  }

  async removeItem(itemId: string, actor: AuthUser, meta: RequestMeta) {
    const item = await this.prisma.auditWorkItem.findFirst({
      where: { id: itemId, deletedAt: null },
    });
    if (!item) throw notFound('Work item');
    await this.openEngagement(item.engagementId, actor);
    await this.prisma.$transaction(async (tx) => {
      await tx.auditWorkItem.update({ where: { id: itemId }, data: { deletedAt: new Date() } });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'AuditEngagement',
          entityId: item.engagementId,
          userId: actor.id,
          summary: { workItem: itemId },
          meta,
        },
        tx,
      );
    });
    return this.get(item.engagementId, actor);
  }

  async uploadItemFile(
    itemId: string,
    file: Express.Multer.File | undefined,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const item = await this.prisma.auditWorkItem.findFirst({
      where: { id: itemId, deletedAt: null },
    });
    if (!item) throw notFound('Work item');
    await this.openEngagement(item.engagementId, actor);
    return this.files.upload('AUDIT_ITEM', itemId, file, actor, meta, ENTITY);
  }

  // ---------- Findings ----------

  private async assertFindingRefs(input: UpdateFindingInput, engagementId: string) {
    const settings = await this.settings.get();
    if (input.rating && !settings.severities.some((s) => s.key === input.rating))
      throw badRequest('INVALID_SEVERITY');
    const obj = async (id: string | null | undefined, type: 'RISK' | 'CONTROL' | 'REQUIREMENT') => {
      if (id && !(await this.prisma.repoObject.count({ where: { id, type, deletedAt: null } })))
        throw badRequest(`INVALID_${type}_REFERENCE`);
    };
    await obj(input.riskId, 'RISK');
    await obj(input.controlId, 'CONTROL');
    await obj(input.requirementId, 'REQUIREMENT');
    if (
      input.processId &&
      !(await this.prisma.process.count({ where: { id: input.processId, deletedAt: null } }))
    )
      throw badRequest('INVALID_PROCESS');
    if (
      input.responseOwnerId &&
      !(await this.prisma.user.count({ where: { id: input.responseOwnerId, deletedAt: null } }))
    )
      throw badRequest('INVALID_USER');
    if (
      input.workItemId &&
      !(await this.prisma.auditWorkItem.count({
        where: { id: input.workItemId, engagementId, deletedAt: null },
      }))
    )
      throw badRequest('INVALID_WORK_ITEM');
  }

  async addFinding(id: string, input: CreateFindingInput, actor: AuthUser, meta: RequestMeta) {
    const e = await this.openEngagement(id, actor);
    await this.assertFindingRefs(input, id);
    const n = await this.prisma.auditFinding.count({ where: { engagementId: id } });
    const code = `F-${String(n + 1).padStart(2, '0')}`;
    const f = await this.prisma.$transaction(async (tx) => {
      const row = await tx.auditFinding.create({
        data: {
          engagementId: id,
          code,
          ...this.findingData(input),
          rating: input.rating,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.events.add(
        tx,
        ENTITY,
        id,
        'UPDATED',
        { finding: { from: null, to: `${code} ${row.titleEn || row.titleAr}` } },
        '',
        actor.id,
      );
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'AuditFinding',
          entityId: row.id,
          userId: actor.id,
          summary: { engagementId: id, code, rating: row.rating },
          meta,
        },
        tx,
      );
      return row;
    });
    if (e.status === 'REPORTING' || e.status === 'FOLLOW_UP')
      await this.notifyResponse(e, f, actor.id);
    return this.get(id, actor);
  }

  private findingData(input: UpdateFindingInput) {
    return {
      titleEn: input.titleEn,
      titleAr: input.titleAr,
      rating: input.rating,
      conditionEn: input.conditionEn,
      conditionAr: input.conditionAr,
      criteriaEn: input.criteriaEn,
      criteriaAr: input.criteriaAr,
      requirementId: input.requirementId,
      causeEn: input.causeEn,
      causeAr: input.causeAr,
      effectEn: input.effectEn,
      effectAr: input.effectAr,
      recommendationEn: input.recommendationEn,
      recommendationAr: input.recommendationAr,
      processId: input.processId,
      bpmnElementId: input.bpmnElementId,
      riskId: input.riskId,
      controlId: input.controlId,
      workItemId: input.workItemId,
      responseOwnerId: input.responseOwnerId,
    };
  }

  private async findingRow(findingId: string) {
    const f = await this.prisma.auditFinding.findFirst({
      where: { id: findingId, deletedAt: null },
    });
    if (!f) throw notFound('Finding');
    return f;
  }

  async updateFinding(
    findingId: string,
    input: UpdateFindingInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const f = await this.findingRow(findingId);
    const e = await this.openEngagement(f.engagementId, actor);
    if (f.issueId)
      throw conflict('FINDING_AGREED', 'An agreed finding is followed up through its issue');
    await this.assertFindingRefs(input, f.engagementId);
    await this.prisma.$transaction(async (tx) => {
      await tx.auditFinding.update({
        where: { id: findingId },
        data: { ...this.findingData(input), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'AuditFinding',
          entityId: findingId,
          userId: actor.id,
          summary: { fields: Object.keys(input) },
          meta,
        },
        tx,
      );
    });
    if (
      input.responseOwnerId &&
      input.responseOwnerId !== f.responseOwnerId &&
      (e.status === 'REPORTING' || e.status === 'FOLLOW_UP')
    )
      await this.notifyResponse(e, await this.findingRow(findingId), actor.id);
    return this.get(f.engagementId, actor);
  }

  async removeFinding(findingId: string, actor: AuthUser, meta: RequestMeta) {
    const f = await this.findingRow(findingId);
    await this.openEngagement(f.engagementId, actor);
    if (f.issueId) throw conflict('FINDING_AGREED');
    await this.prisma.$transaction(async (tx) => {
      await tx.auditFinding.update({ where: { id: findingId }, data: { deletedAt: new Date() } });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'AuditFinding',
          entityId: findingId,
          userId: actor.id,
          summary: { code: f.code },
          meta,
        },
        tx,
      );
    });
    return this.get(f.engagementId, actor);
  }

  async uploadFindingFile(
    findingId: string,
    file: Express.Multer.File | undefined,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const f = await this.findingRow(findingId);
    await this.openEngagement(f.engagementId, actor);
    return this.files.upload('AUDIT_FINDING', findingId, file, actor, meta, ENTITY);
  }

  /** One finding (response owners reach their own without the audit workspace). */
  async getFinding(findingId: string, user: AuthUser): Promise<AuditFindingDto> {
    const f = await this.prisma.auditFinding.findFirst({
      where: { id: findingId, deletedAt: null, engagement: { deletedAt: null } },
      include: { engagement: true },
    });
    if (!f || (!this.reads(user) && f.responseOwnerId !== user.id)) throw notFound('Finding');
    return (await this.findingDtos([f], user))[0];
  }

  /** Management response: agreeing creates the issue (with the agreed action) linked like the finding. */
  async respond(
    findingId: string,
    input: FindingResponseInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const f = await this.prisma.auditFinding.findFirst({
      where: { id: findingId, deletedAt: null, engagement: { deletedAt: null } },
      include: { engagement: true },
    });
    if (!f || (!this.reads(actor) && f.responseOwnerId !== actor.id)) throw notFound('Finding');
    if (f.responseOwnerId !== actor.id && !this.manages(actor)) throw forbidden();
    if (f.responseStatus !== 'PENDING' || f.engagement.status === 'CLOSED')
      throw conflict('FINDING_ANSWERED');
    const ownerId = input.ownerId ?? f.responseOwnerId ?? actor.id;
    if (
      input.ownerId &&
      !(await this.prisma.user.count({ where: { id: input.ownerId, deletedAt: null } }))
    )
      throw badRequest('INVALID_USER');
    const now = new Date();
    const done = await this.prisma.auditFinding.updateMany({
      where: { id: findingId, responseStatus: 'PENDING' },
      data: {
        responseStatus: input.status,
        agreedActionEn: input.agreedActionEn ?? '',
        agreedActionAr: input.agreedActionAr ?? '',
        targetDate: input.targetDate ? day(input.targetDate) : null,
        responseComment: input.comment,
        respondedAt: now,
        respondedById: actor.id,
        ...(input.status === 'ACCEPTED' ? { responseOwnerId: ownerId } : {}),
      },
    });
    if (!done.count) throw conflict('FINDING_ANSWERED');
    if (input.status === 'ACCEPTED') {
      const issueId = await this.issues.create(
        {
          titleEn: `${f.engagement.code} ${f.code}: ${f.titleEn || f.titleAr}`,
          titleAr: `${f.engagement.code} ${f.code}: ${f.titleAr || f.titleEn}`,
          descriptionEn: [f.conditionEn, f.recommendationEn].filter(Boolean).join('\n\n'),
          descriptionAr: [f.conditionAr, f.recommendationAr].filter(Boolean).join('\n\n'),
          severity: f.rating,
          sourceType: 'AUDIT_FINDING',
          sourceId: f.id,
          ownerId,
          dueAt: input.targetDate ?? null,
          actions: [
            {
              titleEn: input.agreedActionEn || input.agreedActionAr,
              titleAr: input.agreedActionAr || input.agreedActionEn,
              ownerId,
              dueAt: input.targetDate ?? null,
            },
          ],
        },
        actor,
        meta,
      );
      await this.prisma.auditFinding.update({ where: { id: findingId }, data: { issueId } });
    }
    await this.prisma.$transaction(async (tx) => {
      await this.events.add(
        tx,
        ENTITY,
        f.engagementId,
        'UPDATED',
        { [`response:${f.code}`]: { from: 'PENDING', to: input.status } },
        input.comment,
        actor.id,
      );
      await this.audit.log(
        {
          action: input.status === 'ACCEPTED' ? 'APPROVE' : 'REJECT',
          entityType: 'AuditFinding',
          entityId: findingId,
          userId: actor.id,
          summary: { response: input.status, targetDate: input.targetDate ?? null },
          meta,
        },
        tx,
      );
    });
    await this.notifications.notify({
      userIds: [f.engagement.leadId, ...f.engagement.teamIds],
      type: 'AUDIT',
      actorId: actor.id,
      params: {
        kind: input.status === 'ACCEPTED' ? 'agreed' : 'disagreed',
        code: `${f.engagement.code} ${f.code}`,
        titleEn: f.titleEn,
        titleAr: f.titleAr,
        comment: input.comment,
      },
      link: `${engagementLink(f.engagementId)}?finding=${f.id}`,
    });
    return this.getFinding(findingId, actor);
  }

  async myTasks(user: AuthUser) {
    const rows = await this.prisma.auditFinding.findMany({
      where: {
        deletedAt: null,
        responseOwnerId: user.id,
        responseStatus: 'PENDING',
        engagement: { deletedAt: null, status: { in: ['REPORTING', 'FOLLOW_UP'] } },
      },
      include: { engagement: true },
    });
    return { findingsToAnswer: await this.findingDtos(rows, user) };
  }

  // ---------- Audit universe ----------

  /**
   * Processes and departments with a risk-based priority (highest residual score of their active
   * risks), the last audit date and the engagements of the year that cover them.
   */
  async universe(year: number, user: AuthUser): Promise<AuditUniverseRow[]> {
    if (!this.reads(user)) throw forbidden();
    const { bands } = await this.grcSettings.get();
    const [processes, departments, risks, engagements] = await Promise.all([
      this.prisma.process.findMany({
        where: { deletedAt: null, status: { not: 'ARCHIVED' } },
        select: { id: true, code: true, nameEn: true, nameAr: true, departmentId: true },
      }),
      this.prisma.department.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.prisma.risk.findMany({
        where: { status: 'ACTIVE', object: { deletedAt: null } },
        include: {
          object: {
            select: {
              links: { where: { process: { deletedAt: null } }, select: { processId: true } },
            },
          },
        },
      }),
      this.prisma.auditEngagement.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          code: true,
          status: true,
          year: true,
          actualEnd: true,
          processIds: true,
          departmentIds: true,
        },
      }),
    ]);
    const deptOf = new Map(processes.map((p) => [p.id, p.departmentId]));
    const scores = new Map<string, number[]>();
    const add = (k: string, v: number) => scores.set(k, [...(scores.get(k) ?? []), v]);
    for (const r of risks) {
      const score = rateRisk(r, bands).residualScore;
      const procs = new Set(r.object.links.map((l) => l.processId));
      for (const p of procs) add(`P:${p}`, score);
      const depts = new Set(
        [r.departmentId, ...[...procs].map((p) => deptOf.get(p))].filter((v): v is string => !!v),
      );
      for (const d of depts) add(`D:${d}`, score);
    }
    const row = (
      kind: 'PROCESS' | 'DEPARTMENT',
      x: { id: string; code: string | null; nameEn: string; nameAr: string },
    ): AuditUniverseRow => {
      const list = scores.get(`${kind === 'PROCESS' ? 'P' : 'D'}:${x.id}`) ?? [];
      const max = list.length ? Math.max(...list) : 0;
      const covering = engagements.filter((e) =>
        (kind === 'PROCESS' ? e.processIds : e.departmentIds).includes(x.id),
      );
      const audited = covering
        .filter((e) => ['FOLLOW_UP', 'CLOSED', 'REPORTING'].includes(e.status) && e.actualEnd)
        .map((e) => e.actualEnd!.getTime());
      let band: string | null = null;
      for (const b of bands) if (max >= b.minScore) band = b.key;
      return {
        kind,
        id: x.id,
        code: x.code,
        nameEn: x.nameEn,
        nameAr: x.nameAr,
        priorityScore: max,
        priorityBand: max ? band : null,
        riskCount: list.length,
        lastAuditedAt: audited.length ? new Date(Math.max(...audited)).toISOString() : null,
        planned: covering
          .filter((e) => e.year === year)
          .map((e) => ({ id: e.id, code: e.code, status: e.status as EngagementStatus })),
      };
    };
    return [
      ...processes.map((p) => row('PROCESS', p)),
      ...departments.map((d) => row('DEPARTMENT', d)),
    ].sort(
      (a, b) =>
        b.priorityScore - a.priorityScore ||
        (a.lastAuditedAt ?? '').localeCompare(b.lastAuditedAt ?? '') ||
        (a.code ?? a.nameEn).localeCompare(b.code ?? b.nameEn),
    );
  }

  /** Engagement row for the report (raw). */
  async reportData(id: string, user: AuthUser) {
    if (!this.reads(user)) throw notFound('Engagement');
    return this.get(id, user);
  }
}
