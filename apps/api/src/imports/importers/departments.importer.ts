import { Injectable } from '@nestjs/common';
import type { ImportChange, ImportIssue, ImportKind, Locale } from '@processhub/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { ApplyContext, Importer, ParseContext, ParsedItem } from '../importer';
import { issue, norm, readTabular, tabularTemplate, type TabularField } from './tabular';

export const DEPARTMENT_FIELDS: TabularField[] = [
  {
    key: 'code',
    en: 'Department code',
    ar: 'رمز الإدارة',
    required: true,
    aliases: ['code', 'الرمز'],
    width: 14,
  },
  { key: 'nameEn', en: 'Name (English)', ar: 'الاسم (إنجليزي)', aliases: ['name'], width: 32 },
  { key: 'nameAr', en: 'Name (Arabic)', ar: 'الاسم (عربي)', aliases: ['الاسم'], width: 32 },
  {
    key: 'parentCode',
    en: 'Parent department code',
    ar: 'رمز الإدارة الأم',
    aliases: ['parent', 'parent code'],
    width: 16,
  },
  {
    key: 'manager',
    en: 'Head (e-mail)',
    ar: 'المدير (البريد)',
    aliases: ['manager', 'head'],
    width: 28,
  },
];

interface DepartmentRow {
  code: string;
  nameEn: string;
  nameAr: string;
  parentCode: string | null;
  managerId: string | null;
}

/** Departments (hierarchy) from Excel / CSV (M15 step 2). Matched by department code. */
@Injectable()
export class DepartmentsImporter implements Importer {
  readonly kinds: ImportKind[] = ['DEPARTMENTS'];

  constructor(private readonly prisma: PrismaService) {}

  template(_kind: ImportKind, locale: Locale) {
    return tabularTemplate(
      'departments',
      locale === 'ar' ? 'الإدارات' : 'Departments',
      DEPARTMENT_FIELDS,
      [
        ['DG', 'Director General Office', 'مكتب المدير العام', '', ''],
        ['SPD', 'Strategy and Performance', 'الاستراتيجية والأداء', 'DG', ''],
      ],
      locale,
    );
  }

  async parse(ctx: ParseContext) {
    const table = await readTabular(ctx.files[0], DEPARTMENT_FIELDS, ctx.options.mapping);
    if (table.issues.some((i) => i.level === 'ERROR'))
      return { items: [], columns: table.columns, fields: table.fields, issues: table.issues };
    const [existing, users] = await Promise.all([
      this.prisma.department.findMany({ where: { deletedAt: null } }),
      this.prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, email: true } }),
    ]);
    const byCode = new Map(existing.filter((d) => d.code).map((d) => [norm(d.code!), d]));
    const byId = new Map(existing.map((d) => [d.id, d]));
    const userByEmail = new Map(users.map((u) => [norm(u.email), u.id]));
    const count = new Map<string, number>();
    for (const r of table.rows)
      if (r.values.code) count.set(norm(r.values.code), (count.get(norm(r.values.code)) ?? 0) + 1);
    const parentOf = new Map<string, string | null>();
    for (const r of table.rows)
      if (r.values.code) parentOf.set(norm(r.values.code), r.values.parentCode?.trim() || null);
    const depth = (code: string, trail = new Set<string>()): number | null => {
      const k = norm(code);
      if (trail.has(k)) return null;
      trail.add(k);
      if (!parentOf.has(k)) return byCode.has(k) ? 0 : null;
      const p = parentOf.get(k);
      if (!p) return 1;
      const d = depth(p, trail);
      return d === null ? null : d + 1;
    };
    const update = ctx.options.updateExisting !== false;
    const items: ParsedItem[] = table.rows.map((r) => {
      const v = r.values;
      const issues: ImportIssue[] = [];
      const code = (v.code ?? '').trim();
      if (!code) issues.push(issue('ERROR', 'CODE_REQUIRED'));
      else if ((count.get(norm(code)) ?? 0) > 1)
        issues.push(issue('ERROR', 'DUPLICATE_IN_FILE', { code }));
      if (!v.nameEn && !v.nameAr && !(code && byCode.has(norm(code))))
        issues.push(issue('ERROR', 'NAME_REQUIRED'));
      const parentCode = v.parentCode?.trim() || null;
      if (parentCode && !parentOf.has(norm(parentCode)) && !byCode.has(norm(parentCode)))
        issues.push(issue('ERROR', 'UNKNOWN_PARENT', { code: parentCode }));
      const d = code ? depth(code) : 0;
      if (code && d === null && !issues.some((i) => i.code === 'UNKNOWN_PARENT'))
        issues.push(issue('ERROR', 'PARENT_CYCLE'));
      let managerId: string | null = null;
      if (v.manager) {
        managerId = userByEmail.get(norm(v.manager)) ?? null;
        if (!managerId)
          issues.push(issue('WARNING', 'UNKNOWN_MANAGER_IGNORED', { email: v.manager }));
      }
      const data: DepartmentRow = {
        code,
        nameEn: v.nameEn ?? '',
        nameAr: v.nameAr ?? '',
        parentCode,
        managerId,
      };
      const match = code ? byCode.get(norm(code)) : undefined;
      const changes: ImportChange[] = [];
      let action: ParsedItem['action'] = 'CREATE';
      if (match) {
        const parent = match.parentId ? byId.get(match.parentId) : null;
        const next: Record<string, string | null> = {
          nameEn: data.nameEn || match.nameEn,
          nameAr: data.nameAr || match.nameAr,
          parentCode: parentCode ?? parent?.code ?? null,
          managerId: managerId ?? match.managerId,
        };
        const cur: Record<string, string | null> = {
          nameEn: match.nameEn,
          nameAr: match.nameAr,
          parentCode: parent?.code ?? null,
          managerId: match.managerId,
        };
        for (const f of Object.keys(next))
          if (norm(next[f] ?? '') !== norm(cur[f] ?? ''))
            changes.push({ field: f, from: cur[f], to: next[f] });
        action = update && changes.length ? 'UPDATE' : 'SKIP';
      }
      return {
        ref: `row:${r.row}`,
        entity: 'DEPARTMENT',
        key: code,
        nameEn: data.nameEn,
        nameAr: data.nameAr,
        action,
        matchId: match?.id ?? null,
        matchBy: match ? 'CODE' : null,
        source: `${ctx.files[0].fileName} · ${r.row}`,
        issues,
        changes,
        suggestions: [],
        skip: false,
        facts: parentCode ? { parent: parentCode } : undefined,
        order: d ?? 0,
        data,
      };
    });
    return { items, columns: table.columns, fields: table.fields, issues: table.issues };
  }

  async apply(ctx: ApplyContext, items: ParsedItem[]) {
    const created = new Map<string, string>();
    const resolve = async (
      code: string | null,
      tx: Parameters<Parameters<ApplyContext['step']>[1]>[0],
    ) => {
      if (!code) return null;
      const id =
        created.get(norm(code)) ??
        (
          await tx.department.findFirst({
            where: { code: { equals: code, mode: 'insensitive' }, deletedAt: null },
            select: { id: true },
          })
        )?.id;
      if (!id) throw new Error('UNKNOWN_PARENT');
      return id;
    };
    for (const item of items) {
      const d = item.data as DepartmentRow;
      await ctx.step(item, async (tx) => {
        if (item.action === 'UPDATE' && item.matchId) {
          const data: Record<string, unknown> = { updatedById: ctx.actor.id };
          for (const c of item.changes) {
            if (c.field === 'parentCode') data.parentId = await resolve(c.to as string | null, tx);
            else data[c.field] = c.to;
          }
          if (data.parentId === item.matchId) throw new Error('PARENT_CYCLE');
          await tx.department.update({ where: { id: item.matchId }, data });
          return {
            entity: 'DEPARTMENT',
            entityId: item.matchId,
            outcome: 'UPDATED',
            externalKey: d.code,
            before: Object.fromEntries(item.changes.map((c) => [c.field, c.from])),
            after: Object.fromEntries(item.changes.map((c) => [c.field, c.to])),
          };
        }
        const dep = await tx.department.create({
          data: {
            code: d.code,
            nameEn: d.nameEn,
            nameAr: d.nameAr,
            parentId: await resolve(d.parentCode, tx),
            managerId: d.managerId,
            createdById: ctx.actor.id,
            updatedById: ctx.actor.id,
          },
        });
        created.set(norm(d.code), dep.id);
        return { entity: 'DEPARTMENT', entityId: dep.id, outcome: 'CREATED', externalKey: d.code };
      });
    }
  }
}
