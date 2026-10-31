import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ATTACHMENT_MAX_BYTES,
  PERMISSIONS,
  activeNodeIds,
  formSchema,
  isApprovalNode,
  nodeLabel,
  noneStart,
  parseMentions,
  validateFormData,
  type CaseCommentDto,
  type CaseDetailDto,
  type CaseEventDto,
  type CaseEventType,
  type CaseFileDto,
  type CaseIncidentDto,
  type CaseListQuery,
  type CaseOutcome,
  type CaseState,
  type CaseStatus,
  type CaseSummaryDto,
  type CaseTaskDto,
  type CatalogueItemDto,
  type FormSchema,
  type Paginated,
  type StartFormDto,
  type UserRef,
  type WfTaskStatus,
  type WorkflowModel,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { badRequest, conflict, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { pageArgs, paginated } from '../common/pagination';
import { userRefSelect } from '../governance/content.service';
import { detectAttachmentType, safeFileName } from '../docs/attachment-type';
import { WorkflowConfigService } from './workflow-config.service';
import { WorkflowRunnerService, caseLink, type AfterCommit } from './workflow-runner.service';
import {
  canMonitorProcess,
  canSeeCase,
  canStartProcess,
  isWorkflowAdmin,
  monitorCaseWhere,
  visibleCaseWhere,
} from './workflow-access';

type Tx = Prisma.TransactionClient;

const summaryInclude = {
  process: {
    select: { id: true, code: true, nameEn: true, nameAr: true, ownerId: true, departmentId: true },
  },
  definition: { select: { versionNumber: true, id: true } },
  tasks: {
    where: { status: 'OPEN' as const },
    select: { elementId: true, nameEn: true, nameAr: true, dueAt: true },
  },
} satisfies Prisma.WorkflowCaseInclude;
type SummaryRow = Prisma.WorkflowCaseGetPayload<{ include: typeof summaryInclude }>;

export interface StartOptions {
  /** Started by a timer or a call activity: no start rights or form required. */
  system?: boolean;
  parent?: { caseId: string; tokenId: string };
  vars?: Record<string, unknown>;
}

/**
 * Starting and following cases (step 3): service catalogue, start with form validation, case lists,
 * the case page (timeline, step data, files, comments, incidents), withdraw / cancel / retry.
 */
@Injectable()
export class WorkflowCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly config: WorkflowConfigService,
    private readonly runner: WorkflowRunnerService,
  ) {}

  // ---------- Users ----------

  async userRefs(ids: (string | null | undefined)[]): Promise<Map<string, UserRef>> {
    const list = [...new Set(ids.filter((v): v is string => !!v))];
    if (!list.length) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: list } },
      select: userRefSelect,
    });
    return new Map(rows.map((u) => [u.id, u]));
  }

  // ---------- Catalogue ----------

  private async startable(user: AuthUser, processId?: string) {
    const rows = await this.prisma.workflowProcessConfig.findMany({
      where: {
        enabled: true,
        activeDefinitionId: { not: null },
        process: { deletedAt: null },
        ...(processId ? { processId } : {}),
      },
      include: {
        process: {
          select: {
            id: true,
            code: true,
            nameEn: true,
            nameAr: true,
            descriptionEn: true,
            descriptionAr: true,
            category: true,
            ownerId: true,
            department: { select: { id: true, nameEn: true, nameAr: true } },
          },
        },
      },
      orderBy: { process: { code: 'asc' } },
    });
    return rows.filter((r) => canStartProcess(user, r));
  }

  async catalogue(user: AuthUser): Promise<CatalogueItemDto[]> {
    const rows = await this.startable(user);
    const defs = await this.prisma.workflowDefinition.findMany({
      where: { id: { in: rows.map((r) => r.activeDefinitionId!) } },
      select: { id: true, versionNumber: true },
    });
    const ver = new Map(defs.map((d) => [d.id, d.versionNumber]));
    const owners = await this.userRefs(rows.map((r) => r.process.ownerId));
    const open = await this.prisma.workflowCase.groupBy({
      by: ['processId'],
      where: { initiatorId: user.id, status: 'RUNNING' },
      _count: { _all: true },
    });
    const openBy = new Map(open.map((o) => [o.processId, o._count._all]));
    return rows.map((r) => ({
      processId: r.processId,
      code: r.process.code,
      nameEn: r.process.nameEn,
      nameAr: r.process.nameAr,
      descriptionEn: r.process.descriptionEn,
      descriptionAr: r.process.descriptionAr,
      category: r.process.category,
      department: r.process.department,
      owner: r.process.ownerId ? (owners.get(r.process.ownerId) ?? null) : null,
      casePrefix: r.casePrefix,
      versionNumber: ver.get(r.activeDefinitionId!) ?? 0,
      myOpenCases: openBy.get(r.processId) ?? 0,
    }));
  }

  async startForm(processId: string, user: AuthUser): Promise<StartFormDto> {
    const item = (await this.catalogue(user)).find((c) => c.processId === processId);
    if (!item) throw notFound('Process');
    const cfg = await this.prisma.workflowProcessConfig.findUniqueOrThrow({ where: { processId } });
    const def = await this.prisma.workflowDefinition.findUniqueOrThrow({
      where: { id: cfg.activeDefinitionId! },
      select: { bpmnXml: true },
    });
    const model = await this.config.model(cfg.activeDefinitionId!);
    return { ...item, form: noneStart(model)?.exec.form ?? null, bpmnXml: def.bpmnXml };
  }

  // ---------- Start ----------

  private async nextNumber(tx: Tx, prefix: string) {
    const year = new Date().getUTCFullYear();
    await tx.workflowCaseCounter.createMany({
      data: [{ prefix, year, last: 0 }],
      skipDuplicates: true,
    });
    const row = await tx.workflowCaseCounter.update({
      where: { prefix_year: { prefix, year } },
      data: { last: { increment: 1 } },
    });
    return `${prefix}-${year}-${String(row.last).padStart(5, '0')}`;
  }

  /** User / department fields must point to existing records; file fields to the user's uploads. */
  private async checkRefs(
    tx: Tx,
    form: FormSchema,
    values: Record<string, unknown>,
    userId: string | null,
  ) {
    const errors: { key: string; code: string }[] = [];
    for (const f of form.fields) {
      const v = values[f.key];
      if (f.type === 'user' && typeof v === 'string') {
        const u = await tx.user.findFirst({
          where: { id: v, deletedAt: null, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!u) errors.push({ key: f.key, code: 'TYPE' });
      }
      if (f.type === 'department' && typeof v === 'string') {
        const d = await tx.department.findFirst({
          where: { id: v, deletedAt: null },
          select: { id: true },
        });
        if (!d) errors.push({ key: f.key, code: 'TYPE' });
      }
      if (f.type === 'file' && Array.isArray(v) && v.length) {
        const n = await tx.workflowFile.count({
          where: { id: { in: v as string[] }, createdById: userId ?? undefined },
        });
        if (n !== v.length) errors.push({ key: f.key, code: 'TYPE' });
      }
    }
    if (errors.length) throw badRequest('FORM_INVALID', 'Form data is not valid', errors);
  }

  async start(
    processId: string,
    data: Record<string, unknown>,
    fileIds: string[],
    user: AuthUser | null,
    meta: RequestMeta | null,
    opts: StartOptions = {},
  ): Promise<{ id: string; number: string }> {
    const cfg = await this.prisma.workflowProcessConfig.findUnique({
      where: { processId },
      include: {
        process: {
          select: { code: true, nameEn: true, nameAr: true, ownerId: true, deletedAt: true },
        },
      },
    });
    if (!cfg || cfg.process.deletedAt || !cfg.enabled) throw badRequest('NOT_EXECUTABLE');
    if (!cfg.activeDefinitionId) throw badRequest('NOT_DEPLOYED');
    if (!opts.system && (!user || !canStartProcess(user, cfg))) throw forbidden();
    const definitionId = cfg.activeDefinitionId;
    const model = await this.config.model(definitionId);
    const start = noneStart(model);
    if (!start) throw badRequest('NOT_EXECUTABLE');
    const form = start.exec.form ?? formSchema.parse({});
    let values: Record<string, unknown> = {};
    if (!opts.system) {
      const v = validateFormData(form, data);
      if (v.errors.length) throw badRequest('FORM_INVALID', 'Form data is not valid', v.errors);
      values = v.values;
    }
    const initiatorId = user?.id ?? cfg.process.ownerId;
    const initiator = initiatorId
      ? await this.prisma.user.findUnique({
          where: { id: initiatorId },
          select: { id: true, nameEn: true, nameAr: true, email: true, departmentId: true },
        })
      : null;
    const firstText = form.fields.find(
      (f) =>
        (f.type === 'text' || f.type === 'textarea') &&
        typeof values[f.key] === 'string' &&
        values[f.key],
    );
    const titleText = firstText ? String(values[firstText.key]).slice(0, 200) : '';
    return this.runner.transaction(async (tx, after) => {
      if (!opts.system) await this.checkRefs(tx, form, values, user?.id ?? null);
      const number = await this.nextNumber(tx, cfg.casePrefix);
      const vars = {
        ...(opts.vars ?? {}),
        ...values,
        initiator: initiator
          ? {
              id: initiator.id,
              name: initiator.nameEn || initiator.email,
              nameAr: initiator.nameAr,
              departmentId: initiator.departmentId,
            }
          : null,
        case: { number },
        process: { code: cfg.process.code, name: cfg.process.nameEn, nameAr: cfg.process.nameAr },
      };
      const created = await tx.workflowCase.create({
        data: {
          number,
          definitionId,
          processId,
          titleEn: titleText || cfg.process.nameEn,
          titleAr: titleText || cfg.process.nameAr || cfg.process.nameEn,
          initiatorId: initiator?.id ?? null,
          departmentId: initiator?.departmentId ?? null,
          variables: vars as Prisma.InputJsonValue,
          state: { tokens: [], seq: 0 },
          parentCaseId: opts.parent?.caseId ?? null,
          parentTokenId: opts.parent?.tokenId ?? null,
        },
      });
      const ids = [
        ...new Set([
          ...fileIds,
          ...form.fields
            .filter((f) => f.type === 'file')
            .flatMap((f) => (values[f.key] as string[]) ?? []),
        ]),
      ];
      if (ids.length && user) {
        const res = await tx.workflowFile.updateMany({
          where: { id: { in: ids }, caseId: null, createdById: user.id },
          data: { caseId: created.id },
        });
        if (res.count !== ids.length)
          throw badRequest('FORM_INVALID', 'Unknown file', [{ key: 'files', code: 'TYPE' }]);
      }
      await tx.workflowEvent.create({
        data: {
          caseId: created.id,
          type: 'STARTED',
          elementId: start.id,
          userId: user?.id ?? null,
          data: {
            values,
            system: !!opts.system,
            parentCaseId: opts.parent?.caseId ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      const c = await this.runner.claim(tx, created.id);
      await this.runner.run(
        tx,
        c,
        { type: 'START', startNodeId: start.id },
        { actorId: user?.id ?? null },
        after,
      );
      await this.audit.log(
        {
          action: 'START',
          entityType: 'WorkflowCase',
          entityId: created.id,
          userId: user?.id ?? null,
          summary: { number, process: cfg.process.code, system: !!opts.system },
          meta: meta ?? undefined,
        },
        tx,
      );
      return { id: created.id, number };
    });
  }

  // ---------- Lists ----------

  private toSummary(r: SummaryRow, users: Map<string, UserRef>, now = new Date()): CaseSummaryDto {
    const state = r.state as unknown as CaseState;
    const waiting = (state?.tokens ?? []).map((t) => t.nodeId);
    const steps = new Map<string, { elementId: string; nameEn: string; nameAr: string }>();
    for (const t of r.tasks)
      steps.set(t.elementId, { elementId: t.elementId, nameEn: t.nameEn, nameAr: t.nameAr });
    for (const id of waiting)
      if (!steps.has(id)) steps.set(id, { elementId: id, nameEn: id, nameAr: id });
    return {
      id: r.id,
      number: r.number,
      processId: r.processId,
      processCode: r.process.code,
      processNameEn: r.process.nameEn,
      processNameAr: r.process.nameAr,
      titleEn: r.titleEn,
      titleAr: r.titleAr,
      status: r.status as CaseStatus,
      outcome: (r.outcome as CaseOutcome) ?? null,
      initiator: r.initiatorId ? (users.get(r.initiatorId) ?? null) : null,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      currentSteps: r.status === 'RUNNING' ? [...steps.values()] : [],
      stuck: r.stuck,
      overdue: r.tasks.some((t) => t.dueAt && t.dueAt < now),
      versionNumber: r.definition.versionNumber,
    };
  }

  /** Step names for waiting elements without a task (timers, called processes). */
  private async labelSteps(items: CaseSummaryDto[], rows: SummaryRow[]) {
    const defs = new Map<string, WorkflowModel>();
    for (const r of rows)
      if (!defs.has(r.definitionId))
        defs.set(r.definitionId, await this.config.model(r.definitionId));
    items.forEach((it, i) => {
      const m = defs.get(rows[i].definitionId)!;
      for (const s of it.currentSteps) {
        const n = m.nodes[s.elementId];
        if (n && s.nameEn === s.elementId) {
          s.nameEn = nodeLabel(n, 'en');
          s.nameAr = nodeLabel(n, 'ar');
        }
      }
    });
  }

  async list(q: CaseListQuery, user: AuthUser): Promise<Paginated<CaseSummaryDto>> {
    const and: Prisma.WorkflowCaseWhereInput[] = [];
    if (q.scope === 'mine') and.push({ initiatorId: user.id });
    else if (q.scope === 'involved') {
      and.push({
        tasks: {
          some: {
            OR: [
              { assigneeId: user.id },
              { completedById: user.id },
              { candidates: { some: { userId: user.id } } },
            ],
          },
        },
      });
    } else {
      if (!user.permissions.has(PERMISSIONS.WORKFLOW_MONITOR) && !isWorkflowAdmin(user))
        throw forbidden();
      const w = monitorCaseWhere(user);
      if (w) and.push(w);
    }
    if (q.processId) and.push({ processId: q.processId });
    if (q.status) and.push({ status: q.status });
    if (q.stuck !== undefined) and.push({ stuck: q.stuck });
    if (q.q)
      and.push({
        OR: [
          { number: { contains: q.q, mode: 'insensitive' } },
          { titleEn: { contains: q.q, mode: 'insensitive' } },
          { titleAr: { contains: q.q, mode: 'insensitive' } },
        ],
      });
    const where: Prisma.WorkflowCaseWhereInput = { AND: and };
    const sort = ['startedAt', 'number', 'completedAt', 'status'].includes(q.sort ?? '')
      ? q.sort!
      : 'startedAt';
    const [rows, total] = await Promise.all([
      this.prisma.workflowCase.findMany({
        where,
        include: summaryInclude,
        orderBy: { [sort]: q.sort ? q.order : 'desc' },
        ...pageArgs(q),
      }),
      this.prisma.workflowCase.count({ where }),
    ]);
    const users = await this.userRefs(rows.map((r) => r.initiatorId));
    const items = rows.map((r) => this.toSummary(r, users));
    await this.labelSteps(items, rows);
    return paginated(items, total, q);
  }

  // ---------- Detail and access ----------

  private async involved(caseId: string): Promise<Set<string>> {
    const tasks = await this.prisma.workflowTask.findMany({
      where: { caseId },
      select: {
        assigneeId: true,
        completedById: true,
        onBehalfOfId: true,
        candidates: { select: { userId: true } },
      },
    });
    const ids = new Set<string>();
    for (const t of tasks) {
      for (const v of [t.assigneeId, t.completedById, t.onBehalfOfId]) if (v) ids.add(v);
      for (const c of t.candidates) ids.add(c.userId);
    }
    return ids;
  }

  /** Loads a case the user may see (404 otherwise) with the user's rights on it. */
  async access(caseId: string, user: AuthUser) {
    const c = await this.prisma.workflowCase.findUnique({
      where: { id: caseId },
      include: summaryInclude,
    });
    if (!c) throw notFound('Case');
    const cfg = await this.prisma.workflowProcessConfig.findUnique({
      where: { processId: c.processId },
      select: { monitorUserIds: true, allowWithdraw: true },
    });
    const involved = await this.involved(c.id);
    const visible = canSeeCase(user, {
      initiatorId: c.initiatorId,
      process: c.process,
      monitorUserIds: cfg?.monitorUserIds ?? [],
      involvedUserIds: involved,
    });
    if (!visible) throw notFound('Case');
    const participant =
      c.initiatorId === user.id || involved.has(user.id) || c.process.ownerId === user.id;
    const deptMonitor =
      user.permissions.has(PERMISSIONS.WORKFLOW_MONITOR) &&
      ((!!c.process.departmentId && c.process.departmentId === user.departmentId) ||
        (cfg?.monitorUserIds ?? []).includes(user.id));
    const canAct = participant || isWorkflowAdmin(user) || deptMonitor;
    return { c, cfg, involved, canAct, admin: isWorkflowAdmin(user) };
  }

  async detail(caseId: string, user: AuthUser): Promise<CaseDetailDto> {
    const { c, cfg, canAct, admin } = await this.access(caseId, user);
    const [def, tasks, events, files, comments, children, parent] = await Promise.all([
      this.prisma.workflowDefinition.findUniqueOrThrow({
        where: { id: c.definitionId },
        select: { bpmnXml: true },
      }),
      this.prisma.workflowTask.findMany({
        where: { caseId },
        include: { candidates: { select: { userId: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.workflowEvent.findMany({ where: { caseId }, orderBy: { at: 'asc' }, take: 2000 }),
      this.prisma.workflowFile.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.workflowCaseComment.findMany({
        where: { caseId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.workflowCase.findMany({
        where: { parentCaseId: caseId },
        select: { id: true, number: true, status: true },
      }),
      c.parentCaseId
        ? this.prisma.workflowCase.findUnique({
            where: { id: c.parentCaseId },
            select: { id: true, number: true },
          })
        : null,
    ]);
    const model = await this.config.model(c.definitionId);
    const users = await this.userRefs([
      c.initiatorId,
      ...tasks.flatMap((t) => [
        t.assigneeId,
        t.completedById,
        ...t.candidates.map((x) => x.userId),
      ]),
      ...events.map((e) => e.userId),
      ...files.map((f) => f.createdById),
      ...comments.map((x) => x.createdById),
    ]);
    const summary = this.toSummary(c, users);
    await this.labelSteps([summary], [c]);
    const state = c.state as unknown as CaseState;
    const started = events.find((e) => e.type === 'STARTED');
    const startNode = noneStart(model);
    const purged = !!c.dataPurgedAt;
    const taskDtos: CaseTaskDto[] = tasks.map((t) => {
      const node = model.nodes[t.elementId];
      return {
        id: t.id,
        elementId: t.elementId,
        nameEn: t.nameEn,
        nameAr: t.nameAr,
        approval: t.approval,
        status: t.status as WfTaskStatus,
        assignee: t.assigneeId ? (users.get(t.assigneeId) ?? null) : null,
        candidates: t.candidates.map((x) => users.get(x.userId)).filter((u): u is UserRef => !!u),
        dueAt: t.dueAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
        completedBy: t.completedById ? (users.get(t.completedById) ?? null) : null,
        decision: (t.decision as CaseTaskDto['decision']) ?? null,
        comment: t.comment,
        form: node?.exec.form ?? null,
        data: purged ? null : ((t.data as Record<string, unknown>) ?? null),
      };
    });
    const eventDtos: CaseEventDto[] = events
      .filter((e) => e.type !== 'STEP_STARTED')
      .map((e) => {
        const n = e.elementId ? model.nodes[e.elementId] : undefined;
        const data = { ...((e.data as Record<string, unknown>) ?? {}) };
        delete data.values;
        return {
          id: e.id,
          type: e.type as CaseEventType,
          elementId: e.elementId,
          nameEn: n ? nodeLabel(n, 'en') : '',
          nameAr: n ? nodeLabel(n, 'ar') : '',
          user: e.userId ? (users.get(e.userId) ?? null) : null,
          at: e.at.toISOString(),
          data,
        };
      });
    const completed = new Set(
      events.filter((e) => e.type === 'STEP_COMPLETED' && e.elementId).map((e) => e.elementId!),
    );
    if (startNode) completed.add(startNode.id);
    const incidents: CaseIncidentDto[] = (state?.tokens ?? [])
      .filter((t) => t.status === 'FAILED')
      .map((t) => {
        const n = model.nodes[t.nodeId];
        return {
          tokenId: t.id,
          elementId: t.nodeId,
          nameEn: n ? nodeLabel(n, 'en') : t.nodeId,
          nameAr: n ? nodeLabel(n, 'ar') : t.nodeId,
          code: t.incident?.code ?? 'ERROR',
          message: t.incident?.message ?? '',
        };
      });
    const running = c.status === 'RUNNING';
    return {
      ...summary,
      bpmnXml: def.bpmnXml,
      activeElementIds: running ? activeNodeIds(state ?? { tokens: [], seq: 0 }) : [],
      completedElementIds: [...completed],
      startForm: startNode?.exec.form ?? null,
      startData: purged
        ? null
        : ((started?.data as { values?: Record<string, unknown> })?.values ?? null),
      tasks: taskDtos,
      events: eventDtos,
      files: files.map((f) => this.fileDto(f, users)),
      comments: comments.map((x) => ({
        id: x.id,
        body: x.body,
        author: x.createdById ? (users.get(x.createdById) ?? null) : null,
        createdAt: x.createdAt.toISOString(),
      })),
      incidents,
      parentCase: parent,
      childCases: children.map((ch) => ({ ...ch, status: ch.status as CaseStatus })),
      dataPurged: purged,
      canWithdraw: running && c.initiatorId === user.id && (cfg?.allowWithdraw ?? true),
      canCancel: running && admin,
      canRetry: running && admin && incidents.length > 0,
      canComment: canAct,
      canUpload: canAct && running,
    };
  }

  fileDto(
    f: {
      id: string;
      name: string;
      size: number;
      mimeType: string;
      kind: string;
      taskId: string | null;
      createdAt: Date;
      createdById: string | null;
    },
    users: Map<string, UserRef>,
  ): CaseFileDto {
    return {
      id: f.id,
      name: f.name,
      size: f.size,
      mimeType: f.mimeType,
      kind: f.kind as CaseFileDto['kind'],
      taskId: f.taskId,
      createdAt: f.createdAt.toISOString(),
      createdBy: f.createdById ? (users.get(f.createdById) ?? null) : null,
    };
  }

  // ---------- Withdraw, cancel, retry ----------

  async withdraw(caseId: string, reason: string, user: AuthUser, meta: RequestMeta) {
    const { c, cfg } = await this.access(caseId, user);
    if (c.status !== 'RUNNING') throw conflict('CASE_NOT_RUNNING');
    if (c.initiatorId !== user.id || !(cfg?.allowWithdraw ?? true))
      throw badRequest('WITHDRAW_NOT_ALLOWED');
    await this.runner.transaction(async (tx, after) => {
      await this.runner.close(tx, caseId, 'WITHDRAWN', reason, user.id, after);
      await this.audit.log(
        {
          action: 'WITHDRAW',
          entityType: 'WorkflowCase',
          entityId: caseId,
          userId: user.id,
          summary: { number: c.number, reason },
          meta,
        },
        tx,
      );
    });
  }

  async cancel(caseId: string, reason: string, user: AuthUser, meta: RequestMeta) {
    const { c } = await this.access(caseId, user);
    if (!isWorkflowAdmin(user)) throw forbidden();
    if (c.status !== 'RUNNING') throw conflict('CASE_NOT_RUNNING');
    await this.runner.transaction(async (tx, after) => {
      await this.runner.close(tx, caseId, 'CANCELLED', reason, user.id, after);
      await this.audit.log(
        {
          action: 'CANCEL',
          entityType: 'WorkflowCase',
          entityId: caseId,
          userId: user.id,
          summary: { number: c.number, reason },
          meta,
        },
        tx,
      );
    });
  }

  /** Retries every failed step of a stuck case (admins). */
  async retry(caseId: string, user: AuthUser, meta: RequestMeta) {
    const { c } = await this.access(caseId, user);
    if (!isWorkflowAdmin(user)) throw forbidden();
    const failed = ((c.state as unknown as CaseState)?.tokens ?? []).filter(
      (t) => t.status === 'FAILED',
    );
    if (!failed.length) throw badRequest('NO_INCIDENT');
    for (const t of failed) {
      await this.runner.execute(
        caseId,
        { type: 'RETRY', tokenId: t.id },
        {
          actorId: user.id,
          before: async (tx) => {
            await tx.workflowEvent.create({
              data: {
                caseId,
                type: 'RETRIED',
                elementId: t.nodeId,
                tokenId: t.id,
                userId: user.id,
              },
            });
          },
        },
      );
    }
    await this.audit.log({
      action: 'RETRY',
      entityType: 'WorkflowCase',
      entityId: caseId,
      userId: user.id,
      summary: { number: c.number, steps: failed.map((t) => t.nodeId) },
      meta,
    });
  }

  // ---------- Comments ----------

  async addComment(caseId: string, body: string, user: AuthUser): Promise<CaseCommentDto> {
    const { c, canAct } = await this.access(caseId, user);
    if (!canAct) throw forbidden();
    const mentioned = parseMentions(body);
    const row = await this.prisma.workflowCaseComment.create({
      data: { caseId, body, mentionIds: mentioned, createdById: user.id },
    });
    await this.prisma.workflowEvent.create({
      data: { caseId, type: 'COMMENT', userId: user.id, data: { commentId: row.id } },
    });
    // Only people who can see the case are notified.
    const cfg = await this.prisma.workflowProcessConfig.findUnique({
      where: { processId: c.processId },
      select: { monitorUserIds: true },
    });
    const involved = await this.involved(caseId);
    const visible: string[] = [];
    for (const id of mentioned) {
      if (
        id === c.initiatorId ||
        involved.has(id) ||
        id === c.process.ownerId ||
        (cfg?.monitorUserIds ?? []).includes(id)
      )
        visible.push(id);
    }
    await this.notifications.notify({
      userIds: visible,
      type: 'MENTIONED',
      params: {
        actorEn: user.nameEn || user.email,
        actorAr: user.nameAr || user.nameEn || user.email,
        code: c.number,
        titleEn: c.titleEn,
        titleAr: c.titleAr,
        comment: body.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1').slice(0, 300),
      },
      link: caseLink(caseId),
      actorId: user.id,
    });
    return {
      id: row.id,
      body: row.body,
      author: { id: user.id, email: user.email, nameEn: user.nameEn, nameAr: user.nameAr },
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---------- Files ----------

  async upload(
    file: Express.Multer.File | undefined,
    caseId: string | null,
    taskId: string | null,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<CaseFileDto> {
    if (!file?.buffer?.length) throw badRequest('FILE_REQUIRED');
    if (file.size > ATTACHMENT_MAX_BYTES) throw badRequest('FILE_TOO_LARGE');
    if (caseId) {
      const { c, canAct } = await this.access(caseId, user);
      if (!canAct || c.status !== 'RUNNING') throw forbidden();
      if (taskId) {
        const t = await this.prisma.workflowTask.findFirst({
          where: { id: taskId, caseId },
          select: { id: true },
        });
        if (!t) throw notFound('Task');
      }
    } else {
      // Draft upload for a start form: at most 20 unattached files per user.
      const drafts = await this.prisma.workflowFile.count({
        where: { caseId: null, createdById: user.id },
      });
      if (drafts >= 20) throw badRequest('TOO_MANY_FILES');
    }
    const name = safeFileName(Buffer.from(file.originalname, 'latin1').toString('utf8'));
    const mimeType = detectAttachmentType(file.buffer, name);
    if (!mimeType) throw badRequest('UNSUPPORTED_FILE_TYPE');
    const id = randomUUID();
    const storageKey = `workflow/${caseId ?? `draft-${user.id}`}/${id}`;
    await this.storage.put(storageKey, file.buffer, mimeType);
    const row = await this.prisma.$transaction(async (tx) => {
      const f = await tx.workflowFile.create({
        data: {
          id,
          caseId,
          taskId,
          kind: 'UPLOAD',
          name,
          mimeType,
          size: file.size,
          storageKey,
          createdById: user.id,
        },
      });
      if (caseId)
        await tx.workflowEvent.create({
          data: { caseId, type: 'FILE_ADDED', userId: user.id, data: { fileId: id, name } },
        });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'WorkflowFile',
          entityId: id,
          userId: user.id,
          summary: { caseId, name, mimeType, size: file.size },
          meta,
        },
        tx,
      );
      return f;
    });
    return this.fileDto(
      row,
      new Map([
        [user.id, { id: user.id, email: user.email, nameEn: user.nameEn, nameAr: user.nameAr }],
      ]),
    );
  }

  async openFile(id: string, user: AuthUser) {
    const f = await this.prisma.workflowFile.findUnique({ where: { id } });
    if (!f) throw notFound('File');
    if (!f.caseId) {
      if (f.createdById !== user.id) throw notFound('File');
    } else await this.access(f.caseId, user);
    return { file: f, stream: await this.storage.get(f.storageKey) };
  }

  // ---------- Helpers for other services ----------

  /** Monitor rights on a case's process (reassign etc.). */
  async monitorsCase(caseId: string, user: AuthUser) {
    const c = await this.prisma.workflowCase.findUnique({
      where: { id: caseId },
      select: { process: { select: { ownerId: true, departmentId: true } }, processId: true },
    });
    if (!c) return false;
    const cfg = await this.prisma.workflowProcessConfig.findUnique({
      where: { processId: c.processId },
      select: { monitorUserIds: true },
    });
    return canMonitorProcess(user, c.process, cfg?.monitorUserIds ?? []);
  }

  visibleWhere(user: AuthUser) {
    return visibleCaseWhere(user);
  }

  async closeTx(
    tx: Tx,
    caseId: string,
    status: 'WITHDRAWN' | 'CANCELLED',
    reason: string,
    actorId: string | null,
    after: AfterCommit,
  ) {
    return this.runner.close(tx, caseId, status, reason, actorId, after);
  }
}

export const approvalNode = isApprovalNode;
