import { Injectable } from '@nestjs/common';
import type { Prisma, ProcessCategory } from '@prisma/client';
import type { ImportChange, ImportIssue, ImportKind, Locale } from '@processhub/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { ApplyContext, Importer, ParseContext, ParsedItem } from '../importer';
import { issue, norm, readTabular, tabularTemplate, type TabularField } from './tabular';

const CATEGORIES: ProcessCategory[] = ['MANAGEMENT', 'CORE', 'SUPPORT'];
const CATEGORY_ALIASES: Record<string, ProcessCategory> = {
  management: 'MANAGEMENT',
  m: 'MANAGEMENT',
  إدارية: 'MANAGEMENT',
  core: 'CORE',
  c: 'CORE',
  رئيسية: 'CORE',
  support: 'SUPPORT',
  s: 'SUPPORT',
  مساندة: 'SUPPORT',
};

export const PROCESS_FIELDS: TabularField[] = [
  {
    key: 'code',
    en: 'Process code',
    ar: 'رمز العملية',
    required: true,
    aliases: ['code', 'الرمز'],
    width: 14,
  },
  {
    key: 'nameEn',
    en: 'Name (English)',
    ar: 'الاسم (إنجليزي)',
    aliases: ['name', 'english name'],
    width: 32,
  },
  {
    key: 'nameAr',
    en: 'Name (Arabic)',
    ar: 'الاسم (عربي)',
    aliases: ['arabic name', 'الاسم'],
    width: 32,
  },
  {
    key: 'descriptionEn',
    en: 'Description (English)',
    ar: 'الوصف (إنجليزي)',
    aliases: ['description'],
    width: 40,
  },
  {
    key: 'descriptionAr',
    en: 'Description (Arabic)',
    ar: 'الوصف (عربي)',
    aliases: ['الوصف'],
    width: 40,
  },
  { key: 'category', en: 'Category', ar: 'الفئة', values: CATEGORIES, width: 14 },
  { key: 'parentCode', en: 'Parent code', ar: 'رمز العملية الأم', aliases: ['parent'], width: 14 },
  { key: 'level', en: 'Level', ar: 'المستوى', width: 8 },
  {
    key: 'owner',
    en: 'Owner (e-mail)',
    ar: 'المالك (البريد)',
    aliases: ['owner', 'owner email'],
    width: 28,
  },
  {
    key: 'department',
    en: 'Department (code or name)',
    ar: 'الإدارة (الرمز أو الاسم)',
    aliases: ['department'],
    width: 24,
  },
  { key: 'sortOrder', en: 'Sort order', ar: 'الترتيب', width: 10 },
];

interface ProcessRow {
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  category: ProcessCategory | null;
  parentCode: string | null;
  ownerId: string | null;
  departmentId: string | null;
  sortOrder: number | null;
}

const FIELDS_COMPARED = [
  'nameEn',
  'nameAr',
  'descriptionEn',
  'descriptionAr',
  'ownerId',
  'departmentId',
  'sortOrder',
] as const;

/** Process house from Excel / CSV (M15 step 2): builds or updates the process tree. */
@Injectable()
export class ProcessHouseImporter implements Importer {
  readonly kinds: ImportKind[] = ['PROCESS_HOUSE'];

  constructor(private readonly prisma: PrismaService) {}

  template(_kind: ImportKind, locale: Locale) {
    return tabularTemplate(
      'process-house',
      locale === 'ar' ? 'بيت العمليات' : 'Process house',
      PROCESS_FIELDS,
      [
        ['C', 'Core processes', 'العمليات الرئيسية', '', '', 'CORE', '', '1', '', '', '1'],
        ['C.01', 'Customer services', 'خدمات المتعاملين', '', '', 'CORE', 'C', '2', '', '', '1'],
        [
          'C.01.01',
          'Handle enquiries',
          'معالجة الاستفسارات',
          '',
          '',
          'CORE',
          'C.01',
          '3',
          '',
          '',
          '1',
        ],
      ],
      locale,
    );
  }

  async parse(ctx: ParseContext) {
    const table = await readTabular(ctx.files[0], PROCESS_FIELDS, ctx.options.mapping);
    if (table.issues.some((i) => i.level === 'ERROR'))
      return { items: [], columns: table.columns, fields: table.fields, issues: table.issues };
    const [existing, users, departments] = await Promise.all([
      this.prisma.process.findMany({ where: { deletedAt: null } }),
      this.prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, email: true } }),
      this.prisma.department.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
    ]);
    const byCode = new Map(existing.map((p) => [norm(p.code), p]));
    const byId = new Map(existing.map((p) => [p.id, p]));
    const userByEmail = new Map(users.map((u) => [norm(u.email), u.id]));
    const deptBy = new Map<string, string>();
    for (const d of departments)
      for (const k of [d.code, d.nameEn, d.nameAr]) if (k) deptBy.set(norm(k), d.id);
    const update = ctx.options.updateExisting !== false;

    const seen = new Map<string, number>();
    for (const r of table.rows) {
      const c = norm(r.values.code ?? '');
      if (c) seen.set(c, (seen.get(c) ?? 0) + 1);
    }
    const inFile = new Map<
      string,
      { row: number; parentCode: string | null; category: ProcessCategory | null }
    >();
    const parsed: { row: number; data: ProcessRow; issues: ImportIssue[] }[] = [];
    for (const r of table.rows) {
      const v = r.values;
      const issues: ImportIssue[] = [];
      const code = (v.code ?? '').trim();
      if (!code) issues.push(issue('ERROR', 'CODE_REQUIRED'));
      else if (code.length > 50) issues.push(issue('ERROR', 'CODE_TOO_LONG'));
      else if ((seen.get(norm(code)) ?? 0) > 1)
        issues.push(issue('ERROR', 'DUPLICATE_IN_FILE', { code }));
      if (!v.nameEn && !v.nameAr && !(code && byCode.has(norm(code))))
        issues.push(issue('ERROR', 'NAME_REQUIRED'));
      let category: ProcessCategory | null = null;
      if (v.category) {
        category =
          CATEGORY_ALIASES[norm(v.category)] ??
          (CATEGORIES.find((x) => x === v.category.toUpperCase()) || null);
        if (!category) issues.push(issue('ERROR', 'INVALID_CATEGORY', { value: v.category }));
      }
      let ownerId: string | null = null;
      if (v.owner) {
        ownerId = userByEmail.get(norm(v.owner)) ?? null;
        if (!ownerId)
          issues.push(
            ctx.options.defaultOwnerId
              ? issue('WARNING', 'UNKNOWN_OWNER_DEFAULT', { email: v.owner })
              : issue('ERROR', 'UNKNOWN_OWNER', { email: v.owner }),
          );
      }
      let departmentId: string | null = null;
      if (v.department) {
        departmentId = deptBy.get(norm(v.department)) ?? null;
        if (!departmentId)
          issues.push(issue('ERROR', 'UNKNOWN_DEPARTMENT', { value: v.department }));
      }
      const sortOrder = v.sortOrder ? Number(v.sortOrder) : null;
      if (v.sortOrder && !Number.isInteger(sortOrder))
        issues.push(issue('ERROR', 'INVALID_NUMBER', { column: 'sortOrder' }));
      const parentCode = v.parentCode?.trim() || null;
      if (parentCode && norm(parentCode) === norm(code))
        issues.push(issue('ERROR', 'PARENT_CYCLE'));
      if (code) inFile.set(norm(code), { row: r.row, parentCode, category });
      parsed.push({
        row: r.row,
        issues,
        data: {
          code,
          nameEn: v.nameEn ?? '',
          nameAr: v.nameAr ?? '',
          descriptionEn: v.descriptionEn ?? '',
          descriptionAr: v.descriptionAr ?? '',
          category,
          parentCode,
          ownerId: ownerId ?? (v.owner ? (ctx.options.defaultOwnerId ?? null) : null),
          departmentId,
          sortOrder: Number.isInteger(sortOrder) ? sortOrder : null,
        },
      });
    }

    // Depth (parents first) and inherited category; cycles and unknown parents.
    const depthCache = new Map<string, number | null>();
    const depthOf = (code: string, trail = new Set<string>()): number | null => {
      const k = norm(code);
      if (depthCache.has(k)) return depthCache.get(k)!;
      if (trail.has(k)) return null;
      trail.add(k);
      const f = inFile.get(k);
      let d: number | null;
      if (f)
        d = f.parentCode
          ? (() => {
              const pd = depthOf(f.parentCode!, trail);
              return pd === null ? null : pd + 1;
            })()
          : 1;
      else d = byCode.get(k)?.level ?? null;
      depthCache.set(k, d);
      return d;
    };
    const categoryOf = (code: string, trail = new Set<string>()): ProcessCategory | null => {
      const k = norm(code);
      if (trail.has(k)) return null;
      trail.add(k);
      const f = inFile.get(k);
      if (f)
        return (
          f.category ??
          (f.parentCode ? categoryOf(f.parentCode, trail) : (byCode.get(k)?.category ?? null))
        );
      return byCode.get(k)?.category ?? null;
    };

    const items: ParsedItem[] = parsed.map(({ row, data, issues }) => {
      const level = data.code ? depthOf(data.code) : null;
      if (
        data.parentCode &&
        !inFile.has(norm(data.parentCode)) &&
        !byCode.has(norm(data.parentCode))
      )
        issues.push(issue('ERROR', 'UNKNOWN_PARENT', { code: data.parentCode }));
      else if (data.code && level === null) issues.push(issue('ERROR', 'PARENT_CYCLE'));
      const category = data.code ? categoryOf(data.code) : null;
      if (!category && !issues.some((i) => i.code === 'INVALID_CATEGORY'))
        issues.push(issue('ERROR', 'CATEGORY_REQUIRED'));
      const given = table.rows.find((r) => r.row === row)?.values.level;
      if (given && level && Number(given) !== level)
        issues.push(issue('WARNING', 'LEVEL_ADJUSTED', { given, level }));
      const match = data.code ? byCode.get(norm(data.code)) : undefined;
      const changes: ImportChange[] = [];
      let action: ParsedItem['action'] = 'CREATE';
      if (match) {
        const parent = match.parentId ? byId.get(match.parentId) : null;
        if (norm(parent?.code ?? '') !== norm(data.parentCode ?? '') && data.parentCode !== null)
          issues.push(issue('WARNING', 'PARENT_CHANGE_IGNORED', { code: data.parentCode ?? '' }));
        const next = {
          ...data,
          ownerId: data.ownerId ?? match.ownerId,
          departmentId: data.departmentId ?? match.departmentId,
          sortOrder: data.sortOrder ?? match.sortOrder,
          nameEn: data.nameEn || match.nameEn,
          nameAr: data.nameAr || match.nameAr,
          descriptionEn: data.descriptionEn || match.descriptionEn,
          descriptionAr: data.descriptionAr || match.descriptionAr,
        };
        for (const f of FIELDS_COMPARED)
          if ((next[f] ?? null) !== (match[f] ?? null))
            changes.push({ field: f, from: match[f] ?? null, to: next[f] ?? null });
        if (data.category && data.category !== match.category)
          issues.push(issue('WARNING', 'CATEGORY_CHANGE_IGNORED'));
        if (!update) action = 'SKIP';
        else if (match.status !== 'DRAFT') {
          action = 'SKIP';
          if (changes.length)
            issues.push(issue('WARNING', 'NOT_DRAFT_SKIPPED', { status: match.status }));
        } else action = changes.length ? 'UPDATE' : 'SKIP';
      }
      return {
        ref: `row:${row}`,
        entity: 'PROCESS',
        key: data.code,
        nameEn: data.nameEn,
        nameAr: data.nameAr,
        action,
        matchId: match?.id ?? null,
        matchBy: match ? 'CODE' : null,
        source: `${ctx.files[0].fileName} · ${row}`,
        issues,
        changes,
        suggestions: [],
        skip: false,
        facts: { level: level ?? '—', ...(data.parentCode ? { parent: data.parentCode } : {}) },
        order: level ?? 0,
        data: { ...data, category, level },
      };
    });
    return { items, columns: table.columns, fields: table.fields, issues: table.issues };
  }

  async apply(ctx: ApplyContext, items: ParsedItem[]) {
    const created = new Map<string, { id: string; category: ProcessCategory; level: number }>();
    for (const item of items) {
      const d = item.data as ProcessRow & { level: number; category: ProcessCategory };
      await ctx.step(item, async (tx) => {
        if (item.action === 'UPDATE' && item.matchId) {
          const before = await tx.process.findFirstOrThrow({
            where: { id: item.matchId, deletedAt: null },
          });
          if (before.status !== 'DRAFT') throw new Error('NOT_DRAFT');
          const data = Object.fromEntries(
            item.changes.map((c) => [c.field, c.to]),
          ) as Prisma.ProcessUncheckedUpdateInput;
          await tx.process.update({
            where: { id: before.id },
            data: { ...data, updatedById: ctx.actor.id },
          });
          return {
            entity: 'PROCESS',
            entityId: before.id,
            outcome: 'UPDATED',
            externalKey: d.code,
            before: Object.fromEntries(item.changes.map((c) => [c.field, c.from])),
            after: Object.fromEntries(item.changes.map((c) => [c.field, c.to])),
          };
        }
        let parentId: string | null = null;
        let level = 1;
        let category = d.category;
        if (d.parentCode) {
          const inBatch = created.get(norm(d.parentCode));
          const parent =
            inBatch ??
            (await tx.process.findFirst({
              where: { code: { equals: d.parentCode, mode: 'insensitive' }, deletedAt: null },
              select: { id: true, category: true, level: true },
            }));
          if (!parent) throw new Error('UNKNOWN_PARENT');
          parentId = parent.id;
          level = parent.level + 1;
          category = parent.category;
        }
        const sortOrder =
          d.sortOrder ??
          ((
            await tx.process.aggregate({
              where: { parentId, category, deletedAt: null },
              _max: { sortOrder: true },
            })
          )._max.sortOrder ?? -1) + 1;
        const p = await tx.process.create({
          data: {
            code: d.code,
            nameEn: d.nameEn,
            nameAr: d.nameAr,
            descriptionEn: d.descriptionEn,
            descriptionAr: d.descriptionAr,
            category,
            parentId,
            level,
            sortOrder,
            ownerId: d.ownerId ?? ctx.options.defaultOwnerId ?? null,
            departmentId: d.departmentId,
            status: 'DRAFT',
            importBatchId: ctx.batchId,
            createdById: ctx.actor.id,
            updatedById: ctx.actor.id,
          },
        });
        created.set(norm(d.code), { id: p.id, category, level });
        return {
          entity: 'PROCESS',
          entityId: p.id,
          outcome: 'CREATED',
          externalKey: d.code,
          after: { code: p.code, parentCode: d.parentCode, level, category },
        };
      });
    }
  }
}
