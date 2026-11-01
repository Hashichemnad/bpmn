import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PERMISSIONS,
  kpiRag,
  thresholdsFor,
  type Locale,
  type Permission,
  type ReportSubscriptionInput,
  type ScheduledReport,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ReportDataService } from '../reports/report-data.service';
import { reportSteps } from '../reports/report-steps';
import { ExportDataService } from '../exports/export-data.service';
import type { AuthUser } from '../common/auth-user';

/** What one scheduled report shows: headline numbers and one table (Excel / PDF / e-mail). */
export interface ReportContent {
  title: string;
  /** Lines of the e-mail summary ("12 KPIs: 3 off target …"). */
  summary: string[];
  columns: string[];
  rows: (string | number)[][];
  /** Index of a column whose cells are RAG / severity words to colour in the PDF. */
  statusColumn?: number;
  /** Process handbook: one section per process with its diagram. */
  sections?: { heading: string; image: Buffer | null; columns: string[]; rows: string[][] }[];
}

export class ReportNotAllowed extends Error {}

/** Permissions a recipient needs for each report (any of the list). */
export const REPORT_PERMISSIONS: Record<ScheduledReport, Permission[]> = {
  KPI_DASHBOARD: [PERMISSIONS.KPI_READ],
  OVERDUE_REVIEWS: [PERMISSIONS.GOVERNANCE_DASHBOARD],
  OPEN_ISSUES: [PERMISSIONS.GRC_READ, PERMISSIONS.ISSUES_MANAGE],
  WORKFLOW_SLA: [PERMISSIONS.WORKFLOW_MONITOR, PERMISSIONS.WORKFLOW_ADMIN],
  MIGRATION_PROGRESS: [PERMISSIONS.IMPORT_MANAGE],
  PROCESS_HANDBOOK: [PERMISSIONS.PROCESSES_READ, PERMISSIONS.PORTAL_READ],
};

export const mayReceive = (report: ScheduledReport, user: AuthUser) =>
  REPORT_PERMISSIONS[report].some((p) => user.permissions.has(p));

const TXT = {
  en: {
    KPI_DASHBOARD: 'KPI dashboard',
    OVERDUE_REVIEWS: 'Overdue reviews',
    OPEN_ISSUES: 'Open issues',
    WORKFLOW_SLA: 'Workflow SLA per step',
    MIGRATION_PROGRESS: 'Migration progress',
    PROCESS_HANDBOOK: 'Process handbook',
    code: 'Code',
    name: 'Name',
    target: 'Target',
    latest: 'Latest value',
    period: 'Period',
    status: 'Status',
    item: 'Item',
    type: 'Type',
    due: 'Due',
    daysLate: 'Days late',
    severity: 'Severity',
    owner: 'Owner',
    process: 'Process',
    step: 'Step',
    tasks: 'Tasks',
    late: 'Completed late',
    overdue: 'Open and overdue',
    onTime: 'On time %',
    avgHours: 'Avg. hours',
    content: 'Content',
    total: 'Total',
    imported: 'Imported',
    draft: 'Draft',
    inReview: 'In review',
    published: 'Published',
    version: 'Version',
    approved: 'Approved on',
    steps: 'Steps',
    role: 'Role',
    rag: { GREEN: 'On target', AMBER: 'Watch', RED: 'Off target' } as Record<string, string>,
    kpiSummary: (n: number, red: number, amber: number, none: number) =>
      `${n} KPIs: ${red} off target, ${amber} to watch, ${none} without a current value.`,
    reviewSummary: (n: number, periodic: number) =>
      `${n} reviews are past their due date; ${periodic} items are overdue for their periodic review.`,
    issueSummary: (n: number, overdue: number) => `${n} open issues, ${overdue} of them overdue.`,
    slaSummary: (overdue: number, onTime: string) =>
      `${overdue} open tasks are overdue; ${onTime} of completed tasks were on time.`,
    migrationSummary: (total: number, published: number) =>
      `${total} imported items, ${published} of them published.`,
    handbookSummary: (n: number) => `${n} processes in this branch.`,
    periodicLabel: 'Periodic review',
    reviewLabel: 'Approval review',
  },
  ar: {
    KPI_DASHBOARD: 'لوحة مؤشرات الأداء',
    OVERDUE_REVIEWS: 'المراجعات المتأخرة',
    OPEN_ISSUES: 'الملاحظات المفتوحة',
    WORKFLOW_SLA: 'مستوى الخدمة لكل مرحلة في سير العمل',
    MIGRATION_PROGRESS: 'تقدم الترحيل',
    PROCESS_HANDBOOK: 'دليل العمليات',
    code: 'الرمز',
    name: 'الاسم',
    target: 'المستهدف',
    latest: 'آخر قيمة',
    period: 'الفترة',
    status: 'الحالة',
    item: 'العنصر',
    type: 'النوع',
    due: 'الاستحقاق',
    daysLate: 'أيام التأخير',
    severity: 'الخطورة',
    owner: 'المالك',
    process: 'العملية',
    step: 'المرحلة',
    tasks: 'المهام',
    late: 'أُنجزت متأخرة',
    overdue: 'مفتوحة ومتأخرة',
    onTime: 'في الوقت %',
    avgHours: 'متوسط الساعات',
    content: 'المحتوى',
    total: 'الإجمالي',
    imported: 'المستورد',
    draft: 'مسودة',
    inReview: 'قيد المراجعة',
    published: 'منشور',
    version: 'الإصدار',
    approved: 'تاريخ الاعتماد',
    steps: 'الخطوات',
    role: 'الدور',
    rag: { GREEN: 'ضمن المستهدف', AMBER: 'تحت المراقبة', RED: 'خارج المستهدف' } as Record<
      string,
      string
    >,
    kpiSummary: (n: number, red: number, amber: number, none: number) =>
      `${n} مؤشراً: ${red} خارج المستهدف، ${amber} تحت المراقبة، ${none} دون قيمة حالية.`,
    reviewSummary: (n: number, periodic: number) =>
      `${n} مراجعة تجاوزت موعدها؛ ${periodic} عنصراً تأخرت مراجعته الدورية.`,
    issueSummary: (n: number, overdue: number) => `${n} ملاحظة مفتوحة، منها ${overdue} متأخرة.`,
    slaSummary: (overdue: number, onTime: string) =>
      `${overdue} مهمة مفتوحة متأخرة؛ ${onTime} من المهام المنجزة كانت في الوقت.`,
    migrationSummary: (total: number, published: number) =>
      `${total} عنصراً مستورداً، منها ${published} منشوراً.`,
    handbookSummary: (n: number) => `${n} عملية في هذا الفرع.`,
    periodicLabel: 'مراجعة دورية',
    reviewLabel: 'مراجعة اعتماد',
  },
};

export const reportTitle = (r: ScheduledReport, l: Locale) => TXT[l][r];

const nm = (o: { nameEn?: string | null; nameAr?: string | null } | null | undefined, l: Locale) =>
  (l === 'ar' ? o?.nameAr || o?.nameEn : o?.nameEn || o?.nameAr) || '';
const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? '';
const DAY_MS = 86_400_000;

/**
 * Builds scheduled reports with the recipient's permissions (D-179): never more than the person sees
 * in the app — the report's permission is required, issues are limited to the recipient's own unless
 * they manage issues, workflow monitors see their department's processes, the handbook uses the
 * handbook's visibility rules (published content for portal users).
 */
@Injectable()
export class ReportBuilders {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportData: ReportDataService,
    private readonly exportData: ExportDataService,
  ) {}

  async build(
    report: ScheduledReport,
    filters: ReportSubscriptionInput['filters'],
    user: AuthUser,
    l: Locale,
    withImages: boolean,
  ): Promise<ReportContent> {
    if (!mayReceive(report, user)) throw new ReportNotAllowed(report);
    const t = TXT[l];
    const now = new Date();
    const dept = filters.departmentId ?? null;
    switch (report) {
      case 'KPI_DASHBOARD': {
        const kpis = await this.prisma.kpi.findMany({
          where: {
            status: 'ACTIVE',
            object: { deletedAt: null },
            ...(dept ? { departmentId: dept } : {}),
          },
          include: {
            object: true,
            periodTargets: true,
            measurements: { orderBy: { periodStart: 'desc' }, take: 1 },
          },
          orderBy: { object: { code: 'asc' } },
        });
        const rows = kpis.map((k) => {
          const m = k.measurements[0];
          const th = m ? thresholdsFor(k, m.period, k.periodTargets) : k;
          const rag = m ? kpiRag(m.value, th) : null;
          return {
            rag,
            row: [
              k.object.code ?? '',
              nm(k.object, l),
              th.target ?? '',
              m?.value ?? '',
              m?.period ?? '',
              rag ? t.rag[rag] : '',
            ],
          };
        });
        return {
          title: t.KPI_DASHBOARD,
          summary: [
            t.kpiSummary(
              rows.length,
              rows.filter((r) => r.rag === 'RED').length,
              rows.filter((r) => r.rag === 'AMBER').length,
              rows.filter((r) => !r.rag).length,
            ),
          ],
          columns: [t.code, t.name, t.target, t.latest, t.period, t.status],
          rows: rows.map((r) => r.row),
          statusColumn: 5,
        };
      }
      case 'OVERDUE_REVIEWS': {
        const reviews = await this.prisma.review.findMany({
          where: { status: 'IN_PROGRESS', dueAt: { lt: now } },
          orderBy: { dueAt: 'asc' },
          take: 500,
        });
        const procIds = reviews.filter((r) => r.entityType === 'PROCESS').map((r) => r.entityId);
        const procs = await this.prisma.process.findMany({
          where: {
            OR: [{ id: { in: procIds } }, { nextReviewAt: { lt: now }, status: 'PUBLISHED' }],
            deletedAt: null,
            ...(dept ? { departmentId: dept } : {}),
          },
          select: {
            id: true,
            code: true,
            nameEn: true,
            nameAr: true,
            nextReviewAt: true,
            status: true,
          },
        });
        const byId = new Map(procs.map((p) => [p.id, p]));
        const reviewRows = reviews
          .filter((r) => r.entityType !== 'PROCESS' || byId.has(r.entityId))
          .filter((r) => !dept || r.entityType === 'PROCESS')
          .map((r) => {
            const p = byId.get(r.entityId);
            return [
              p?.code ?? '',
              p ? nm(p, l) : r.entityType,
              t.reviewLabel,
              day(r.dueAt),
              Math.floor((now.getTime() - r.dueAt!.getTime()) / DAY_MS),
            ];
          });
        const periodic = procs
          .filter((p) => p.status === 'PUBLISHED' && p.nextReviewAt && p.nextReviewAt < now)
          .map((p) => [
            p.code,
            nm(p, l),
            t.periodicLabel,
            day(p.nextReviewAt),
            Math.floor((now.getTime() - p.nextReviewAt!.getTime()) / DAY_MS),
          ]);
        return {
          title: t.OVERDUE_REVIEWS,
          summary: [t.reviewSummary(reviewRows.length, periodic.length)],
          columns: [t.code, t.item, t.type, t.due, t.daysLate],
          rows: [...reviewRows, ...periodic],
        };
      }
      case 'OPEN_ISSUES': {
        const own =
          !user.permissions.has(PERMISSIONS.ISSUES_MANAGE) &&
          !user.permissions.has(PERMISSIONS.AUDIT_MANAGE);
        const issues = await this.prisma.issue.findMany({
          where: {
            deletedAt: null,
            status: { in: ['OPEN', 'IN_PROGRESS'] },
            ...(dept ? { departmentId: dept } : {}),
            ...(own ? { ownerId: user.id } : {}),
          },
          orderBy: [{ dueAt: 'asc' }, { code: 'asc' }],
          take: 1000,
        });
        const owners = await this.users(issues.map((i) => i.ownerId));
        const overdue = issues.filter((i) => i.dueAt && i.dueAt < now).length;
        return {
          title: t.OPEN_ISSUES,
          summary: [t.issueSummary(issues.length, overdue)],
          columns: [t.code, t.name, t.severity, t.status, t.owner, t.due],
          rows: issues.map((i) => [
            i.code,
            nm({ nameEn: i.titleEn, nameAr: i.titleAr }, l),
            i.severity,
            i.status,
            i.ownerId ? nm(owners.get(i.ownerId), l) : '',
            day(i.dueAt),
          ]),
        };
      }
      case 'WORKFLOW_SLA': {
        const procWhere: Prisma.ProcessWhereInput = {
          deletedAt: null,
          workflowConfig: { isNot: null },
          ...(dept ? { departmentId: dept } : {}),
          // Monitors see the processes of their department (admins all).
          ...(!user.permissions.has(PERMISSIONS.WORKFLOW_ADMIN)
            ? { departmentId: user.departmentId ?? '00000000-0000-0000-0000-000000000000' }
            : {}),
        };
        const procs = await this.prisma.process.findMany({
          where: procWhere,
          select: { id: true, code: true, nameEn: true, nameAr: true },
        });
        const ids = procs.map((p) => p.id);
        const rows = ids.length
          ? await this.prisma.$queryRaw<
              {
                processId: string;
                nameEn: string;
                nameAr: string;
                tasks: bigint;
                completed: bigint;
                late: bigint;
                overdue: bigint;
                avgHours: number | null;
              }[]
            >`
              SELECT c."processId", max(t."nameEn") AS "nameEn", max(t."nameAr") AS "nameAr", count(*) AS tasks,
                     count(*) FILTER (WHERE t.status = 'COMPLETED') AS completed,
                     count(*) FILTER (WHERE t.status = 'COMPLETED' AND t."dueAt" IS NOT NULL AND t."completedAt" > t."dueAt") AS late,
                     count(*) FILTER (WHERE t.status = 'OPEN' AND t."dueAt" < now()) AS overdue,
                     avg(extract(epoch FROM (t."completedAt" - t."createdAt")) / 3600) FILTER (WHERE t.status = 'COMPLETED')::float AS "avgHours"
              FROM "WorkflowTask" t JOIN "WorkflowCase" c ON c.id = t."caseId"
              WHERE c."processId" = ANY(${ids}::uuid[])
              GROUP BY c."processId", t."elementId" ORDER BY 1, 2`
          : [];
        const pOf = new Map(procs.map((p) => [p.id, p]));
        let completed = 0;
        let late = 0;
        let overdue = 0;
        const table = rows.map((r) => {
          completed += Number(r.completed);
          late += Number(r.late);
          overdue += Number(r.overdue);
          const c = Number(r.completed);
          return [
            pOf.get(r.processId)?.code ?? '',
            nm(r, l),
            Number(r.tasks),
            Number(r.late),
            Number(r.overdue),
            c ? Math.round(((c - Number(r.late)) / c) * 100) : '',
            r.avgHours !== null ? Math.round(r.avgHours * 10) / 10 : '',
          ];
        });
        return {
          title: t.WORKFLOW_SLA,
          summary: [
            t.slaSummary(
              overdue,
              completed ? `${Math.round(((completed - late) / completed) * 100)} %` : '—',
            ),
          ],
          columns: [t.process, t.step, t.tasks, t.late, t.overdue, t.onTime, t.avgHours],
          rows: table,
        };
      }
      case 'MIGRATION_PROGRESS': {
        const kinds = [
          { label: t.process, model: 'process' as const },
          { label: TXT[l].content, model: 'page' as const },
          { label: 'Diagram', model: 'diagram' as const },
        ];
        const rows: (string | number)[][] = [];
        let total = 0;
        let published = 0;
        for (const k of kinds) {
          const groups =
            k.model === 'process'
              ? await this.prisma.process.groupBy({
                  by: ['status'],
                  where: { importBatchId: { not: null }, deletedAt: null },
                  _count: { _all: true },
                })
              : k.model === 'page'
                ? await this.prisma.page.groupBy({
                    by: ['status'],
                    where: { importBatchId: { not: null }, deletedAt: null },
                    _count: { _all: true },
                  })
                : await this.prisma.diagram.groupBy({
                    by: ['status'],
                    where: { importBatchId: { not: null }, deletedAt: null },
                    _count: { _all: true },
                  });
          const c = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
          const sum = groups.reduce((a, g) => a + g._count._all, 0);
          total += sum;
          published += c('PUBLISHED');
          rows.push([k.label, sum, c('DRAFT'), c('IN_REVIEW'), c('PUBLISHED')]);
        }
        return {
          title: t.MIGRATION_PROGRESS,
          summary: [t.migrationSummary(total, published)],
          columns: [t.type, t.imported, t.draft, t.inReview, t.published],
          rows,
        };
      }
      case 'PROCESS_HANDBOOK': {
        const source = user.permissions.has(PERMISSIONS.PROCESSES_READ) ? 'working' : 'published';
        const processes = await this.reportData.collect(filters.processId!, true, user, source);
        const sections = [];
        for (const p of processes) {
          const img = withImages
            ? await this.exportData.bpmnImage(p.bpmnXml, l, 'png', 1600)
            : null;
          sections.push({
            heading: `${p.code} ${nm(p, l)}`,
            image: img?.data ?? null,
            columns: ['#', t.step, t.role],
            rows: reportSteps(p, l).map((s, i) => [String(i + 1), s.name, s.roles.join(', ')]),
          });
        }
        return {
          title: `${t.PROCESS_HANDBOOK} — ${processes[0] ? `${processes[0].code} ${nm(processes[0], l)}` : ''}`,
          summary: [t.handbookSummary(processes.length)],
          columns: [t.code, t.name, t.owner, t.version, t.approved, t.steps],
          rows: processes.map((p) => [
            p.code,
            nm(p, l),
            p.owner ? nm(p.owner, l) : '',
            p.versionNumber ?? '',
            day(p.approvedAt),
            reportSteps(p, l).length,
          ]),
          sections,
        };
      }
    }
  }

  private async users(ids: (string | null)[]) {
    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids.filter((v): v is string => !!v) } },
      select: { id: true, nameEn: true, nameAr: true },
    });
    return new Map(rows.map((u) => [u.id, u]));
  }
}
