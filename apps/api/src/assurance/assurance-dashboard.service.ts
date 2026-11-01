import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  OPEN_ISSUE_STATUSES,
  OPEN_TEST_STATUSES,
  ageBucket,
  type AssuranceDashboardDto,
  type AssuranceDashboardQuery,
  type CampaignStatus,
  type ControlTestStatus,
  type Locale,
  type ResponseProgress,
  type SurveyPurpose,
  type TestBreakdownRow,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { AssuranceSettingsService } from './assurance-settings.service';
import { compareNatural } from '../common/compare';

const DAY = 86_400_000;

/**
 * Assurance dashboard (Phase 4.2, D-103): control tests done / due / overdue and % effective by
 * department and process, open issues by severity and age, overdue actions, audit plan progress,
 * findings by rating, campaign response rates. Scope: organisation, department or process.
 */
@Injectable()
export class AssuranceDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: AssuranceSettingsService,
  ) {}

  async dashboard(q: AssuranceDashboardQuery): Promise<AssuranceDashboardDto> {
    const now = new Date();
    const year = q.year ?? now.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
    const processes = await this.prisma.process.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true, nameEn: true, nameAr: true, departmentId: true },
    });
    const scopeProcessIds = q.processId
      ? [q.processId]
      : q.departmentId
        ? processes.filter((p) => p.departmentId === q.departmentId).map((p) => p.id)
        : null;
    const scopeSet = scopeProcessIds ? new Set(scopeProcessIds) : null;

    // ----- Control tests -----
    // Only tests that count this year: open (due / overdue / awaiting review) or done in the year.
    const doneInYear = { gte: yearStart, lt: yearEnd };
    const tests = await this.prisma.controlTest.findMany({
      where: {
        deletedAt: null,
        control: { object: { deletedAt: null } },
        OR: [
          { status: { in: [...OPEN_TEST_STATUSES, 'SUBMITTED'] } },
          {
            status: { in: ['REVIEWED', 'CLOSED'] },
            OR: [{ reviewedAt: doneInYear }, { reviewedAt: null, updatedAt: doneInYear }],
          },
        ],
      },
      include: {
        control: {
          select: {
            departmentId: true,
            department: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          },
        },
      },
    });
    // Processes of each control, read once per control (not once per test) and computed once per
    // test (was rebuilt for every process × test pair).
    const controlLinks = await this.prisma.objectLink.findMany({
      where: {
        repoObjectId: { in: [...new Set(tests.map((t) => t.controlId))] },
        process: { deletedAt: null },
      },
      select: { repoObjectId: true, processId: true },
    });
    const procsOfControl = new Map<string, Set<string>>();
    for (const l of controlLinks)
      procsOfControl.set(
        l.repoObjectId,
        (procsOfControl.get(l.repoObjectId) ?? new Set()).add(l.processId),
      );
    const procsOf = new Map(tests.map((t) => [t.id, [...(procsOfControl.get(t.controlId) ?? [])]]));
    const procOf = (t: (typeof tests)[number]) => procsOf.get(t.id)!;
    const inScope = (t: (typeof tests)[number]) =>
      !scopeProcessIds
        ? true
        : procOf(t).some((p) => scopeSet!.has(p)) ||
          (!!q.departmentId && !q.processId && t.control.departmentId === q.departmentId);
    const scoped = tests.filter(inScope);
    const isDone = (t: (typeof tests)[number]) =>
      (t.status === 'REVIEWED' || t.status === 'CLOSED') &&
      (t.reviewedAt ?? t.updatedAt) >= yearStart &&
      (t.reviewedAt ?? t.updatedAt) < yearEnd;
    const isOpen = (t: (typeof tests)[number]) =>
      OPEN_TEST_STATUSES.includes(t.status as ControlTestStatus);
    const effective = (list: typeof tests) => {
      const reviewed = list.filter(isDone);
      return reviewed.length
        ? Math.round(
            (reviewed.filter((t) => t.conclusion !== 'NOT_EFFECTIVE').length / reviewed.length) *
              100,
          )
        : null;
    };
    const row = (
      key: { id: string; code: string | null; nameEn: string; nameAr: string },
      list: typeof tests,
    ): TestBreakdownRow => ({
      ...key,
      done: list.filter(isDone).length,
      due: list.filter((t) => isOpen(t) && t.dueAt >= now).length,
      overdue: list.filter((t) => isOpen(t) && t.dueAt < now).length,
      effectivePercent: effective(list),
    });
    const byConclusion: Record<string, number> = {};
    for (const t of scoped.filter(isDone))
      if (t.conclusion) byConclusion[t.conclusion] = (byConclusion[t.conclusion] ?? 0) + 1;
    const depts = new Map<
      string,
      { id: string; code: string | null; nameEn: string; nameAr: string }
    >();
    for (const t of scoped)
      if (t.control.department) depts.set(t.control.department.id, t.control.department);
    const testsByProcess = new Map<string, typeof tests>();
    for (const t of scoped)
      for (const p of procOf(t)) testsByProcess.set(p, [...(testsByProcess.get(p) ?? []), t]);
    const procIds = new Set([...testsByProcess.keys()].filter((p) => !scopeSet || scopeSet.has(p)));

    // ----- Issues and actions -----
    const settings = await this.settings.get();
    const issues = await this.prisma.issue.findMany({
      where: {
        deletedAt: null,
        ...(scopeProcessIds
          ? {
              OR: [
                { processId: { in: scopeProcessIds } },
                ...(q.departmentId && !q.processId ? [{ departmentId: q.departmentId }] : []),
              ],
            }
          : {}),
      },
      include: { actions: { where: { deletedAt: null } } },
    });
    const openIssues = issues.filter((i) => OPEN_ISSUE_STATUSES.includes(i.status as never));
    const bySeverity: Record<string, number> = Object.fromEntries(
      settings.severities.map((s) => [s.key, 0]),
    );
    const byAge: Record<string, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    for (const i of openIssues) {
      bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
      byAge[ageBucket(Math.floor((now.getTime() - i.createdAt.getTime()) / DAY))]++;
    }

    // ----- Audits -----
    const engagements = await this.prisma.auditEngagement.findMany({
      where: {
        deletedAt: null,
        year,
        ...(q.processId
          ? { processIds: { has: q.processId } }
          : q.departmentId
            ? {
                OR: [
                  { departmentIds: { has: q.departmentId } },
                  { processIds: { hasSome: scopeProcessIds ?? [] } },
                ],
              }
            : {}),
      },
      include: { findings: { where: { deletedAt: null } } },
    });
    const byStatus: Record<string, number> = {
      PLANNED: 0,
      FIELDWORK: 0,
      REPORTING: 0,
      FOLLOW_UP: 0,
      CLOSED: 0,
    };
    const findingsByRating: Record<string, number> = {};
    for (const e of engagements) {
      byStatus[e.status]++;
      for (const f of e.findings)
        findingsByRating[f.rating] = (findingsByRating[f.rating] ?? 0) + 1;
    }

    // ----- Surveys -----
    const campaigns = await this.prisma.surveyCampaign.findMany({
      where: {
        deletedAt: null,
        status: { in: ['OPEN', 'CLOSED'] },
        launchedAt: { gte: yearStart, lt: yearEnd },
        ...(q.processId
          ? { processId: q.processId }
          : q.departmentId
            ? {
                OR: [
                  { departmentId: q.departmentId },
                  { processId: { in: scopeProcessIds ?? [] } },
                ],
              }
            : {}),
      },
      include: { responses: { select: { status: true } } },
      orderBy: { launchedAt: 'desc' },
    });
    const surveyRows = campaigns.map((c) => {
      const counts: Record<ResponseProgress, number> = { SENT: 0, OPENED: 0, SUBMITTED: 0 };
      for (const r of c.responses) counts[r.status as ResponseProgress]++;
      return {
        id: c.id,
        titleEn: c.titleEn,
        titleAr: c.titleAr,
        status: c.status as CampaignStatus,
        purpose: c.purpose as SurveyPurpose,
        counts,
        responseRate: c.responses.length
          ? Math.round((counts.SUBMITTED / c.responses.length) * 100)
          : 0,
      };
    });
    const sent = campaigns.reduce((n, c) => n + c.responses.length, 0);
    const submitted = surveyRows.reduce((n, c) => n + c.counts.SUBMITTED, 0);

    return {
      year,
      tests: {
        done: scoped.filter(isDone).length,
        due: scoped.filter((t) => isOpen(t) && t.dueAt >= now).length,
        overdue: scoped.filter((t) => isOpen(t) && t.dueAt < now).length,
        awaitingReview: scoped.filter((t) => t.status === 'SUBMITTED').length,
        effectivePercent: effective(scoped),
        byConclusion,
        byDepartment: [...depts.values()]
          .map((d) =>
            row(
              d,
              scoped.filter((t) => t.control.departmentId === d.id),
            ),
          )
          .sort((a, b) => (a.code ?? a.nameEn).localeCompare(b.code ?? b.nameEn)),
        byProcess: processes
          .filter((p) => procIds.has(p.id))
          .map((p) => row(p, testsByProcess.get(p.id) ?? []))
          .sort((a, b) => compareNatural(a.code ?? '', b.code ?? '')),
      },
      issues: {
        open: openIssues.length,
        overdue: openIssues.filter((i) => i.dueAt && i.dueAt < now).length,
        bySeverity,
        byAge,
        actionsOverdue: openIssues.reduce(
          (n, i) =>
            n + i.actions.filter((a) => a.progress < 100 && a.dueAt && a.dueAt < now).length,
          0,
        ),
        acceptedRisks: issues.filter((i) => i.status === 'ACCEPTED_RISK').length,
      },
      audits: {
        byStatus,
        total: engagements.length,
        progressPercent: engagements.length
          ? Math.round(((byStatus.FOLLOW_UP + byStatus.CLOSED) / engagements.length) * 100)
          : 0,
        late: engagements.filter(
          (e) =>
            (e.status === 'PLANNED' || e.status === 'FIELDWORK') &&
            e.plannedEnd &&
            e.plannedEnd < now,
        ).length,
        findingsByRating,
        findingsPendingResponse: engagements.reduce(
          (n, e) => n + e.findings.filter((f) => f.responseStatus === 'PENDING').length,
          0,
        ),
      },
      surveys: {
        campaigns: surveyRows,
        responseRate: sent ? Math.round((submitted / sent) * 100) : 0,
      },
    };
  }

  async exportExcel(q: AssuranceDashboardQuery, locale: Locale, user: AuthUser, meta: RequestMeta) {
    const d = await this.dashboard(q);
    const ar = locale === 'ar';
    const T = (en: string, a: string) => (ar ? a : en);
    const name = (r: { nameEn: string; nameAr: string; code: string | null }) =>
      [r.code, ar ? r.nameAr || r.nameEn : r.nameEn || r.nameAr].filter(Boolean).join(' ');
    const settings = await this.settings.get();
    const sev = (k: string) => {
      const s = settings.severities.find((x) => x.key === k);
      return s ? (ar ? s.nameAr : s.nameEn) : k;
    };
    const wb = new ExcelJS.Workbook();
    const sheet = (title: string, header: string[], rows: (string | number | null)[][]) => {
      const ws = wb.addWorksheet(title, {
        views: [{ state: 'frozen', ySplit: 1, rightToLeft: ar }],
      });
      ws.addRow(header).font = { bold: true };
      for (const r of rows) ws.addRow(r.map((v) => v ?? ''));
      ws.columns.forEach((c, i) => (c.width = i === 0 ? 40 : 16));
    };
    sheet(
      T('Summary', 'الملخص'),
      [T('Measure', 'المؤشر'), T('Value', 'القيمة')],
      [
        [T('Year', 'السنة'), d.year],
        [T('Control tests done', 'الاختبارات المنجزة'), d.tests.done],
        [T('Control tests due', 'الاختبارات المستحقة'), d.tests.due],
        [T('Control tests overdue', 'الاختبارات المتأخرة'), d.tests.overdue],
        [T('Tests awaiting review', 'اختبارات بانتظار المراجعة'), d.tests.awaitingReview],
        [T('Tested effective %', 'نسبة الفعالية المختبرة %'), d.tests.effectivePercent],
        [T('Open issues', 'الملاحظات المفتوحة'), d.issues.open],
        [T('Overdue issues', 'الملاحظات المتأخرة'), d.issues.overdue],
        [T('Overdue actions', 'الإجراءات المتأخرة'), d.issues.actionsOverdue],
        [T('Accepted risks', 'المخاطر المقبولة'), d.issues.acceptedRisks],
        [T('Audit engagements', 'مهام التدقيق'), d.audits.total],
        [T('Audit plan progress %', 'تقدم خطة التدقيق %'), d.audits.progressPercent],
        [T('Findings pending response', 'نتائج بانتظار الرد'), d.audits.findingsPendingResponse],
        [T('Survey response rate %', 'نسبة الاستجابة للاستبيانات %'), d.surveys.responseRate],
      ],
    );
    const testHeader = [
      T('Name', 'الاسم'),
      T('Done', 'منجزة'),
      T('Due', 'مستحقة'),
      T('Overdue', 'متأخرة'),
      T('Effective %', 'فعالة %'),
    ];
    sheet(
      T('Tests by department', 'الاختبارات حسب الإدارة'),
      testHeader,
      d.tests.byDepartment.map((r) => [name(r), r.done, r.due, r.overdue, r.effectivePercent]),
    );
    sheet(
      T('Tests by process', 'الاختبارات حسب العملية'),
      testHeader,
      d.tests.byProcess.map((r) => [name(r), r.done, r.due, r.overdue, r.effectivePercent]),
    );
    sheet(
      T('Issues', 'الملاحظات'),
      [T('Severity / age', 'الخطورة / العمر'), T('Open issues', 'الملاحظات المفتوحة')],
      [
        ...Object.entries(d.issues.bySeverity).map(([k, n]) => [sev(k), n]),
        ...Object.entries(d.issues.byAge).map(([k, n]) => [`${k} ${T('days', 'يوم')}`, n]),
      ],
    );
    sheet(
      T('Audits', 'التدقيق'),
      [T('Status / rating', 'الحالة / التصنيف'), T('Count', 'العدد')],
      [
        ...Object.entries(d.audits.byStatus).map(([k, n]) => [k, n]),
        ...Object.entries(d.audits.findingsByRating).map(([k, n]) => [
          `${T('Findings', 'نتائج')}: ${sev(k)}`,
          n,
        ]),
      ],
    );
    sheet(
      T('Surveys', 'الاستبيانات'),
      [
        T('Campaign', 'الحملة'),
        T('Sent', 'مرسل'),
        T('Submitted', 'مقدَّم'),
        T('Response rate %', 'نسبة الاستجابة %'),
      ],
      d.surveys.campaigns.map((c) => [
        ar ? c.titleAr || c.titleEn : c.titleEn || c.titleAr,
        c.counts.SENT + c.counts.OPENED + c.counts.SUBMITTED,
        c.counts.SUBMITTED,
        c.responseRate,
      ]),
    );
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'Setting',
      entityId: 'assurance-dashboard',
      userId: user.id,
      summary: { report: 'assurance-dashboard', locale, ...q },
      meta,
    });
    return {
      data: Buffer.from(await wb.xlsx.writeBuffer()),
      fileName: `assurance-dashboard-${d.year}-${locale}.xlsx`,
    };
  }
}
