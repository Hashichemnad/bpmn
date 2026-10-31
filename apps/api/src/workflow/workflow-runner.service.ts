import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  EMPTY_STATE,
  EngineError,
  evaluateDmnTable,
  isApprovalNode,
  nodeLabel,
  readDecisionTables,
  renderTemplate,
  step,
  type CaseState,
  type DmnTable,
  type EngineCommand,
  type EngineEffect,
  type WfNode,
  type WorkflowModel,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService, type NotifyInput } from '../notifications/notifications.service';
import { AppException, conflict } from '../common/app-exception';
import { HttpStatus } from '@nestjs/common';
import { WorkflowConfigService, decisionKey } from './workflow-config.service';
import { WorkflowSettingsService } from './workflow-settings.service';
import { WorkflowAssignmentService, type AssignmentContext } from './workflow-assignment.service';
import { WorkflowTimersService } from './workflow-timers.service';
import { WorkflowEventLogService } from './workflow-event-log.service';

type Tx = Prisma.TransactionClient;

const caseInclude = {
  process: {
    select: { id: true, code: true, nameEn: true, nameAr: true, ownerId: true, departmentId: true },
  },
  definition: { select: { versionNumber: true } },
} satisfies Prisma.WorkflowCaseInclude;
export type CaseRow = Prisma.WorkflowCaseGetPayload<{ include: typeof caseInclude }>;

/** Lost the optimistic lock on a case: the whole step is retried from a fresh read. */
export class CaseVersionConflict extends Error {}

export interface RunOptions {
  actorId?: string | null;
  /** Variables merged before the step (submitted form data). */
  vars?: Record<string, unknown>;
  /** Work in the same transaction before the engine step (runs again on a retry). */
  before?: (tx: Tx, c: CaseRow) => Promise<void>;
}

/** Things done after the commit: notifications and waking the job runner. */
export class AfterCommit {
  notifications: NotifyInput[] = [];
  jobs = false;
}

export const caseLink = (id: string) => `/workflow/cases/${id}`;
export const taskLink = (id: string) => `/workflow/tasks/${id}`;

export const caseTitleParams = (c: { number: string; titleEn: string; titleAr: string }) => ({
  code: c.number,
  titleEn: c.titleEn,
  titleAr: c.titleAr || c.titleEn,
});

/**
 * Runs engine steps (D-148): one command per transaction — claim the case with an optimistic version
 * check, run the pure engine, turn its effects into rows (tasks with assignment and due time, timer and
 * job rows, timeline, live event log), save the new state; notifications go out after the commit.
 */
@Injectable()
export class WorkflowRunnerService {
  private readonly logger = new Logger(WorkflowRunnerService.name);
  private readonly decisionCache = new Map<string, Map<string, DmnTable>>();
  /** Set by the job runner: wakes it up when a step created jobs that are due now. */
  onJobs: (() => void) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WorkflowConfigService,
    private readonly settings: WorkflowSettingsService,
    private readonly assignment: WorkflowAssignmentService,
    private readonly timers: WorkflowTimersService,
    private readonly eventLog: WorkflowEventLogService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Runs `work` in a transaction, retrying on lost optimistic locks; then the after-commit work. */
  async transaction<T>(work: (tx: Tx, after: AfterCommit) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const after = new AfterCommit();
      try {
        const result = await this.prisma.$transaction((tx) => work(tx, after), {
          timeout: 30_000,
          maxWait: 10_000,
        });
        await this.flush(after);
        return result;
      } catch (e) {
        const retry =
          e instanceof CaseVersionConflict ||
          (e instanceof Prisma.PrismaClientKnownRequestError &&
            ['P2034', 'P2002'].includes(e.code));
        if (retry && attempt < 5) {
          await new Promise((r) => setTimeout(r, 20 * (attempt + 1) + Math.random() * 30));
          continue;
        }
        if (e instanceof CaseVersionConflict) throw conflict('CONCURRENT_UPDATE');
        throw e;
      }
    }
  }

  /** One engine command on a case (its own transaction). */
  async execute(caseId: string, command: EngineCommand, opts: RunOptions = {}): Promise<void> {
    await this.transaction(async (tx, after) => {
      const c = await this.claim(tx, caseId);
      await opts.before?.(tx, c);
      await this.run(tx, c, command, opts, after);
    });
  }

  /** Loads a running case and takes its optimistic lock (version + 1). */
  async claim(tx: Tx, caseId: string): Promise<CaseRow> {
    const c = await tx.workflowCase.findUnique({ where: { id: caseId }, include: caseInclude });
    if (!c) throw new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Case not found');
    if (c.status !== 'RUNNING') throw conflict('CASE_NOT_RUNNING');
    const claimed = await tx.workflowCase.updateMany({
      where: { id: c.id, version: c.version, status: 'RUNNING' },
      data: { version: { increment: 1 } },
    });
    if (!claimed.count) throw new CaseVersionConflict();
    return { ...c, version: c.version + 1 };
  }

  async loadCase(tx: Tx, id: string): Promise<CaseRow> {
    return tx.workflowCase.findUniqueOrThrow({ where: { id }, include: caseInclude });
  }

  private async decider(definitionId: string) {
    let tables = this.decisionCache.get(definitionId);
    if (!tables) {
      tables = new Map();
      const xmls = await this.config.deploymentDecisions(definitionId);
      for (const [key, xml] of Object.entries(xmls)) {
        const [diagramId] = key.split(':');
        for (const t of readDecisionTables(xml)) tables.set(decisionKey(diagramId, t.id), t);
      }
      if (this.decisionCache.size > 200) this.decisionCache.clear();
      this.decisionCache.set(definitionId, tables);
    }
    return (node: WfNode, vars: Record<string, unknown>) => {
      const t = tables.get(decisionKey(node.decisionRef ?? '', node.decisionId ?? ''));
      if (!t)
        throw Object.assign(new Error('Decision not deployed'), { code: 'DECISION_NOT_FOUND' });
      return evaluateDmnTable(t, vars).outputs;
    };
  }

  /** Runs one command on a claimed case inside the caller's transaction. */
  async run(tx: Tx, c: CaseRow, command: EngineCommand, opts: RunOptions, after: AfterCommit) {
    const model = await this.config.model(c.definitionId);
    const decide = await this.decider(c.definitionId);
    const vars = { ...(c.variables as Record<string, unknown>), ...(opts.vars ?? {}) };
    let r;
    try {
      r = step(model, (c.state as unknown as CaseState) ?? EMPTY_STATE, vars, command, { decide });
    } catch (e) {
      if (e instanceof EngineError) throw conflict('CASE_STATE', e.message);
      throw e;
    }
    await this.applyEffects(tx, c, model, r.effects, r.state, r.vars, opts.actorId ?? null, after);
    const now = new Date();
    const ended = r.ended;
    await tx.workflowCase.update({
      where: { id: c.id },
      data: {
        state: r.state as unknown as Prisma.InputJsonValue,
        variables: r.vars as Prisma.InputJsonValue,
        stuck: r.state.tokens.some((t) => t.status === 'FAILED'),
        ...(ended
          ? {
              status: 'COMPLETED',
              outcome: ended.kind,
              errorCode: ended.errorCode,
              completedAt: now,
            }
          : {}),
      },
    });
    if (ended) await this.onEnded(tx, c, r.vars, ended, after);
  }

  private async event(
    tx: Tx,
    caseId: string,
    type: string,
    data: {
      elementId?: string | null;
      tokenId?: string | null;
      userId?: string | null;
      data?: object;
    },
  ) {
    await tx.workflowEvent.create({
      data: {
        caseId,
        type,
        elementId: data.elementId ?? null,
        tokenId: data.tokenId ?? null,
        userId: data.userId ?? null,
        data: (data.data ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  private async applyEffects(
    tx: Tx,
    c: CaseRow,
    model: WorkflowModel,
    effects: EngineEffect[],
    state: CaseState,
    vars: Record<string, unknown>,
    actorId: string | null,
    after: AfterCommit,
  ) {
    const now = new Date();
    const settings = await this.settings.get();
    const calendar = await this.settings.calendar();
    const ctx: AssignmentContext = {
      caseId: c.id,
      processOwnerId: c.process.ownerId,
      initiatorId: c.initiatorId,
      departmentId: c.departmentId,
      vars,
    };
    const title = caseTitleParams(c);
    for (const e of effects) {
      switch (e.type) {
        case 'CREATE_TASK': {
          const node = model.nodes[e.nodeId];
          const who = await this.assignment.resolve(tx, node, ctx, settings.calendar.timeZone);
          if (!who) {
            const t = state.tokens.find((x) => x.id === e.tokenId);
            if (t) {
              t.status = 'FAILED';
              t.incident = { code: 'NO_ASSIGNEE', message: 'Nobody can be assigned to this step' };
            }
            await this.event(tx, c.id, 'INCIDENT', {
              elementId: node.id,
              tokenId: e.tokenId,
              data: { code: 'NO_ASSIGNEE' },
            });
            this.incidentNotice(c, node, 'NO_ASSIGNEE', after);
            break;
          }
          const minutes = node.exec.dueMinutes ?? node.slaMinutes;
          const dueAt = minutes ? calendar.addWorkingMinutes(now, minutes) : null;
          const task = await tx.workflowTask.create({
            data: {
              caseId: c.id,
              tokenId: e.tokenId,
              elementId: node.id,
              nameEn: nodeLabel(node, 'en'),
              nameAr: nodeLabel(node, 'ar'),
              approval: isApprovalNode(node),
              assigneeId: who.assigneeId,
              onBehalfOfId: who.onBehalfOfId,
              dueAt,
              candidates: who.candidateIds.length
                ? { create: who.candidateIds.map((userId) => ({ userId })) }
                : undefined,
            },
          });
          await this.event(tx, c.id, 'TASK_CREATED', {
            elementId: node.id,
            tokenId: e.tokenId,
            data: {
              taskId: task.id,
              assigneeId: who.assigneeId,
              candidates: who.candidateIds.length,
              onBehalfOfId: who.onBehalfOfId,
            },
          });
          if (dueAt) {
            const before = settings.reminderMinutesBefore;
            if (before > 0 && minutes && minutes > before) {
              const remindAt = calendar.addWorkingMinutes(now, minutes - before);
              await tx.workflowJob.create({
                data: {
                  kind: 'REMINDER',
                  caseId: c.id,
                  tokenId: e.tokenId,
                  elementId: node.id,
                  dueAt: remindAt,
                  data: { taskId: task.id },
                },
              });
            }
            await tx.workflowJob.create({
              data: {
                kind: 'ESCALATE',
                caseId: c.id,
                tokenId: e.tokenId,
                elementId: node.id,
                dueAt,
                data: { taskId: task.id },
              },
            });
          }
          after.notifications.push({
            userIds: who.assigneeId ? [who.assigneeId] : who.candidateIds,
            type: 'WORKFLOW',
            params: {
              kind: who.assigneeId ? 'assigned' : 'group',
              ...title,
              stepEn: task.nameEn,
              stepAr: task.nameAr,
              ...(dueAt ? { due: dueAt.toISOString() } : {}),
            },
            link: taskLink(task.id),
            actorId,
          });
          break;
        }
        case 'CANCEL_TASK': {
          await tx.workflowTask.updateMany({
            where: { caseId: c.id, tokenId: e.tokenId, status: 'OPEN' },
            data: { status: 'CANCELLED', completedAt: now, version: { increment: 1 } },
          });
          await tx.workflowJob.updateMany({
            where: {
              caseId: c.id,
              tokenId: e.tokenId,
              status: 'PENDING',
              kind: { in: ['REMINDER', 'ESCALATE'] },
            },
            data: { status: 'CANCELLED' },
          });
          break;
        }
        case 'SCHEDULE_TIMER': {
          const node = model.nodes[e.nodeId];
          const s = await this.timers.schedule(node, now);
          if (!s) {
            const t = state.tokens.find((x) => x.id === e.tokenId);
            if (t && node.type === 'intermediateCatchEvent') {
              t.status = 'FAILED';
              t.incident = {
                code: 'TIMER_INVALID',
                message: `Timer ${node.timer?.value ?? ''} is invalid`,
              };
            }
            break;
          }
          await tx.workflowJob.create({
            data: {
              kind: 'TIMER',
              caseId: c.id,
              tokenId: e.tokenId,
              elementId: node.id,
              dueAt: s.dueAt,
              data: { cycle: s.cycle } as Prisma.InputJsonValue,
            },
          });
          if (s.dueAt <= now) after.jobs = true;
          break;
        }
        case 'CANCEL_TIMERS':
          await tx.workflowJob.updateMany({
            where: { caseId: c.id, tokenId: e.tokenId, status: 'PENDING', kind: 'TIMER' },
            data: { status: 'CANCELLED' },
          });
          break;
        case 'RUN_JOB':
          await tx.workflowJob.create({
            data: {
              kind: e.kind,
              caseId: c.id,
              tokenId: e.tokenId,
              elementId: e.nodeId,
              dueAt: now,
            },
          });
          after.jobs = true;
          break;
        case 'CANCEL_CHILD': {
          const children = await tx.workflowCase.findMany({
            where: { parentCaseId: c.id, parentTokenId: e.tokenId, status: 'RUNNING' },
            select: { id: true },
          });
          for (const ch of children)
            await this.close(tx, ch.id, 'CANCELLED', 'Parent step ended', actorId, after);
          break;
        }
        case 'NOTIFY': {
          const node = model.nodes[e.nodeId];
          const t = node.exec.notify;
          if (!t) break;
          const ids = new Set<string>();
          for (const r of t.recipients)
            for (const id of await this.assignment.users(tx, r, node, ctx)) ids.add(id);
          const display = { 'case.number': c.number };
          const subjectEn = renderTemplate(t.subjectEn || t.subjectAr, vars, 'en', display);
          const subjectAr = renderTemplate(t.subjectAr || t.subjectEn, vars, 'ar', display);
          const bodyEn = renderTemplate(t.bodyEn || t.bodyAr, vars, 'en', display);
          const bodyAr = renderTemplate(t.bodyAr || t.bodyEn, vars, 'ar', display);
          after.notifications.push({
            userIds: [...ids],
            type: 'WORKFLOW',
            params: {
              kind: 'message',
              ...title,
              msgSubjectEn: subjectEn.slice(0, 300),
              msgSubjectAr: subjectAr.slice(0, 300),
              msgBodyEn: bodyEn.slice(0, 5000),
              msgBodyAr: bodyAr.slice(0, 5000),
            },
            link: caseLink(c.id),
          });
          await this.event(tx, c.id, 'NOTIFICATION_SENT', {
            elementId: node.id,
            tokenId: e.tokenId,
            data: {
              recipients: ids.size,
              subjectEn: subjectEn.slice(0, 300),
              subjectAr: subjectAr.slice(0, 300),
            },
          });
          break;
        }
        case 'INCIDENT': {
          await this.event(tx, c.id, 'INCIDENT', {
            elementId: e.nodeId,
            tokenId: e.tokenId,
            data: { code: e.code, message: e.message },
          });
          this.incidentNotice(c, model.nodes[e.nodeId], e.message || e.code, after);
          break;
        }
        case 'ACTIVITY': {
          const type =
            e.phase === 'START'
              ? 'STEP_STARTED'
              : e.phase === 'END'
                ? 'STEP_COMPLETED'
                : 'STEP_CANCELLED';
          const node = model.nodes[e.nodeId];
          const performer = e.phase === 'END' && node.type === 'userTask' ? actorId : null;
          const decision =
            e.phase === 'END' && isApprovalNode(node) ? (vars.decision as string) : null;
          await this.event(tx, c.id, type, {
            elementId: e.nodeId,
            tokenId: e.tokenId,
            userId: performer,
            data: decision ? { decision } : {},
          });
          if (e.phase === 'END') {
            const started = await tx.workflowEvent.findFirst({
              where: {
                caseId: c.id,
                tokenId: e.tokenId,
                elementId: e.nodeId,
                type: 'STEP_STARTED',
              },
              orderBy: { at: 'desc' },
              select: { at: true },
            });
            await this.eventLog.record(tx, {
              processId: c.processId,
              caseNumber: c.number,
              elementId: node.id,
              activity: nodeLabel(node, 'en'),
              startAt: started?.at ?? null,
              endAt: now,
              performerId: performer,
              versionNumber: c.definition.versionNumber,
              decision,
            });
          }
          break;
        }
        case 'FLOW':
        case 'CASE_ENDED':
          break;
      }
    }
  }

  private incidentNotice(
    c: CaseRow,
    node: WfNode | undefined,
    message: string,
    after: AfterCommit,
  ) {
    after.notifications.push({
      userIds: [c.process.ownerId],
      type: 'WORKFLOW',
      params: {
        kind: 'incident',
        ...caseTitleParams(c),
        stepEn: node ? nodeLabel(node, 'en') : '',
        stepAr: node ? nodeLabel(node, 'ar') : '',
        comment: message.slice(0, 500),
      },
      link: caseLink(c.id),
    });
  }

  private async onEnded(
    tx: Tx,
    c: CaseRow,
    vars: Record<string, unknown>,
    ended: { kind: string; errorCode: string | null },
    after: AfterCommit,
  ) {
    await tx.workflowTask.updateMany({
      where: { caseId: c.id, status: 'OPEN' },
      data: { status: 'CANCELLED', completedAt: new Date(), version: { increment: 1 } },
    });
    await tx.workflowJob.updateMany({
      where: { caseId: c.id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    await this.event(tx, c.id, 'COMPLETED', {
      data: { outcome: ended.kind, errorCode: ended.errorCode },
    });
    if (c.parentCaseId && c.parentTokenId) {
      await tx.workflowJob.create({
        data: {
          kind: 'CHILD_DONE',
          caseId: c.parentCaseId,
          tokenId: c.parentTokenId,
          dueAt: new Date(),
          data: { childId: c.id, endKind: ended.kind, errorCode: ended.errorCode },
        },
      });
      after.jobs = true;
    }
    const rejected = vars.decision === 'REJECT';
    const last = rejected
      ? await tx.workflowTask.findFirst({
          where: { caseId: c.id, status: 'COMPLETED', decision: 'REJECT' },
          orderBy: { completedAt: 'desc' },
          select: { nameEn: true, nameAr: true, comment: true },
        })
      : null;
    after.notifications.push({
      userIds: [c.initiatorId],
      type: 'WORKFLOW',
      params: {
        kind: rejected ? 'rejected' : 'completed',
        ...caseTitleParams(c),
        ...(last ? { stepEn: last.nameEn, stepAr: last.nameAr, comment: last.comment ?? '' } : {}),
      },
      link: caseLink(c.id),
    });
  }

  /** Withdraw / cancel a running case (and its called cases); open tasks and jobs are cancelled. */
  async close(
    tx: Tx,
    caseId: string,
    status: 'WITHDRAWN' | 'CANCELLED',
    reason: string,
    actorId: string | null,
    after: AfterCommit,
  ) {
    const c = await this.loadCase(tx, caseId);
    if (c.status !== 'RUNNING') return;
    const open = await tx.workflowTask.findMany({
      where: { caseId, status: 'OPEN' },
      include: { candidates: { select: { userId: true } } },
    });
    await tx.workflowCase.update({
      where: { id: caseId },
      data: {
        status,
        closedReason: reason,
        closedById: actorId,
        completedAt: new Date(),
        version: { increment: 1 },
        state: {
          tokens: [],
          seq: (c.state as unknown as CaseState).seq ?? 0,
        } as Prisma.InputJsonValue,
        stuck: false,
      },
    });
    await tx.workflowTask.updateMany({
      where: { caseId, status: 'OPEN' },
      data: { status: 'CANCELLED', completedAt: new Date(), version: { increment: 1 } },
    });
    await tx.workflowJob.updateMany({
      where: { caseId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    await this.event(tx, caseId, status, { userId: actorId, data: { reason } });
    for (const t of open)
      after.notifications.push({
        userIds: [t.assigneeId, ...t.candidates.map((x) => x.userId)],
        type: 'WORKFLOW',
        params: {
          kind: status === 'WITHDRAWN' ? 'withdrawn' : 'cancelled',
          ...caseTitleParams(c),
          stepEn: t.nameEn,
          stepAr: t.nameAr,
          comment: reason.slice(0, 500),
        },
        link: caseLink(caseId),
        actorId,
      });
    if (status === 'CANCELLED')
      after.notifications.push({
        userIds: [c.initiatorId],
        type: 'WORKFLOW',
        params: { kind: 'cancelled', ...caseTitleParams(c), comment: reason.slice(0, 500) },
        link: caseLink(caseId),
        actorId,
      });
    const children = await tx.workflowCase.findMany({
      where: { parentCaseId: caseId, status: 'RUNNING' },
      select: { id: true },
    });
    for (const ch of children) await this.close(tx, ch.id, 'CANCELLED', reason, actorId, after);
  }

  async event$(
    tx: Tx,
    caseId: string,
    type: string,
    data: Parameters<WorkflowRunnerService['event']>[3],
  ) {
    return this.event(tx, caseId, type, data);
  }

  private async flush(after: AfterCommit) {
    for (const n of after.notifications) {
      try {
        await this.notifications.notify(n);
      } catch (e) {
        this.logger.warn(`Workflow notification failed: ${(e as Error).message}`);
      }
    }
    if (after.jobs) this.onJobs?.();
  }
}
