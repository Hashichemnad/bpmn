import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  OPEN_ISSUE_STATUSES,
  PERMISSIONS,
  ageBucket,
  issueTransition,
  type CreateIssueInput,
  type IssueAction,
  type IssueActionDto,
  type IssueActionInput,
  type IssueDetailDto,
  type IssueDto,
  type IssueListQuery,
  type IssueSource,
  type IssueStatus,
  type IssueTransitionInput,
  type Paginated,
  type UpdateIssueInput,
  type UserRef,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { badRequest, conflict, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { GrcService } from '../grc/grc.service';
import { elementLabel } from '../models/bpmn-xml';
import { itemLink } from '../governance/content.service';
import { AssuranceFilesService } from './assurance-files.service';
import { AssuranceEventsService } from './assurance-events.service';
import { AssuranceSettingsService } from './assurance-settings.service';
import { AssigneeResolver } from './assignees';
import { compareNatural } from '../common/compare';

const ENTITY = 'Issue';
const userSelect = { id: true, email: true, nameEn: true, nameAr: true } as const;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const day = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
const toDay = (v: string | null | undefined) => (v === undefined ? undefined : v ? day(v) : null);
const DAY = 86_400_000;
const issueLink = (id: string) => `/grc/issues/${id}`;

type IssueRow = Prisma.IssueGetPayload<{ include: { actions: true } }>;
type ActionRow = IssueRow['actions'][number];

/** What a source contributes to a new issue (defaults for the links). */
export interface SourceInfo {
  link: string | null;
  defaults: Partial<
    Pick<
      CreateIssueInput,
      'processId' | 'bpmnElementId' | 'riskId' | 'controlId' | 'requirementId' | 'departmentId'
    >
  >;
}

/**
 * Issues and action plans (Phase 4.2, D-100). Raised from a failed test, a risk assessment, an
 * audit finding, portal feedback or by hand; owners work through actions; the raiser (or a Risk &
 * Compliance officer) verifies the fix; a risk may be accepted with a justification instead.
 */
@Injectable()
export class IssuesService implements OnModuleInit {
  /** Sources registered by other features (audit findings). */
  private readonly sources = new Map<IssueSource, (id: string) => Promise<SourceInfo | null>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly grc: GrcService,
    private readonly files: AssuranceFilesService,
    private readonly events: AssuranceEventsService,
    private readonly settings: AssuranceSettingsService,
    private readonly assignees: AssigneeResolver,
  ) {}

  onModuleInit() {
    this.files.register('ISSUE', {
      canRead: async (id, user) => !!(await this.readable(id, user)),
      canWrite: async (id, user) => {
        const i = await this.readable(id, user);
        return !!i && this.canEdit(i, user);
      },
    });
    this.files.register('ISSUE_ACTION', {
      canRead: async (id, user) => {
        const a = await this.prisma.issueAction.findFirst({ where: { id, deletedAt: null } });
        return !!a && !!(await this.readable(a.issueId, user));
      },
      canWrite: async (id, user) => {
        const a = await this.prisma.issueAction.findFirst({ where: { id, deletedAt: null } });
        const i = a && (await this.readable(a.issueId, user));
        return !!a && !!i && this.mayUpdateAction(i, a, user);
      },
    });
    this.sources.set('CONTROL_TEST', async (id) => {
      const t = await this.prisma.controlTest.findFirst({
        where: { id, deletedAt: null },
        include: { control: true },
      });
      return t
        ? {
            link: `/grc/tests/${id}`,
            defaults: { controlId: t.controlId, departmentId: t.control.departmentId },
          }
        : null;
    });
    this.sources.set('RISK_ASSESSMENT', async (id) => {
      const r = await this.prisma.risk.findFirst({
        where: { objectId: id, object: { deletedAt: null } },
      });
      return r
        ? { link: `/grc/risks/${id}`, defaults: { riskId: id, departmentId: r.departmentId } }
        : null;
    });
    this.sources.set('FEEDBACK', async (id) => {
      const f = await this.prisma.feedback.findUnique({ where: { id } });
      if (!f) return null;
      if (f.entityType === 'PROCESS') {
        const p = await this.prisma.process.findFirst({
          where: { id: f.entityId, deletedAt: null },
        });
        return {
          link: itemLink({ type: 'PROCESS', id: f.entityId }),
          defaults: p ? { processId: p.id, departmentId: p.departmentId } : {},
        };
      }
      const page = await this.prisma.page.findUnique({ where: { id: f.entityId } });
      return {
        link: page ? itemLink({ type: 'PAGE', id: page.id, spaceId: page.spaceId }) : null,
        defaults: {},
      };
    });
  }

  /** Lets another feature (audit findings) be the source of issues. */
  registerSource(type: IssueSource, resolve: (id: string) => Promise<SourceInfo | null>) {
    this.sources.set(type, resolve);
  }

  // ---------- Access ----------

  private manages(user: AuthUser) {
    return user.permissions.has(PERMISSIONS.ISSUES_MANAGE);
  }
  private officer(user: AuthUser) {
    return user.permissions.has(PERMISSIONS.GRC_EDIT);
  }

  private canReadRow(i: IssueRow, user: AuthUser) {
    return (
      user.permissions.has(PERMISSIONS.GRC_READ) ||
      this.manages(user) ||
      i.ownerId === user.id ||
      i.createdById === user.id ||
      i.actions.some((a) => !a.deletedAt && a.ownerId === user.id)
    );
  }

  private async readable(id: string, user: AuthUser) {
    const i = await this.prisma.issue.findFirst({
      where: { id, deletedAt: null },
      include: { actions: true },
    });
    return i && this.canReadRow(i, user) ? i : null;
  }

  private canEdit(i: { status: string; ownerId: string | null }, user: AuthUser) {
    return (
      OPEN_ISSUE_STATUSES.includes(i.status as IssueStatus) &&
      (this.manages(user) || i.ownerId === user.id)
    );
  }

  private mayUpdateAction(i: IssueRow, a: ActionRow, user: AuthUser) {
    return (
      OPEN_ISSUE_STATUSES.includes(i.status as IssueStatus) &&
      (this.manages(user) || i.ownerId === user.id || a.ownerId === user.id)
    );
  }

  private allowed(i: IssueRow, user: AuthUser): IssueAction[] {
    const status = i.status as IssueStatus;
    const ownerOrManager = this.manages(user) || i.ownerId === user.id;
    // Four-eyes: whoever owns the fix never verifies it or accepts the risk.
    const verifier = (i.createdById === user.id || this.officer(user)) && i.ownerId !== user.id;
    const out: IssueAction[] = [];
    const can = (a: IssueAction, ok: boolean) => ok && issueTransition(status, a) && out.push(a);
    can('START', ownerOrManager);
    can('READY', ownerOrManager);
    can('VERIFY', verifier);
    can('REJECT_VERIFICATION', verifier);
    can('ACCEPT_RISK', this.officer(user) && i.ownerId !== user.id);
    can('REOPEN', this.manages(user) || this.officer(user));
    return out;
  }

  // ---------- DTOs ----------

  private async toDtos(rows: IssueRow[], user: AuthUser, now = new Date()): Promise<IssueDto[]> {
    const ids = <K extends keyof IssueRow>(k: K) =>
      [
        ...new Set(rows.map((r) => r[k]).filter((v): v is NonNullable<IssueRow[K]> => !!v)),
      ] as string[];
    const [users, objects, processes, departments, labels, sources] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          id: {
            in: [
              ...ids('ownerId'),
              ...ids('createdById'),
              ...ids('acceptedById'),
              ...ids('verifiedById'),
            ],
          },
        },
        select: userSelect,
      }),
      this.prisma.repoObject.findMany({
        where: { id: { in: [...ids('riskId'), ...ids('controlId'), ...ids('requirementId')] } },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.prisma.process.findMany({
        where: { id: { in: ids('processId') } },
        select: { id: true, code: true, nameEn: true, nameAr: true, status: true },
      }),
      this.prisma.department.findMany({
        where: { id: { in: ids('departmentId') } },
        select: { id: true, nameEn: true, nameAr: true },
      }),
      this.grc.labels(ids('processId')),
      Promise.all(
        rows.map(async (r) =>
          r.sourceId
            ? ((await this.sources.get(r.sourceType as IssueSource)?.(r.sourceId))?.link ?? null)
            : null,
        ),
      ),
    ]);
    const u = new Map<string, UserRef>(users.map((x) => [x.id, x]));
    const o = new Map(objects.map((x) => [x.id, x]));
    const p = new Map(processes.map((x) => [x.id, x]));
    const d = new Map(departments.map((x) => [x.id, x]));
    const get = <T>(m: Map<string, T>, id: string | null) => (id ? (m.get(id) ?? null) : null);
    return rows.map((r, idx) => {
      const actions = r.actions.filter((a) => !a.deletedAt);
      const el =
        r.processId && r.bpmnElementId
          ? elementLabel(labels.get(r.processId) ?? new Map(), r.bpmnElementId)
          : null;
      return {
        id: r.id,
        code: r.code,
        titleEn: r.titleEn,
        titleAr: r.titleAr,
        descriptionEn: r.descriptionEn,
        descriptionAr: r.descriptionAr,
        sourceType: r.sourceType as IssueSource,
        sourceId: r.sourceId,
        sourceLink: sources[idx],
        severity: r.severity,
        status: r.status as IssueStatus,
        owner: get(u, r.ownerId),
        raisedBy: get(u, r.createdById),
        dueAt: iso(r.dueAt),
        overdue:
          OPEN_ISSUE_STATUSES.includes(r.status as IssueStatus) && !!r.dueAt && r.dueAt < now,
        ageDays: Math.floor(((r.closedAt ?? now).getTime() - r.createdAt.getTime()) / DAY),
        process: get(p, r.processId),
        bpmnElementId: r.bpmnElementId,
        elementLabel: el ? { nameEn: el.nameEn, nameAr: el.nameAr } : null,
        risk: get(o, r.riskId),
        control: get(o, r.controlId),
        requirement: get(o, r.requirementId),
        department: get(d, r.departmentId),
        actionCount: actions.length,
        actionsDone: actions.filter((a) => a.progress >= 100).length,
        progress: actions.length
          ? Math.round(actions.reduce((n, a) => n + a.progress, 0) / actions.length)
          : 0,
        acceptanceJustification: r.acceptanceJustification,
        acceptedBy: get(u, r.acceptedById),
        acceptedAt: iso(r.acceptedAt),
        verifiedBy: get(u, r.verifiedById),
        verifiedAt: iso(r.verifiedAt),
        closedAt: iso(r.closedAt),
        escalatedAt: iso(r.escalatedAt),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        allowed: this.allowed(r, user),
        canEdit: this.canEdit(r, user),
      };
    });
  }

  private async actionDtos(
    i: IssueRow,
    user: AuthUser,
    now = new Date(),
  ): Promise<IssueActionDto[]> {
    const actions = i.actions.filter((a) => !a.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder);
    const [users, files] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: actions.map((a) => a.ownerId).filter((v): v is string => !!v) } },
        select: userSelect,
      }),
      this.files.list(
        'ISSUE_ACTION',
        actions.map((a) => a.id),
      ),
    ]);
    const u = new Map(users.map((x) => [x.id, x]));
    return actions.map((a) => ({
      id: a.id,
      issueId: a.issueId,
      titleEn: a.titleEn,
      titleAr: a.titleAr,
      note: a.note,
      owner: a.ownerId ? (u.get(a.ownerId) ?? null) : null,
      dueAt: iso(a.dueAt),
      progress: a.progress,
      done: a.progress >= 100,
      overdue: a.progress < 100 && !!a.dueAt && a.dueAt < now,
      completedAt: iso(a.completedAt),
      files: files.filter((f) => f.ownerId === a.id),
      canUpdate: this.mayUpdateAction(i, a, user),
    }));
  }

  // ---------- Queries ----------

  private async row(id: string): Promise<IssueRow> {
    const i = await this.prisma.issue.findFirst({
      where: { id, deletedAt: null },
      include: { actions: true },
    });
    if (!i) throw notFound('Issue');
    return i;
  }

  async get(id: string, user: AuthUser): Promise<IssueDetailDto> {
    const i = await this.row(id);
    if (!this.canReadRow(i, user)) throw notFound('Issue');
    const [dto] = await this.toDtos([i], user);
    return {
      ...dto,
      actions: await this.actionDtos(i, user),
      files: await this.files.list('ISSUE', [id]),
      events: await this.events.list(ENTITY, id),
    };
  }

  async list(q: IssueListQuery, user: AuthUser): Promise<Paginated<IssueDto>> {
    const now = new Date();
    const where: Prisma.IssueWhereInput = {
      deletedAt: null,
      status:
        q.status ??
        (q.open === undefined
          ? undefined
          : q.open
            ? { in: [...OPEN_ISSUE_STATUSES] }
            : { in: ['CLOSED', 'ACCEPTED_RISK'] }),
      severity: q.severity,
      sourceType: q.sourceType,
      sourceId: q.sourceId,
      ownerId: q.ownerId,
      processId: q.processId,
      controlId: q.controlId,
      riskId: q.riskId,
      departmentId: q.departmentId,
      ...(q.q
        ? {
            OR: [
              { code: { contains: q.q, mode: 'insensitive' } },
              { titleEn: { contains: q.q, mode: 'insensitive' } },
              { titleAr: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(q.overdue ? { status: { in: [...OPEN_ISSUE_STATUSES] }, dueAt: { lt: now } } : {}),
      ...(q.mine
        ? {
            AND: [
              {
                OR: [
                  { ownerId: user.id },
                  { actions: { some: { ownerId: user.id, deletedAt: null } } },
                ],
              },
            ],
          }
        : {}),
    };
    let rows = await this.prisma.issue.findMany({ where, include: { actions: true } });
    rows = rows.filter((r) => this.canReadRow(r, user));
    if (q.ageBucket)
      rows = rows.filter(
        (r) =>
          ageBucket(Math.floor(((r.closedAt ?? now).getTime() - r.createdAt.getTime()) / DAY)) ===
          q.ageBucket,
      );
    const settings = await this.settings.get();
    const rank = (k: string) => settings.severities.findIndex((s) => s.key === k);
    const dir = q.order === 'desc' ? -1 : 1;
    const key = (r: IssueRow): string | number =>
      q.sort === 'severity'
        ? rank(r.severity)
        : q.sort === 'status'
          ? r.status
          : q.sort === 'dueAt'
            ? (r.dueAt?.toISOString() ?? '9999')
            : q.sort === 'code'
              ? r.code
              : r.createdAt.toISOString();
    rows.sort((a, b) => {
      const va = key(a);
      const vb = key(b);
      return (
        (typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : compareNatural(String(va), String(vb))) * dir
      );
    });
    const start = (q.page - 1) * q.pageSize;
    return {
      items: await this.toDtos(rows.slice(start, start + q.pageSize), user, now),
      total: rows.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** My tasks: open issues and actions the user owns, issues waiting for their verification. */
  async myTasks(user: AuthUser) {
    const rows = await this.prisma.issue.findMany({
      where: {
        deletedAt: null,
        status: { in: [...OPEN_ISSUE_STATUSES] },
        OR: [
          { ownerId: user.id },
          { createdById: user.id },
          { actions: { some: { ownerId: user.id, deletedAt: null } } },
          ...(this.officer(user) ? [{ status: 'READY_FOR_VERIFICATION' }] : []),
        ],
      },
      include: { actions: true },
      orderBy: { dueAt: 'asc' },
    });
    const owned = rows.filter(
      (r) => r.ownerId === user.id && r.status !== 'READY_FOR_VERIFICATION',
    );
    const verify = rows.filter((r) => this.allowed(r, user).includes('VERIFY'));
    const actions = [];
    for (const r of rows) {
      const mine = (await this.actionDtos(r, user)).filter(
        (a) => a.owner?.id === user.id && !a.done,
      );
      actions.push(
        ...mine.map((a) => ({
          ...a,
          issue: { id: r.id, code: r.code, titleEn: r.titleEn, titleAr: r.titleAr },
        })),
      );
    }
    return {
      issues: await this.toDtos(owned, user),
      issueActions: actions,
      issuesToVerify: await this.toDtos(verify, user),
    };
  }

  // ---------- Changes ----------

  private async assertRefs(input: Partial<CreateIssueInput>, severities?: string[]) {
    if (input.severity && severities && !severities.includes(input.severity))
      throw badRequest('INVALID_SEVERITY');
    const users = [input.ownerId, ...(input.actions ?? []).map((a) => a.ownerId)].filter(
      (v): v is string => !!v,
    );
    if (users.length) {
      const n = await this.prisma.user.count({
        where: { id: { in: [...new Set(users)] }, deletedAt: null },
      });
      if (n !== new Set(users).size) throw badRequest('INVALID_USER');
    }
    const object = async (
      id: string | null | undefined,
      type: 'RISK' | 'CONTROL' | 'REQUIREMENT',
    ) => {
      if (!id) return;
      if (!(await this.prisma.repoObject.count({ where: { id, type, deletedAt: null } })))
        throw badRequest(`INVALID_${type}_REFERENCE`);
    };
    await object(input.riskId, 'RISK');
    await object(input.controlId, 'CONTROL');
    await object(input.requirementId, 'REQUIREMENT');
    if (
      input.processId &&
      !(await this.prisma.process.count({ where: { id: input.processId, deletedAt: null } }))
    )
      throw badRequest('INVALID_PROCESS');
    if (
      input.departmentId &&
      !(await this.prisma.department.count({ where: { id: input.departmentId, deletedAt: null } }))
    )
      throw badRequest('INVALID_DEPARTMENT');
  }

  /** Raises an issue (API or another feature, e.g. an accepted audit finding). */
  async create(input: CreateIssueInput, actor: AuthUser | null, meta?: RequestMeta) {
    const settings = await this.settings.get();
    let defaults: SourceInfo['defaults'] = {};
    if (input.sourceType !== 'MANUAL') {
      const info = await this.sources.get(input.sourceType)?.(input.sourceId!);
      if (!info) throw badRequest('INVALID_SOURCE');
      defaults = info.defaults;
    }
    const data = {
      ...defaults,
      ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    } as CreateIssueInput;
    await this.assertRefs(
      data,
      settings.severities.map((s) => s.key),
    );
    let id = '';
    for (let attempt = 0; attempt < 5 && !id; attempt++) {
      try {
        id = await this.prisma.$transaction(async (tx) => {
          const n = await tx.issue.count();
          const code = `ISS-${String(n + 1 + attempt).padStart(4, '0')}`;
          const i = await tx.issue.create({
            data: {
              code,
              titleEn: data.titleEn ?? '',
              titleAr: data.titleAr ?? '',
              descriptionEn: data.descriptionEn ?? '',
              descriptionAr: data.descriptionAr ?? '',
              sourceType: data.sourceType,
              sourceId: data.sourceId ?? null,
              severity: data.severity,
              ownerId: data.ownerId ?? null,
              dueAt: data.dueAt ? day(data.dueAt) : null,
              processId: data.processId ?? null,
              bpmnElementId: data.bpmnElementId ?? null,
              riskId: data.riskId ?? null,
              controlId: data.controlId ?? null,
              requirementId: data.requirementId ?? null,
              departmentId: data.departmentId ?? null,
              createdById: actor?.id ?? null,
              updatedById: actor?.id ?? null,
              actions: {
                create: (data.actions ?? []).map((a, i) => ({
                  titleEn: a.titleEn ?? '',
                  titleAr: a.titleAr ?? '',
                  ownerId: a.ownerId ?? null,
                  dueAt: a.dueAt ? day(a.dueAt) : null,
                  sortOrder: i,
                  createdById: actor?.id ?? null,
                })),
              },
            },
          });
          await this.events.add(
            tx,
            ENTITY,
            i.id,
            'CREATED',
            { status: { from: null, to: 'OPEN' } },
            '',
            actor?.id ?? null,
          );
          await this.audit.log(
            {
              action: 'CREATE',
              entityType: 'Issue',
              entityId: i.id,
              userId: actor?.id ?? null,
              summary: {
                after: {
                  code,
                  severity: i.severity,
                  sourceType: i.sourceType,
                  sourceId: i.sourceId,
                },
              },
              meta,
            },
            tx,
          );
          return i.id;
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    if (!id) throw conflict('CONFLICT');
    const created = await this.row(id);
    await this.notify(created, 'assigned', [created.ownerId], actor?.id ?? null);
    for (const a of created.actions)
      await this.notify(created, 'action_assigned', [a.ownerId], actor?.id ?? null, a);
    return id;
  }

  async update(id: string, input: UpdateIssueInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.row(id);
    if (!this.canReadRow(before, actor)) throw notFound('Issue');
    if (!this.canEdit(before, actor)) throw forbidden();
    // Owners update the content of their issue; only issue managers move ownership and severity.
    if (!this.manages(actor) && (input.ownerId !== undefined || input.severity !== undefined))
      throw forbidden('Only issue managers change the owner or the severity');
    const settings = await this.settings.get();
    await this.assertRefs(
      input,
      settings.severities.map((s) => s.key),
    );
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.issue.update({
        where: { id },
        data: {
          titleEn: input.titleEn,
          titleAr: input.titleAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          severity: input.severity,
          ownerId: input.ownerId,
          dueAt: toDay(input.dueAt),
          processId: input.processId,
          bpmnElementId: input.bpmnElementId,
          riskId: input.riskId,
          controlId: input.controlId,
          requirementId: input.requirementId,
          departmentId: input.departmentId,
          updatedById: actor.id,
          // A new due date restarts the reminders and the escalation.
          ...(input.dueAt !== undefined
            ? { dueNotifiedAt: null, overdueNotifiedAt: null, escalatedAt: null }
            : {}),
        },
      });
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const k of ['severity', 'ownerId', 'dueAt', 'titleEn', 'titleAr'] as const) {
        const a = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k];
        const b = after[k] instanceof Date ? (after[k] as Date).toISOString() : after[k];
        if (a !== b) changes[k] = { from: a, to: b };
      }
      if (Object.keys(changes).length)
        await this.events.add(tx, ENTITY, id, 'UPDATED', changes, '', actor.id);
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Issue',
          entityId: id,
          userId: actor.id,
          summary: { changes },
          meta,
        },
        tx,
      );
    });
    if (input.ownerId && input.ownerId !== before.ownerId)
      await this.notify(await this.row(id), 'assigned', [input.ownerId], actor.id);
    return this.get(id, actor);
  }

  async transition(id: string, input: IssueTransitionInput, actor: AuthUser, meta: RequestMeta) {
    const i = await this.row(id);
    if (!this.canReadRow(i, actor)) throw notFound('Issue');
    const to = issueTransition(i.status as IssueStatus, input.action);
    if (!to) throw conflict('INVALID_TRANSITION');
    if (!this.allowed(i, actor).includes(input.action)) throw forbidden();
    const open = i.actions.filter((a) => !a.deletedAt && a.progress < 100);
    if ((input.action === 'READY' || input.action === 'VERIFY') && open.length)
      throw badRequest('ACTIONS_OPEN', 'Every action must be done first', { count: open.length });
    const now = new Date();
    const data: Prisma.IssueUpdateManyMutationInput = { status: to, updatedById: actor.id };
    if (input.action === 'VERIFY')
      Object.assign(data, { verifiedById: actor.id, verifiedAt: now, closedAt: now });
    if (input.action === 'ACCEPT_RISK')
      Object.assign(data, {
        acceptanceJustification: input.comment,
        acceptedById: actor.id,
        acceptedAt: now,
        closedAt: now,
      });
    if (input.action === 'REOPEN')
      Object.assign(data, {
        closedAt: null,
        verifiedAt: null,
        verifiedById: null,
        acceptedAt: null,
        acceptedById: null,
      });
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.issue.updateMany({ where: { id, status: i.status }, data });
      if (!res.count) throw conflict('INVALID_TRANSITION');
      await this.events.add(
        tx,
        ENTITY,
        id,
        'STATUS',
        { status: { from: i.status, to } },
        input.comment,
        actor.id,
      );
      await this.audit.log(
        {
          action:
            input.action === 'VERIFY' || input.action === 'ACCEPT_RISK'
              ? 'APPROVE'
              : input.action === 'REJECT_VERIFICATION'
                ? 'REQUEST_CHANGES'
                : input.action === 'READY'
                  ? 'SUBMIT'
                  : input.action === 'REOPEN'
                    ? 'REOPEN'
                    : 'UPDATE',
          entityType: 'Issue',
          entityId: id,
          userId: actor.id,
          summary: {
            action: input.action,
            status: { from: i.status, to },
            comment: input.comment || null,
          },
          meta,
        },
        tx,
      );
    });
    const kind = {
      READY: 'ready',
      VERIFY: 'closed',
      REJECT_VERIFICATION: 'returned',
      ACCEPT_RISK: 'accepted',
      REOPEN: 'reopened',
      START: null,
    }[input.action];
    if (kind) {
      const recipients =
        kind === 'ready'
          ? [
              i.createdById,
              ...(await this.assignees.userIds(
                { userId: null, roleKey: null },
                PERMISSIONS.GRC_EDIT,
              )),
            ]
          : [i.ownerId, i.createdById];
      await this.notify(i, kind, recipients, actor.id, undefined, input.comment);
    }
    return this.get(id, actor);
  }

  // ---------- Actions ----------

  async addAction(id: string, input: IssueActionInput, actor: AuthUser, meta: RequestMeta) {
    const i = await this.row(id);
    if (!this.canReadRow(i, actor)) throw notFound('Issue');
    if (!this.canEdit(i, actor)) throw forbidden();
    if (!input.titleEn && !input.titleAr) throw badRequest('NAME_REQUIRED');
    await this.assertRefs({ ownerId: input.ownerId });
    const progress = input.progress ?? 0;
    const a = await this.prisma.$transaction(async (tx) => {
      const row = await tx.issueAction.create({
        data: {
          issueId: id,
          titleEn: input.titleEn ?? '',
          titleAr: input.titleAr ?? '',
          note: input.note ?? '',
          ownerId: input.ownerId ?? null,
          dueAt: input.dueAt ? day(input.dueAt) : null,
          progress,
          completedAt: progress >= 100 ? new Date() : null,
          sortOrder: i.actions.length,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.events.add(
        tx,
        ENTITY,
        id,
        'UPDATED',
        { action: { from: null, to: row.titleEn || row.titleAr } },
        '',
        actor.id,
      );
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'IssueAction',
          entityId: row.id,
          userId: actor.id,
          summary: { issueId: id, title: row.titleEn || row.titleAr },
          meta,
        },
        tx,
      );
      return row;
    });
    await this.notify(i, 'action_assigned', [a.ownerId], actor.id, a);
    return this.get(id, actor);
  }

  private async actionRow(actionId: string) {
    const a = await this.prisma.issueAction.findFirst({ where: { id: actionId, deletedAt: null } });
    if (!a) throw notFound('Action');
    return { a, i: await this.row(a.issueId) };
  }

  /** Action owners update progress and the note; issue owners / managers change anything. */
  async updateAction(
    actionId: string,
    input: IssueActionInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const { a, i } = await this.actionRow(actionId);
    if (!this.canReadRow(i, actor)) throw notFound('Action');
    if (!this.mayUpdateAction(i, a, actor)) throw forbidden();
    const planner = this.canEdit(i, actor);
    if (
      !planner &&
      (input.titleEn !== undefined ||
        input.titleAr !== undefined ||
        input.ownerId !== undefined ||
        input.dueAt !== undefined)
    )
      throw forbidden('Only the issue owner changes the plan');
    await this.assertRefs({ ownerId: input.ownerId });
    const progress = input.progress;
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.issueAction.update({
        where: { id: actionId },
        data: {
          titleEn: input.titleEn,
          titleAr: input.titleAr,
          note: input.note,
          ownerId: input.ownerId,
          dueAt: toDay(input.dueAt),
          progress,
          ...(progress !== undefined
            ? { completedAt: progress >= 100 ? (a.completedAt ?? new Date()) : null }
            : {}),
          ...(input.dueAt !== undefined
            ? { dueNotifiedAt: null, overdueNotifiedAt: null, escalatedAt: null }
            : {}),
          updatedById: actor.id,
        },
      });
      if (progress !== undefined && progress !== a.progress)
        await this.events.add(
          tx,
          ENTITY,
          i.id,
          'UPDATED',
          { progress: { from: a.progress, to: progress } },
          `${after.titleEn || after.titleAr}${input.note ? ` — ${input.note}` : ''}`,
          actor.id,
        );
      // Work starts with the first progress.
      if (i.status === 'OPEN' && (progress ?? 0) > 0)
        await tx.issue.updateMany({
          where: { id: i.id, status: 'OPEN' },
          data: { status: 'IN_PROGRESS' },
        });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'IssueAction',
          entityId: actionId,
          userId: actor.id,
          summary: { issueId: i.id, progress: { from: a.progress, to: after.progress } },
          meta,
        },
        tx,
      );
    });
    if (input.ownerId && input.ownerId !== a.ownerId)
      await this.notify(i, 'action_assigned', [input.ownerId], actor.id, a);
    return this.get(i.id, actor);
  }

  async removeAction(actionId: string, actor: AuthUser, meta: RequestMeta) {
    const { a, i } = await this.actionRow(actionId);
    if (!this.canReadRow(i, actor)) throw notFound('Action');
    if (!this.canEdit(i, actor)) throw forbidden();
    await this.prisma.$transaction(async (tx) => {
      await tx.issueAction.update({ where: { id: actionId }, data: { deletedAt: new Date() } });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'IssueAction',
          entityId: actionId,
          userId: actor.id,
          summary: { issueId: i.id, title: a.titleEn || a.titleAr },
          meta,
        },
        tx,
      );
    });
    return this.get(i.id, actor);
  }

  async uploadIssueFile(
    id: string,
    file: Express.Multer.File | undefined,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const i = await this.row(id);
    if (!this.canReadRow(i, actor)) throw notFound('Issue');
    if (!this.canEdit(i, actor)) throw forbidden();
    return this.files.upload('ISSUE', id, file, actor, meta, ENTITY);
  }

  async uploadActionFile(
    actionId: string,
    file: Express.Multer.File | undefined,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const { a, i } = await this.actionRow(actionId);
    if (!this.canReadRow(i, actor)) throw notFound('Action');
    if (!this.mayUpdateAction(i, a, actor)) throw forbidden();
    const f = await this.files.upload('ISSUE_ACTION', actionId, file, actor, meta, 'IssueAction');
    await this.prisma.assuranceEvent.create({
      data: {
        entityType: ENTITY,
        entityId: i.id,
        kind: 'FILE',
        changes: { file: { from: null, to: f.fileName } },
        createdById: actor.id,
      },
    });
    return f;
  }

  async comment(id: string, body: string, actor: AuthUser, meta: RequestMeta) {
    const i = await this.row(id);
    if (!this.canReadRow(i, actor)) throw notFound('Issue');
    await this.prisma.$transaction(async (tx) => {
      const e = await this.events.add(tx, ENTITY, id, 'COMMENT', {}, body, actor.id);
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Issue',
          entityId: id,
          userId: actor.id,
          summary: { comment: e.id },
          meta,
        },
        tx,
      );
    });
    return this.events.list(ENTITY, id);
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const i = await this.row(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.issue.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Issue',
          entityId: id,
          userId: actor.id,
          summary: { code: i.code },
          meta,
        },
        tx,
      );
    });
  }

  // ---------- Notifications, reminders, escalation ----------

  private notify(
    i: { id: string; code: string; titleEn: string; titleAr: string; dueAt: Date | null },
    kind: string,
    userIds: (string | null)[],
    actorId: string | null,
    action?: { titleEn: string; titleAr: string; dueAt: Date | null } | null,
    comment?: string,
    dedupeKey?: string,
  ) {
    return this.notifications.notify({
      userIds,
      type: 'ISSUE',
      actorId,
      params: {
        kind,
        code: i.code,
        titleEn: i.titleEn,
        titleAr: i.titleAr,
        ...(action ? { stepEn: action.titleEn, stepAr: action.titleAr } : {}),
        due: (action?.dueAt ?? i.dueAt)?.toISOString() ?? '',
        ...(comment ? { comment } : {}),
      },
      link: issueLink(i.id),
      dedupeKey,
    });
  }

  /** Recipients of an escalation: the owner's department manager and / or the GRC officers. */
  private async escalationTargets(
    ownerId: string | null,
    escalateTo: 'MANAGER' | 'RISK_OFFICER' | 'BOTH',
  ) {
    const out: string[] = [];
    if (escalateTo !== 'RISK_OFFICER' && ownerId) {
      const owner = await this.prisma.user.findUnique({
        where: { id: ownerId },
        select: { department: { select: { managerId: true } } },
      });
      if (owner?.department?.managerId && owner.department.managerId !== ownerId)
        out.push(owner.department.managerId);
    }
    if (escalateTo !== 'MANAGER' || !out.length)
      out.push(
        ...(await this.assignees.userIds({ userId: null, roleKey: null }, PERMISSIONS.GRC_EDIT)),
      );
    return out;
  }

  async runScheduler(now: Date) {
    const s = await this.settings.get();
    const soon = new Date(now.getTime() + s.reminderDaysBefore * DAY);
    const late = new Date(now.getTime() - s.escalationDays * DAY);
    const stamp = (d: Date) => d.toISOString().slice(0, 10);
    let sent = 0;
    const issues = await this.prisma.issue.findMany({
      where: { deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lte: soon } },
    });
    for (const i of issues) {
      const due = i.dueAt!;
      if (due < late && !i.escalatedAt) {
        sent += await this.notify(
          i,
          'escalated',
          await this.escalationTargets(i.ownerId, s.escalateTo),
          null,
          null,
          undefined,
          `ISSUE:escalated:${i.id}:${stamp(due)}`,
        );
        await this.prisma.issue.update({ where: { id: i.id }, data: { escalatedAt: now } });
        await this.prisma.assuranceEvent.create({
          data: {
            entityType: ENTITY,
            entityId: i.id,
            kind: 'UPDATED',
            changes: { escalated: { from: null, to: stamp(now) } },
          },
        });
      } else if (due <= now && !i.overdueNotifiedAt) {
        sent += await this.notify(
          i,
          'overdue',
          [i.ownerId],
          null,
          null,
          undefined,
          `ISSUE:overdue:${i.id}:${stamp(due)}`,
        );
        await this.prisma.issue.update({ where: { id: i.id }, data: { overdueNotifiedAt: now } });
      } else if (due > now && !i.dueNotifiedAt) {
        sent += await this.notify(
          i,
          'due',
          [i.ownerId],
          null,
          null,
          undefined,
          `ISSUE:due:${i.id}:${stamp(due)}`,
        );
        await this.prisma.issue.update({ where: { id: i.id }, data: { dueNotifiedAt: now } });
      }
    }
    const actions = await this.prisma.issueAction.findMany({
      where: {
        deletedAt: null,
        progress: { lt: 100 },
        dueAt: { lte: soon },
        issue: { deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      },
      include: { issue: true },
    });
    for (const a of actions) {
      const due = a.dueAt!;
      if (due < late && !a.escalatedAt) {
        sent += await this.notify(
          a.issue,
          'action_escalated',
          await this.escalationTargets(a.ownerId, s.escalateTo),
          null,
          a,
          undefined,
          `ISSUE:action_escalated:${a.id}:${stamp(due)}`,
        );
        await this.prisma.issueAction.update({ where: { id: a.id }, data: { escalatedAt: now } });
      } else if (due <= now && !a.overdueNotifiedAt) {
        sent += await this.notify(
          a.issue,
          'action_overdue',
          [a.ownerId],
          null,
          a,
          undefined,
          `ISSUE:action_overdue:${a.id}:${stamp(due)}`,
        );
        await this.prisma.issueAction.update({
          where: { id: a.id },
          data: { overdueNotifiedAt: now },
        });
      } else if (due > now && !a.dueNotifiedAt) {
        sent += await this.notify(
          a.issue,
          'action_due',
          [a.ownerId],
          null,
          a,
          undefined,
          `ISSUE:action_due:${a.id}:${stamp(due)}`,
        );
        await this.prisma.issueAction.update({ where: { id: a.id }, data: { dueNotifiedAt: now } });
      }
    }
    return sent;
  }
}
