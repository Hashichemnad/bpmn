import { Injectable } from '@nestjs/common';
import type { PortalPerformanceDto } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../common/app-exception';
import { MiningSettingsService } from './mining-settings.service';
import { MiningAnalysisService } from './analysis.service';
import { ConformanceService } from './conformance.service';

/**
 * "Performance" tab of a published process in the Knowledge Portal (Phase 5.1, D-142): off by
 * default (Setting `mining.portalPerformance`); throughput time trend and conformance of the most
 * recent event log linked to the process — aggregated values only, never cases, resources or the
 * log itself (logs stay restricted to their owner, department and granted users).
 */
@Injectable()
export class MiningPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: MiningSettingsService,
    private readonly analysis: MiningAnalysisService,
    private readonly conformance: ConformanceService,
  ) {}

  async performance(processId: string): Promise<PortalPerformanceDto> {
    if (!(await this.settings.get()).portalPerformance) throw notFound('Performance');
    const published = await this.prisma.publication.findFirst({
      where: { entityType: 'PROCESS', entityId: processId, current: true },
    });
    if (!published) throw notFound('Process');
    const log = await this.prisma.eventLog.findFirst({
      where: { processId, status: 'READY' },
      orderBy: { importedAt: 'desc' },
    });
    if (!log) throw notFound('Performance');
    const a = await this.analysis.analyse(log.id, {}, null, 30_000);
    if (!a.result) throw notFound('Performance');
    const mapped = await this.prisma.miningActivity.count({
      where: { logId: log.id, bpmnElementId: { not: null } },
    });
    const c = mapped
      ? await this.conformance.conformance(log.id, {}, null, 30_000).catch(() => null)
      : null;
    const tp = a.result.stats.throughput;
    return {
      periodStart: log.periodStart?.toISOString() ?? null,
      periodEnd: log.periodEnd?.toISOString() ?? null,
      cases: a.result.cases,
      throughput: tp ? { mean: tp.mean, median: tp.median, p90: tp.p90 } : null,
      trend: a.result.stats.trend.map(({ period, completed, meanMs }) => ({
        period,
        completed,
        meanMs,
      })),
      granularity: a.result.stats.granularity,
      conformance: c?.result
        ? { conformingShare: c.result.conformingShare, fitness: c.result.fitness }
        : null,
    };
  }
}
