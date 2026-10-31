import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  parseBpmnGraph,
  periodStart,
  shiftPeriod,
  type KpiFrequency,
  type MiningMetric,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-user';
import { badRequest, notFound } from '../common/app-exception';
import { MiningJobsService, type JobContext } from './jobs/mining-jobs.service';
import { MiningScheduler } from './mining-scheduler.service';
import { SnapshotService } from './snapshot.service';

/**
 * KPIs calculated from event logs (Phase 5.1, D-136): a job writes one measurement per completed
 * period (source EVENT_LOG) for every active KPI of a log; status comes from the KPI's thresholds
 * as for any measurement. Runs after each import of the log, daily from the scheduler and on demand.
 */
@Injectable()
export class MiningKpiService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: MiningJobsService,
    private readonly snapshots: SnapshotService,
    private readonly scheduler: MiningScheduler,
  ) {}

  onModuleInit() {
    this.jobs.register('KPI', (ctx) => this.run(ctx));
    this.scheduler.register(async (now) => {
      // Once a day is enough: the values change with imports, which trigger their own run.
      if (now.getUTCHours() !== 2) return;
      await this.enqueueForLog(null);
    });
  }

  /** Queues a calculation for the KPIs of one log (or all logs); nothing when no KPI uses it. */
  async enqueueForLog(logId: string | null, userId: string | null = null) {
    const n = await this.prisma.kpi.count({
      where: { dataSource: 'EVENT_LOG', status: 'ACTIVE', miningLogId: logId ?? { not: null } },
    });
    if (!n) return null;
    return this.jobs.enqueue({ kind: 'KPI', logId, params: { logId }, userId });
  }

  async recalculate(kpiId: string, user: AuthUser) {
    const kpi = await this.prisma.kpi.findUnique({ where: { objectId: kpiId } });
    if (!kpi) throw notFound('KPI');
    if (kpi.dataSource !== 'EVENT_LOG' || !kpi.miningLogId) throw badRequest('NOT_CALCULATED');
    const job = await this.jobs.enqueue({
      kind: 'KPI',
      logId: kpi.miningLogId,
      params: { logId: kpi.miningLogId, kpiId },
      userId: user.id,
    });
    return this.jobs.wait(job.id, 30_000);
  }

  private async run(ctx: JobContext) {
    const { logId, kpiId } = ctx.job.params as { logId: string | null; kpiId?: string };
    const kpis = await this.prisma.kpi.findMany({
      where: {
        dataSource: 'EVENT_LOG',
        status: 'ACTIVE',
        miningLogId: logId ?? { not: null },
        ...(kpiId ? { objectId: kpiId } : {}),
        object: { deletedAt: null },
      },
      include: { object: { select: { code: true } } },
    });
    const byLog = new Map<string, typeof kpis>();
    for (const k of kpis) byLog.set(k.miningLogId!, [...(byLog.get(k.miningLogId!) ?? []), k]);
    const now = Date.now();
    let written = 0;
    for (const [id, list] of byLog) {
      const log = await this.prisma.eventLog.findUnique({ where: { id } });
      if (!log || log.status !== 'READY') continue;
      const slaByActivity = await this.slaByActivity(log.id, log.processId);
      const bytes = await this.snapshots.load(log);
      const results = await ctx.worker<
        { id: string; values: Record<string, { value: number; cases: number }> }[]
      >('miningKpis', {
        bytes,
        kpis: list.map((k) => ({
          id: k.objectId,
          metric: k.calculatedMetric as MiningMetric,
          frequency: k.frequency as KpiFrequency,
        })),
        slaByActivity,
      });
      for (const r of results) {
        const k = list.find((x) => x.objectId === r.id)!;
        const periods = Object.entries(r.values).filter(
          // Completed periods only: the next period has started.
          ([p]) => periodStart(shiftPeriod(p, k.frequency as KpiFrequency, 1)).getTime() <= now,
        );
        for (const [period, v] of periods) {
          await this.prisma.kpiMeasurement.upsert({
            where: { kpiId_period: { kpiId: k.objectId, period } },
            create: {
              kpiId: k.objectId,
              period,
              periodStart: periodStart(period),
              value: v.value,
              comment: `${log.code}: ${v.cases}`,
              source: 'EVENT_LOG',
            },
            update: { value: v.value, comment: `${log.code}: ${v.cases}`, source: 'EVENT_LOG' },
          });
          written++;
        }
        await this.audit.log({
          action: 'SYNC',
          entityType: 'Kpi',
          entityId: k.objectId,
          userId: ctx.job.createdById,
          summary: {
            code: k.object.code,
            log: log.code,
            periods: periods.length,
            source: 'EVENT_LOG',
          },
        });
      }
    }
    return { kpis: kpis.length, measurements: written };
  }

  /** SLA minutes of the step each activity is mapped to (`ph:slaMinutes`). */
  private async slaByActivity(logId: string, processId: string | null) {
    if (!processId) return {};
    const model = await this.prisma.processModel.findUnique({ where: { processId } });
    if (!model) return {};
    const sla = new Map(
      parseBpmnGraph(model.bpmnXml)
        .nodes.filter((n) => n.attributes.slaMinutes !== undefined)
        .map((n) => [n.id, n.attributes.slaMinutes!]),
    );
    const acts = await this.prisma.miningActivity.findMany({ where: { logId } });
    const out: Record<string, number> = {};
    for (const a of acts)
      if (a.bpmnElementId && sla.has(a.bpmnElementId)) out[a.name] = sla.get(a.bpmnElementId)!;
    return out;
  }
}
