import { Injectable } from '@nestjs/common';
import {
  SYSTEM_ROLES,
  SYSTEM_ROLE_KEYS,
  type ImportChange,
  type ImportIssue,
  type ImportKind,
  type Locale,
  type SystemRoleKey,
} from '@processhub/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthSettingsService } from '../../auth/auth-settings.service';
import { InvitationsService } from '../../users/invitations.service';
import type { ApplyContext, Importer, ParseContext, ParsedItem } from '../importer';
import {
  issue,
  norm,
  readTabular,
  splitCells,
  tabularTemplate,
  type TabularField,
} from './tabular';

export const USER_FIELDS: TabularField[] = [
  {
    key: 'email',
    en: 'E-mail',
    ar: 'البريد الإلكتروني',
    required: true,
    aliases: ['email', 'mail', 'البريد'],
    width: 30,
  },
  { key: 'nameEn', en: 'Name (English)', ar: 'الاسم (إنجليزي)', aliases: ['name'], width: 28 },
  { key: 'nameAr', en: 'Name (Arabic)', ar: 'الاسم (عربي)', aliases: ['الاسم'], width: 28 },
  {
    key: 'department',
    en: 'Department (code or name)',
    ar: 'الإدارة (الرمز أو الاسم)',
    aliases: ['department'],
    width: 24,
  },
  {
    key: 'roles',
    en: 'Roles (separated by ;)',
    ar: 'الأدوار (مفصولة بـ ;)',
    aliases: ['roles', 'role'],
    width: 28,
    values: SYSTEM_ROLE_KEYS.filter((r) => r !== 'SUPER_ADMIN'),
  },
  {
    key: 'jobRoles',
    en: 'Job roles (separated by ;)',
    ar: 'المسميات الوظيفية (مفصولة بـ ;)',
    aliases: ['job roles', 'job role'],
    width: 28,
  },
  {
    key: 'locale',
    en: 'Language (en / ar)',
    ar: 'اللغة (en / ar)',
    aliases: ['language', 'locale'],
    width: 10,
    values: ['en', 'ar'],
  },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UserRow {
  email: string;
  nameEn: string;
  nameAr: string;
  departmentId: string | null;
  roles: SystemRoleKey[];
  jobRoleIds: string[];
  locale: 'en' | 'ar';
}

/**
 * Users from Excel / CSV (M15 step 2) — no passwords: new users get a set-password invitation, or
 * sign in with SSO (linked by e-mail). Super Admins are never created or changed by an import;
 * the break-glass account and the importing user are left unchanged; roles that require two-factor
 * authentication are flagged (enrolment at the first sign-in). Roles are added, never removed.
 */
@Injectable()
export class UsersImporter implements Importer {
  readonly kinds: ImportKind[] = ['USERS'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly authSettings: AuthSettingsService,
    private readonly invitations: InvitationsService,
  ) {}

  template(_kind: ImportKind, locale: Locale) {
    return tabularTemplate(
      'users',
      locale === 'ar' ? 'المستخدمون' : 'Users',
      USER_FIELDS,
      [
        [
          'sara.ahmed@example.org',
          'Sara Ahmed',
          'سارة أحمد',
          'SPD',
          'PROCESS_OWNER',
          'Process analyst',
          'ar',
        ],
      ],
      locale,
    );
  }

  async parse(ctx: ParseContext) {
    const table = await readTabular(ctx.files[0], USER_FIELDS, ctx.options.mapping);
    if (table.issues.some((i) => i.level === 'ERROR'))
      return { items: [], columns: table.columns, fields: table.fields, issues: table.issues };
    const [users, departments, jobRoles, settings, mode] = await Promise.all([
      this.prisma.user.findMany({
        include: { roles: { include: { role: true } }, jobRoles: true },
      }),
      this.prisma.department.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.prisma.repoObject.findMany({
        where: { type: 'ROLE', deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.authSettings.get(),
      this.invitations.mode(),
    ]);
    const byEmail = new Map(users.map((u) => [norm(u.email), u]));
    const deptBy = new Map<string, string>();
    for (const d of departments)
      for (const k of [d.code, d.nameEn, d.nameAr]) if (k) deptBy.set(norm(k), d.id);
    const jobBy = new Map<string, string>();
    for (const j of jobRoles)
      for (const k of [j.code, j.nameEn, j.nameAr]) if (k) jobBy.set(norm(k), j.id);
    const roleBy = new Map<string, SystemRoleKey>();
    for (const k of SYSTEM_ROLE_KEYS)
      for (const label of [k, SYSTEM_ROLES[k].nameEn, SYSTEM_ROLES[k].nameAr, k.replace(/_/g, ' ')])
        roleBy.set(norm(label), k);
    const count = new Map<string, number>();
    for (const r of table.rows)
      if (r.values.email)
        count.set(norm(r.values.email), (count.get(norm(r.values.email)) ?? 0) + 1);
    const update = ctx.options.updateExisting !== false;
    const batchIssues: ImportIssue[] = [...table.issues];
    if (mode === 'SSO') batchIssues.push(issue('WARNING', 'USERS_SIGN_IN_WITH_SSO'));
    else if (mode === 'NO_EMAIL' && ctx.options.sendInvitations !== false)
      batchIssues.push(issue('WARNING', 'NO_EMAIL_FOR_INVITATIONS'));

    const items: ParsedItem[] = table.rows.map((r) => {
      const v = r.values;
      const issues: ImportIssue[] = [];
      const email = (v.email ?? '').trim().toLowerCase();
      if (!email) issues.push(issue('ERROR', 'EMAIL_REQUIRED'));
      else if (!EMAIL_RE.test(email) || email.length > 254)
        issues.push(issue('ERROR', 'INVALID_EMAIL', { email }));
      else if ((count.get(norm(email)) ?? 0) > 1)
        issues.push(issue('ERROR', 'DUPLICATE_IN_FILE', { code: email }));
      if (!v.nameEn && !v.nameAr && !(email && byEmail.has(norm(email))))
        issues.push(issue('ERROR', 'NAME_REQUIRED'));
      let departmentId: string | null = null;
      if (v.department) {
        departmentId = deptBy.get(norm(v.department)) ?? null;
        if (!departmentId)
          issues.push(issue('ERROR', 'UNKNOWN_DEPARTMENT', { value: v.department }));
      }
      const roles: SystemRoleKey[] = [];
      for (const raw of splitCells(v.roles ?? '')) {
        const key = roleBy.get(norm(raw));
        if (!key) issues.push(issue('ERROR', 'UNKNOWN_ROLE', { value: raw }));
        else if (key === 'SUPER_ADMIN')
          issues.push(issue('ERROR', 'ROLE_NOT_IMPORTABLE', { value: raw }));
        else if (!roles.includes(key)) roles.push(key);
      }
      if (!roles.length && !issues.some((i) => i.code.startsWith('UNKNOWN_ROLE')))
        roles.push('VIEWER');
      const mfaRoles = roles.filter((x) => settings.mfaRequiredRoles.includes(x));
      if (mfaRoles.length)
        issues.push(issue('WARNING', 'MFA_REQUIRED_AT_SIGN_IN', { roles: mfaRoles.join(', ') }));
      const jobRoleIds: string[] = [];
      for (const raw of splitCells(v.jobRoles ?? '')) {
        const id = jobBy.get(norm(raw));
        if (!id) issues.push(issue('ERROR', 'UNKNOWN_JOB_ROLE', { value: raw }));
        else if (!jobRoleIds.includes(id)) jobRoleIds.push(id);
      }
      const locale = norm(v.locale ?? '') === 'ar' || norm(v.locale ?? '') === 'عربي' ? 'ar' : 'en';
      const data: UserRow = {
        email,
        nameEn: v.nameEn ?? '',
        nameAr: v.nameAr ?? '',
        departmentId,
        roles,
        jobRoleIds,
        locale,
      };
      const match = email ? byEmail.get(norm(email)) : undefined;
      const changes: ImportChange[] = [];
      let action: ParsedItem['action'] = 'CREATE';
      if (match?.deletedAt) issues.push(issue('ERROR', 'EMAIL_OF_DELETED_USER', { email }));
      else if (match) {
        action = 'SKIP';
        const currentRoles = match.roles.map((x) => x.role.key as SystemRoleKey);
        if (match.id === settings.breakGlassUserId)
          issues.push(issue('WARNING', 'BREAK_GLASS_UNCHANGED'));
        else if (match.id === ctx.actor.id) issues.push(issue('WARNING', 'OWN_ACCOUNT_UNCHANGED'));
        else if (currentRoles.includes('SUPER_ADMIN'))
          issues.push(issue('WARNING', 'SUPER_ADMIN_UNCHANGED'));
        else {
          const cmp: [string, string | null, string | null][] = [
            ['nameEn', match.nameEn, data.nameEn || match.nameEn],
            ['nameAr', match.nameAr, data.nameAr || match.nameAr],
            ['departmentId', match.departmentId, departmentId ?? match.departmentId],
          ];
          for (const [f, from, to] of cmp)
            if ((from ?? '') !== (to ?? '')) changes.push({ field: f, from, to });
          const added = roles.filter(
            (x) => !currentRoles.includes(x) && !(x === 'VIEWER' && !v.roles),
          );
          if (added.length)
            changes.push({
              field: 'roles',
              from: currentRoles.join(', '),
              to: [...currentRoles, ...added].join(', '),
            });
          const currentJobs = match.jobRoles.map((j) => j.repoObjectId);
          const newJobs = jobRoleIds.filter((j) => !currentJobs.includes(j));
          if (newJobs.length)
            changes.push({
              field: 'jobRoles',
              from: currentJobs.length,
              to: currentJobs.length + newJobs.length,
            });
          if (update && changes.length) action = 'UPDATE';
          data.roles = added;
          data.jobRoleIds = newJobs;
        }
      }
      return {
        ref: `row:${r.row}`,
        entity: 'USER',
        key: email,
        nameEn: data.nameEn,
        nameAr: data.nameAr,
        action,
        matchId: match && !match.deletedAt ? match.id : null,
        matchBy: match ? 'EMAIL' : null,
        source: `${ctx.files[0].fileName} · ${r.row}`,
        issues,
        changes,
        suggestions: [],
        skip: false,
        facts: { roles: roles.join(', ') },
        data,
      };
    });
    return { items, columns: table.columns, fields: table.fields, issues: batchIssues };
  }

  async apply(ctx: ApplyContext, items: ParsedItem[]) {
    const roles = new Map(
      (await this.prisma.role.findMany({ select: { id: true, key: true } })).map((r) => [
        r.key,
        r.id,
      ]),
    );
    const settings = await this.authSettings.get();
    const invite =
      ctx.options.sendInvitations !== false && (await this.invitations.mode()) === 'INVITE';
    for (const item of items) {
      const d = item.data as UserRow;
      let token: string | null = null;
      const res = await ctx.step(item, async (tx) => {
        if (item.action === 'UPDATE' && item.matchId) {
          const before = await tx.user.findFirstOrThrow({
            where: { id: item.matchId, deletedAt: null },
            include: { roles: { include: { role: true } } },
          });
          if (
            before.id === settings.breakGlassUserId ||
            before.id === ctx.actor.id ||
            before.roles.some((r) => r.role.key === 'SUPER_ADMIN')
          )
            throw new Error('USER_NOT_IMPORTABLE');
          const data: Record<string, unknown> = { updatedById: ctx.actor.id };
          for (const c of item.changes)
            if (['nameEn', 'nameAr', 'departmentId'].includes(c.field)) data[c.field] = c.to;
          await tx.user.update({ where: { id: before.id }, data });
          for (const key of d.roles)
            await tx.userRole.upsert({
              where: { userId_roleId: { userId: before.id, roleId: roles.get(key)! } },
              update: {},
              create: { userId: before.id, roleId: roles.get(key)! },
            });
          for (const repoObjectId of d.jobRoleIds)
            await tx.userJobRole.upsert({
              where: { userId_repoObjectId: { userId: before.id, repoObjectId } },
              update: {},
              create: { userId: before.id, repoObjectId },
            });
          return {
            entity: 'USER',
            entityId: before.id,
            outcome: 'UPDATED',
            externalKey: d.email,
            before: Object.fromEntries(item.changes.map((c) => [c.field, c.from])),
            after: Object.fromEntries(item.changes.map((c) => [c.field, c.to])),
          };
        }
        const user = await tx.user.create({
          data: {
            email: d.email,
            nameEn: d.nameEn,
            nameAr: d.nameAr,
            locale: d.locale,
            departmentId: d.departmentId,
            passwordHash: '',
            createdById: ctx.actor.id,
            updatedById: ctx.actor.id,
            roles: { create: d.roles.map((k) => ({ roleId: roles.get(k)! })) },
            jobRoles: { create: d.jobRoleIds.map((repoObjectId) => ({ repoObjectId })) },
          },
        });
        if (invite) token = await this.invitations.create(user.id, ctx.actor.id, tx);
        return {
          entity: 'USER',
          entityId: user.id,
          outcome: 'CREATED',
          externalKey: d.email,
          after: { roles: d.roles, invited: invite },
        };
      });
      const createdId = res?.[0]?.outcome === 'CREATED' ? res[0].entityId : null;
      if (token && createdId) await this.invitations.send(createdId, token);
    }
  }
}
