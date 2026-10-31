import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  rateRisk,
  worstRag,
  type ProcessFactDto,
  type ProcessStatus,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/auth-user';
import { GrcSettingsService } from '../grc/grc-settings.service';
import { KpiService } from '../kpi/kpi.service';

/** Most processes a value chain asks about at once. */
const MAX_FACTS = 300;

/**
 * Facts about the processes a diagram links to (D-121): status, owner department, worst KPI
 * status (with `kpi.read`) and highest residual risk on their steps (with `grc.read`).
 */
@Injectable()
export class DiagramFactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grcSettings: GrcSettingsService,
    private readonly kpis: KpiService,
  ) {}

  async processFacts(ids: string[], user: AuthUser): Promise<ProcessFactDto[]> {
    const unique = [...new Set(ids)].slice(0, MAX_FACTS);
    if (!unique.length) return [];
    const processes = await this.prisma.process.findMany({
      where: { id: { in: unique }, deletedAt: null },
      include: { department: { select: { id: true, nameEn: true, nameAr: true } } },
    });
    const ids2 = processes.map((p) => p.id);
    const risk = new Map<string, { score: number; band: string | null }>();
    if (user.permissions.has(PERMISSIONS.GRC_READ)) {
      const { bands } = await this.grcSettings.get();
      const links = await this.prisma.objectLink.findMany({
        where: {
          processId: { in: ids2 },
          repoObject: { deletedAt: null, type: 'RISK', risk: { status: { not: 'RETIRED' } } },
        },
        include: { repoObject: { include: { risk: true } } },
      });
      for (const l of links) {
        if (!l.repoObject.risk) continue;
        const r = rateRisk(l.repoObject.risk, bands);
        const cur = risk.get(l.processId);
        if (!cur || r.residualScore > cur.score)
          risk.set(l.processId, { score: r.residualScore, band: r.residualBand });
      }
    }
    const kpi = new Map<string, { rag: ProcessFactDto['kpi']; count: number }>();
    if (user.permissions.has(PERMISSIONS.KPI_READ))
      for (const id of ids2) {
        const items = (await this.kpis.forProcess(id)).items;
        kpi.set(id, { rag: worstRag(items.map((i) => i.rag)), count: items.length });
      }
    return processes.map((p) => ({
      id: p.id,
      code: p.code,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      status: p.status as ProcessStatus,
      department: p.department,
      kpi: kpi.get(p.id)?.rag ?? null,
      kpiCount: kpi.get(p.id)?.count ?? 0,
      risk: risk.get(p.id) ?? null,
    }));
  }
}
