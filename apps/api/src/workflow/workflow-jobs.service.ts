import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Prisma, type WorkflowJob } from '@prisma/client';
import {
  nodeLabel,
  type CaseState,
  type EndKind,
  type FormField,
  type Locale,
  type WorkflowModel,
  MIN_TIMER_CYCLE_MINUTES,
} from '@processhub/shared';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppException } from '../common/app-exception';
import { WorkflowConfigService } from './workflow-config.service';
import {
  WorkflowRunnerService,
  caseEvent,
  caseTitleParams,
  taskLink,
} from './workflow-runner.service';
import { DomainEvents } from '../events/domain-events';
import { WorkflowCasesService } from './workflow-cases.service';
import { WorkflowSettingsService } from './workflow-settings.service';
import { WorkflowTimersService } from './workflow-timers.service';
import { buildCaseDocument } from './workflow-document';

const LOCK_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Job runner (D-148): polls due `WorkflowJob` rows, claims each with a conditional update, runs it and
 * marks it done. Jobs are idempotent (they act only if their token / task is still waiting) and survive
 * restarts: stale RUNNING jobs are released. Also the daily retention of form data (D-152).
 */
/** Deepest chain of call activities (parent → child cases), SEC-29. */
const MAX_CALL_DEPTH = 5;

@Injectable()
export class WorkflowJobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowJobsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private first?: ReturnType<typeof setTimeout>;
  private running: Promise<number> | null = null;
  private again = false;
  private lastPurge = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly config: WorkflowConfigService,
    private readonly runner: WorkflowRunnerService,
    private readonly cases: WorkflowCasesService,
    private readonly settings: WorkflowSettingsService,
    private readonly timers: WorkflowTimersService,
    @Inject(APP_CONFIG) private readonly appConfig: AppConfig,
    private readonly domainEvents: DomainEvents,
  ) {}

  onApplicationBootstrap() {
    const seconds = this.appConfig.WORKFLOW_POLL_SECONDS;
    if (!seconds || this.appConfig.NODE_ENV === 'test') return;
    this.runner.onJobs = () => this.kick();
    this.timer = setInterval(() => this.kick(), seconds * 1000);
    this.first = setTimeout(() => this.kick(), 5000);
  }

  onModuleDestroy() {
    clearTimeout(this.first);
    this.runner.onJobs = null;
    clearInterval(this.timer);
  }

  /** Runs due jobs now (coalesced). */
  kick() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.runDue()
      .catch((e: Error) => {
        this.logger.error(`Workflow jobs: ${e.message}`);
        return 0;
      })
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  /** Processes due jobs until none is left (tests call this directly). Returns how many ran. */
  async runDue(now = () => new Date(), limit = 500): Promise<number> {
    await this.prisma.workflowJob.updateMany({
      where: { status: 'RUNNING', lockedUntil: { lt: now() } },
      data: { status: 'PENDING', lockedUntil: null },
    });
    let ran = 0;
    for (let round = 0; round < 20 && ran < limit; round++) {
      const due = await this.prisma.workflowJob.findMany({
        where: { status: 'PENDING', dueAt: { lte: now() } },
        orderBy: { dueAt: 'asc' },
        take: 50,
      });
      if (!due.length) break;
      for (const job of due) {
        const claimed = await this.prisma.workflowJob.updateMany({
          where: { id: job.id, status: 'PENDING' },
          data: {
            status: 'RUNNING',
            lockedUntil: new Date(Date.now() + LOCK_MS),
            attempts: { increment: 1 },
          },
        });
        if (!claimed.count) continue;
        ran++;
        try {
          await this.handle(job, now());
          await this.prisma.workflowJob.update({
            where: { id: job.id },
            data: { status: 'DONE', lockedUntil: null, error: null },
          });
        } catch (e) {
          await this.failed(job, e as Error);
        }
      }
    }
    if (Date.now() - this.lastPurge > 6 * 3600_000) {
      this.lastPurge = Date.now();
      await this.purgeExpired().catch((e: Error) =>
        this.logger.error(`Workflow retention: ${e.message}`),
      );
    }
    return ran;
  }

  private async failed(job: WorkflowJob, e: Error) {
    const message = (e.message || String(e)).slice(0, 1000);
    const attempts = job.attempts + 1;
    const permanent = e instanceof AppException || attempts >= MAX_ATTEMPTS;
    this.logger.warn(`Workflow job ${job.kind} ${job.id} failed (${attempts}): ${message}`);
    if (!permanent) {
      await this.prisma.workflowJob.update({
        where: { id: job.id },
        data: {
          status: 'PENDING',
          lockedUntil: null,
          error: message,
          dueAt: new Date(Date.now() + 30_000 * attempts),
        },
      });
      return;
    }
    await this.prisma.workflowJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', lockedUntil: null, error: message },
    });
    // Asynchronous steps that failed for good become incidents (or follow the error path).
    if ((job.kind === 'DOCUMENT' || job.kind === 'CALL') && job.caseId && job.tokenId) {
      await this.runner
        .execute(job.caseId, {
          type: 'JOB_FAILED',
          tokenId: job.tokenId,
          code: job.kind === 'DOCUMENT' ? 'DOCUMENT_FAILED' : 'CALL_FAILED',
          message,
        })
        .catch((err: Error) => this.logger.warn(`Could not record the incident: ${err.message}`));
    }
    if (job.kind === 'TIMER' && job.caseId && job.tokenId) {
      await this.prisma.workflowEvent.create({
        data: {
          caseId: job.caseId,
          type: 'INCIDENT',
          elementId: job.elementId,
          tokenId: job.tokenId,
          data: { code: 'TIMER_FAILED', message },
        },
      });
      await this.prisma.workflowCase
        .update({ where: { id: job.caseId }, data: { stuck: true } })
        .catch(() => undefined);
    }
  }

  private async tokenWaiting(caseId: string, tokenId: string) {
    const c = await this.prisma.workflowCase.findUnique({
      where: { id: caseId },
      select: { status: true, state: true },
    });
    if (!c || c.status !== 'RUNNING') return null;
    return (
      ((c.state as unknown as CaseState).tokens ?? []).find(
        (t) => t.id === tokenId && t.status === 'WAITING',
      ) ?? null
    );
  }

  async handle(job: WorkflowJob, now: Date): Promise<void> {
    switch (job.kind) {
      case 'TIMER':
        return this.timer$(job, now);
      case 'START_TIMER':
        return this.startTimer(job, now);
      case 'DOCUMENT':
        return this.document(job, now);
      case 'CALL':
        return this.call(job);
      case 'CHILD_DONE':
        return this.childDone(job);
      case 'REMINDER':
      case 'ESCALATE':
        return this.reminder(job, now);
    }
  }

  private async timer$(job: WorkflowJob, now: Date) {
    if (!job.caseId || !job.tokenId || !job.elementId) return;
    const tok = await this.tokenWaiting(job.caseId, job.tokenId);
    if (!tok) return;
    await this.runner.execute(
      job.caseId,
      { type: 'TIMER_FIRED', tokenId: job.tokenId, nodeId: job.elementId },
      {
        before: async (tx) => {
          await tx.workflowEvent.create({
            data: {
              caseId: job.caseId!,
              type: 'TIMER_FIRED',
              elementId: job.elementId,
              tokenId: job.tokenId,
            },
          });
        },
      },
    );
    // Non-interrupting cycle timers on a step that is still open fire again.
    const cycle = (job.data as { cycle?: { minutes: number; left: number | null } } | null)?.cycle;
    if (cycle && (cycle.left === null || cycle.left > 0)) {
      const still = await this.tokenWaiting(job.caseId, job.tokenId);
      if (still) {
        const model = await this.caseModel(job.caseId);
        const node = model.nodes[job.elementId];
        await this.prisma.workflowJob.create({
          data: {
            kind: 'TIMER',
            caseId: job.caseId,
            tokenId: job.tokenId,
            elementId: job.elementId,
            dueAt: await this.timers.add(
              now,
              Math.max(cycle.minutes, MIN_TIMER_CYCLE_MINUTES),
              !!node?.exec.workingTime,
            ),
            data: {
              cycle: { minutes: cycle.minutes, left: cycle.left === null ? null : cycle.left - 1 },
            },
          },
        });
      }
    }
  }

  private async caseModel(caseId: string): Promise<WorkflowModel> {
    const c = await this.prisma.workflowCase.findUniqueOrThrow({
      where: { id: caseId },
      select: { definitionId: true },
    });
    return this.config.model(c.definitionId);
  }

  private async startTimer(job: WorkflowJob, now: Date) {
    const data = (job.data ?? {}) as {
      processId?: string;
      cycle?: { minutes: number; left: number | null } | null;
    };
    if (!job.definitionId || !data.processId) return;
    const cfg = await this.prisma.workflowProcessConfig.findUnique({
      where: { processId: data.processId },
    });
    // Only the active deployment of an executable process starts cases.
    if (!cfg?.enabled || cfg.activeDefinitionId !== job.definitionId) return;
    await this.cases.start(data.processId, {}, [], null, null, { system: true });
    const c = data.cycle;
    if (c && (c.left === null || c.left > 0)) {
      const model = await this.config.model(job.definitionId);
      const node = job.elementId ? model.nodes[job.elementId] : undefined;
      await this.prisma.workflowJob.create({
        data: {
          kind: 'START_TIMER',
          definitionId: job.definitionId,
          elementId: job.elementId,
          dueAt: await this.timers.add(
            now,
            Math.max(c.minutes, MIN_TIMER_CYCLE_MINUTES),
            !!node?.exec.workingTime,
          ),
          data: {
            processId: data.processId,
            cycle: { minutes: c.minutes, left: c.left === null ? null : c.left - 1 },
          },
        },
      });
    }
  }

  /** Display values for templates: option labels, user and department names. */
  async displayValues(model: WorkflowModel, vars: Record<string, unknown>, locale: Locale) {
    const fields = new Map<string, FormField>();
    for (const n of Object.values(model.nodes))
      for (const f of n.exec.form?.fields ?? []) if (!fields.has(f.key)) fields.set(f.key, f);
    const display: Record<string, string> = {};
    for (const f of fields.values()) {
      const v = vars[f.key];
      if (v === null || v === undefined) continue;
      const opt = (x: unknown) => {
        const o = f.options.find((o) => o.value === x);
        return o
          ? (locale === 'ar' ? o.labelAr || o.labelEn : o.labelEn || o.labelAr) || o.value
          : String(x);
      };
      if (f.type === 'select' || f.type === 'radio') display[f.key] = opt(v);
      if (f.type === 'multiselect' && Array.isArray(v)) display[f.key] = v.map(opt).join(', ');
      if (f.type === 'user' && typeof v === 'string') {
        const u = await this.prisma.user.findUnique({
          where: { id: v },
          select: { nameEn: true, nameAr: true, email: true },
        });
        if (u)
          display[f.key] =
            (locale === 'ar' ? u.nameAr || u.nameEn : u.nameEn || u.nameAr) || u.email;
      }
      if (f.type === 'department' && typeof v === 'string') {
        const d = await this.prisma.department.findUnique({
          where: { id: v },
          select: { nameEn: true, nameAr: true },
        });
        if (d)
          display[f.key] = (locale === 'ar' ? d.nameAr || d.nameEn : d.nameEn || d.nameAr) ?? '';
      }
    }
    return { display, fields: [...fields.values()] };
  }

  private async document(job: WorkflowJob, now: Date) {
    if (!job.caseId || !job.tokenId || !job.elementId) return;
    if (!(await this.tokenWaiting(job.caseId, job.tokenId))) return;
    const c = await this.prisma.workflowCase.findUniqueOrThrow({
      where: { id: job.caseId },
      include: { process: { select: { nameEn: true, nameAr: true } } },
    });
    const model = await this.config.model(c.definitionId);
    const node = model.nodes[job.elementId];
    const tpl = node?.exec.document;
    if (!tpl) throw new Error('No document template');
    const initiator = c.initiatorId
      ? await this.prisma.user.findUnique({
          where: { id: c.initiatorId },
          select: { locale: true },
        })
      : null;
    const locale: Locale =
      tpl.language === 'INITIATOR' ? (initiator?.locale === 'ar' ? 'ar' : 'en') : tpl.language;
    const vars = (c.variables ?? {}) as Record<string, unknown>;
    const { display, fields } = await this.displayValues(model, vars, locale);
    display['case.number'] = c.number;
    const buffer = await buildCaseDocument({
      template: tpl,
      locale,
      vars,
      display,
      fields,
      caseNumber: c.number,
      processName: locale === 'ar' ? c.process.nameAr || c.process.nameEn : c.process.nameEn,
      generatedAt: now,
    });
    const base = (
      (locale === 'ar' ? tpl.fileNameAr || tpl.fileNameEn : tpl.fileNameEn) || 'document'
    )
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\p{Cc}/gu, '_')
      .slice(0, 100);
    const id = randomUUID();
    const storageKey = `workflow/${c.id}/${id}`;
    await this.storage.put(storageKey, buffer, DOCX);
    await this.runner.execute(
      c.id,
      { type: 'JOB_DONE', tokenId: job.tokenId, variables: { [`${job.elementId}_document`]: id } },
      {
        before: async (tx) => {
          await tx.workflowFile.create({
            data: {
              id,
              caseId: c.id,
              kind: 'GENERATED',
              name: `${base} ${c.number}.docx`,
              mimeType: DOCX,
              size: buffer.length,
              storageKey,
            },
          });
          await tx.workflowEvent.create({
            data: {
              caseId: c.id,
              type: 'DOCUMENT_GENERATED',
              elementId: job.elementId,
              tokenId: job.tokenId,
              data: { fileId: id },
            },
          });
        },
      },
    );
  }

  private async call(job: WorkflowJob) {
    if (!job.caseId || !job.tokenId || !job.elementId) return;
    if (!(await this.tokenWaiting(job.caseId, job.tokenId))) return;
    const existing = await this.prisma.workflowCase.findFirst({
      where: { parentCaseId: job.caseId, parentTokenId: job.tokenId },
      select: { id: true },
    });
    if (existing) return; // idempotent: the called case was already started
    const parent = await this.prisma.workflowCase.findUniqueOrThrow({ where: { id: job.caseId } });
    const node = (await this.config.model(parent.definitionId)).nodes[job.elementId];
    if (!node?.linkedProcessId) throw new AppException(400, 'NOT_EXECUTABLE', 'No linked process');
    // Call chains are bounded (SEC-29): at most MAX_CALL_DEPTH levels, and a process never calls
    // itself through other processes (A → B → A would start cases without end).
    let ancestor: { processId: string; parentCaseId: string | null } | null = parent;
    for (let depth = 1; ancestor; depth++) {
      if (ancestor.processId === node.linkedProcessId || depth >= MAX_CALL_DEPTH)
        throw new AppException(
          400,
          'CALL_FAILED',
          'Call activity refused: recursive call or more than 5 nested calls',
        );
      ancestor = ancestor.parentCaseId
        ? await this.prisma.workflowCase.findUnique({
            where: { id: ancestor.parentCaseId },
            select: { processId: true, parentCaseId: true },
          })
        : null;
    }
    const vars = { ...((parent.variables ?? {}) as Record<string, unknown>) };
    delete vars.case;
    delete vars.process;
    const child = await this.cases
      .start(node.linkedProcessId, {}, [], null, null, {
        system: true,
        parent: { caseId: parent.id, tokenId: job.tokenId },
        vars,
      })
      .catch((e: Error) => {
        throw new AppException(
          400,
          'CALL_FAILED',
          `The linked process cannot be started: ${e.message}`,
        );
      });
    // The called case belongs to the parent's initiator.
    await this.prisma.workflowCase.update({
      where: { id: child.id },
      data: { initiatorId: parent.initiatorId, departmentId: parent.departmentId },
    });
    await this.prisma.workflowEvent.create({
      data: {
        caseId: parent.id,
        type: 'CHILD_STARTED',
        elementId: job.elementId,
        tokenId: job.tokenId,
        data: { childId: child.id, number: child.number },
      },
    });
  }

  private async childDone(job: WorkflowJob) {
    const data = (job.data ?? {}) as {
      childId?: string;
      endKind?: EndKind;
      errorCode?: string | null;
    };
    if (!job.caseId || !job.tokenId || !data.childId) return;
    if (!(await this.tokenWaiting(job.caseId, job.tokenId))) return;
    const child = await this.prisma.workflowCase.findUniqueOrThrow({
      where: { id: data.childId },
      select: { variables: true },
    });
    const vars = { ...((child.variables ?? {}) as Record<string, unknown>) };
    for (const k of ['case', 'process', 'initiator']) delete vars[k];
    await this.runner.execute(job.caseId, {
      type: 'CHILD_COMPLETED',
      tokenId: job.tokenId,
      endKind: data.endKind ?? 'NORMAL',
      errorCode: data.errorCode ?? null,
      variables: vars,
    });
  }

  /** Reminder before due; escalation after due (to the manager and / or the process owner). */
  private async reminder(job: WorkflowJob, now: Date) {
    const taskId = (job.data as { taskId?: string } | null)?.taskId;
    if (!taskId) return;
    const t = await this.prisma.workflowTask.findUnique({
      where: { id: taskId },
      include: {
        candidates: { select: { userId: true } },
        case: {
          select: {
            id: true,
            number: true,
            titleEn: true,
            titleAr: true,
            definitionId: true,
            processId: true,
            departmentId: true,
            parentCaseId: true,
            process: { select: { ownerId: true } },
          },
        },
      },
    });
    if (!t || t.status !== 'OPEN' || !t.dueAt) return;
    const params = {
      ...caseTitleParams(t.case),
      stepEn: t.nameEn,
      stepAr: t.nameAr,
      due: t.dueAt.toISOString(),
    };
    const people = t.assigneeId ? [t.assigneeId] : t.candidates.map((c) => c.userId);
    if (job.kind === 'REMINDER') {
      if (t.reminderSentAt) return;
      await this.notifications.notify({
        userIds: people,
        type: 'WORKFLOW',
        params: { kind: 'reminder', ...params },
        link: taskLink(t.id),
        dedupeKey: `WF_REMINDER:${t.id}`,
      });
      await this.prisma.workflowTask.update({ where: { id: t.id }, data: { reminderSentAt: now } });
      return;
    }
    const settings = await this.settings.get();
    const node = (await this.config.model(t.case.definitionId)).nodes[t.elementId];
    const target =
      !node || node.exec.escalation === 'DEFAULT' ? settings.escalation : node.exec.escalation;
    // Escalation targets (D-150, D-154): the manager of the assignee and / or the process owner.
    // Fallbacks to the process owner: an unclaimed group task (no single assignee whose manager to
    // ask) and an assignee without a manager or who is the department head.
    const owner = t.case.process.ownerId;
    const recipients = new Set<string>();
    if (target !== 'NONE') {
      if (target === 'OWNER' || target === 'BOTH') {
        if (owner) recipients.add(owner);
      }
      if (target === 'MANAGER' || target === 'BOTH') {
        if (!t.assigneeId) {
          if (owner) recipients.add(owner);
        } else {
          const u = await this.prisma.user.findUnique({
            where: { id: t.assigneeId },
            select: { department: { select: { managerId: true } } },
          });
          const manager = u?.department?.managerId;
          if (manager && manager !== t.assigneeId) recipients.add(manager);
          else if (owner) recipients.add(owner);
        }
      }
    }
    // Nobody escalates to themselves.
    if (t.assigneeId) recipients.delete(t.assigneeId);
    const stamp = now.toISOString().slice(0, 13);
    if (!t.case.parentCaseId) {
      this.domainEvents.emit(
        caseEvent('workflow.case.overdue', t.case, {
          step: t.nameEn || t.nameAr,
          due: t.dueAt.toISOString(),
        }),
      );
    }
    await this.notifications.notify({
      userIds: people,
      type: 'WORKFLOW',
      params: { kind: 'overdue', ...params },
      link: taskLink(t.id),
      dedupeKey: `WF_OVERDUE:${t.id}:${stamp}`,
    });
    const assignee = t.assigneeId
      ? await this.prisma.user.findUnique({
          where: { id: t.assigneeId },
          select: { nameEn: true, nameAr: true, email: true },
        })
      : null;
    if (recipients.size)
      await this.notifications.notify({
        userIds: [...recipients],
        type: 'WORKFLOW',
        params: {
          kind: 'escalated',
          ...params,
          actorEn: assignee?.nameEn || assignee?.email || '—',
          actorAr: assignee?.nameAr || assignee?.nameEn || assignee?.email || '—',
        },
        link: `/workflow/cases/${t.case.id}`,
        dedupeKey: `WF_ESCALATED:${t.id}:${stamp}`,
      });
    await this.prisma.$transaction([
      this.prisma.workflowTask.update({ where: { id: t.id }, data: { escalatedAt: now } }),
      this.prisma.workflowEvent.create({
        data: {
          caseId: t.caseId,
          type: 'TASK_ESCALATED',
          elementId: t.elementId,
          tokenId: t.tokenId,
          data: { taskId: t.id, to: [...recipients], target } as Prisma.InputJsonValue,
        },
      }),
    ]);
    if (settings.escalationRepeatHours > 0)
      await this.prisma.workflowJob.create({
        data: {
          kind: 'ESCALATE',
          caseId: t.caseId,
          tokenId: t.tokenId,
          elementId: t.elementId,
          dueAt: (await this.settings.calendar()).addWorkingMinutes(
            now,
            settings.escalationRepeatHours * 60,
          ),
          data: { taskId: t.id },
        },
      });
  }

  /**
   * Retention (D-152): processes with `retentionDays` lose the form data, task data, comments and
   * uploaded files of cases closed longer ago; the case number, steps, dates and decisions stay.
   */
  async purgeExpired(now = new Date()): Promise<number> {
    const cfgs = await this.prisma.workflowProcessConfig.findMany({
      where: { retentionDays: { not: null } },
      select: { processId: true, retentionDays: true },
    });
    let purged = 0;
    for (const cfg of cfgs) {
      const before = new Date(now.getTime() - cfg.retentionDays! * 86_400_000);
      const cases = await this.prisma.workflowCase.findMany({
        where: {
          processId: cfg.processId,
          status: { not: 'RUNNING' },
          completedAt: { lt: before },
          dataPurgedAt: null,
        },
        select: { id: true, variables: true },
        take: 500,
      });
      for (const c of cases) {
        const files = await this.prisma.workflowFile.findMany({
          where: { caseId: c.id },
          select: { storageKey: true },
        });
        for (const f of files) await this.storage.remove(f.storageKey).catch(() => undefined);
        const v = (c.variables ?? {}) as Record<string, unknown>;
        await this.prisma.$transaction([
          this.prisma.workflowFile.deleteMany({ where: { caseId: c.id } }),
          this.prisma.workflowCaseComment.deleteMany({ where: { caseId: c.id } }),
          this.prisma.workflowTask.updateMany({
            where: { caseId: c.id },
            data: { data: Prisma.DbNull, draft: Prisma.DbNull, comment: null },
          }),
          this.prisma.workflowEvent.updateMany({
            where: {
              caseId: c.id,
              type: {
                in: [
                  'STARTED',
                  'TASK_COMPLETED',
                  'TASK_DELEGATED',
                  'TASK_REASSIGNED',
                  'COMMENT',
                  'FILE_ADDED',
                ],
              },
            },
            data: { data: {} },
          }),
          this.prisma.workflowCase.update({
            where: { id: c.id },
            data: {
              variables: {
                case: v.case ?? null,
                process: v.process ?? null,
              } as Prisma.InputJsonValue,
              dataPurgedAt: now,
            },
          }),
        ]);
        purged++;
      }
    }
    return purged;
  }

  /** Label helper for tests. */
  static label = nodeLabel;
}
