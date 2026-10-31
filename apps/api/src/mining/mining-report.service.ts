import { Injectable } from '@nestjs/common';
import { PERMISSIONS, type Locale, type SimulationResult } from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/auth-user';
import { MiningAnalysisService } from './analysis.service';
import { ConformanceService } from './conformance.service';

/**
 * Handbook section "Performance analysis" (Phase 5.1, D-142): per process the mining summary of the
 * most recent log the user may see and the comparison of its latest simulation — aggregated values.
 */
@Injectable()
export class MiningReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analysis: MiningAnalysisService,
    private readonly conformance: ConformanceService,
  ) {}

  async performance(
    processIds: string[],
    user: AuthUser,
    locale: Locale,
  ): Promise<Map<string, [string, string][]>> {
    const out = new Map<string, [string, string][]>();
    if (!user.permissions.has(PERMISSIONS.MINING_READ)) return out;
    const ar = locale === 'ar';
    const L = (en: string, a: string) => (ar ? a : en);
    const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    const pct = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
    const hours = (ms: number | undefined) =>
      ms === undefined ? '—' : `${nf.format(ms / 3_600_000)} ${L('h', 'س')}`;
    const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');
    for (const id of processIds) {
      const rows: [string, string][] = [];
      const logs = await this.conformance.processLogs(id, user);
      const log = logs[0];
      if (log) {
        const a = await this.analysis.analyse(log.id, {}, user, 60_000).catch(() => null);
        const r = a?.result;
        rows.push([
          L('Event log', 'سجل الأحداث'),
          `${log.code} · ${nf.format(log.caseCount)} ${L('cases', 'حالة')} · ${date(log.periodStart ? new Date(log.periodStart) : null)} – ${date(log.periodEnd ? new Date(log.periodEnd) : null)}`,
        ]);
        if (r?.stats.throughput)
          rows.push([
            L('Throughput time (mean / median / P90)', 'مدة الإنجاز (المتوسط / الوسيط / P90)'),
            `${hours(r.stats.throughput.mean)} / ${hours(r.stats.throughput.median)} / ${hours(r.stats.throughput.p90)}`,
          ]);
        if (r) {
          rows.push([
            L('Variants', 'المتغيرات'),
            `${nf.format(r.variants.total)} · ${L('most frequent', 'الأكثر تكراراً')} ${pct.format(r.variants.items[0]?.share ?? 0)}`,
          ]);
          rows.push([
            L('Cases with rework', 'الحالات بإعادة عمل'),
            pct.format(r.stats.rework.share),
          ]);
          const slow = r.bottlenecks.edges[0];
          if (slow?.duration)
            rows.push([
              L('Slowest transition', 'أبطأ انتقال'),
              `${slow.from} → ${slow.to} (${hours(slow.duration.mean)})`,
            ]);
        }
        if (log.mappedActivities) {
          const c = await this.conformance.conformance(log.id, {}, user, 60_000).catch(() => null);
          if (c?.result)
            rows.push([
              L(
                'Conformance (cases following the model / fitness)',
                'المطابقة (الحالات المطابقة / الملاءمة)',
              ),
              `${pct.format(c.result.conformingShare)} / ${pct.format(c.result.fitness)}`,
            ]);
        }
      }
      const sim = await this.prisma.simulation.findFirst({
        where: { processId: id, scenarios: { some: { ranAt: { not: null } } } },
        include: { scenarios: { where: { ranAt: { not: null } }, orderBy: { sortOrder: 'asc' } } },
        orderBy: { updatedAt: 'desc' },
      });
      for (const sc of sim?.scenarios ?? []) {
        const res = sc.result as SimulationResult | null;
        if (!res) continue;
        const maxU = Math.max(0, ...res.resources.map((x) => x.utilisation));
        rows.push([
          `${sim!.code} · ${(ar ? sc.nameAr : sc.nameEn) || sc.nameEn || sc.nameAr}`,
          `${L('throughput', 'مدة الإنجاز')} ${hours(res.throughput ? res.throughput.mean * 3_600_000 : undefined)} (P90 ${hours(res.throughput ? res.throughput.p90 * 3_600_000 : undefined)}) · ${L('cost per case', 'التكلفة لكل حالة')} ${nf.format(res.costPerCase)} · ${L('highest utilisation', 'أعلى استخدام')} ${pct.format(maxU)}`,
        ]);
      }
      out.set(id, rows);
    }
    return out;
  }
}
