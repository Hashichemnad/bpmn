import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  SETTING_KEYS,
  blockingIssues,
  checkConventions,
  parseBpmnGraph,
  resolveDiagramTheme,
  type Locale,
  type MigrationBulkInput,
  type MigrationBulkResultDto,
  type MigrationCounts,
  type MigrationDashboardDto,
  type MigrationGroupDto,
  type MigrationItemDto,
  type MigrationItemType,
  type MigrationItemsQuery,
  type MigrationProblem,
  type MigrationScope,
  type Paginated,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConventionsService } from '../conventions/conventions.service';
import { ModelsService, APPLY_THEME_CHANGE_NOTE } from '../models/models.service';
import { applyThemeToXml } from '../models/diagram-theme-xml';
import { ReviewsService } from '../governance/reviews.service';
import { htmlToText } from '../docs/rich-text';
import { AppException, badRequest } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { XLSX_TYPE, addSheet, type ExcelFile } from '../common/excel';
import { batchNumber } from './imports.service';

const empty = (): MigrationCounts => ({
  total: 0,
  draft: 0,
  inReview: 0,
  approved: 0,
  published: 0,
  archived: 0,
  noOwner: 0,
  missingEn: 0,
  missingAr: 0,
  conventions: 0,
});
const byTypeEmpty = (): Record<MigrationItemType, MigrationCounts> => ({
  PROCESS: empty(),
  PAGE: empty(),
  DIAGRAM: empty(),
});

const STATUS_FIELD: Record<string, keyof MigrationCounts> = {
  DRAFT: 'draft',
  IN_REVIEW: 'inReview',
  APPROVED: 'approved',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
};

function add(c: MigrationCounts, item: MigrationItemDto) {
  c.total++;
  const s = STATUS_FIELD[item.status];
  if (s) c[s]++;
  if (item.problems.includes('NO_OWNER')) c.noOwner++;
  if (item.problems.includes('MISSING_EN')) c.missingEn++;
  if (item.problems.includes('MISSING_AR')) c.missingAr++;
  if (item.problems.includes('CONVENTIONS')) c.conventions++;
}

/**
 * Migration tracker (M15 step 6): processes, pages and diagrams — imported only or all — with
 * their status and the problems the content phase must fix (no owner, missing Arabic or English,
 * modeling conventions), by department and process-house branch; review queue bulk actions.
 */
@Injectable()
export class MigrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly conventions: ConventionsService,
    private readonly models: ModelsService,
    private readonly reviews: ReviewsService,
  ) {}

  /** Every item of the scope with its problems (one pass; the repository has hundreds, not millions). */
  async items(
    scope: MigrationScope,
    extra: { ownerId?: string } = {},
  ): Promise<MigrationItemDto[]> {
    const imported = scope === 'IMPORTED' ? { importBatchId: { not: null } } : {};
    const owner = extra.ownerId ? { ownerId: extra.ownerId } : {};
    const person = { select: { id: true, nameEn: true, nameAr: true } };
    const [processes, allProcesses, pages, diagrams, batches, conventions] = await Promise.all([
      this.prisma.process.findMany({
        where: { deletedAt: null, ...imported, ...owner },
        include: { owner: person, department: person, model: { select: { bpmnXml: true } } },
      }),
      this.prisma.process.findMany({
        where: { deletedAt: null },
        select: { id: true, parentId: true, code: true, nameEn: true, nameAr: true },
      }),
      this.prisma.page.findMany({
        where: { deletedAt: null, ...imported, ...owner },
        select: {
          id: true,
          spaceId: true,
          titleEn: true,
          titleAr: true,
          textEn: true,
          textAr: true,
          status: true,
          ownerId: true,
          importBatchId: true,
          updatedAt: true,
          owner: person,
          space: { select: { department: person } },
          links: { where: { processId: { not: null } }, select: { processId: true }, take: 1 },
        },
      }),
      this.prisma.diagram.findMany({
        where: { deletedAt: null, ...imported, ...owner },
        include: { owner: person, department: person },
      }),
      this.prisma.importBatch.findMany({ select: { id: true, number: true } }),
      this.conventions.get(),
    ]);
    const batchOf = new Map(
      batches.map((b) => [b.id, { id: b.id, number: batchNumber(b.number) }]),
    );
    const procById = new Map(allProcesses.map((p) => [p.id, p]));
    const branchOf = (id: string | null | undefined) => {
      let cur = id ? procById.get(id) : undefined;
      const seen = new Set<string>();
      while (cur?.parentId && !seen.has(cur.id)) {
        seen.add(cur.id);
        const next = procById.get(cur.parentId);
        if (!next) break;
        cur = next;
      }
      return cur ? { id: cur.id, code: cur.code, nameEn: cur.nameEn, nameAr: cur.nameAr } : null;
    };
    const out: MigrationItemDto[] = [];
    for (const p of processes) {
      const problems: MigrationProblem[] = [];
      if (!p.ownerId) problems.push('NO_OWNER');
      if (!p.nameEn.trim()) problems.push('MISSING_EN');
      if (!p.nameAr.trim()) problems.push('MISSING_AR');
      if (!p.model) problems.push('NO_MODEL');
      else {
        try {
          if (blockingIssues(checkConventions(parseBpmnGraph(p.model.bpmnXml), conventions)).length)
            problems.push('CONVENTIONS');
        } catch {
          problems.push('CONVENTIONS');
        }
      }
      out.push({
        type: 'PROCESS',
        id: p.id,
        code: p.code,
        nameEn: p.nameEn,
        nameAr: p.nameAr,
        status: p.status,
        owner: p.owner,
        department: p.department,
        branch: branchOf(p.id),
        batch: p.importBatchId ? (batchOf.get(p.importBatchId) ?? null) : null,
        problems,
        href: `/processes/${p.id}`,
        updatedAt: p.updatedAt.toISOString(),
      });
    }
    for (const g of pages) {
      const problems: MigrationProblem[] = [];
      if (!g.ownerId) problems.push('NO_OWNER');
      if (!g.titleEn.trim() && !g.textEn.trim()) problems.push('MISSING_EN');
      if (!g.titleAr.trim() && !g.textAr.trim()) problems.push('MISSING_AR');
      out.push({
        type: 'PAGE',
        id: g.id,
        code: '',
        nameEn: g.titleEn,
        nameAr: g.titleAr,
        status: g.status,
        owner: g.owner,
        department: g.space.department,
        branch: branchOf(g.links[0]?.processId),
        batch: g.importBatchId ? (batchOf.get(g.importBatchId) ?? null) : null,
        problems,
        href: `/docs/${g.spaceId}/pages/${g.id}`,
        updatedAt: g.updatedAt.toISOString(),
      });
    }
    for (const d of diagrams) {
      const problems: MigrationProblem[] = [];
      if (!d.ownerId) problems.push('NO_OWNER');
      if (!d.nameEn.trim()) problems.push('MISSING_EN');
      if (!d.nameAr.trim()) problems.push('MISSING_AR');
      out.push({
        type: 'DIAGRAM',
        id: d.id,
        code: d.code,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        status: d.status,
        owner: d.owner,
        department: d.department,
        branch: branchOf(d.processId),
        batch: d.importBatchId ? (batchOf.get(d.importBatchId) ?? null) : null,
        problems,
        href: `/diagrams/${d.id}`,
        updatedAt: d.updatedAt.toISOString(),
      });
    }
    return out;
  }

  async dashboard(scope: MigrationScope): Promise<MigrationDashboardDto> {
    const [items, batches, proposalsPending] = await Promise.all([
      this.items(scope),
      this.prisma.importBatch.groupBy({ by: ['status'], _count: true }),
      this.prisma.aiProposal.count({ where: { status: 'PENDING' } }),
    ]);
    const totals = empty();
    const byType = byTypeEmpty();
    const groups = (
      key: (
        i: MigrationItemDto,
      ) => { id: string; code?: string; nameEn: string; nameAr: string } | null,
    ) => {
      const map = new Map<string, MigrationGroupDto>();
      for (const i of items) {
        const g = key(i);
        const k = g?.id ?? '';
        let row = map.get(k);
        if (!row) {
          row = {
            id: g?.id ?? null,
            code: g?.code ?? '',
            nameEn: g?.nameEn ?? '',
            nameAr: g?.nameAr ?? '',
            counts: empty(),
            byType: byTypeEmpty(),
          };
          map.set(k, row);
        }
        add(row.counts, i);
        add(row.byType[i.type], i);
      }
      return [...map.values()].sort(
        (a, b) =>
          (a.id ? 0 : 1) - (b.id ? 0 : 1) || (a.code || a.nameEn).localeCompare(b.code || b.nameEn),
      );
    };
    for (const i of items) {
      add(totals, i);
      add(byType[i.type], i);
    }
    const count = (s: string) => batches.find((b) => b.status === s)?._count ?? 0;
    return {
      scope,
      totals,
      byType,
      departments: groups((i) => i.department),
      branches: groups((i) => i.branch),
      batches: {
        total: batches.reduce((s, b) => s + b._count, 0),
        applied: count('APPLIED'),
        undone: count('UNDONE'),
        failed: count('FAILED'),
      },
      proposalsPending,
    };
  }

  async list(q: MigrationItemsQuery): Promise<Paginated<MigrationItemDto>> {
    const needle = q.q?.toLowerCase();
    const all = (await this.items(q.scope, { ownerId: q.ownerId })).filter(
      (i) =>
        (!q.type || i.type === q.type) &&
        (!q.status || i.status === q.status) &&
        (!q.problem || i.problems.includes(q.problem)) &&
        (!q.departmentId ||
          (q.departmentId === 'none' ? !i.department : i.department?.id === q.departmentId)) &&
        (!q.branchId || (q.branchId === 'none' ? !i.branch : i.branch?.id === q.branchId)) &&
        (!q.batchId || i.batch?.id === q.batchId) &&
        (!needle || [i.code, i.nameEn, i.nameAr].some((s) => s.toLowerCase().includes(needle))),
    );
    all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const start = (q.page - 1) * q.pageSize;
    return {
      items: all.slice(start, start + q.pageSize),
      total: all.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** My tasks: the imported drafts the user owns. */
  async myDrafts(actor: AuthUser): Promise<MigrationItemDto[]> {
    return (await this.items('IMPORTED', { ownerId: actor.id })).filter(
      (i) => i.status === 'DRAFT',
    );
  }

  async export(
    scope: MigrationScope,
    locale: Locale,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<ExcelFile> {
    const d = await this.dashboard(scope);
    const items = await this.items(scope);
    const ar = locale === 'ar';
    const L = (en: string, a: string) => (ar ? a : en);
    const name = (x: { nameEn: string; nameAr: string } | null) =>
      x ? (ar ? x.nameAr || x.nameEn : x.nameEn || x.nameAr) : L('(none)', '(لا يوجد)');
    const cols = [
      L('Total', 'الإجمالي'),
      L('Draft', 'مسودة'),
      L('In review', 'قيد المراجعة'),
      L('Approved', 'معتمد'),
      L('Published', 'منشور'),
      L('Archived', 'مؤرشف'),
      L('Without owner', 'بدون مالك'),
      L('Without English', 'بدون إنجليزي'),
      L('Without Arabic', 'بدون عربي'),
      L('Conventions', 'معايير النمذجة'),
    ];
    const keys: (keyof MigrationCounts)[] = [
      'total',
      'draft',
      'inReview',
      'approved',
      'published',
      'archived',
      'noOwner',
      'missingEn',
      'missingAr',
      'conventions',
    ];
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ProcessHub';
    for (const [title, rows] of [
      [L('By department', 'حسب الإدارة'), d.departments],
      [L('By branch', 'حسب الفرع'), d.branches],
    ] as const) {
      const ws = addSheet(
        wb,
        title,
        [L('Group', 'المجموعة'), ...cols],
        [36, ...cols.map(() => 12)],
        locale,
      );
      for (const g of rows)
        ws.addRow([
          `${g.code ? `${g.code} ` : ''}${name(g.id ? g : null)}`,
          ...keys.map((k) => g.counts[k]),
        ]);
      ws.addRow([L('Total', 'الإجمالي'), ...keys.map((k) => d.totals[k])]).font = { bold: true };
    }
    const ws = addSheet(
      wb,
      L('Items', 'العناصر'),
      [
        L('Type', 'النوع'),
        L('Code', 'الرمز'),
        L('Name (English)', 'الاسم (إنجليزي)'),
        L('Name (Arabic)', 'الاسم (عربي)'),
        L('Status', 'الحالة'),
        L('Owner', 'المالك'),
        L('Department', 'الإدارة'),
        L('Branch', 'الفرع'),
        L('Batch', 'الدفعة'),
        L('Problems', 'الملاحظات'),
      ],
      [12, 14, 34, 34, 14, 24, 24, 24, 12, 40],
      locale,
    );
    for (const i of items)
      ws.addRow([
        i.type,
        i.code,
        i.nameEn,
        i.nameAr,
        i.status,
        i.owner ? name(i.owner) : '',
        i.department ? name(i.department) : '',
        i.branch ? `${i.branch.code} ${name(i.branch)}` : '',
        i.batch?.number ?? '',
        i.problems.join(', '),
      ]);
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'ImportBatch',
      entityId: null,
      userId: actor.id,
      summary: { migrationDashboard: scope, items: items.length },
      meta,
    });
    return {
      data: Buffer.from(await wb.xlsx.writeBuffer()),
      fileName: `migration-${new Date().toISOString().slice(0, 10)}.xlsx`,
      contentType: XLSX_TYPE,
    };
  }

  // ---------- Bulk actions ----------

  async bulk(
    input: MigrationBulkInput,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<MigrationBulkResultDto> {
    const result: MigrationBulkResultDto = {
      action: input.action,
      done: 0,
      unchanged: 0,
      failed: [],
      issues: [],
    };
    if (input.action === 'ASSIGN_OWNER') {
      const owner = await this.prisma.user.findFirst({
        where: { id: input.ownerId, deletedAt: null, status: 'ACTIVE' },
      });
      if (!owner) throw badRequest('UNKNOWN_OWNER');
    }
    const theme =
      input.action === 'APPLY_THEME'
        ? resolveDiagramTheme(
            (await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.DIAGRAM_THEME } }))
              ?.value,
          )
        : null;
    for (const it of input.items) {
      try {
        switch (input.action) {
          case 'ASSIGN_OWNER':
            await this.assignOwner(it.type, it.id, input.ownerId!, actor, meta);
            result.done++;
            break;
          case 'APPLY_THEME': {
            if (it.type !== 'PROCESS') {
              result.unchanged++;
              break;
            }
            const p = await this.prisma.process.findFirst({
              where: { id: it.id, deletedAt: null },
              include: { model: true },
            });
            if (!p?.model || p.status !== 'DRAFT') {
              result.unchanged++;
              break;
            }
            const { xml, changed } = applyThemeToXml(p.model.bpmnXml, theme!);
            if (!changed) {
              result.unchanged++;
              break;
            }
            await this.models.createVersion(
              p.id,
              { bpmnXml: xml, changeNote: APPLY_THEME_CHANGE_NOTE },
              actor,
              meta,
            );
            result.done++;
            break;
          }
          case 'VALIDATE': {
            const problems = await this.validate(it.type, it.id);
            if (problems.length) result.issues.push({ ...it, problems });
            result.done++;
            break;
          }
          case 'SUBMIT':
            await this.reviews.submit(it.type, it.id, { note: input.note }, actor, meta);
            result.done++;
            break;
        }
      } catch (e) {
        const code =
          e instanceof AppException ? e.code : ((e as Error).message || 'FAILED').slice(0, 100);
        result.failed.push({ ...it, code });
      }
    }
    return result;
  }

  private async assignOwner(
    type: MigrationItemType,
    id: string,
    ownerId: string,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const where = { id, deletedAt: null };
    const data = { ownerId, updatedById: actor.id };
    const res =
      type === 'PROCESS'
        ? await this.prisma.process.updateMany({ where, data })
        : type === 'PAGE'
          ? await this.prisma.page.updateMany({ where, data })
          : await this.prisma.diagram.updateMany({ where, data });
    if (!res.count) throw badRequest('NOT_FOUND');
    await this.audit.log({
      action: 'UPDATE',
      entityType: type === 'PROCESS' ? 'Process' : type === 'PAGE' ? 'Page' : 'Diagram',
      entityId: id,
      userId: actor.id,
      summary: { ownerId, migration: 'bulk' },
      meta,
    });
  }

  /** Checks of one item: mandatory modeling conventions, missing languages, owner, diagram. */
  private async validate(type: MigrationItemType, id: string): Promise<string[]> {
    const out: string[] = [];
    if (type === 'PROCESS') {
      const p = await this.prisma.process.findFirst({
        where: { id, deletedAt: null },
        include: { model: true },
      });
      if (!p) return ['NOT_FOUND'];
      if (!p.ownerId) out.push('NO_OWNER');
      if (!p.nameEn) out.push('MISSING_EN');
      if (!p.nameAr) out.push('MISSING_AR');
      if (!p.model) out.push('NO_MODEL');
      else
        for (const v of await this.conventions.violations(p.model.bpmnXml))
          out.push(`CONVENTION:${v.rule}`);
    } else if (type === 'PAGE') {
      const p = await this.prisma.page.findFirst({ where: { id, deletedAt: null } });
      if (!p) return ['NOT_FOUND'];
      if (!p.ownerId) out.push('NO_OWNER');
      if (!htmlToText(p.contentEn).trim() && !p.titleEn) out.push('MISSING_EN');
      if (!htmlToText(p.contentAr).trim() && !p.titleAr) out.push('MISSING_AR');
    } else {
      const d = await this.prisma.diagram.findFirst({ where: { id, deletedAt: null } });
      if (!d) return ['NOT_FOUND'];
      if (!d.ownerId) out.push('NO_OWNER');
      if (!d.nameEn) out.push('MISSING_EN');
      if (!d.nameAr) out.push('MISSING_AR');
    }
    return out;
  }
}
