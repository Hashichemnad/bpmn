import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

export interface LiveEvent {
  processId: string;
  caseNumber: string;
  elementId: string;
  activity: string;
  startAt: Date | null;
  endAt: Date;
  performerId: string | null;
  versionNumber: number;
  decision?: string | null;
}

/**
 * Live event log (D-151): every executable process feeds a Phase 5.1 event log (source WORKFLOW) as its
 * steps complete — case = case number, activity = step name (mapped to the BPMN element), start / end,
 * resource and department of the performer (pseudonymised when the process says so). Mining,
 * conformance and mining-based KPIs then work on real executions without an import.
 */
@Injectable()
export class WorkflowEventLogService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async nextCode(tx: Tx) {
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

  /** Creates the live log of a process once (when it becomes executable with the log on). */
  async ensureLog(processId: string, actorId: string | null): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const cfg = await tx.workflowProcessConfig.findUnique({ where: { processId } });
      if (!cfg?.eventLog) return null;
      if (cfg.eventLogId) {
        const exists = await tx.eventLog.findUnique({
          where: { id: cfg.eventLogId },
          select: { id: true },
        });
        if (exists) return exists.id;
      }
      const p = await tx.process.findUniqueOrThrow({
        where: { id: processId },
        select: { code: true, nameEn: true, nameAr: true, ownerId: true, departmentId: true },
      });
      const log = await tx.eventLog.create({
        data: {
          code: await this.nextCode(tx),
          nameEn: `${p.code} ${p.nameEn} — live cases`,
          nameAr: `${p.code} ${p.nameAr || p.nameEn} — الحالات الفعلية`,
          descriptionEn: 'Fed automatically by the executable process (workflow execution).',
          descriptionAr: 'تتم تغذيته تلقائياً من العملية القابلة للتنفيذ (تنفيذ سير العمل).',
          source: 'WORKFLOW',
          status: 'READY',
          processId,
          ownerId: p.ownerId ?? actorId,
          departmentId: p.departmentId,
          pseudonymised: cfg.pseudonymiseLog,
          hasStartTimes: true,
          attributeNames: ['version', 'decision'],
          importedAt: new Date(),
          createdById: actorId,
        },
      });
      await tx.workflowProcessConfig.update({ where: { processId }, data: { eventLogId: log.id } });
      return log.id;
    });
  }

  private pseudonym(logId: string, userId: string) {
    const key =
      this.config.INTEGRATIONS_ENCRYPTION_KEY || this.config.JWT_ACCESS_SECRET || 'processhub';
    return `R-${createHmac('sha256', `${key}:${logId}`).update(userId).digest('hex').slice(0, 8)}`;
  }

  /** Appends one completed step to the process's live log (inside the engine transaction). */
  async record(tx: Tx, e: LiveEvent): Promise<void> {
    const cfg = await tx.workflowProcessConfig.findUnique({
      where: { processId: e.processId },
      select: { eventLog: true, eventLogId: true, pseudonymiseLog: true },
    });
    if (!cfg?.eventLog || !cfg.eventLogId) return;
    const log = await tx.eventLog.findUnique({
      where: { id: cfg.eventLogId },
      select: { id: true, status: true, periodStart: true, periodEnd: true },
    });
    if (!log || log.status !== 'READY') return;
    let resource: string | null = null;
    let department: string | null = null;
    if (e.performerId) {
      const u = await tx.user.findUnique({
        where: { id: e.performerId },
        select: { nameEn: true, email: true, department: { select: { nameEn: true } } },
      });
      resource = cfg.pseudonymiseLog
        ? this.pseudonym(log.id, e.performerId)
        : u?.nameEn || u?.email || null;
      department = u?.department?.nameEn ?? null;
    }
    const caseSeen = await tx.miningEvent.findFirst({
      where: { logId: log.id, caseId: e.caseNumber },
      select: { id: true },
    });
    const activitySeen = await tx.miningEvent.findFirst({
      where: { logId: log.id, caseId: e.caseNumber, activity: e.activity },
      select: { id: true },
    });
    await tx.miningEvent.create({
      data: {
        logId: log.id,
        caseId: e.caseNumber,
        activity: e.activity,
        startAt: e.startAt,
        endAt: e.endAt,
        resource,
        department,
        attributes: { version: String(e.versionNumber), decision: e.decision ?? '' },
      },
    });
    const existing = await tx.miningActivity.findUnique({
      where: { logId_name: { logId: log.id, name: e.activity } },
      select: { name: true },
    });
    await tx.miningActivity.upsert({
      where: { logId_name: { logId: log.id, name: e.activity } },
      create: {
        logId: log.id,
        name: e.activity,
        eventCount: 1,
        caseCount: 1,
        bpmnElementId: e.elementId,
        match: 'LABEL',
      },
      update: {
        eventCount: { increment: 1 },
        ...(activitySeen ? {} : { caseCount: { increment: 1 } }),
      },
    });
    const start = e.startAt ?? e.endAt;
    await tx.eventLog.update({
      where: { id: log.id },
      data: {
        eventCount: { increment: 1 },
        ...(caseSeen ? {} : { caseCount: { increment: 1 } }),
        ...(existing ? {} : { activityCount: { increment: 1 } }),
        periodStart: !log.periodStart || start < log.periodStart ? start : undefined,
        periodEnd: !log.periodEnd || e.endAt > log.periodEnd ? e.endAt : undefined,
        // New data version: cached analyses and the snapshot are rebuilt from the events table.
        dataVersion: { increment: 1 },
        snapshotKey: null,
        importedAt: new Date(),
      },
    });
  }

  /** Recounts resources (cheap, after a batch of cases, e.g. the demo seed). */
  async recount(logId: string) {
    const rows = await this.prisma.miningEvent.findMany({
      where: { logId },
      distinct: ['resource'],
      select: { resource: true },
    });
    await this.prisma.eventLog.update({
      where: { id: logId },
      data: { resourceCount: rows.filter((r) => r.resource).length },
    });
  }
}
