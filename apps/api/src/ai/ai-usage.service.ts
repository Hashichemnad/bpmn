import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AiFeature,
  AiUsageQuery,
  AiUsageReportDto,
  AiUsageTotalsDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AiSettingsService } from './ai-settings.service';

interface Agg {
  _count: { _all: number };
  _sum: { inputTokens: number | null; outputTokens: number | null };
}

const monthKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** AI usage report for administrators: totals per user, feature, model and month (UTC). */
@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
  ) {}

  async report(q: AiUsageQuery): Promise<AiUsageReportDto> {
    const month = q.month ?? monthKey(new Date());
    const [y, m] = month.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const where: Prisma.AiUsageWhereInput = { createdAt: { gte: from, lt: to } };
    const sums = {
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    } as const;

    const [all, byUser, byFeature, byModel, errors, monthly, settings] = await Promise.all([
      this.prisma.aiUsage.aggregate({ where, ...sums }),
      this.prisma.aiUsage.groupBy({ by: ['userId'], where, ...sums }),
      this.prisma.aiUsage.groupBy({ by: ['feature'], where, ...sums }),
      this.prisma.aiUsage.groupBy({ by: ['model'], where, ...sums }),
      this.prisma.aiUsage.groupBy({
        by: ['userId', 'feature', 'model'],
        where: { ...where, status: { not: 'SUCCESS' } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<
        { month: Date; requests: bigint; input: bigint; output: bigint; errors: bigint }[]
      >(
        Prisma.sql`SELECT date_trunc('month', "createdAt") AS month, count(*) AS requests,
          coalesce(sum("inputTokens"), 0) AS input, coalesce(sum("outputTokens"), 0) AS output,
          count(*) FILTER (WHERE status <> 'SUCCESS') AS errors
        FROM "AiUsage" WHERE "createdAt" >= ${new Date(Date.UTC(y, m - 12, 1))} AND "createdAt" < ${to}
        GROUP BY 1 ORDER BY 1`,
      ),
      this.settings.get(),
    ]);
    const errorsBy = (pick: (e: (typeof errors)[number]) => string | null, key: string | null) =>
      errors.filter((e) => pick(e) === key).reduce((n, e) => n + e._count._all, 0);
    const totals = (a: Agg, errorCount: number): AiUsageTotalsDto => ({
      requests: a._count._all,
      inputTokens: a._sum.inputTokens ?? 0,
      outputTokens: a._sum.outputTokens ?? 0,
      errors: errorCount,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: byUser.map((u) => u.userId).filter((v): v is string => !!v) } },
      select: { id: true, email: true, nameEn: true, nameAr: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));
    const months = new Map(monthly.map((r) => [monthKey(new Date(r.month)), r]));
    return {
      month,
      orgMonthlyLimit: settings.orgMonthlyLimit,
      totals: totals(
        all,
        errors.reduce((n, e) => n + e._count._all, 0),
      ),
      byUser: byUser
        .map((u) => ({
          ...totals(
            u,
            errorsBy((e) => e.userId, u.userId),
          ),
          user: u.userId ? (userById.get(u.userId) ?? null) : null,
        }))
        .sort((a, b) => b.requests - a.requests),
      byFeature: byFeature
        .map((f) => ({
          ...totals(
            f,
            errorsBy((e) => e.feature, f.feature),
          ),
          feature: f.feature as AiFeature,
        }))
        .sort((a, b) => b.requests - a.requests),
      byModel: byModel
        .map((f) => ({
          ...totals(
            f,
            errorsBy((e) => e.model, f.model),
          ),
          model: f.model,
        }))
        .sort((a, b) => b.requests - a.requests),
      byMonth: Array.from({ length: 12 }, (_, i) => {
        const key = monthKey(new Date(Date.UTC(y, m - 12 + i, 1)));
        const r = months.get(key);
        return {
          month: key,
          requests: Number(r?.requests ?? 0),
          inputTokens: Number(r?.input ?? 0),
          outputTokens: Number(r?.output ?? 0),
          errors: Number(r?.errors ?? 0),
        };
      }),
    };
  }
}
