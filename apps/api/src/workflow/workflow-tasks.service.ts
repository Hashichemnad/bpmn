import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  APPROVAL_OUTCOMES,
  PERMISSIONS,
  formSchema,
  initialFormValues,
  validateFormData,
  type ApprovalOutcome,
  type CompleteTaskInput,
  type OutOfOfficeDto,
  type OutOfOfficeInput,
  type Paginated,
  type TaskListQuery,
  type UserRef,
  type WfTaskDetailDto,
  type WfTaskStatus,
  type WfTaskSummaryDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { badRequest, conflict, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { pageArgs, paginated } from '../common/pagination';
import { userRefSelect } from '../governance/content.service';
import { WorkflowConfigService } from './workflow-config.service';
import {
  WorkflowRunnerService,
  caseLink,
  caseTitleParams,
  taskLink,
} from './workflow-runner.service';
import { WorkflowSettingsService } from './workflow-settings.service';
import { WorkflowCasesService } from './workflow-cases.service';
import { canMonitorProcess, isWorkflowAdmin } from './workflow-access';

const taskInclude = {
  candidates: { select: { userId: true } },
  case: {
    select: {
      id: true,
      number: true,
      titleEn: true,
      titleAr: true,
      status: true,
      initiatorId: true,
      definitionId: true,
      processId: true,
      variables: true,
      process: {
        select: { id: true, nameEn: true, nameAr: true, ownerId: true, departmentId: true },
      },
    },
  },
} satisfies Prisma.WorkflowTaskInclude;
type TaskRow = Prisma.WorkflowTaskGetPayload<{ include: typeof taskInclude }>;

/**
 * Workflow tasks (step 2): the inbox ("My tasks"), claim / unclaim of group tasks, completing with a
 * form and a decision (optimistic lock, four-eyes, mandatory comment on reject / return), delegation,
 * reassignment by admins, and out-of-office substitutes.
 */
@Injectable()
export class WorkflowTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: WorkflowConfigService,
    private readonly runner: WorkflowRunnerService,
    private readonly settings: WorkflowSettingsService,
    private readonly cases: WorkflowCasesService,
  ) {}

  private summary(t: TaskRow, users: Map<string, UserRef>): WfTaskSummaryDto {
    return {
      id: t.id,
      caseId: t.caseId,
      caseNumber: t.case.number,
      caseTitleEn: t.case.titleEn,
      caseTitleAr: t.case.titleAr,
      processId: t.case.processId,
      processNameEn: t.case.process.nameEn,
      processNameAr: t.case.process.nameAr,
      elementId: t.elementId,
      nameEn: t.nameEn,
      nameAr: t.nameAr,
      approval: t.approval,
      assignee: t.assigneeId ? (users.get(t.assigneeId) ?? null) : null,
      unclaimed: !t.assigneeId,
      candidateCount: t.candidates.length,
      initiator: t.case.initiatorId ? (users.get(t.case.initiatorId) ?? null) : null,
      dueAt: t.dueAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      onBehalfOf: t.onBehalfOfId ? (users.get(t.onBehalfOfId) ?? null) : null,
    };
  }

  async summaries(rows: TaskRow[]) {
    const users = await this.cases.userRefs(
      rows.flatMap((t) => [t.assigneeId, t.case.initiatorId, t.onBehalfOfId]),
    );
    return rows.map((t) => this.summary(t, users));
  }

  taskWhere(
    q: Pick<TaskListQuery, 'scope' | 'processId' | 'due' | 'q'>,
    user: AuthUser,
    extra?: Prisma.WorkflowTaskWhereInput,
  ) {
    const and: Prisma.WorkflowTaskWhereInput[] = [{ status: 'OPEN' }];
    if (q.scope === 'mine') and.push({ assigneeId: user.id });
    else if (q.scope === 'group')
      and.push({ assigneeId: null, candidates: { some: { userId: user.id } } });
    if (q.processId) and.push({ case: { processId: q.processId } });
    const now = new Date();
    if (q.due === 'overdue') and.push({ dueAt: { lt: now } });
    if (q.due === 'soon')
      and.push({ dueAt: { gte: now, lt: new Date(now.getTime() + 86_400_000) } });
    if (q.q)
      and.push({
        OR: [
          { nameEn: { contains: q.q, mode: 'insensitive' } },
          { nameAr: { contains: q.q, mode: 'insensitive' } },
          { case: { number: { contains: q.q, mode: 'insensitive' } } },
          { case: { titleEn: { contains: q.q, mode: 'insensitive' } } },
          { case: { titleAr: { contains: q.q, mode: 'insensitive' } } },
        ],
      });
    if (extra) and.push(extra);
    return { AND: and };
  }

  async list(q: TaskListQuery, user: AuthUser): Promise<Paginated<WfTaskSummaryDto>> {
    if (q.scope === 'all' && !isWorkflowAdmin(user)) throw forbidden();
    const where = this.taskWhere(q, user);
    const [rows, total] = await Promise.all([
      this.prisma.workflowTask.findMany({
        where,
        include: taskInclude,
        // Due first (nulls last), then oldest.
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        ...pageArgs(q),
      }),
      this.prisma.workflowTask.count({ where }),
    ]);
    return paginated(await this.summaries(rows), total, q);
  }

  /** Open tasks of the user (assigned + group) for the inbox counter. */
  async counts(user: AuthUser) {
    const [mine, group, overdue] = await Promise.all([
      this.prisma.workflowTask.count({ where: { status: 'OPEN', assigneeId: user.id } }),
      this.prisma.workflowTask.count({
        where: { status: 'OPEN', assigneeId: null, candidates: { some: { userId: user.id } } },
      }),
      this.prisma.workflowTask.count({
        where: { status: 'OPEN', assigneeId: user.id, dueAt: { lt: new Date() } },
      }),
    ]);
    return { mine, group, overdue };
  }

  private async load(id: string) {
    const t = await this.prisma.workflowTask.findUnique({ where: { id }, include: taskInclude });
    if (!t) throw notFound('Task');
    return t;
  }

  private async canMonitor(t: TaskRow, user: AuthUser) {
    const cfg = await this.prisma.workflowProcessConfig.findUnique({
      where: { processId: t.case.processId },
      select: { monitorUserIds: true },
    });
    return canMonitorProcess(user, t.case.process, cfg?.monitorUserIds ?? []);
  }

  /** Earlier performers and the initiator (four-eyes). */
  private async fourEyesBlocked(t: TaskRow, userId: string) {
    if (t.case.initiatorId === userId) return true;
    const done = await this.prisma.workflowTask.count({
      where: { caseId: t.caseId, status: 'COMPLETED', completedById: userId, id: { not: t.id } },
    });
    return done > 0;
  }

  async detail(id: string, user: AuthUser): Promise<WfTaskDetailDto> {
    const t = await this.load(id);
    const isCandidate = t.candidates.some((c) => c.userId === user.id);
    const mine = t.assigneeId === user.id;
    const related =
      mine || isCandidate || t.onBehalfOfId === user.id || t.completedById === user.id;
    if (!related && !(await this.canMonitor(t, user))) throw notFound('Task');
    const model = await this.config.model(t.case.definitionId);
    const node = model.nodes[t.elementId];
    const fourEyes = node?.exec.fourEyes ? await this.fourEyesBlocked(t, user.id) : false;
    const open = t.status === 'OPEN' && t.case.status === 'RUNNING';
    const def = await this.prisma.workflowDefinition.findUniqueOrThrow({
      where: { id: t.case.definitionId },
      select: { bpmnXml: true },
    });
    const form = node?.exec.form ?? null;
    const vars = (t.case.variables ?? {}) as Record<string, unknown>;
    const values = form
      ? initialFormValues(form, { ...vars, ...((t.draft as Record<string, unknown>) ?? {}) })
      : {};
    const users = await this.cases.userRefs([
      t.assigneeId,
      t.case.initiatorId,
      t.onBehalfOfId,
      ...t.candidates.map((c) => c.userId),
    ]);
    const canComplete = open && (mine || (!t.assigneeId && isCandidate)) && !fourEyes;
    const decisions: ApprovalOutcome[] = t.approval ? [...APPROVAL_OUTCOMES] : [];
    if (t.approval && node) {
      // Offer only decisions the model can route (flows mapped to outcomes, or a gateway after the task).
      const flows = node.outgoing.map((f) => model.flows[f]).filter(Boolean);
      const marked = flows.filter((f) => f.exec.outcome);
      if (marked.length && !flows.some((f) => !f.exec.outcome)) {
        decisions.splice(
          0,
          decisions.length,
          ...APPROVAL_OUTCOMES.filter((o) => marked.some((f) => f.exec.outcome === o)),
        );
      }
    }
    return {
      ...this.summary(t, users),
      status: t.status as WfTaskStatus,
      version: t.version,
      form,
      values,
      caseData: vars,
      bpmnXml: def.bpmnXml,
      canComplete,
      canClaim: open && !t.assigneeId && isCandidate,
      canUnclaim: open && mine && t.candidates.length > 0,
      canDelegate: open && mine,
      canReassign: open && isWorkflowAdmin(user),
      blockedReason: open && (mine || isCandidate) && fourEyes ? 'FOUR_EYES' : null,
      decisions,
      candidates: t.candidates.map((c) => users.get(c.userId)).filter((u): u is UserRef => !!u),
    };
  }

  async claim(id: string, user: AuthUser, meta: RequestMeta) {
    const t = await this.load(id);
    if (t.status !== 'OPEN') throw conflict('TASK_ALREADY_COMPLETED');
    if (!t.candidates.some((c) => c.userId === user.id)) throw forbidden();
    const res = await this.prisma.workflowTask.updateMany({
      where: { id, status: 'OPEN', assigneeId: null },
      data: { assigneeId: user.id, version: { increment: 1 } },
    });
    if (!res.count) throw conflict('TASK_CLAIMED_BY_OTHER');
    await this.prisma.workflowEvent.create({
      data: {
        caseId: t.caseId,
        type: 'TASK_CLAIMED',
        elementId: t.elementId,
        tokenId: t.tokenId,
        userId: user.id,
        data: { taskId: id },
      },
    });
    await this.audit.log({
      action: 'CLAIM',
      entityType: 'WorkflowTask',
      entityId: id,
      userId: user.id,
      summary: { case: t.case.number },
      meta,
    });
    return this.detail(id, user);
  }

  async unclaim(id: string, user: AuthUser, meta: RequestMeta) {
    const t = await this.load(id);
    if (t.status !== 'OPEN' || t.assigneeId !== user.id || !t.candidates.length) throw forbidden();
    await this.prisma.workflowTask.updateMany({
      where: { id, status: 'OPEN', assigneeId: user.id },
      data: { assigneeId: null, version: { increment: 1 } },
    });
    await this.prisma.workflowEvent.create({
      data: {
        caseId: t.caseId,
        type: 'TASK_UNCLAIMED',
        elementId: t.elementId,
        tokenId: t.tokenId,
        userId: user.id,
        data: { taskId: id },
      },
    });
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'WorkflowTask',
      entityId: id,
      userId: user.id,
      summary: { case: t.case.number, unclaimed: true },
      meta,
    });
    return this.detail(id, user);
  }

  /** Saves form data without completing (draft; not validated for required fields). */
  async save(id: string, data: Record<string, unknown>, user: AuthUser) {
    const t = await this.load(id);
    if (t.status !== 'OPEN' || t.assigneeId !== user.id) throw forbidden();
    const node = (await this.config.model(t.case.definitionId)).nodes[t.elementId];
    const { values, errors } = validateFormData(node?.exec.form ?? formSchema.parse({}), data, {
      draft: true,
    });
    if (errors.length) throw badRequest('FORM_INVALID', 'Form data is not valid', errors);
    await this.prisma.workflowTask.update({
      where: { id },
      data: { draft: values as Prisma.InputJsonValue },
    });
    return this.detail(id, user);
  }

  async complete(id: string, input: CompleteTaskInput, user: AuthUser, meta: RequestMeta) {
    const t = await this.load(id);
    if (t.status !== 'OPEN') throw conflict('TASK_ALREADY_COMPLETED');
    if (t.case.status !== 'RUNNING') throw conflict('CASE_NOT_RUNNING');
    const isCandidate = t.candidates.some((c) => c.userId === user.id);
    if (t.assigneeId && t.assigneeId !== user.id) {
      throw isCandidate ? conflict('TASK_CLAIMED_BY_OTHER') : forbidden('TASK_NOT_ASSIGNED');
    }
    if (!t.assigneeId && !isCandidate) throw forbidden('TASK_NOT_ASSIGNED');
    const model = await this.config.model(t.case.definitionId);
    const node = model.nodes[t.elementId];
    if (node?.exec.fourEyes && (await this.fourEyesBlocked(t, user.id)))
      throw forbidden('FOUR_EYES');
    const decision = t.approval ? input.decision : null;
    if (t.approval && !decision) throw badRequest('DECISION_REQUIRED');
    if ((decision === 'REJECT' || decision === 'RETURN') && !input.comment)
      throw badRequest('COMMENT_REQUIRED');
    const form = node?.exec.form ?? formSchema.parse({});
    // Returning or rejecting does not require the form to be complete.
    const { values, errors } = validateFormData(form, input.data, {
      draft: decision === 'REJECT' || decision === 'RETURN',
    });
    if (errors.length) throw badRequest('FORM_INVALID', 'Form data is not valid', errors);
    for (const f of form.fields) {
      const v = values[f.key];
      if (f.type === 'file' && Array.isArray(v) && v.length) {
        const n = await this.prisma.workflowFile.count({
          where: { id: { in: v as string[] }, caseId: t.caseId },
        });
        if (n !== v.length)
          throw badRequest('FORM_INVALID', 'Unknown file', [{ key: f.key, code: 'TYPE' }]);
      }
      if (f.type === 'user' && typeof v === 'string') {
        const u = await this.prisma.user.findFirst({
          where: { id: v, deletedAt: null, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!u) throw badRequest('FORM_INVALID', 'Unknown user', [{ key: f.key, code: 'TYPE' }]);
      }
    }
    const now = new Date();
    await this.runner.execute(
      t.caseId,
      { type: 'COMPLETE_TASK', tokenId: t.tokenId, decision: decision as ApprovalOutcome | null },
      {
        actorId: user.id,
        vars: { ...values, ...(input.comment ? { comment: input.comment } : {}) },
        before: async (tx) => {
          const upd = await tx.workflowTask.updateMany({
            where: { id, status: 'OPEN', version: input.version },
            data: {
              status: 'COMPLETED',
              completedAt: now,
              completedById: user.id,
              assigneeId: t.assigneeId ?? user.id,
              data: values as Prisma.InputJsonValue,
              decision,
              comment: input.comment || null,
              draft: Prisma.DbNull,
              version: { increment: 1 },
            },
          });
          if (!upd.count) throw conflict('TASK_ALREADY_COMPLETED');
          await tx.workflowJob.updateMany({
            where: {
              caseId: t.caseId,
              tokenId: t.tokenId,
              status: 'PENDING',
              kind: { in: ['REMINDER', 'ESCALATE'] },
            },
            data: { status: 'CANCELLED' },
          });
          await tx.workflowEvent.create({
            data: {
              caseId: t.caseId,
              type: 'TASK_COMPLETED',
              elementId: t.elementId,
              tokenId: t.tokenId,
              userId: user.id,
              data: {
                taskId: id,
                decision,
                comment: input.comment || null,
                onBehalfOfId: t.onBehalfOfId,
              },
            },
          });
          await this.audit.log(
            {
              action: 'COMPLETE',
              entityType: 'WorkflowTask',
              entityId: id,
              userId: user.id,
              summary: { case: t.case.number, step: t.nameEn, decision },
              meta,
            },
            tx,
          );
        },
      },
    );
    if (decision === 'RETURN')
      await this.notifications.notify({
        userIds: [t.case.initiatorId],
        type: 'WORKFLOW',
        params: {
          kind: 'returned',
          ...caseTitleParams(t.case),
          stepEn: t.nameEn,
          stepAr: t.nameAr,
          actorEn: user.nameEn || user.email,
          actorAr: user.nameAr || user.nameEn || user.email,
          comment: input.comment.slice(0, 500),
        },
        link: caseLink(t.caseId),
        actorId: user.id,
      });
    return { caseId: t.caseId };
  }

  private async activeUser(id: string) {
    const u = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!u) throw badRequest('USER_NOT_FOUND');
  }

  async delegate(id: string, userId: string, comment: string, user: AuthUser, meta: RequestMeta) {
    const t = await this.load(id);
    if (t.status !== 'OPEN' || t.assigneeId !== user.id) throw forbidden();
    if (userId === user.id) throw badRequest('SAME_USER');
    await this.activeUser(userId);
    const res = await this.prisma.workflowTask.updateMany({
      where: { id, status: 'OPEN', assigneeId: user.id },
      data: {
        assigneeId: userId,
        onBehalfOfId: t.onBehalfOfId ?? user.id,
        version: { increment: 1 },
      },
    });
    if (!res.count) throw conflict('TASK_ALREADY_COMPLETED');
    await this.prisma.workflowEvent.create({
      data: {
        caseId: t.caseId,
        type: 'TASK_DELEGATED',
        elementId: t.elementId,
        tokenId: t.tokenId,
        userId: user.id,
        data: { taskId: id, to: userId, comment },
      },
    });
    await this.audit.log({
      action: 'DELEGATE',
      entityType: 'WorkflowTask',
      entityId: id,
      userId: user.id,
      summary: { case: t.case.number, to: userId },
      meta,
    });
    await this.notifications.notify({
      userIds: [userId],
      type: 'WORKFLOW',
      params: {
        kind: 'delegated',
        ...caseTitleParams(t.case),
        stepEn: t.nameEn,
        stepAr: t.nameAr,
        actorEn: user.nameEn || user.email,
        actorAr: user.nameAr || user.nameEn || user.email,
        comment: comment.slice(0, 500),
      },
      link: taskLink(id),
      actorId: user.id,
    });
  }

  async reassign(id: string, userId: string, comment: string, user: AuthUser, meta: RequestMeta) {
    if (!isWorkflowAdmin(user)) throw forbidden();
    const t = await this.load(id);
    if (t.status !== 'OPEN') throw conflict('TASK_ALREADY_COMPLETED');
    await this.activeUser(userId);
    await this.prisma.workflowTask.update({
      where: { id },
      data: { assigneeId: userId, onBehalfOfId: null, version: { increment: 1 } },
    });
    await this.prisma.workflowEvent.create({
      data: {
        caseId: t.caseId,
        type: 'TASK_REASSIGNED',
        elementId: t.elementId,
        tokenId: t.tokenId,
        userId: user.id,
        data: { taskId: id, from: t.assigneeId, to: userId, comment },
      },
    });
    await this.audit.log({
      action: 'REASSIGN',
      entityType: 'WorkflowTask',
      entityId: id,
      userId: user.id,
      summary: { case: t.case.number, from: t.assigneeId, to: userId, comment },
      meta,
    });
    await this.notifications.notify({
      userIds: [userId],
      type: 'WORKFLOW',
      params: {
        kind: 'reassigned',
        ...caseTitleParams(t.case),
        stepEn: t.nameEn,
        stepAr: t.nameAr,
        actorEn: user.nameEn || user.email,
        actorAr: user.nameAr || user.nameEn || user.email,
        comment: comment.slice(0, 500),
      },
      link: taskLink(id),
      actorId: user.id,
    });
  }

  // ---------- Out of office ----------

  async outOfOffice(user: AuthUser): Promise<OutOfOfficeDto> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { outOfOfficeFrom: true, outOfOfficeTo: true, substituteId: true },
    });
    const sub = u.substituteId
      ? await this.prisma.user.findUnique({ where: { id: u.substituteId }, select: userRefSelect })
      : null;
    const from = u.outOfOfficeFrom?.toISOString().slice(0, 10) ?? null;
    const to = u.outOfOfficeTo?.toISOString().slice(0, 10) ?? null;
    const tz = (await this.settings.get()).calendar.timeZone;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return {
      from,
      to,
      substituteId: u.substituteId,
      substitute: sub,
      active: !!from && !!to && !!sub && from <= today && today <= to,
    };
  }

  async setOutOfOffice(input: OutOfOfficeInput, user: AuthUser, meta: RequestMeta) {
    if (input.substituteId) {
      if (input.substituteId === user.id) throw badRequest('SAME_USER');
      await this.activeUser(input.substituteId);
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        outOfOfficeFrom: input.from ? new Date(`${input.from}T00:00:00Z`) : null,
        outOfOfficeTo: input.to ? new Date(`${input.to}T00:00:00Z`) : null,
        substituteId: input.from ? input.substituteId : null,
      },
    });
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
      summary: { outOfOffice: input },
      meta,
    });
    return this.outOfOffice(user);
  }

  /** Small user lookup for delegation, reassignment, substitutes and mentions (active users only). */
  async users(q: string, user: AuthUser, ids?: string[]): Promise<UserRef[]> {
    if (ids) {
      const valid = ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i));
      // Names of the given ids only — not of deleted accounts (SEC-48).
      return this.prisma.user.findMany({
        where: { id: { in: valid.slice(0, 100) }, deletedAt: null },
        select: userRefSelect,
      });
    }
    if (q.trim().length < 2 && !user.permissions.has(PERMISSIONS.USERS_READ)) return [];
    return this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        ...(q.trim()
          ? {
              OR: [
                { nameEn: { contains: q.trim(), mode: 'insensitive' } },
                { nameAr: { contains: q.trim(), mode: 'insensitive' } },
                { email: { contains: q.trim(), mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: userRefSelect,
      orderBy: { nameEn: 'asc' },
      take: 20,
    });
  }

  departments() {
    return this.prisma.department.findMany({
      where: { deletedAt: null },
      select: { id: true, nameEn: true, nameAr: true, parentId: true },
      orderBy: { nameEn: 'asc' },
    });
  }
}
