import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { z } from 'zod';
import {
  KPI_DATA_SOURCES,
  KPI_DIRECTIONS,
  KPI_FREQUENCIES,
  KPI_STATUSES,
  PERMISSIONS,
  createKpiSchema,
  createObjectiveSchema,
  isPeriod,
  measurementSchema,
  updateKpiSchema,
  updateObjectiveSchema,
  type KpiDto,
  type KpiImportKind,
  type KpiImportReportDto,
  type KpiImportRowIssue,
  type Locale,
  type ObjectiveDto,
  type ScorecardQuery,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { forbidden } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import {
  XLSX_TYPE,
  addSheet,
  catalogueWorkbook,
  lookup,
  norm,
  readUpload,
  splitList,
  type ExcelColumn,
  type ExcelFile,
} from '../common/excel';
import { KpiService } from './kpi.service';
import { compareNatural } from '../common/compare';

interface MeasurementRow {
  kpi: string;
  period: string;
  value: number;
  comment: string;
}

const KPI_COLUMNS: ExcelColumn<KpiDto>[] = [
  { key: 'code', en: 'Code', ar: 'الرمز', width: 14, get: (x) => x.code },
  { key: 'nameEn', en: 'Name (English)', ar: 'الاسم (إنجليزي)', width: 32, get: (x) => x.nameEn },
  { key: 'nameAr', en: 'Name (Arabic)', ar: 'الاسم (عربي)', width: 32, get: (x) => x.nameAr },
  {
    key: 'descriptionEn',
    en: 'Definition (English)',
    ar: 'التعريف (إنجليزي)',
    width: 40,
    get: (x) => x.descriptionEn,
  },
  {
    key: 'descriptionAr',
    en: 'Definition (Arabic)',
    ar: 'التعريف (عربي)',
    width: 40,
    get: (x) => x.descriptionAr,
  },
  {
    key: 'formulaEn',
    en: 'Formula (English)',
    ar: 'المعادلة (إنجليزي)',
    width: 30,
    get: (x) => x.formulaEn,
  },
  {
    key: 'formulaAr',
    en: 'Formula (Arabic)',
    ar: 'المعادلة (عربي)',
    width: 30,
    get: (x) => x.formulaAr,
  },
  { key: 'unit', en: 'Unit', ar: 'الوحدة', width: 10, get: (x) => x.unit },
  {
    key: 'direction',
    en: 'Direction',
    ar: 'الاتجاه',
    width: 18,
    values: KPI_DIRECTIONS,
    get: (x) => x.direction,
  },
  {
    key: 'frequency',
    en: 'Frequency',
    ar: 'دورية القياس',
    width: 12,
    values: KPI_FREQUENCIES,
    get: (x) => x.frequency,
  },
  { key: 'target', en: 'Target', ar: 'المستهدف', width: 10, get: (x) => x.target },
  {
    key: 'greenThreshold',
    en: 'Green from',
    ar: 'أخضر من',
    width: 10,
    get: (x) => x.greenThreshold,
  },
  { key: 'redThreshold', en: 'Red from', ar: 'أحمر من', width: 10, get: (x) => x.redThreshold },
  { key: 'baseline', en: 'Baseline', ar: 'خط الأساس', width: 10, get: (x) => x.baseline },
  {
    key: 'baselinePeriod',
    en: 'Baseline period',
    ar: 'فترة خط الأساس',
    width: 12,
    get: (x) => x.baselinePeriod,
  },
  {
    key: 'owner',
    en: 'Owner (e-mail)',
    ar: 'المالك (البريد)',
    width: 26,
    get: (x) => x.owner?.email ?? null,
  },
  {
    key: 'department',
    en: 'Department',
    ar: 'الإدارة',
    width: 22,
    get: (x) => x.department?.nameEn || x.department?.nameAr || null,
  },
  {
    key: 'dataSource',
    en: 'Data source',
    ar: 'مصدر البيانات',
    width: 14,
    values: KPI_DATA_SOURCES.filter((s) => s !== 'CALCULATED' && s !== 'SALESFORCE'),
    get: (x) => x.dataSource,
  },
  {
    key: 'status',
    en: 'Status',
    ar: 'الحالة',
    width: 10,
    values: KPI_STATUSES,
    get: (x) => x.status,
  },
  {
    key: 'objectives',
    en: 'Objectives (codes)',
    ar: 'الأهداف (الرموز)',
    width: 22,
    get: (x) => x.objectives.map((o) => o.code || o.nameEn).join('; '),
  },
];

const MEASUREMENT_COLUMNS: ExcelColumn<MeasurementRow>[] = [
  { key: 'kpi', en: 'KPI (code)', ar: 'المؤشر (الرمز)', width: 16, get: (x) => x.kpi },
  {
    key: 'period',
    en: 'Period (2026-03, 2026-Q1, 2026)',
    ar: 'الفترة (2026-03، 2026-Q1، 2026)',
    width: 18,
    get: (x) => x.period,
  },
  { key: 'value', en: 'Actual value', ar: 'القيمة الفعلية', width: 14, get: (x) => x.value },
  { key: 'comment', en: 'Comment', ar: 'تعليق', width: 40, get: (x) => x.comment },
];

function objectiveColumns(parents: Map<string, string>): ExcelColumn<ObjectiveDto>[] {
  return [
    { key: 'code', en: 'Code', ar: 'الرمز', width: 14, get: (x) => x.code },
    { key: 'nameEn', en: 'Name (English)', ar: 'الاسم (إنجليزي)', width: 34, get: (x) => x.nameEn },
    { key: 'nameAr', en: 'Name (Arabic)', ar: 'الاسم (عربي)', width: 34, get: (x) => x.nameAr },
    {
      key: 'descriptionEn',
      en: 'Description (English)',
      ar: 'الوصف (إنجليزي)',
      width: 40,
      get: (x) => x.descriptionEn,
    },
    {
      key: 'descriptionAr',
      en: 'Description (Arabic)',
      ar: 'الوصف (عربي)',
      width: 40,
      get: (x) => x.descriptionAr,
    },
    {
      key: 'parent',
      en: 'Parent objective (code)',
      ar: 'الهدف الأعلى (الرمز)',
      width: 16,
      get: (x) => (x.parentId ? (parents.get(x.parentId) ?? null) : null),
    },
    {
      key: 'owner',
      en: 'Owner (e-mail)',
      ar: 'المالك (البريد)',
      width: 26,
      get: (x) => x.owner?.email ?? null,
    },
  ];
}

const SHEETS: Record<KpiImportKind, [string, string]> = {
  kpis: ['KPIs', 'المؤشرات'],
  measurements: ['Measurements', 'القياسات'],
  objectives: ['Objectives', 'الأهداف'],
};
const ENTITY = {
  kpis: 'Kpi',
  measurements: 'KpiMeasurement',
  objectives: 'StrategicObjective',
} as const;

/**
 * Excel of the KPI catalogue, the measurements and the objectives (Phase 4.3): export, template,
 * and an import that checks the whole file first (Phase 4.1 pattern).
 */
@Injectable()
export class KpiExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly kpis: KpiService,
  ) {}

  private async columns(kind: KpiImportKind): Promise<ExcelColumn<unknown>[]> {
    if (kind === 'kpis') return KPI_COLUMNS as ExcelColumn<unknown>[];
    if (kind === 'measurements') return MEASUREMENT_COLUMNS as ExcelColumn<unknown>[];
    const all = await this.kpis.objectives();
    return objectiveColumns(
      new Map(all.map((o) => [o.id, o.code || o.nameEn])),
    ) as ExcelColumn<unknown>[];
  }

  private async rows(kind: KpiImportKind): Promise<unknown[]> {
    if (kind === 'kpis')
      return (await this.kpis.listAll()).sort((a, b) => compareNatural(a.code ?? '', b.code ?? ''));
    if (kind === 'objectives') return this.kpis.objectives();
    const rows = await this.prisma.kpiMeasurement.findMany({
      where: { kpi: { object: { deletedAt: null } } },
      include: { kpi: { select: { object: { select: { code: true, nameEn: true } } } } },
      orderBy: [{ kpiId: 'asc' }, { periodStart: 'asc' }],
    });
    return rows.map<MeasurementRow>((m) => ({
      kpi: m.kpi.object.code || m.kpi.object.nameEn,
      period: m.period,
      value: m.value,
      comment: m.comment,
    }));
  }

  async export(kind: KpiImportKind, locale: Locale, actor: AuthUser, meta: RequestMeta) {
    const rows = await this.rows(kind);
    const data = await catalogueWorkbook(
      SHEETS[kind][locale === 'ar' ? 1 : 0],
      await this.columns(kind),
      rows,
      locale,
    );
    await this.audit.log({
      action: 'EXPORT',
      entityType: ENTITY[kind],
      userId: actor.id,
      summary: { report: `kpi-${kind}`, locale, rows: rows.length },
      meta,
    });
    return { data, fileName: `${kind}.xlsx`, contentType: XLSX_TYPE } satisfies ExcelFile;
  }

  async template(kind: KpiImportKind, locale: Locale): Promise<ExcelFile> {
    return {
      data: await catalogueWorkbook(
        SHEETS[kind][locale === 'ar' ? 1 : 0],
        await this.columns(kind),
        [],
        locale,
      ),
      fileName: `${kind}-template.xlsx`,
      contentType: XLSX_TYPE,
    };
  }

  /** The KPI dashboard as a workbook (objective, KPI, latest value, target, status, trend). */
  async scorecard(q: ScorecardQuery, actor: AuthUser, meta: RequestMeta): Promise<ExcelFile> {
    const card = await this.kpis.scorecard(q);
    const locale = q.locale;
    const ar = locale === 'ar';
    const L = (en: string, a: string) => (ar ? a : en);
    const pick = (o: { nameEn: string; nameAr: string }) =>
      ar ? o.nameAr || o.nameEn : o.nameEn || o.nameAr;
    const RAG: Record<string, [string, string]> = {
      GREEN: ['On target', 'ضمن المستهدف'],
      AMBER: ['Watch', 'تحت المراقبة'],
      RED: ['Off target', 'خارج المستهدف'],
    };
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ProcessHub';
    const ws = addSheet(
      wb,
      L('KPI scorecard', 'بطاقة الأداء'),
      [
        L('Objective', 'الهدف'),
        L('KPI code', 'رمز المؤشر'),
        L('KPI', 'المؤشر'),
        L('Unit', 'الوحدة'),
        L('Period', 'الفترة'),
        L('Actual', 'الفعلي'),
        L('Target', 'المستهدف'),
        L('Status', 'الحالة'),
        L('Trend (last values)', 'الاتجاه (آخر القيم)'),
        L('Owner', 'المالك'),
      ],
      [34, 12, 40, 8, 10, 10, 10, 16, 36, 24],
      locale,
    );
    for (const row of card.objectives)
      for (const k of row.kpis)
        ws.addRow([
          row.objective
            ? `${'  '.repeat(row.level - 1)}${row.objective.code ?? ''} ${pick(row.objective)}`.trim()
            : L('Without objective', 'دون هدف'),
          k.code ?? '',
          pick(k),
          k.unit,
          k.latest?.period ?? '',
          k.latest?.value ?? null,
          k.latest?.target ?? null,
          k.latest?.rag ? RAG[k.latest.rag][ar ? 1 : 0] : L('No value', 'لا توجد قيمة'),
          k.trend
            .slice(-6)
            .map((p) => p.value)
            .join(' · '),
          k.owner ? pick(k.owner) || k.owner.email : '',
        ]);
    const sum = addSheet(
      wb,
      L('Summary', 'الملخص'),
      [L('Status', 'الحالة'), L('KPIs', 'المؤشرات')],
      [30, 10],
      locale,
    );
    for (const [key, en, a] of [
      ['GREEN', 'On target', 'ضمن المستهدف'],
      ['AMBER', 'Watch', 'تحت المراقبة'],
      ['RED', 'Off target', 'خارج المستهدف'],
      ['none', 'No value', 'لا توجد قيمة'],
      ['due', 'Value due', 'قيمة مستحقة'],
      ['total', 'All KPIs', 'كل المؤشرات'],
    ] as const)
      sum.addRow([L(en, a), card.summary[key]]);
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'Kpi',
      userId: actor.id,
      summary: { report: 'kpi-scorecard', rows: card.summary.total, ...q },
      meta,
    });
    return {
      data: Buffer.from(await wb.xlsx.writeBuffer()),
      fileName: 'kpi-scorecard.xlsx',
      contentType: XLSX_TYPE,
    };
  }

  async import(
    kind: KpiImportKind,
    file: Express.Multer.File | undefined,
    dryRun: boolean,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<KpiImportReportDto> {
    const editor = actor.permissions.has(PERMISSIONS.KPI_EDIT);
    if (kind !== 'measurements' && !editor) throw forbidden();
    const columns = await this.columns(kind);
    const { rows, present } = await readUpload(
      file,
      columns,
      kind === 'measurements' ? ['kpi', 'period', 'value'] : ['code'],
    );
    const [users, departments, kpis, objectives] = await Promise.all([
      this.prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, email: true } }),
      this.prisma.department.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.prisma.repoObject.findMany({
        where: { type: 'KPI', deletedAt: null },
        select: {
          id: true,
          code: true,
          nameEn: true,
          nameAr: true,
          ownerId: true,
          kpi: { select: { frequency: true, dataSource: true, lockedFields: true } },
        },
      }),
      this.prisma.strategicObjective.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
    ]);
    const userIds = lookup(users, (u) => u.email);
    const deptIds = lookup(
      departments,
      (d) => d.code,
      (d) => d.nameEn,
      (d) => d.nameAr,
    );
    const kpiIds = lookup(
      kpis,
      (k) => k.code,
      (k) => k.nameEn,
      (k) => k.nameAr,
    );
    const objectiveIds = lookup(
      objectives,
      (o) => o.code,
      (o) => o.nameEn,
      (o) => o.nameAr,
    );
    const kpiById = new Map(kpis.map((k) => [k.id, k]));
    const existing = new Map<string, string>();
    for (const o of kind === 'kpis' ? kpis : objectives)
      if (o.code) existing.set(norm(o.code), o.id);
    const fileCodes = new Set(rows.map((r) => norm(r.values.code ?? '')));

    const errors: KpiImportRowIssue[] = [];
    const seen = new Set<string>();
    const prepared: {
      row: number;
      key: string;
      input: Record<string, unknown>;
      parent?: string;
      kpiId?: string;
    }[] = [];
    const PLACEHOLDER = '00000000-0000-4000-8000-000000000000';

    for (const { row, values } of rows) {
      const err = (column: string, code: string) => errors.push({ row, column, code });
      const v = (k: string) => (present.has(k) ? values[k] : undefined);
      const input: Record<string, unknown> = {};
      const number = (k: string) => {
        const raw = v(k);
        if (raw === undefined) return;
        if (raw === '') input[k] = null;
        else if (Number.isNaN(Number(raw.replace(/,/g, '')))) err(k, 'INVALID_NUMBER');
        else input[k] = Number(raw.replace(/,/g, ''));
      };

      if (kind === 'measurements') {
        const code = values.kpi;
        const kpiId = code ? kpiIds.get(norm(code)) : undefined;
        if (!code) err('kpi', 'REQUIRED');
        else if (!kpiId) err('kpi', 'UNKNOWN_KPI');
        const k = kpiId ? kpiById.get(kpiId) : undefined;
        const period = values.period;
        if (!period) err('period', 'REQUIRED');
        else if (k?.kpi && !isPeriod(period, k.kpi.frequency)) err('period', 'INVALID_PERIOD');
        const key = `${kpiId}|${period}`;
        if (seen.has(key)) err('period', 'DUPLICATE_IN_FILE');
        seen.add(key);
        number('value');
        if (input.value === null || input.value === undefined) err('value', 'REQUIRED');
        if (k && !editor && k.ownerId !== actor.id) err('kpi', 'NOT_OWNER');
        if (k?.kpi?.dataSource === 'SALESFORCE') err('kpi', 'SALESFORCE_OWNED');
        const parsed = measurementSchema.safeParse({
          period,
          value: input.value,
          comment: v('comment') ?? '',
        });
        if (!parsed.success && !errors.some((e) => e.row === row)) err('period', 'INVALID_PERIOD');
        if (kpiId && period && parsed.success)
          prepared.push({ row, key, kpiId, input: parsed.data as Record<string, unknown> });
        continue;
      }

      const code = values.code;
      if (!code) err('code', 'REQUIRED');
      else if (seen.has(norm(code))) err('code', 'DUPLICATE_IN_FILE');
      seen.add(norm(code ?? ''));
      input.code = code;
      for (const k of [
        'nameEn',
        'nameAr',
        'descriptionEn',
        'descriptionAr',
        'formulaEn',
        'formulaAr',
        'unit',
      ])
        if (v(k) !== undefined) input[k] = v(k);
      const enumOf = (k: string, allowed: readonly string[]) => {
        const raw = v(k);
        if (!raw) return;
        const up = raw.toUpperCase().replace(/[\s-]+/g, '_');
        if (!allowed.includes(up)) err(k, 'INVALID_VALUE');
        else input[k] = up;
      };
      const owner = v('owner');
      if (owner) {
        if (userIds.has(norm(owner))) input.ownerId = userIds.get(norm(owner));
        else err('owner', 'UNKNOWN_USER');
      } else if (owner === '') input.ownerId = null;

      let parent: string | undefined;
      if (kind === 'kpis') {
        enumOf('direction', KPI_DIRECTIONS);
        enumOf('frequency', KPI_FREQUENCIES);
        enumOf('dataSource', ['MANUAL', 'EXCEL']);
        enumOf('status', KPI_STATUSES);
        for (const k of ['target', 'greenThreshold', 'redThreshold', 'baseline']) number(k);
        if (v('baselinePeriod') !== undefined) input.baselinePeriod = v('baselinePeriod') || null;
        const dept = v('department');
        if (dept) {
          if (deptIds.has(norm(dept))) input.departmentId = deptIds.get(norm(dept));
          else err('department', 'UNKNOWN_DEPARTMENT');
        } else if (dept === '') input.departmentId = null;
        const objs = v('objectives');
        if (objs !== undefined) {
          const found: string[] = [];
          for (const c of splitList(objs)) {
            const id = objectiveIds.get(norm(c));
            if (id) found.push(id);
            else err('objectives', 'UNKNOWN_OBJECTIVE');
          }
          input.objectiveIds = found;
        }
        const id = existing.get(norm(code ?? ''));
        const locked = id ? (kpiById.get(id)?.kpi?.lockedFields ?? []) : [];
        for (const f of locked) if (input[f] !== undefined) delete input[f];
      } else {
        const p = v('parent');
        if (p) {
          if (!objectiveIds.has(norm(p)) && !fileCodes.has(norm(p)))
            err('parent', 'UNKNOWN_OBJECTIVE');
          else if (norm(p) === norm(code ?? '')) err('parent', 'INVALID_PARENT');
          else parent = p;
        } else if (p === '') input.parentId = null;
      }
      const isNew = !existing.has(norm(code ?? ''));
      const schema: z.ZodType =
        kind === 'kpis'
          ? isNew
            ? createKpiSchema
            : updateKpiSchema
          : isNew
            ? createObjectiveSchema
            : updateObjectiveSchema;
      const parsed = schema.safeParse({ ...input, ...(parent ? { parentId: PLACEHOLDER } : {}) });
      if (!parsed.success)
        for (const issue of parsed.error.issues) {
          const column = String(issue.path[0] ?? 'code');
          if (errors.some((e) => e.row === row && e.column === column)) continue;
          err(
            column,
            issue.code === 'custom'
              ? issue.message
              : input[column] === undefined
                ? 'REQUIRED'
                : 'INVALID_VALUE',
          );
        }
      if (kind === 'kpis' && input.baselinePeriod && input.frequency !== undefined)
        if (!isPeriod(String(input.baselinePeriod), input.frequency as never))
          err('baselinePeriod', 'INVALID_PERIOD');
      if (code) prepared.push({ row, key: code, input, parent });
    }

    const unique = (l: KpiImportRowIssue[]) => [
      ...new Map(l.map((e) => [`${e.row}|${e.column}|${e.code}`, e])).values(),
    ];
    const existingMeasure =
      kind === 'measurements'
        ? new Set(
            (
              await this.prisma.kpiMeasurement.findMany({
                where: { kpiId: { in: [...new Set(prepared.map((p) => p.kpiId!))] } },
                select: { kpiId: true, period: true },
              })
            ).map((m) => `${m.kpiId}|${m.period}`),
          )
        : null;
    const isUpdate = (p: (typeof prepared)[number]) =>
      existingMeasure ? existingMeasure.has(p.key) : existing.has(norm(p.key));
    const report: KpiImportReportDto = {
      kind,
      rows: rows.length,
      created: prepared.filter((p) => !isUpdate(p)).length,
      updated: prepared.filter(isUpdate).length,
      errors: unique(errors).slice(0, 500),
      imported: false,
    };
    if (dryRun || errors.length) return report;

    if (kind === 'measurements') {
      for (const p of prepared)
        await this.kpis.measure(p.kpiId!, p.input as never, actor, meta, { source: 'EXCEL' });
    } else {
      // Objectives: parents before children.
      const pending = [...prepared];
      const ordered: typeof prepared = [];
      while (pending.length) {
        const next = pending.findIndex(
          (p) =>
            !p.parent ||
            existing.has(norm(p.parent)) ||
            !pending.some((q) => norm(q.key) === norm(p.parent!)),
        );
        ordered.push(...pending.splice(next < 0 ? 0 : next, 1));
      }
      for (const p of ordered) {
        const id = existing.get(norm(p.key));
        const input = { ...p.input };
        if (p.parent)
          input.parentId = existing.get(norm(p.parent)) ?? objectiveIds.get(norm(p.parent));
        let savedId: string;
        if (kind === 'kpis')
          savedId = id
            ? (await this.kpis.update(id, input, actor, meta)).item.id
            : (await this.kpis.create(input as never, actor, meta)).item.id;
        else
          savedId = id
            ? (await this.kpis.updateObjective(id, input, actor, meta)).id
            : (await this.kpis.createObjective(input as never, actor, meta)).id;
        existing.set(norm(p.key), savedId);
      }
    }
    await this.audit.log({
      action: 'IMPORT',
      entityType: ENTITY[kind],
      userId: actor.id,
      summary: { kind, rows: report.rows, created: report.created, updated: report.updated },
      meta,
    });
    return { ...report, imported: true };
  }
}
