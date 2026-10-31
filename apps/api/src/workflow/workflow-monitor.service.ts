import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  PERMISSIONS,
  nodeLabel,
  type CaseIncidentDto,
  type CaseState,
  type DashboardQuery,
  type Locale,
  type MonitorDto,
  type WorkflowDashboardDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { forbidden } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { HEADER_FILL, XLSX_TYPE, type ExcelFile } from '../common/excel';
import { WorkflowConfigService } from './workflow-config.service';
import { WorkflowSettingsService } from './workflow-settings.service';
import { WorkflowCasesService } from './workflow-cases.service';
import { WorkflowTasksService } from './workflow-tasks.service';
import { isWorkflowAdmin, monitorCaseWhere, monitorProcessWhere } from './workflow-access';

const DAY = 86_400_000;
const pct = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : null;
const round = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

/** Workflow monitor, dashboard and Excel export (step 4): only processes the user may monitor. */
@Injectable()
export class WorkflowMonitorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: WorkflowConfigService,
    private readonly settings: WorkflowSettingsService,
    private readonly cases: WorkflowCasesService,
    private readonly tasks: WorkflowTasksService,
  ) {}

  private ensure(user: AuthUser) {
    if (!user.permissions.has(PERMISSIONS.WORKFLOW_MONITOR) && !isWorkflowAdmin(user))
      throw forbidden();
  }

  private caseScope(user: AuthUser, processId?: string): Prisma.WorkflowCaseWhereInput {
    const w = monitorCaseWhere(user);
    return { AND: [w ?? {}, processId ? { processId } : {}] };
  }

  async monitor(user: AuthUser): Promise<MonitorDto> {
    this.ensure(user);
    const pw = monitorProcessWhere(user);
    const processes = await this.prisma.process.findMany({
      where: { deletedAt: null, workflowConfig: { isNot: null }, ...(pw ?? {}) },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: 'asc' },
    });
    const ids = processes.map((p) => p.id);
    const [byStatus, stuck, overdue] = await Promise.all([
      this.prisma.workflowCase.groupBy({
        by: ['processId', 'status'],
        where: { processId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.workflowCase.groupBy({
        by: ['processId'],
        where: { processId: { in: ids }, status: 'RUNNING', stuck: true },
        _count: { _all: true },
      }),
      this.prisma.workflowTask.findMany({
        where: { status: 'OPEN', dueAt: { lt: new Date() }, case: { processId: { in: ids } } },
        select: { case: { select: { processId: true } } },
      }),
    ]);
    const count = (pid: string, status: string) =>
      byStatus.find((r) => r.processId === pid && r.status === status)?._count._all ?? 0;
    const overdueBy = new Map<string, number>();
    for (const o of overdue)
      overdueBy.set(o.case.processId, (overdueBy.get(o.case.processId) ?? 0) + 1);
    const overdueRows = await this.prisma.workflowTask.findMany({
      where: { status: 'OPEN', dueAt: { lt: new Date() }, case: { processId: { in: ids } } },
      include: {
        candidates: { select: { userId: true } },
        case: {
          select: {
            id: true,
            number: true,
            titleEn: true,
            titleAr: true,
            status: true,
            initiatorId: true,
            definitionId: true,
            processId: true,
            variables: true,
            process: {
              select: { id: true, nameEn: true, nameAr: true, ownerId: true, departmentId: true },
            },
          },
        },
      },
      orderBy: { dueAt: 'asc' },
      take: 50,
    });
    const stuckCases = await this.cases.list(
      { scope: 'monitor', stuck: true, status: 'RUNNING', page: 1, pageSize: 50, order: 'desc' },
      user,
    );
    const stuckRows = await this.prisma.workflowCase.findMany({
      where: { id: { in: stuckCases.items.map((c) => c.id) } },
      select: { id: true, state: true, definitionId: true },
    });
    const incidents = new Map<string, CaseIncidentDto[]>();
    for (const r of stuckRows) {
      const m = await this.config.model(r.definitionId);
      incidents.set(
        r.id,
        ((r.state as unknown as CaseState).tokens ?? [])
          .filter((t) => t.status === 'FAILED')
          .map((t) => ({
            tokenId: t.id,
            elementId: t.nodeId,
            nameEn: m.nodes[t.nodeId] ? nodeLabel(m.nodes[t.nodeId], 'en') : t.nodeId,
            nameAr: m.nodes[t.nodeId] ? nodeLabel(m.nodes[t.nodeId], 'ar') : t.nodeId,
            code: t.incident?.code ?? 'ERROR',
            message: t.incident?.message ?? '',
          })),
      );
    }
    return {
      processes: processes.map((p) => ({
        processId: p.id,
        code: p.code,
        nameEn: p.nameEn,
        nameAr: p.nameAr,
        running: count(p.id, 'RUNNING'),
        completed: count(p.id, 'COMPLETED'),
        cancelled: count(p.id, 'CANCELLED') + count(p.id, 'WITHDRAWN'),
        stuck: stuck.find((s) => s.processId === p.id)?._count._all ?? 0,
        overdueTasks: overdueBy.get(p.id) ?? 0,
      })),
      overdueTasks: await this.tasks.summaries(overdueRows),
      stuckCases: stuckCases.items.map((c) => ({ ...c, incidents: incidents.get(c.id) ?? [] })),
    };
  }

  private range(q: DashboardQuery) {
    const to = q.to ? new Date(`${q.to}T23:59:59.999Z`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00Z`) : new Date(to.getTime() - 90 * DAY);
    return { from, to };
  }

  private periodKey(d: Date, period: 'week' | 'month') {
    if (period === 'month') return d.toISOString().slice(0, 7);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() - t.getUTCDay()); // weeks start on Sunday
    return t.toISOString().slice(0, 10);
  }

  async dashboard(q: DashboardQuery, user: AuthUser): Promise<WorkflowDashboardDto> {
    this.ensure(user);
    const { from, to } = this.range(q);
    const scope = this.caseScope(user, q.processId);
    const calendar = await this.settings.calendar();
    const [startedRows, completedRows, running] = await Promise.all([
      this.prisma.workflowCase.findMany({
        where: { AND: [scope, { startedAt: { gte: from, lte: to }, parentCaseId: null }] },
        select: { startedAt: true },
        take: 50_000,
      }),
      this.prisma.workflowCase.findMany({
        where: {
          AND: [
            scope,
            { status: 'COMPLETED', completedAt: { gte: from, lte: to }, parentCaseId: null },
          ],
        },
        select: { startedAt: true, completedAt: true },
        take: 50_000,
      }),
      this.prisma.workflowCase.count({ where: { AND: [scope, { status: 'RUNNING' }] } }),
    ]);
    const hours = completedRows.map(
      (c) => calendar.workingMinutesBetween(c.startedAt, c.completedAt!) / 60,
    );
    const sorted = [...hours].sort((a, b) => a - b);
    const series = new Map<string, { started: number; completed: number; sum: number }>();
    const bucket = (k: string) => {
      let b = series.get(k);
      if (!b) series.set(k, (b = { started: 0, completed: 0, sum: 0 }));
      return b;
    };
    for (const c of startedRows) bucket(this.periodKey(c.startedAt, q.period)).started++;
    completedRows.forEach((c, i) => {
      const b = bucket(this.periodKey(c.completedAt!, q.period));
      b.completed++;
      b.sum += hours[i];
    });

    // Steps: completed tasks in the period, open / overdue now. Open tasks are counted in SQL per
    // step and assignee (thousands of rows otherwise; final session A), done tasks read flat.
    const taskScope: Prisma.WorkflowTaskWhereInput = { case: scope };
    const now = new Date();
    const pw = monitorProcessWhere(user);
    const scopeIds =
      pw || q.processId
        ? (
            await this.prisma.process.findMany({
              where: { AND: [pw ?? {}, q.processId ? { id: q.processId } : {}] },
              select: { id: true },
            })
          ).map((p) => p.id)
        : null;
    const inScope = scopeIds
      ? Prisma.sql`c."processId" = ANY(${scopeIds}::uuid[])`
      : Prisma.sql`TRUE`;
    type StepKey = { elementId: string; nameEn: string; nameAr: string };
    type TaskCase = { case: { processId: string; definitionId: string } };
    const [doneRows, openRows] = await Promise.all([
      this.prisma.$queryRaw<
        (StepKey & {
          processId: string;
          definitionId: string;
          dueAt: Date | null;
          createdAt: Date;
          completedAt: Date;
          completedById: string | null;
        })[]
      >`SELECT t."elementId", t."nameEn", t."nameAr", t."dueAt", t."createdAt", t."completedAt",
          t."completedById", c."processId", c."definitionId"
        FROM "WorkflowTask" t JOIN "WorkflowCase" c ON c."id" = t."caseId"
        WHERE t."status" = 'COMPLETED' AND t."completedAt" >= ${from} AND t."completedAt" <= ${to}
          AND ${inScope}
        LIMIT 100000`,
      this.prisma.$queryRaw<
        (StepKey & {
          processId: string;
          definitionId: string;
          assigneeId: string | null;
          open: number;
          overdue: number;
        })[]
      >`SELECT c."processId", c."definitionId", t."elementId", t."assigneeId",
          min(t."nameEn") AS "nameEn", min(t."nameAr") AS "nameAr",
          count(*)::int AS "open", (count(*) FILTER (WHERE t."dueAt" < ${now}))::int AS "overdue"
        FROM "WorkflowTask" t JOIN "WorkflowCase" c ON c."id" = t."caseId"
        WHERE t."status" = 'OPEN' AND ${inScope}
        GROUP BY c."processId", c."definitionId", t."elementId", t."assigneeId"`,
    ]);
    const withCase = <T extends { processId: string; definitionId: string }>(r: T) => ({
      ...r,
      case: { processId: r.processId, definitionId: r.definitionId },
    });
    const done: (StepKey & TaskCase & (typeof doneRows)[number])[] = doneRows.map(withCase);
    const open: (StepKey & TaskCase & (typeof openRows)[number])[] = openRows.map(withCase);
    const steps = new Map<string, WorkflowDashboardDto['steps'][number] & { sum: number }>();
    const stepOf = (t: {
      elementId: string;
      nameEn: string;
      nameAr: string;
      case: { processId: string };
    }) => {
      const k = `${t.case.processId}:${t.elementId}`;
      let s = steps.get(k);
      if (!s)
        steps.set(
          k,
          (s = {
            processId: t.case.processId,
            elementId: t.elementId,
            nameEn: t.nameEn,
            nameAr: t.nameAr,
            completed: 0,
            onTime: 0,
            meanHours: null,
            open: 0,
            overdue: 0,
            sum: 0,
          }),
        );
      return s;
    };
    let withDue = 0;
    let onTime = 0;
    for (const t of done) {
      const s = stepOf(t);
      s.completed++;
      s.sum += calendar.workingMinutesBetween(t.createdAt, t.completedAt!) / 60;
      if (t.dueAt) {
        withDue++;
        if (t.completedAt! <= t.dueAt) {
          onTime++;
          s.onTime++;
        }
      } else s.onTime++;
    }
    for (const t of open) {
      const s = stepOf(t);
      s.open += t.open;
      s.overdue += t.overdue;
    }

    // Workload: open / overdue / completed per user, department and lane role.
    const load = new Map<string, WorkflowDashboardDto['workload'][number]>();
    const add = (
      kind: 'USER' | 'ROLE' | 'DEPARTMENT',
      id: string,
      f: 'open' | 'overdue' | 'completed',
      n = 1,
    ) => {
      if (!n) return;
      const k = `${kind}:${id}`;
      let w = load.get(k);
      if (!w)
        load.set(k, (w = { kind, id, nameEn: '', nameAr: '', open: 0, overdue: 0, completed: 0 }));
      w[f] += n;
    };
    const userIds = [
      ...new Set(
        [...open.map((t) => t.assigneeId), ...done.map((t) => t.completedById)].filter(
          (v): v is string => !!v,
        ),
      ),
    ];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, nameEn: true, nameAr: true, email: true, departmentId: true },
    });
    const userBy = new Map(users.map((u) => [u.id, u]));
    const roleOf = async (defId: string, elementId: string) =>
      (await this.config.model(defId)).nodes[elementId]?.laneRoleId ?? null;
    for (const t of open) {
      if (t.assigneeId) {
        add('USER', t.assigneeId, 'open', t.open);
        add('USER', t.assigneeId, 'overdue', t.overdue);
        const dep = userBy.get(t.assigneeId)?.departmentId;
        if (dep) {
          add('DEPARTMENT', dep, 'open', t.open);
          add('DEPARTMENT', dep, 'overdue', t.overdue);
        }
      }
      const role = await roleOf(t.case.definitionId, t.elementId);
      if (role) {
        add('ROLE', role, 'open', t.open);
        add('ROLE', role, 'overdue', t.overdue);
      }
    }
    for (const t of done) {
      if (t.completedById) {
        add('USER', t.completedById, 'completed');
        const dep = userBy.get(t.completedById)?.departmentId;
        if (dep) add('DEPARTMENT', dep, 'completed');
      }
      const role = await roleOf(t.case.definitionId, t.elementId);
      if (role) add('ROLE', role, 'completed');
    }
    const depIds = [...load.values()].filter((w) => w.kind === 'DEPARTMENT').map((w) => w.id);
    const roleIds = [...load.values()].filter((w) => w.kind === 'ROLE').map((w) => w.id);
    const [deps, roles] = await Promise.all([
      this.prisma.department.findMany({
        where: { id: { in: depIds } },
        select: { id: true, nameEn: true, nameAr: true },
      }),
      this.prisma.repoObject.findMany({
        where: { id: { in: roleIds } },
        select: { id: true, nameEn: true, nameAr: true },
      }),
    ]);
    const names = new Map<string, { nameEn: string; nameAr: string }>([
      ...users.map(
        (u) =>
          [
            `USER:${u.id}`,
            { nameEn: u.nameEn || u.email, nameAr: u.nameAr || u.nameEn || u.email },
          ] as const,
      ),
      ...deps.map((d) => [`DEPARTMENT:${d.id}`, d] as const),
      ...roles.map((r) => [`ROLE:${r.id}`, r] as const),
    ]);
    for (const [k, w] of load)
      Object.assign(w, { nameEn: names.get(k)?.nameEn ?? '', nameAr: names.get(k)?.nameAr ?? '' });

    const topRows = await this.prisma.workflowTask.findMany({
      where: { AND: [taskScope, { status: 'OPEN', dueAt: { lt: now } }] },
      include: {
        candidates: { select: { userId: true } },
        case: {
          select: {
            id: true,
            number: true,
            titleEn: true,
            titleAr: true,
            status: true,
            initiatorId: true,
            definitionId: true,
            processId: true,
            variables: true,
            process: {
              select: { id: true, nameEn: true, nameAr: true, ownerId: true, departmentId: true },
            },
          },
        },
      },
      orderBy: { dueAt: 'asc' },
      take: 10,
    });
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      started: startedRows.length,
      completed: completedRows.length,
      running,
      throughput: {
        mean: round(hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null),
        median: round(pct(sorted, 0.5)),
        p90: round(pct(sorted, 0.9)),
      },
      slaCompliance: withDue ? Math.round((onTime / withDue) * 1000) / 10 : null,
      series: [...series.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, b]) => ({
          period,
          started: b.started,
          completed: b.completed,
          meanHours: round(b.completed ? b.sum / b.completed : null),
        })),
      steps: [...steps.values()]
        .map(({ sum, ...s }) => ({
          ...s,
          meanHours: round(s.completed ? sum / s.completed : null),
        }))
        .sort((a, b) => b.completed + b.open - (a.completed + a.open)),
      workload: [...load.values()]
        .sort((a, b) => b.open - a.open || b.completed - a.completed)
        .slice(0, 100),
      topOverdue: await this.tasks.summaries(topRows),
    };
  }

  /** Excel: visible cases of the period (+ steps sheet); respects monitor scope (D-152). */
  async export(
    q: DashboardQuery,
    user: AuthUser,
    meta: RequestMeta,
    locale: Locale,
  ): Promise<ExcelFile> {
    this.ensure(user);
    const { from, to } = this.range(q);
    const scope = this.caseScope(user, q.processId);
    const calendar = await this.settings.calendar();
    const rows = await this.prisma.workflowCase.findMany({
      where: { AND: [scope, { startedAt: { gte: from, lte: to } }] },
      include: { process: { select: { code: true, nameEn: true, nameAr: true } } },
      orderBy: { startedAt: 'asc' },
      take: 20_000,
    });
    const users = await this.cases.userRefs(rows.map((r) => r.initiatorId));
    const ar = locale === 'ar';
    const L = (en: string, a: string) => (ar ? a : en);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(L('Cases', 'الحالات'), {
      views: [{ rightToLeft: ar, state: 'frozen', ySplit: 1 }],
    });
    ws.columns = [
      { header: L('Case', 'الحالة'), key: 'number', width: 18 },
      { header: L('Process', 'العملية'), key: 'process', width: 32 },
      { header: L('Title', 'العنوان'), key: 'title', width: 36 },
      { header: L('Status', 'الحالة'), key: 'status', width: 14 },
      { header: L('Initiator', 'مقدّم الطلب'), key: 'initiator', width: 24 },
      { header: L('Started', 'البداية'), key: 'started', width: 20 },
      { header: L('Completed', 'الانتهاء'), key: 'completed', width: 20 },
      { header: L('Working hours', 'ساعات العمل'), key: 'hours', width: 14 },
      { header: L('Version', 'الإصدار'), key: 'version', width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = HEADER_FILL;
    for (const r of rows) {
      const u = r.initiatorId ? users.get(r.initiatorId) : null;
      ws.addRow({
        number: r.number,
        process: `${r.process.code} ${ar ? r.process.nameAr || r.process.nameEn : r.process.nameEn}`,
        title: ar ? r.titleAr || r.titleEn : r.titleEn,
        status: r.status,
        initiator: u ? (ar ? u.nameAr || u.nameEn : u.nameEn) || u.email : '',
        started: r.startedAt,
        completed: r.completedAt,
        hours: r.completedAt
          ? Math.round(calendar.workingMinutesBetween(r.startedAt, r.completedAt) / 6) / 10
          : null,
        version: (
          await this.prisma.workflowDefinition.findUnique({
            where: { id: r.definitionId },
            select: { versionNumber: true },
          })
        )?.versionNumber,
      });
    }
    const dash = await this.dashboard(q, user);
    const st = wb.addWorksheet(L('Steps', 'الخطوات'), {
      views: [{ rightToLeft: ar, state: 'frozen', ySplit: 1 }],
    });
    st.columns = [
      { header: L('Step', 'الخطوة'), key: 'step', width: 36 },
      { header: L('Completed', 'مكتملة'), key: 'completed', width: 12 },
      { header: L('On time', 'في الوقت'), key: 'onTime', width: 12 },
      { header: L('Mean working hours', 'متوسط ساعات العمل'), key: 'mean', width: 18 },
      { header: L('Open', 'مفتوحة'), key: 'open', width: 10 },
      { header: L('Overdue', 'متأخرة'), key: 'overdue', width: 10 },
    ];
    st.getRow(1).font = { bold: true };
    st.getRow(1).fill = HEADER_FILL;
    for (const s of dash.steps)
      st.addRow({
        step: ar ? s.nameAr || s.nameEn : s.nameEn,
        completed: s.completed,
        onTime: s.onTime,
        mean: s.meanHours,
        open: s.open,
        overdue: s.overdue,
      });
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'WorkflowCase',
      userId: user.id,
      summary: { cases: rows.length, from: dash.from, to: dash.to, processId: q.processId ?? null },
      meta,
    });
    return {
      data: Buffer.from(await wb.xlsx.writeBuffer()),
      fileName: `workflow-cases-${dash.from}-${dash.to}.xlsx`,
      contentType: XLSX_TYPE,
    };
  }
}
