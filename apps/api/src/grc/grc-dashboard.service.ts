import { Injectable } from '@nestjs/common';
import {
  PROCESS_ELEMENT_ID,
  heatMap,
  isEffectiveControl,
  isOverdue,
  rateRisk,
  residualOrInherent,
  testedResidual,
  type GrcBreakdownRow,
  type GrcDashboardDto,
  type GrcDashboardQuery,
  type GrcRef,
  type UncoveredStepDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { elementLabel } from '../models/bpmn-xml';
import { GrcService } from './grc.service';
import { GrcSettingsService } from './grc-settings.service';

interface Link {
  processId: string;
  bpmnElementId: string;
}

/**
 * Risk & Compliance dashboards (Phase 4.1): heat maps, coverage figures and the drill-down
 * department → process → step. Scope: the organisation, one department (processes of that
 * department) or one process. Only active risks and controls count.
 */
@Injectable()
export class GrcDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grc: GrcService,
    private readonly settings: GrcSettingsService,
  ) {}

  private async load() {
    const linkSelect = {
      where: { process: { deletedAt: null } },
      select: { processId: true, bpmnElementId: true },
    } as const;
    const [risks, controls, requirements, processes] = await Promise.all([
      this.prisma.repoObject.findMany({
        where: { type: 'RISK', deletedAt: null, risk: { status: 'ACTIVE' } },
        include: {
          links: linkSelect,
          risk: {
            include: {
              controls: {
                include: {
                  control: {
                    select: {
                      status: true,
                      effectiveness: true,
                      operatingEffectiveness: true,
                      object: { select: { deletedAt: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.repoObject.findMany({
        where: { type: 'CONTROL', deletedAt: null, control: { status: 'ACTIVE' } },
        include: { links: linkSelect, control: true },
      }),
      this.prisma.repoObject.findMany({
        where: { type: 'REQUIREMENT', deletedAt: null, requirement: { status: 'ACTIVE' } },
        include: {
          links: linkSelect,
          requirement: {
            include: {
              controls: { where: { control: { object: { deletedAt: null }, status: 'ACTIVE' } } },
            },
          },
        },
      }),
      this.prisma.process.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true, departmentId: true },
      }),
    ]);
    return { risks, controls, requirements, processes };
  }

  /** Whether a set of links falls in the scope (department / process); org scope: always. */
  private scopeFilter(q: GrcDashboardQuery, deptOf: Map<string, string | null>) {
    return (links: Link[], departmentId?: string | null) => {
      if (q.processId) return links.some((l) => l.processId === q.processId);
      if (q.departmentId)
        return (
          departmentId === q.departmentId ||
          links.some((l) => deptOf.get(l.processId) === q.departmentId)
        );
      return true;
    };
  }

  async dashboard(q: GrcDashboardQuery): Promise<GrcDashboardDto> {
    const settings = await this.settings.get();
    const data = await this.load();
    const deptOf = new Map(data.processes.map((p) => [p.id, p.departmentId]));
    const inScope = this.scopeFilter(q, deptOf);
    const linkInScope = (l: Link) =>
      q.processId
        ? l.processId === q.processId
        : q.departmentId
          ? deptOf.get(l.processId) === q.departmentId
          : true;

    const risks = data.risks
      .filter((r) => inScope(r.links, r.risk!.departmentId))
      .map((r) => {
        const rating = rateRisk(r.risk!, settings.bands);
        const effective = r.risk!.controls.some(
          (c) => !c.control.object.deletedAt && isEffectiveControl(c.control),
        );
        return { o: r, rating, effective, controls: r.risk!.controls.length };
      });
    const controls = data.controls.filter((c) => inScope(c.links, c.control!.departmentId));
    const requirements = data.requirements.filter((r) =>
      inScope(r.links, r.requirement!.departmentId),
    );

    // Steps (and processes) with risks but no control.
    const steps = this.stepCoverage(data.risks, data.controls, linkInScope);
    const uncovered = [...steps.values()].filter((s) => s.risks.size && !s.controls);

    const breakdown = await this.breakdown(q, data, risks, steps);
    return {
      heatMap: {
        inherent: heatMap(
          risks.map((r) => ({
            likelihood: r.o.risk!.inherentLikelihood,
            impact: r.o.risk!.inherentImpact,
          })),
        ),
        residual: heatMap(
          risks.map((r) =>
            q.tested
              ? testedResidual(
                  r.o.risk!,
                  r.o
                    .risk!.controls.filter((c) => !c.control.object.deletedAt)
                    .map((c) => c.control),
                )
              : residualOrInherent(r.o.risk!),
          ),
        ),
        total: risks.length,
      },
      coverage: {
        risksWithoutControls: risks.filter((r) => !r.controls).length,
        alertRisks: risks.filter((r) => r.rating.alert).length,
        alertRisksWithoutEffectiveControl: risks.filter((r) => r.rating.alert && !r.effective)
          .length,
        keyControlsAttention: controls.filter(
          (c) =>
            c.control!.keyControl &&
            (c.control!.effectiveness === 'NOT_ASSESSED' ||
              c.control!.effectiveness === 'NOT_EFFECTIVE'),
        ).length,
        requirementsWithoutControls: requirements.filter((r) => !r.requirement!.controls.length)
          .length,
        stepsWithRiskNoControl: uncovered.filter((s) => s.elementId !== PROCESS_ELEMENT_ID).length,
        processesWithRiskNoControl: new Set(uncovered.map((s) => s.processId)).size,
        overdueReviews:
          risks.filter((r) => isOverdue(r.o.risk!.nextReviewAt)).length +
          controls.filter((c) => isOverdue(c.control!.nextReviewAt)).length,
      },
      breakdown,
    };
  }

  /** Risks and controls linked to each step (key "processId|elementId"). */
  private stepCoverage(
    risks: {
      id: string;
      type: string;
      code: string | null;
      nameEn: string;
      nameAr: string;
      links: Link[];
    }[],
    controls: { links: Link[] }[],
    linkInScope: (l: Link) => boolean,
  ) {
    const steps = new Map<
      string,
      { processId: string; elementId: string; risks: Map<string, GrcRef>; controls: number }
    >();
    const at = (l: Link) => {
      const key = `${l.processId}|${l.bpmnElementId}`;
      let s = steps.get(key);
      if (!s) {
        s = { processId: l.processId, elementId: l.bpmnElementId, risks: new Map(), controls: 0 };
        steps.set(key, s);
      }
      return s;
    };
    for (const r of risks)
      for (const l of r.links.filter(linkInScope))
        at(l).risks.set(r.id, {
          id: r.id,
          type: 'RISK',
          code: r.code,
          nameEn: r.nameEn,
          nameAr: r.nameAr,
          status: 'ACTIVE',
        });
    for (const c of controls) for (const l of c.links.filter(linkInScope)) at(l).controls++;
    return steps;
  }

  private async breakdown(
    q: GrcDashboardQuery,
    data: Awaited<ReturnType<GrcDashboardService['load']>>,
    risks: { o: { id: string; links: Link[] }; rating: { alert: boolean }; controls: number }[],
    steps: ReturnType<GrcDashboardService['stepCoverage']>,
  ): Promise<GrcDashboardDto['breakdown']> {
    const row = (
      id: string,
      code: string | null,
      nameEn: string,
      nameAr: string,
      match: (l: Link) => boolean,
    ): GrcBreakdownRow => {
      const rs = risks.filter((r) => r.o.links.some(match));
      return {
        id,
        code,
        nameEn,
        nameAr,
        risks: rs.length,
        alerts: rs.filter((r) => r.rating.alert).length,
        withoutControls: [...steps.values()].filter(
          (s) =>
            s.risks.size &&
            !s.controls &&
            match({ processId: s.processId, bpmnElementId: s.elementId }),
        ).length,
      };
    };
    if (q.processId) {
      const labels = (await this.grc.labels([q.processId])).get(q.processId) ?? new Map();
      return {
        level: 'step',
        rows: [...steps.values()]
          .filter((s) => s.processId === q.processId)
          .map((s) => ({
            id: s.elementId,
            code: null,
            nameEn: elementLabel(labels, s.elementId)?.nameEn || s.elementId,
            nameAr: elementLabel(labels, s.elementId)?.nameAr || s.elementId,
            risks: s.risks.size,
            alerts: [...s.risks.keys()].filter(
              (id) => risks.find((r) => r.o.id === id)?.rating.alert,
            ).length,
            withoutControls: s.risks.size && !s.controls ? 1 : 0,
          })),
      };
    }
    if (q.departmentId) {
      return {
        level: 'process',
        rows: data.processes
          .filter((p) => p.departmentId === q.departmentId)
          .map((p) => row(p.id, p.code, p.nameEn, p.nameAr, (l) => l.processId === p.id))
          .filter((r) => r.risks > 0),
      };
    }
    const deptOf = new Map(data.processes.map((p) => [p.id, p.departmentId]));
    const departments = await this.prisma.department.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: 'asc' },
    });
    return {
      level: 'department',
      rows: departments
        .map((d) => row(d.id, d.code, d.nameEn, d.nameAr, (l) => deptOf.get(l.processId) === d.id))
        .filter((r) => r.risks > 0),
    };
  }

  /** Steps (and whole processes) with linked risks but no linked control, with labels. */
  async uncoveredSteps(q: GrcDashboardQuery): Promise<UncoveredStepDto[]> {
    const data = await this.load();
    const deptOf = new Map(data.processes.map((p) => [p.id, p.departmentId]));
    const linkInScope = (l: Link) =>
      q.processId
        ? l.processId === q.processId
        : q.departmentId
          ? deptOf.get(l.processId) === q.departmentId
          : true;
    const steps = [...this.stepCoverage(data.risks, data.controls, linkInScope).values()].filter(
      (s) => s.risks.size && !s.controls,
    );
    const labels = await this.grc.labels([...new Set(steps.map((s) => s.processId))]);
    const procs = new Map(data.processes.map((p) => [p.id, p]));
    return steps
      .map((s) => {
        const p = procs.get(s.processId)!;
        return {
          process: { id: p.id, code: p.code, nameEn: p.nameEn, nameAr: p.nameAr },
          bpmnElementId: s.elementId,
          element: elementLabel(labels.get(s.processId) ?? new Map(), s.elementId),
          risks: [...s.risks.values()],
        };
      })
      .sort(
        (a, b) =>
          a.process.code.localeCompare(b.process.code, undefined, { numeric: true }) ||
          a.bpmnElementId.localeCompare(b.bpmnElementId),
      );
  }
}
