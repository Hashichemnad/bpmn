import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  REPORTING_TABLES,
  kpiRag,
  thresholdsFor,
  type PublicPage,
  type ReportingQuery,
  type ReportingTable,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { ApiKeyPrincipal } from './api-keys.service';
import type { Dated } from './public-api.service';

type Row = Record<string, string | number | boolean | null>;

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;
const round1 = (v: number | null | undefined) =>
  typeof v === 'number' ? Math.round(v * 10) / 10 : null;
const maxDate = (dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

/**
 * Reporting feed for Power BI and Excel (Phase 4.4, D-175): flat, paged JSON tables with one row per
 * fact and plain columns (bilingual names side by side), read with an API key carrying
 * `reporting:read`. Published keys see published processes only; the department filter of the key
 * applies wherever a row has a department. Workflow and mining tables are aggregated (no case data).
 */
@Injectable()
export class ReportingService {
  constructor(private readonly prisma: PrismaService) {}

  tables() {
    return REPORTING_TABLES.map((t) => ({ name: t, path: `/api/public/v1/reporting/${t}` }));
  }

  async table(
    key: ApiKeyPrincipal,
    table: ReportingTable,
    q: ReportingQuery,
  ): Promise<Dated<PublicPage<Row>>> {
    const paging = { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
    const res = await this.load(key, table, q, paging);
    return {
      body: { items: res.items, total: res.total, page: q.page, pageSize: q.pageSize },
      lastModified: res.lastModified,
    };
  }

  private dept(key: ApiKeyPrincipal) {
    return key.departmentIds.length ? { departmentId: { in: key.departmentIds } } : {};
  }

  private async processWhere(key: ApiKeyPrincipal): Promise<Prisma.ProcessWhereInput> {
    const base: Prisma.ProcessWhereInput = { deletedAt: null, ...this.dept(key) };
    if (key.content !== 'PUBLISHED') return base;
    const ids = (
      await this.prisma.publication.findMany({
        where: { entityType: 'PROCESS', current: true },
        select: { entityId: true },
      })
    ).map((p) => p.entityId);
    return { ...base, id: { in: ids } };
  }

  private since(q: ReportingQuery, field = 'updatedAt') {
    return q.updatedSince ? { [field]: { gt: new Date(q.updatedSince) } } : {};
  }

  private async load(
    key: ApiKeyPrincipal,
    table: ReportingTable,
    q: ReportingQuery,
    paging: { skip: number; take: number },
  ): Promise<{ items: Row[]; total: number; lastModified: Date | null }> {
    const now = new Date();
    switch (table) {
      case 'processes': {
        const where: Prisma.ProcessWhereInput = {
          AND: [await this.processWhere(key), this.since(q)],
        };
        const [rows, total] = await Promise.all([
          this.prisma.process.findMany({
            where,
            orderBy: [{ code: 'asc' }, { id: 'asc' }],
            ...paging,
            include: {
              owner: { select: { nameEn: true, nameAr: true, email: true } },
              department: { select: { nameEn: true, nameAr: true } },
            },
          }),
          this.prisma.process.count({ where }),
        ]);
        const pubs = await this.prisma.publication.findMany({
          where: { entityType: 'PROCESS', current: true, entityId: { in: rows.map((r) => r.id) } },
        });
        const pubOf = new Map(pubs.map((p) => [p.entityId, p]));
        return {
          items: rows.map((p) => {
            const pub = pubOf.get(p.id);
            return {
              processId: p.id,
              code: p.code,
              nameEn: p.nameEn,
              nameAr: p.nameAr,
              category: p.category,
              level: p.level,
              parentId: p.parentId,
              status: p.status,
              ownerNameEn: p.owner?.nameEn ?? null,
              ownerNameAr: p.owner?.nameAr ?? null,
              ownerEmail: p.owner?.email ?? null,
              departmentId: p.departmentId,
              departmentEn: p.department?.nameEn ?? null,
              departmentAr: p.department?.nameAr ?? null,
              publishedVersion: pub?.versionNumber ?? null,
              lastApprovedAt: iso(pub?.approvedAt),
              publishedAt: iso(pub?.publishedAt),
              nextReviewAt: day(p.nextReviewAt),
              reviewOverdue: !!p.nextReviewAt && p.nextReviewAt < now,
              updatedAt: iso(p.updatedAt),
            };
          }),
          total,
          lastModified: maxDate(rows.map((r) => r.updatedAt)),
        };
      }
      case 'reviews': {
        const procIds =
          key.content === 'PUBLISHED' || key.departmentIds.length
            ? (
                await this.prisma.process.findMany({
                  where: await this.processWhere(key),
                  select: { id: true },
                })
              ).map((p) => p.id)
            : null;
        const where: Prisma.ReviewWhereInput = {
          ...(procIds ? { entityType: 'PROCESS', entityId: { in: procIds } } : {}),
          ...(q.updatedSince ? { submittedAt: { gt: new Date(q.updatedSince) } } : {}),
        };
        const [rows, total] = await Promise.all([
          this.prisma.review.findMany({ where, orderBy: { submittedAt: 'desc' }, ...paging }),
          this.prisma.review.count({ where }),
        ]);
        const names = await this.itemNames(
          rows.map((r) => ({ type: r.entityType, id: r.entityId })),
        );
        return {
          items: rows.map((r) => {
            const steps = (r.steps as { nameEn?: string; nameAr?: string }[] | null) ?? [];
            const step = steps[r.currentStep];
            const item = names.get(`${r.entityType}:${r.entityId}`);
            return {
              reviewId: r.id,
              itemType: r.entityType,
              itemId: r.entityId,
              itemCode: item?.code ?? null,
              itemNameEn: item?.nameEn ?? null,
              itemNameAr: item?.nameAr ?? null,
              versionNumber: r.versionNumber,
              status: r.status,
              workflowEn: r.workflowNameEn,
              workflowAr: r.workflowNameAr,
              currentStepEn: r.status === 'IN_PROGRESS' ? (step?.nameEn ?? null) : null,
              currentStepAr: r.status === 'IN_PROGRESS' ? (step?.nameAr ?? null) : null,
              submittedAt: iso(r.submittedAt),
              dueAt: iso(r.dueAt),
              completedAt: iso(r.completedAt),
              overdue: r.status === 'IN_PROGRESS' && !!r.dueAt && r.dueAt < now,
              daysOpen: Math.round(
                ((r.completedAt ?? now).getTime() - r.submittedAt.getTime()) / 86_400_000,
              ),
            };
          }),
          total,
          lastModified: maxDate(rows.map((r) => r.completedAt ?? r.submittedAt)),
        };
      }
      case 'kpis': {
        const where: Prisma.KpiWhereInput = {
          ...(key.content === 'PUBLISHED' ? { status: 'ACTIVE' as const } : {}),
          ...this.dept(key),
          object: { deletedAt: null, ...this.since(q) },
        };
        const [rows, total] = await Promise.all([
          this.prisma.kpi.findMany({
            where,
            orderBy: { object: { code: 'asc' } },
            ...paging,
            include: {
              object: { include: { owner: { select: { nameEn: true, nameAr: true } } } },
              department: { select: { nameEn: true, nameAr: true } },
            },
          }),
          this.prisma.kpi.count({ where }),
        ]);
        return {
          items: rows.map((k) => ({
            kpiId: k.objectId,
            code: k.object.code,
            nameEn: k.object.nameEn,
            nameAr: k.object.nameAr,
            unit: k.unit,
            direction: k.direction,
            frequency: k.frequency,
            target: k.target,
            greenThreshold: k.greenThreshold,
            redThreshold: k.redThreshold,
            baseline: k.baseline,
            status: k.status,
            dataSource: k.dataSource,
            ownerNameEn: k.object.owner?.nameEn ?? null,
            ownerNameAr: k.object.owner?.nameAr ?? null,
            departmentId: k.departmentId,
            departmentEn: k.department?.nameEn ?? null,
            departmentAr: k.department?.nameAr ?? null,
            updatedAt: iso(k.object.updatedAt),
          })),
          total,
          lastModified: maxDate(rows.map((r) => r.object.updatedAt)),
        };
      }
      case 'kpi-measurements': {
        const where: Prisma.KpiMeasurementWhereInput = {
          kpi: {
            ...(key.content === 'PUBLISHED' ? { status: 'ACTIVE' as const } : {}),
            ...this.dept(key),
            object: { deletedAt: null },
          },
          ...this.since(q),
        };
        const [rows, total] = await Promise.all([
          this.prisma.kpiMeasurement.findMany({
            where,
            orderBy: [{ kpiId: 'asc' }, { periodStart: 'asc' }],
            ...paging,
            include: { kpi: { include: { periodTargets: true } } },
          }),
          this.prisma.kpiMeasurement.count({ where }),
        ]);
        return {
          items: rows.map((m) => {
            const t = thresholdsFor(m.kpi, m.period, m.kpi.periodTargets);
            return {
              measurementId: m.id,
              kpiId: m.kpiId,
              period: m.period,
              periodStart: day(m.periodStart),
              value: m.value,
              target: t.target,
              rag: kpiRag(m.value, t),
              source: m.source,
              updatedAt: iso(m.updatedAt),
            };
          }),
          total,
          lastModified: maxDate(rows.map((r) => r.updatedAt)),
        };
      }
      case 'risks': {
        const where: Prisma.RiskWhereInput = {
          ...(key.content === 'PUBLISHED' ? { status: 'ACTIVE' as const } : {}),
          ...this.dept(key),
          object: { deletedAt: null, ...this.since(q) },
        };
        const [rows, total] = await Promise.all([
          this.prisma.risk.findMany({
            where,
            orderBy: { object: { code: 'asc' } },
            ...paging,
            include: { object: true, _count: { select: { controls: true } } },
          }),
          this.prisma.risk.count({ where }),
        ]);
        const linked = await this.linkedProcesses(rows.map((r) => r.objectId));
        return {
          items: rows.map((r) => ({
            riskId: r.objectId,
            code: r.object.code,
            nameEn: r.object.nameEn,
            nameAr: r.object.nameAr,
            category: r.category,
            status: r.status,
            response: r.response,
            departmentId: r.departmentId,
            inherentLikelihood: r.inherentLikelihood,
            inherentImpact: r.inherentImpact,
            inherentScore: r.inherentLikelihood * r.inherentImpact,
            residualLikelihood: r.residualLikelihood,
            residualImpact: r.residualImpact,
            residualScore:
              r.residualLikelihood && r.residualImpact
                ? r.residualLikelihood * r.residualImpact
                : null,
            controls: r._count.controls,
            linkedProcesses: linked.get(r.objectId) ?? 0,
            lastAssessedAt: iso(r.lastAssessedAt),
            nextReviewAt: day(r.nextReviewAt),
          })),
          total,
          lastModified: maxDate(rows.map((r) => r.object.updatedAt)),
        };
      }
      case 'controls': {
        const where: Prisma.ControlWhereInput = {
          ...(key.content === 'PUBLISHED' ? { status: 'ACTIVE' as const } : {}),
          ...this.dept(key),
          object: { deletedAt: null, ...this.since(q) },
        };
        const [rows, total] = await Promise.all([
          this.prisma.control.findMany({
            where,
            orderBy: { object: { code: 'asc' } },
            ...paging,
            include: { object: true, _count: { select: { risks: true } } },
          }),
          this.prisma.control.count({ where }),
        ]);
        const linked = await this.linkedProcesses(rows.map((r) => r.objectId));
        return {
          items: rows.map((c) => ({
            controlId: c.objectId,
            code: c.object.code,
            nameEn: c.object.nameEn,
            nameAr: c.object.nameAr,
            controlType: c.controlType,
            nature: c.nature,
            frequency: c.frequency,
            keyControl: c.keyControl,
            status: c.status,
            departmentId: c.departmentId,
            designEffectiveness: c.effectiveness,
            operatingEffectiveness: c.operatingEffectiveness,
            risks: c._count.risks,
            linkedProcesses: linked.get(c.objectId) ?? 0,
            lastTestedAt: iso(c.lastTestedAt),
          })),
          total,
          lastModified: maxDate(rows.map((r) => r.object.updatedAt)),
        };
      }
      case 'risk-coverage': {
        // Per process: steps linked to risks / controls (ObjectLink), from the working model links.
        const procWhere = await this.processWhere(key);
        const where: Prisma.ProcessWhereInput = { AND: [procWhere, this.since(q)] };
        const [rows, total] = await Promise.all([
          this.prisma.process.findMany({
            where,
            orderBy: [{ code: 'asc' }, { id: 'asc' }],
            ...paging,
            select: {
              id: true,
              code: true,
              nameEn: true,
              nameAr: true,
              departmentId: true,
              updatedAt: true,
            },
          }),
          this.prisma.process.count({ where }),
        ]);
        const links = await this.prisma.objectLink.findMany({
          where: {
            processId: { in: rows.map((r) => r.id) },
            repoObject: { type: { in: ['RISK', 'CONTROL'] }, deletedAt: null },
          },
          select: {
            processId: true,
            bpmnElementId: true,
            repoObject: { select: { type: true, id: true } },
          },
        });
        const agg = new Map<
          string,
          {
            riskSteps: Set<string>;
            controlSteps: Set<string>;
            risks: Set<string>;
            controls: Set<string>;
          }
        >();
        for (const l of links) {
          const a = agg.get(l.processId) ?? {
            riskSteps: new Set<string>(),
            controlSteps: new Set<string>(),
            risks: new Set<string>(),
            controls: new Set<string>(),
          };
          if (l.repoObject.type === 'RISK') {
            a.risks.add(l.repoObject.id);
            if (l.bpmnElementId !== '#process') a.riskSteps.add(l.bpmnElementId);
          } else {
            a.controls.add(l.repoObject.id);
            if (l.bpmnElementId !== '#process') a.controlSteps.add(l.bpmnElementId);
          }
          agg.set(l.processId, a);
        }
        return {
          items: rows.map((p) => {
            const a = agg.get(p.id);
            const riskSteps = a?.riskSteps ?? new Set<string>();
            const controlSteps = a?.controlSteps ?? new Set<string>();
            const uncovered = [...riskSteps].filter((s) => !controlSteps.has(s)).length;
            return {
              processId: p.id,
              code: p.code,
              nameEn: p.nameEn,
              nameAr: p.nameAr,
              departmentId: p.departmentId,
              risks: a?.risks.size ?? 0,
              controls: a?.controls.size ?? 0,
              stepsWithRisks: riskSteps.size,
              stepsWithControls: controlSteps.size,
              stepsWithRiskWithoutControl: uncovered,
            };
          }),
          total,
          lastModified: maxDate(rows.map((r) => r.updatedAt)),
        };
      }
      case 'control-tests': {
        const where: Prisma.ControlTestWhereInput = {
          deletedAt: null,
          control: { ...this.dept(key), object: { deletedAt: null } },
          ...this.since(q),
        };
        const [rows, total] = await Promise.all([
          this.prisma.controlTest.findMany({
            where,
            orderBy: { dueAt: 'desc' },
            ...paging,
            include: {
              control: {
                include: { object: { select: { code: true, nameEn: true, nameAr: true } } },
              },
            },
          }),
          this.prisma.controlTest.count({ where }),
        ]);
        return {
          items: rows.map((t) => ({
            testId: t.id,
            controlId: t.controlId,
            controlCode: t.control.object.code,
            controlNameEn: t.control.object.nameEn,
            controlNameAr: t.control.object.nameAr,
            testType: t.testType,
            period: t.period,
            status: t.status,
            conclusion: t.conclusion,
            sampleSize: t.sampleSize,
            dueAt: day(t.dueAt),
            submittedAt: iso(t.submittedAt),
            reviewedAt: iso(t.reviewedAt),
            overdue: !t.closedAt && !t.reviewedAt && t.dueAt < now,
          })),
          total,
          lastModified: maxDate(rows.map((r) => r.updatedAt)),
        };
      }
      case 'issues': {
        const where: Prisma.IssueWhereInput = {
          deletedAt: null,
          ...this.dept(key),
          ...this.since(q),
        };
        const [rows, total] = await Promise.all([
          this.prisma.issue.findMany({ where, orderBy: { code: 'asc' }, ...paging }),
          this.prisma.issue.count({ where }),
        ]);
        const open = new Set(['OPEN', 'IN_PROGRESS']);
        return {
          items: rows.map((i) => ({
            issueId: i.id,
            code: i.code,
            titleEn: i.titleEn,
            titleAr: i.titleAr,
            sourceType: i.sourceType,
            severity: i.severity,
            status: i.status,
            departmentId: i.departmentId,
            processId: i.processId,
            dueAt: day(i.dueAt),
            overdue: open.has(i.status) && !!i.dueAt && i.dueAt < now,
            createdAt: iso(i.createdAt),
            closedAt: iso(i.closedAt),
          })),
          total,
          lastModified: maxDate(rows.map((r) => r.updatedAt)),
        };
      }
      case 'audit-findings': {
        const where: Prisma.AuditFindingWhereInput = {
          deletedAt: null,
          engagement: { deletedAt: null },
          ...this.since(q),
        };
        const [rows, total] = await Promise.all([
          this.prisma.auditFinding.findMany({
            where,
            orderBy: { code: 'asc' },
            ...paging,
            include: {
              engagement: {
                select: { code: true, year: true, titleEn: true, titleAr: true, status: true },
              },
            },
          }),
          this.prisma.auditFinding.count({ where }),
        ]);
        return {
          items: rows.map((f) => ({
            findingId: f.id,
            code: f.code,
            titleEn: f.titleEn,
            titleAr: f.titleAr,
            rating: f.rating,
            responseStatus: f.responseStatus,
            engagementCode: f.engagement.code,
            engagementYear: f.engagement.year,
            engagementTitleEn: f.engagement.titleEn,
            engagementTitleAr: f.engagement.titleAr,
            engagementStatus: f.engagement.status,
            processId: f.processId,
            targetDate: day(f.targetDate),
            issueId: f.issueId,
            createdAt: iso(f.createdAt),
          })),
          total,
          lastModified: maxDate(rows.map((r) => r.updatedAt)),
        };
      }
      case 'workflow-cases-monthly': {
        const procIds = (
          await this.prisma.process.findMany({
            where: await this.processWhere(key),
            select: { id: true },
          })
        ).map((p) => p.id);
        const rows = await this.prisma.$queryRaw<
          {
            processId: string;
            month: Date;
            started: bigint;
            completed: bigint;
            running: bigint;
            avgHours: number | null;
          }[]
        >`
          SELECT "processId", date_trunc('month', "startedAt") AS month,
                 count(*) AS started,
                 count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
                 count(*) FILTER (WHERE status = 'RUNNING') AS running,
                 avg(extract(epoch FROM ("completedAt" - "startedAt")) / 3600)
                   FILTER (WHERE status = 'COMPLETED')::float AS "avgHours"
          FROM "WorkflowCase"
          WHERE "processId" = ANY(${procIds}::uuid[]) AND "parentCaseId" IS NULL
          GROUP BY 1, 2 ORDER BY 2, 1`;
        const all = rows.map((r) => ({
          processId: r.processId,
          month: day(r.month)!.slice(0, 7),
          started: Number(r.started),
          completed: Number(r.completed),
          running: Number(r.running),
          avgCompletionHours: round1(r.avgHours),
        }));
        return {
          items: all.slice(paging.skip, paging.skip + paging.take),
          total: all.length,
          lastModified: null,
        };
      }
      case 'workflow-sla': {
        const procIds = (
          await this.prisma.process.findMany({
            where: await this.processWhere(key),
            select: { id: true },
          })
        ).map((p) => p.id);
        const rows = await this.prisma.$queryRaw<
          {
            processId: string;
            elementId: string;
            nameEn: string;
            nameAr: string;
            tasks: bigint;
            completed: bigint;
            completedLate: bigint;
            openOverdue: bigint;
            avgHours: number | null;
          }[]
        >`
          SELECT c."processId", t."elementId", max(t."nameEn") AS "nameEn", max(t."nameAr") AS "nameAr",
                 count(*) AS tasks,
                 count(*) FILTER (WHERE t.status = 'COMPLETED') AS completed,
                 count(*) FILTER (WHERE t.status = 'COMPLETED' AND t."dueAt" IS NOT NULL
                                    AND t."completedAt" > t."dueAt") AS "completedLate",
                 count(*) FILTER (WHERE t.status = 'OPEN' AND t."dueAt" < now()) AS "openOverdue",
                 avg(extract(epoch FROM (t."completedAt" - t."createdAt")) / 3600)
                   FILTER (WHERE t.status = 'COMPLETED')::float AS "avgHours"
          FROM "WorkflowTask" t JOIN "WorkflowCase" c ON c.id = t."caseId"
          WHERE c."processId" = ANY(${procIds}::uuid[])
          GROUP BY 1, 2 ORDER BY 1, 2`;
        const all = rows.map((r) => {
          const completed = Number(r.completed);
          const late = Number(r.completedLate);
          return {
            processId: r.processId,
            stepId: r.elementId,
            stepEn: r.nameEn,
            stepAr: r.nameAr,
            tasks: Number(r.tasks),
            completed,
            completedLate: late,
            openOverdue: Number(r.openOverdue),
            onTimePercent: completed ? round1(((completed - late) / completed) * 100) : null,
            avgHours: round1(r.avgHours),
          };
        });
        return {
          items: all.slice(paging.skip, paging.skip + paging.take),
          total: all.length,
          lastModified: null,
        };
      }
      case 'mining-logs': {
        const where: Prisma.EventLogWhereInput = {
          status: 'READY',
          ...this.dept(key),
          ...this.since(q),
        };
        const [rows, total] = await Promise.all([
          this.prisma.eventLog.findMany({ where, orderBy: { code: 'asc' }, ...paging }),
          this.prisma.eventLog.count({ where }),
        ]);
        return {
          items: rows.map((l) => ({
            logId: l.id,
            code: l.code,
            nameEn: l.nameEn,
            nameAr: l.nameAr,
            source: l.source,
            processId: l.processId,
            departmentId: l.departmentId,
            cases: l.caseCount,
            events: l.eventCount,
            activities: l.activityCount,
            resources: l.resourceCount,
            periodStart: iso(l.periodStart),
            periodEnd: iso(l.periodEnd),
            importedAt: iso(l.importedAt),
          })),
          total,
          lastModified: maxDate(rows.map((r) => r.updatedAt)),
        };
      }
    }
  }

  /** Number of processes each library object is linked to (any step). */
  private async linkedProcesses(objectIds: string[]): Promise<Map<string, number>> {
    if (!objectIds.length) return new Map();
    const rows = await this.prisma.objectLink.groupBy({
      by: ['repoObjectId', 'processId'],
      where: { repoObjectId: { in: objectIds } },
    });
    const out = new Map<string, number>();
    for (const r of rows) out.set(r.repoObjectId, (out.get(r.repoObjectId) ?? 0) + 1);
    return out;
  }

  private async itemNames(items: { type: string; id: string }[]) {
    const ids = (t: string) => items.filter((i) => i.type === t).map((i) => i.id);
    const [processes, pages, diagrams] = await Promise.all([
      this.prisma.process.findMany({
        where: { id: { in: ids('PROCESS') } },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.prisma.page.findMany({
        where: { id: { in: ids('PAGE') } },
        select: { id: true, titleEn: true, titleAr: true },
      }),
      this.prisma.diagram.findMany({
        where: { id: { in: ids('DIAGRAM') } },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
    ]);
    const out = new Map<string, { code: string | null; nameEn: string; nameAr: string }>();
    for (const p of processes) out.set(`PROCESS:${p.id}`, p);
    for (const p of pages)
      out.set(`PAGE:${p.id}`, { code: null, nameEn: p.titleEn, nameAr: p.titleAr });
    for (const d of diagrams) out.set(`DIAGRAM:${d.id}`, d);
    return out;
  }
}
