import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { z } from 'zod';
import {
  CONTROL_EFFECTIVENESS,
  CONTROL_FREQUENCIES,
  CONTROL_NATURES,
  CONTROL_TYPES,
  GRC_IMPORT_MAX_BYTES,
  GRC_IMPORT_MAX_ROWS,
  GRC_STATUSES,
  PROCESS_ELEMENT_ID,
  rateRisk,
  type GrcDashboardQuery,
  REQUIREMENT_LEVELS,
  RISK_RESPONSES,
  createControlSchema,
  createRequirementSchema,
  createRiskSchema,
  updateControlSchema,
  updateRequirementSchema,
  updateRiskSchema,
  type ControlDto,
  type GrcImportKind,
  type GrcImportReportDto,
  type GrcImportRowIssue,
  type GrcItemDto,
  type GrcSettings,
  type Locale,
  type RequirementDto,
  type RiskDto,
  needsChangeApproval,
} from '@processhub/shared';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { badRequest } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { GrcService } from './grc.service';
import { GrcSettingsService } from './grc-settings.service';
import { GrcDashboardService } from './grc-dashboard.service';
import { compareNatural } from '../common/compare';

export interface GrcFile {
  data: Buffer;
  fileName: string;
  contentType: string;
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Cell = string | number | boolean | Date | null;

interface Column<T> {
  key: string;
  en: string;
  ar: string;
  width: number;
  /** Allowed values (shown on the "Lists" sheet). */
  values?: readonly string[];
  get: (item: T, ctx: ExportContext) => Cell;
}

interface ExportContext {
  settings: GrcSettings;
  codes: Map<string, string>;
}

const list = (refs: { id: string; code: string | null }[]) =>
  refs
    .map((r) => r.code)
    .filter(Boolean)
    .join('; ');
const date = (v: string | null) => (v ? new Date(v) : null);

const COMMON_START = <T extends GrcItemDto>(): Column<T>[] => [
  { key: 'code', en: 'Code', ar: 'الرمز', width: 12, get: (x) => x.code },
  {
    key: 'nameEn',
    en: 'Title (English)',
    ar: 'العنوان (إنجليزي)',
    width: 36,
    get: (x) => x.nameEn,
  },
  { key: 'nameAr', en: 'Title (Arabic)', ar: 'العنوان (عربي)', width: 36, get: (x) => x.nameAr },
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
];

const COMMON_END = <T extends GrcItemDto>(): Column<T>[] => [
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
    width: 24,
    get: (x) => x.department?.nameEn || x.department?.nameAr || null,
  },
  {
    key: 'status',
    en: 'Status',
    ar: 'الحالة',
    width: 12,
    values: GRC_STATUSES,
    get: (x) => x.status,
  },
  {
    key: 'nextReviewAt',
    en: 'Next review (date)',
    ar: 'المراجعة القادمة (تاريخ)',
    width: 16,
    get: (x) => date(x.nextReviewAt),
  },
];

const RISK_COLUMNS: Column<RiskDto>[] = [
  ...COMMON_START<RiskDto>(),
  {
    key: 'category',
    en: 'Category (key)',
    ar: 'الفئة (المفتاح)',
    width: 16,
    get: (x) => x.category,
  },
  {
    key: 'causeEn',
    en: 'Cause (English)',
    ar: 'السبب (إنجليزي)',
    width: 30,
    get: (x) => x.causeEn,
  },
  { key: 'causeAr', en: 'Cause (Arabic)', ar: 'السبب (عربي)', width: 30, get: (x) => x.causeAr },
  {
    key: 'consequenceEn',
    en: 'Consequence (English)',
    ar: 'الأثر (إنجليزي)',
    width: 30,
    get: (x) => x.consequenceEn,
  },
  {
    key: 'consequenceAr',
    en: 'Consequence (Arabic)',
    ar: 'الأثر (عربي)',
    width: 30,
    get: (x) => x.consequenceAr,
  },
  {
    key: 'inherentLikelihood',
    en: 'Inherent likelihood (1-5)',
    ar: 'الاحتمالية الكامنة (1-5)',
    width: 12,
    get: (x) => x.inherentLikelihood,
  },
  {
    key: 'inherentImpact',
    en: 'Inherent impact (1-5)',
    ar: 'الأثر الكامن (1-5)',
    width: 12,
    get: (x) => x.inherentImpact,
  },
  {
    key: 'residualLikelihood',
    en: 'Residual likelihood (1-5)',
    ar: 'الاحتمالية المتبقية (1-5)',
    width: 12,
    get: (x) => x.residualLikelihood,
  },
  {
    key: 'residualImpact',
    en: 'Residual impact (1-5)',
    ar: 'الأثر المتبقي (1-5)',
    width: 12,
    get: (x) => x.residualImpact,
  },
  {
    key: 'response',
    en: 'Response',
    ar: 'الاستجابة',
    width: 12,
    values: RISK_RESPONSES,
    get: (x) => x.response,
  },
  {
    key: 'controls',
    en: 'Controls (codes; separated)',
    ar: 'الضوابط (رموز مفصولة بـ ;)',
    width: 20,
    get: (x) => list(x.controls),
  },
  ...COMMON_END<RiskDto>(),
];

const CONTROL_COLUMNS: Column<ControlDto>[] = [
  ...COMMON_START<ControlDto>(),
  {
    key: 'controlType',
    en: 'Type',
    ar: 'النوع',
    width: 14,
    values: CONTROL_TYPES,
    get: (x) => x.controlType,
  },
  {
    key: 'nature',
    en: 'Nature',
    ar: 'الطبيعة',
    width: 20,
    values: CONTROL_NATURES,
    get: (x) => x.nature,
  },
  {
    key: 'frequency',
    en: 'Frequency',
    ar: 'التكرار',
    width: 16,
    values: CONTROL_FREQUENCIES,
    get: (x) => x.frequency,
  },
  {
    key: 'keyControl',
    en: 'Key control (yes/no)',
    ar: 'ضابط رئيسي (نعم/لا)',
    width: 12,
    values: ['yes', 'no'],
    get: (x) => (x.keyControl ? 'yes' : 'no'),
  },
  {
    key: 'system',
    en: 'IT system (code or name)',
    ar: 'النظام التقني (رمز أو اسم)',
    width: 20,
    get: (x) => x.system?.code || x.system?.nameEn || null,
  },
  {
    key: 'effectiveness',
    en: 'Design effectiveness',
    ar: 'فعالية التصميم',
    width: 16,
    values: CONTROL_EFFECTIVENESS,
    get: (x) => x.effectiveness,
  },
  {
    key: 'requirements',
    en: 'Requirements (codes; separated)',
    ar: 'المتطلبات (رموز مفصولة بـ ;)',
    width: 20,
    get: (x) => list(x.requirements),
  },
  ...COMMON_END<ControlDto>(),
];

const REQUIREMENT_COLUMNS: Column<RequirementDto>[] = [
  ...COMMON_START<RequirementDto>(),
  {
    key: 'level',
    en: 'Level',
    ar: 'المستوى',
    width: 12,
    values: REQUIREMENT_LEVELS,
    get: (x) => x.level,
  },
  {
    key: 'parent',
    en: 'Parent (code)',
    ar: 'الأصل (الرمز)',
    width: 14,
    get: (x) => x.parent?.code ?? null,
  },
  {
    key: 'sourceRef',
    en: 'Source reference',
    ar: 'مرجع المصدر',
    width: 24,
    get: (x) => x.sourceRef,
  },
  { key: 'url', en: 'Link', ar: 'الرابط', width: 30, get: (x) => x.url },
  {
    key: 'effectiveDate',
    en: 'Effective date',
    ar: 'تاريخ السريان',
    width: 14,
    get: (x) => date(x.effectiveDate),
  },
  ...COMMON_END<RequirementDto>(),
];

const COLUMNS = {
  risks: RISK_COLUMNS,
  controls: CONTROL_COLUMNS,
  requirements: REQUIREMENT_COLUMNS,
} as unknown as Record<GrcImportKind, Column<GrcItemDto>[]>;

const SHEET_NAMES: Record<GrcImportKind, { en: string; ar: string }> = {
  risks: { en: 'Risks', ar: 'المخاطر' },
  controls: { en: 'Controls', ar: 'الضوابط' },
  requirements: { en: 'Requirements', ar: 'المتطلبات' },
};

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8EEF6' },
};

/** Stands in for a parent that is created earlier in the same import. */
const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Text of a cell (rich text, formulas and hyperlinks flattened; dates as YYYY-MM-DD). */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v)
      return v.richText
        .map((r) => r.text)
        .join('')
        .trim();
    if ('text' in v) return String(v.text).trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    return '';
  }
  return String(v).trim();
}

/**
 * Excel export, template and import of the three registers (Phase 4.1). Import is an upsert by
 * code, validated completely first: any error and nothing is imported (the report lists every
 * issue by row and column).
 */
@Injectable()
export class GrcExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly grc: GrcService,
    private readonly settings: GrcSettingsService,
    private readonly dashboard: GrcDashboardService,
  ) {}

  private async items(kind: GrcImportKind): Promise<GrcItemDto[]> {
    const q = { page: 1, pageSize: 100_000, order: 'asc' as const, sort: 'code' };
    if (kind === 'risks') return (await this.grc.listRisks({ ...q, matrix: 'residual' })).items;
    if (kind === 'controls') return (await this.grc.listControls(q)).items;
    return (await this.grc.listRequirements(q)).items;
  }

  private async workbook(kind: GrcImportKind, locale: Locale, rows: GrcItemDto[]) {
    const settings = await this.settings.get();
    const columns = COLUMNS[kind];
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ProcessHub';
    const ws = wb.addWorksheet(SHEET_NAMES[kind][locale], {
      views: [{ state: 'frozen', ySplit: 1, rightToLeft: locale === 'ar' }],
    });
    ws.addRow(columns.map((c) => c[locale]));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = HEADER_FILL;
    ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
    const ctx: ExportContext = { settings, codes: new Map() };
    for (const item of rows) ws.addRow(columns.map((c) => c.get(item, ctx)));
    columns.forEach((c, i) => {
      if (c.key === 'nextReviewAt' || c.key === 'effectiveDate')
        ws.getColumn(i + 1).numFmt = 'yyyy-mm-dd';
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

    // Allowed values for the coded columns (and the configured risk categories).
    const lists = wb.addWorksheet(locale === 'ar' ? 'القوائم' : 'Lists', {
      views: [{ rightToLeft: locale === 'ar' }],
    });
    const coded = columns.filter((c) => c.values || c.key === 'category');
    lists.addRow(coded.map((c) => c[locale]));
    lists.getRow(1).font = { bold: true };
    const values = coded.map((c) =>
      c.key === 'category'
        ? settings.categories.map((x) => `${x.key} — ${locale === 'ar' ? x.nameAr : x.nameEn}`)
        : [...(c.values ?? [])],
    );
    const depth = Math.max(0, ...values.map((v) => v.length));
    for (let r = 0; r < depth; r++) lists.addRow(values.map((v) => v[r] ?? null));
    coded.forEach((_, i) => (lists.getColumn(i + 1).width = 28));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async export(kind: GrcImportKind, locale: Locale, actor: AuthUser, meta: RequestMeta) {
    const items = await this.items(kind);
    const data = await this.workbook(kind, locale, items);
    await this.audit.log({
      action: 'EXPORT',
      entityType: kind === 'risks' ? 'Risk' : kind === 'controls' ? 'Control' : 'Requirement',
      userId: actor.id,
      summary: { report: `grc-${kind}`, locale, rows: items.length },
      meta,
    });
    return { data, fileName: `${kind}.xlsx`, contentType: XLSX } satisfies GrcFile;
  }

  async template(kind: GrcImportKind, locale: Locale): Promise<GrcFile> {
    return {
      data: await this.workbook(kind, locale, []),
      fileName: `${kind}-template.xlsx`,
      contentType: XLSX,
    };
  }

  // ---------- Import ----------

  private async readRows(kind: GrcImportKind, file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) throw badRequest('FILE_REQUIRED');
    if (file.size > GRC_IMPORT_MAX_BYTES) throw badRequest('FILE_TOO_LARGE');
    // xlsx is a ZIP archive: check the signature, not the name or the declared type.
    if (file.buffer.subarray(0, 4).toString('hex') !== '504b0304')
      throw badRequest('INVALID_FILE_TYPE');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw badRequest('INVALID_FILE_TYPE');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest('EMPTY_FILE');
    const columns = COLUMNS[kind];
    const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => norm(cellText(v)));
    const index = new Map<string, number>();
    for (const c of columns) {
      const at = header.findIndex((h) => h && [c.key, c.en, c.ar].some((l) => norm(l) === h));
      if (at > 0) index.set(c.key, at);
    }
    if (!index.has('code')) throw badRequest('MISSING_CODE_COLUMN');
    const rows: { row: number; values: Record<string, string> }[] = [];
    ws.eachRow((r, n) => {
      if (n === 1) return;
      const values: Record<string, string> = {};
      for (const [k, i] of index) values[k] = cellText(r.getCell(i).value);
      if (Object.values(values).some((v) => v !== '')) rows.push({ row: n, values });
    });
    if (rows.length > GRC_IMPORT_MAX_ROWS) throw badRequest('TOO_MANY_ROWS');
    return { rows, present: new Set(index.keys()) };
  }

  async import(
    kind: GrcImportKind,
    file: Express.Multer.File | undefined,
    dryRun: boolean,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<GrcImportReportDto> {
    const { rows, present } = await this.readRows(kind, file);
    const settings = await this.settings.get();
    const type = kind === 'risks' ? 'RISK' : kind === 'controls' ? 'CONTROL' : 'REQUIREMENT';
    const [existing, users, departments, controls, requirements, systems] = await Promise.all([
      this.prisma.repoObject.findMany({
        where: { type, deletedAt: null, code: { not: null } },
        select: {
          id: true,
          code: true,
          risk: { select: { status: true } },
          control: { select: { status: true } },
        },
      }),
      this.prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, email: true } }),
      this.prisma.department.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.prisma.repoObject.findMany({
        where: { type: 'CONTROL', deletedAt: null, code: { not: null } },
        select: { id: true, code: true },
      }),
      this.prisma.repoObject.findMany({
        where: { type: 'REQUIREMENT', deletedAt: null, code: { not: null } },
        select: { id: true, code: true },
      }),
      this.prisma.repoObject.findMany({
        where: { type: 'SYSTEM', deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
    ]);
    const byCode = (l: { id: string; code: string | null }[]) =>
      new Map(l.map((o) => [norm(o.code!), o.id]));
    const existingIds = byCode(existing);
    // Change approval (D-104): rows changing an active / retired item become pending changes of
    // one batch; new items are imported as drafts; items with a change already pending are refused.
    const approval = type !== 'REQUIREMENT' && needsChangeApproval(type, 'ACTIVE', settings);
    const pendingIds = approval
      ? new Set(
          (
            await this.prisma.grcChange.findMany({
              where: { status: 'PENDING', objectId: { in: existing.map((e) => e.id) } },
              select: { objectId: true },
            })
          ).map((c) => c.objectId),
        )
      : new Set<string>();
    const draftIds = new Set(
      existing.filter((e) => (e.risk ?? e.control)?.status === 'DRAFT').map((e) => e.id),
    );
    const controlIds = byCode(controls);
    const requirementIds = byCode(requirements);
    const userIds = new Map(users.map((u) => [norm(u.email), u.id]));
    const deptIds = new Map<string, string>();
    for (const d of departments)
      for (const k of [d.code, d.nameEn, d.nameAr]) if (k) deptIds.set(norm(k), d.id);
    const systemIds = new Map<string, string>();
    for (const s of systems)
      for (const k of [s.code, s.nameEn, s.nameAr]) if (k) systemIds.set(norm(k), s.id);
    // Requirements of this file can be parents of later rows.
    const fileCodes = new Set(rows.map((r) => norm(r.values.code ?? '')));

    const errors: GrcImportRowIssue[] = [];
    const seen = new Set<string>();
    const prepared: {
      row: number;
      code: string;
      input: Record<string, unknown>;
      parentCode?: string;
    }[] = [];
    const [create, update]: z.ZodType[] =
      kind === 'risks'
        ? [createRiskSchema, updateRiskSchema]
        : kind === 'controls'
          ? [createControlSchema, updateControlSchema]
          : [createRequirementSchema, updateRequirementSchema];

    for (const { row, values } of rows) {
      const err = (column: string, code: string) => errors.push({ row, column, code });
      const v = (k: string) => (present.has(k) ? values[k] : undefined);
      const code = values.code;
      if (!code) err('code', 'REQUIRED');
      else if (seen.has(norm(code))) err('code', 'DUPLICATE_IN_FILE');
      seen.add(norm(code ?? ''));
      const input: Record<string, unknown> = { code };
      for (const k of ['nameEn', 'nameAr', 'descriptionEn', 'descriptionAr'])
        if (v(k) !== undefined) input[k] = v(k);
      const optionalEnum = (k: string, allowed: readonly string[], target = k) => {
        const raw = v(k);
        if (!raw) return;
        const up = raw.toUpperCase().replace(/[\s-]+/g, '_');
        if (!allowed.includes(up)) err(k, 'INVALID_VALUE');
        else input[target] = up;
      };
      const dateValue = (k: string) => {
        const raw = v(k);
        if (raw === undefined) return;
        if (!raw) input[k] = null;
        else if (Number.isNaN(Date.parse(raw))) err(k, 'INVALID_DATE');
        else input[k] = raw;
      };
      const owner = v('owner');
      if (owner) {
        if (userIds.has(norm(owner))) input.ownerId = userIds.get(norm(owner));
        else err('owner', 'UNKNOWN_USER');
      } else if (owner === '') input.ownerId = null;
      const dept = v('department');
      if (dept) {
        if (deptIds.has(norm(dept))) input.departmentId = deptIds.get(norm(dept));
        else err('department', 'UNKNOWN_DEPARTMENT');
      } else if (dept === '') input.departmentId = null;
      optionalEnum('status', GRC_STATUSES);
      dateValue('nextReviewAt');
      const codes = (k: string, map: Map<string, string>, target: string, unknown: string) => {
        const raw = v(k);
        if (raw === undefined) return;
        const ids: string[] = [];
        for (const c of raw
          .split(/[;,\n]/)
          .map((s) => s.trim())
          .filter(Boolean)) {
          const id = map.get(norm(c));
          if (id) ids.push(id);
          else err(k, unknown);
        }
        input[target] = ids;
      };

      let parentCode: string | undefined;
      if (kind === 'risks') {
        const cat = v('category');
        if (cat !== undefined) {
          const key = cat
            .split(/\s+[—-]\s+/)[0]
            .trim()
            .toUpperCase();
          if (!settings.categories.some((c) => c.key === key)) err('category', 'INVALID_CATEGORY');
          else input.category = key;
        }
        for (const k of [
          'inherentLikelihood',
          'inherentImpact',
          'residualLikelihood',
          'residualImpact',
        ]) {
          const raw = v(k);
          if (raw === undefined) continue;
          if (raw === '') input[k] = k.startsWith('residual') ? null : undefined;
          else if (!/^[1-5]$/.test(raw)) err(k, 'INVALID_RATING');
          else input[k] = Number(raw);
        }
        for (const k of ['causeEn', 'causeAr', 'consequenceEn', 'consequenceAr'])
          if (v(k) !== undefined) input[k] = v(k);
        optionalEnum('response', RISK_RESPONSES);
        codes('controls', controlIds, 'controlIds', 'UNKNOWN_CONTROL');
      } else if (kind === 'controls') {
        optionalEnum('controlType', CONTROL_TYPES);
        optionalEnum('nature', CONTROL_NATURES);
        optionalEnum('frequency', CONTROL_FREQUENCIES);
        optionalEnum('effectiveness', CONTROL_EFFECTIVENESS);
        const key = v('keyControl');
        if (key) {
          const k = norm(key);
          if (['yes', 'y', 'true', '1', 'نعم'].includes(k)) input.keyControl = true;
          else if (['no', 'n', 'false', '0', 'لا'].includes(k)) input.keyControl = false;
          else err('keyControl', 'INVALID_VALUE');
        }
        const sys = v('system');
        if (sys) {
          if (systemIds.has(norm(sys))) input.systemId = systemIds.get(norm(sys));
          else err('system', 'UNKNOWN_SYSTEM');
        } else if (sys === '') input.systemId = null;
        codes('requirements', requirementIds, 'requirementIds', 'UNKNOWN_REQUIREMENT');
      } else {
        optionalEnum('level', REQUIREMENT_LEVELS);
        for (const k of ['sourceRef', 'url'])
          if (v(k) !== undefined) input[k] = v(k) || (k === 'url' ? null : '');
        dateValue('effectiveDate');
        const parent = v('parent');
        if (parent) {
          if (!requirementIds.has(norm(parent)) && !fileCodes.has(norm(parent)))
            err('parent', 'UNKNOWN_REQUIREMENT');
          else parentCode = parent;
        } else if (parent === '') input.parentId = null;
      }

      // New items need what a create needs; existing ones are partial updates.
      const isNew = !existingIds.has(norm(code ?? ''));
      if (!isNew && pendingIds.has(existingIds.get(norm(code!))!)) err('code', 'CHANGE_PENDING');
      if (isNew && approval) input.status = 'DRAFT';
      const parsed = (isNew ? create : update).safeParse({
        ...input,
        ...(parentCode ? { parentId: PLACEHOLDER_ID } : {}),
      });
      if (!parsed.success)
        for (const issue of parsed.error.issues) {
          const column = String(issue.path[0] ?? 'code');
          // A column already reported by the checks above is not reported twice.
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
      if (
        isNew &&
        kind === 'requirements' &&
        !parentCode &&
        input.level &&
        input.level !== 'SOURCE'
      )
        err('parent', 'PARENT_REQUIRED');
      if (code) prepared.push({ row, code, input, parentCode });
    }

    const unique = (l: GrcImportRowIssue[]) => [
      ...new Map(l.map((e) => [`${e.row}|${e.column}|${e.code}`, e])).values(),
    ];
    const report: GrcImportReportDto = {
      kind,
      rows: rows.length,
      created: prepared.filter((p) => !existingIds.has(norm(p.code))).length,
      updated: prepared.filter((p) => existingIds.has(norm(p.code))).length,
      // Dry run: rows that would wait for approval (unchanged rows are skipped on import).
      pending: approval
        ? prepared.filter((p) => {
            const id = existingIds.get(norm(p.code));
            return !!id && !draftIds.has(id);
          }).length
        : 0,
      batchId: null,
      errors: unique(errors).slice(0, 500),
      imported: false,
    };
    if (dryRun || errors.length) return report;

    // Requirements: sources first, so parents in the same file exist before their children.
    const order = { SOURCE: 0, SECTION: 1, CLAUSE: 2 } as Record<string, number>;
    if (kind === 'requirements')
      prepared.sort(
        (a, b) =>
          (order[String(a.input.level ?? (a.parentCode ? 'CLAUSE' : 'SOURCE'))] ?? 0) -
          (order[String(b.input.level ?? (b.parentCode ? 'CLAUSE' : 'SOURCE'))] ?? 0),
      );
    const batchId = approval ? randomUUID() : undefined;
    let pending = 0;
    report.pending = 0;
    for (const p of prepared) {
      const id = existingIds.get(norm(p.code));
      const input = { ...p.input };
      if (p.parentCode) input.parentId = existingIds.get(norm(p.parentCode));
      let saved: { item: { id: string }; pendingChange?: { batchId: string | null } | null };
      if (kind === 'risks')
        saved = id
          ? await this.grc.updateRisk(id, input, actor, meta, { batchId })
          : await this.grc.createRisk(input as never, actor, meta);
      else if (kind === 'controls')
        saved = id
          ? await this.grc.updateControl(id, input, actor, meta, { batchId })
          : await this.grc.createControl(input as never, actor, meta);
      else
        saved = id
          ? await this.grc.updateRequirement(id, input, actor, meta)
          : await this.grc.createRequirement(input as never, actor, meta);
      existingIds.set(norm(p.code), saved.item.id);
      if (batchId && saved.pendingChange?.batchId === batchId) pending++;
    }
    await this.audit.log({
      action: 'IMPORT',
      entityType: type === 'RISK' ? 'Risk' : type === 'CONTROL' ? 'Control' : 'Requirement',
      userId: actor.id,
      summary: {
        kind,
        rows: report.rows,
        created: report.created,
        updated: report.updated - pending,
        pending,
        ...(pending ? { batchId } : {}),
      },
      meta,
    });
    return {
      ...report,
      updated: report.updated - pending,
      pending,
      batchId: pending ? batchId! : null,
      imported: true,
    };
  }

  // ---------- Risk–control matrix ----------

  /**
   * Risk–control matrix (RCM): process → step → risk → mitigating control → requirements, with
   * ratings and effectiveness; second sheet: the coverage figures; third: steps with risks but no
   * control. Scope as on the dashboard.
   */
  async rcm(
    q: GrcDashboardQuery,
    locale: Locale,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<GrcFile> {
    const ar = locale === 'ar';
    const L = (en: string, a: string) => (ar ? a : en);
    const settings = await this.settings.get();
    const band = (key: string | null) => {
      const b = settings.bands.find((x) => x.key === key);
      return b ? (ar ? b.nameAr : b.nameEn) : '';
    };
    const pick = (o: { nameEn: string; nameAr: string }) =>
      (ar ? o.nameAr || o.nameEn : o.nameEn || o.nameAr) ?? '';
    const links = await this.prisma.objectLink.findMany({
      where: {
        process: {
          deletedAt: null,
          ...(q.processId ? { id: q.processId } : {}),
          ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        },
        repoObject: { type: 'RISK', deletedAt: null, risk: { status: { not: 'RETIRED' } } },
      },
      include: {
        process: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        repoObject: {
          include: {
            risk: {
              include: {
                controls: {
                  include: {
                    control: {
                      include: {
                        object: true,
                        requirements: {
                          include: { requirement: { include: { object: true } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const labels = await this.grc.labels([...new Set(links.map((l) => l.processId))]);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ProcessHub';
    const sheet = (name: string, header: string[], widths: number[]) => {
      const ws = wb.addWorksheet(name, {
        views: [{ state: 'frozen', ySplit: 1, rightToLeft: ar }],
      });
      ws.addRow(header);
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = HEADER_FILL;
      widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
      return ws;
    };
    const rcm = sheet(
      L('Risk-control matrix', 'مصفوفة المخاطر والضوابط'),
      [
        L('Process', 'العملية'),
        L('Step', 'الخطوة'),
        L('Risk code', 'رمز الخطر'),
        L('Risk', 'الخطر'),
        L('Inherent', 'الكامن'),
        L('Residual', 'المتبقي'),
        L('Control code', 'رمز الضابط'),
        L('Control', 'الضابط'),
        L('Type', 'النوع'),
        L('Key control', 'ضابط رئيسي'),
        L('Effectiveness', 'الفعالية'),
        L('Requirements', 'المتطلبات'),
      ],
      [30, 30, 12, 36, 16, 16, 12, 36, 14, 10, 18, 24],
    );
    const effectiveness: Record<string, [string, string]> = {
      EFFECTIVE: ['Effective', 'فعّال'],
      PARTLY: ['Partly effective', 'فعّال جزئيًا'],
      NOT_EFFECTIVE: ['Not effective', 'غير فعّال'],
      NOT_ASSESSED: ['Not assessed', 'لم يُقيَّم'],
    };
    const ctype: Record<string, [string, string]> = {
      PREVENTIVE: ['Preventive', 'وقائي'],
      DETECTIVE: ['Detective', 'كشفي'],
      CORRECTIVE: ['Corrective', 'تصحيحي'],
    };
    const sorted = [...links].sort(
      (a, b) =>
        compareNatural(a.process.code, b.process.code) ||
        a.bpmnElementId.localeCompare(b.bpmnElementId) ||
        (a.repoObject.code ?? '').localeCompare(b.repoObject.code ?? ''),
    );
    let rows = 0;
    for (const l of sorted) {
      const r = l.repoObject.risk!;
      const rating = rateRisk(r, settings.bands);
      const label = labels.get(l.processId)?.get(l.bpmnElementId);
      const step =
        l.bpmnElementId === PROCESS_ELEMENT_ID
          ? L('Whole process', 'العملية كاملة')
          : (label && (ar ? label.nameAr || label.nameEn : label.nameEn || label.nameAr)) ||
            l.bpmnElementId;
      const lead = [
        `${l.process.code} ${pick(l.process)}`,
        step,
        l.repoObject.code ?? '',
        pick(l.repoObject),
        `${band(rating.inherentBand)} · ${rating.inherentScore}`,
        `${band(rating.residualBand)} · ${rating.residualScore}`,
      ];
      const controls = r.controls.filter((c) => !c.control.object.deletedAt);
      if (!controls.length) {
        rcm.addRow([...lead, '', '', '', '', '', '']);
        rows++;
      }
      for (const c of controls) {
        const ctl = c.control;
        rcm.addRow([
          ...lead,
          ctl.object.code ?? '',
          pick(ctl.object),
          ctype[ctl.controlType][ar ? 1 : 0],
          ctl.keyControl ? L('Yes', 'نعم') : L('No', 'لا'),
          effectiveness[ctl.effectiveness][ar ? 1 : 0],
          ctl.requirements
            .filter((x) => !x.requirement.object.deletedAt)
            .map((x) => x.requirement.object.code || pick(x.requirement.object))
            .join('; '),
        ]);
        rows++;
      }
    }

    const dash = await this.dashboard.dashboard(q);
    const cov = sheet(
      L('Coverage', 'التغطية'),
      [L('Measure', 'المؤشر'), L('Count', 'العدد')],
      [50, 12],
    );
    const c = dash.coverage;
    for (const [en, a, n] of [
      ['Active risks', 'المخاطر النشطة', dash.heatMap.total],
      ['Risks without controls', 'مخاطر بلا ضوابط', c.risksWithoutControls],
      ['High / critical residual risks', 'مخاطر متبقية مرتفعة / حرجة', c.alertRisks],
      [
        'High / critical without an effective control',
        'مرتفعة / حرجة دون ضابط فعّال',
        c.alertRisksWithoutEffectiveControl,
      ],
      [
        'Key controls not assessed or not effective',
        'ضوابط رئيسية لم تُقيَّم أو غير فعّالة',
        c.keyControlsAttention,
      ],
      ['Requirements without controls', 'متطلبات بلا ضوابط', c.requirementsWithoutControls],
      ['Steps with risks but no control', 'خطوات بها مخاطر دون ضوابط', c.stepsWithRiskNoControl],
      [
        'Processes with risks but no control',
        'عمليات بها مخاطر دون ضوابط',
        c.processesWithRiskNoControl,
      ],
      ['Overdue reviews', 'مراجعات متأخرة', c.overdueReviews],
    ] as const)
      cov.addRow([L(en, a), n]);

    const unc = sheet(
      L('Steps without controls', 'خطوات بلا ضوابط'),
      [L('Process', 'العملية'), L('Step', 'الخطوة'), L('Risks', 'المخاطر')],
      [30, 30, 50],
    );
    for (const s of await this.dashboard.uncoveredSteps(q))
      unc.addRow([
        `${s.process.code} ${pick(s.process)}`,
        s.bpmnElementId === PROCESS_ELEMENT_ID
          ? L('Whole process', 'العملية كاملة')
          : (s.element && pick(s.element)) || s.bpmnElementId,
        s.risks.map((r) => `${r.code ?? ''} ${pick(r)}`.trim()).join('; '),
      ]);

    await this.audit.log({
      action: 'EXPORT',
      entityType: 'Risk',
      userId: actor.id,
      summary: { report: 'grc-rcm', locale, rows, ...q },
      meta,
    });
    return {
      data: Buffer.from(await wb.xlsx.writeBuffer()),
      fileName: 'risk-control-matrix.xlsx',
      contentType: XLSX,
    };
  }
}
