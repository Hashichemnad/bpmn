import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import {
  APP_HOSTINGS,
  APP_LIFECYCLES,
  APP_TYPES,
  CRITICALITIES,
  DATA_CLASSIFICATIONS,
  EA_STATUSES,
  INTERFACE_DIRECTIONS,
  INTERFACE_FREQUENCIES,
  INTERFACE_TECHNOLOGIES,
  STRATEGIC_IMPORTANCE,
  createApplicationSchema,
  createCapabilitySchema,
  createDataObjectSchema,
  createInterfaceSchema,
  updateApplicationSchema,
  updateCapabilitySchema,
  updateDataObjectSchema,
  updateInterfaceSchema,
  type ApplicationDto,
  type CapabilityDto,
  type DataObjectDto,
  type EaImportKind,
  type EaImportReportDto,
  type EaImportRowIssue,
  type InterfaceDto,
  type Locale,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import {
  XLSX_TYPE,
  catalogueWorkbook,
  iso,
  lookup,
  norm,
  readUpload,
  splitList,
  type ExcelColumn,
  type ExcelFile,
} from '../common/excel';
import { EaService } from './ea.service';

type AnyDto = ApplicationDto | InterfaceDto | DataObjectDto | CapabilityDto;

const named = <T extends { code: string | null; nameEn: string; nameAr: string }>(
  descEn = 'descriptionEn',
  descAr = 'descriptionAr',
  labels: [string, string, string, string] = [
    'Description (English)',
    'الوصف (إنجليزي)',
    'Description (Arabic)',
    'الوصف (عربي)',
  ],
): ExcelColumn<T>[] => [
  { key: 'code', en: 'Code', ar: 'الرمز', width: 14, get: (x) => x.code },
  { key: 'nameEn', en: 'Name (English)', ar: 'الاسم (إنجليزي)', width: 32, get: (x) => x.nameEn },
  { key: 'nameAr', en: 'Name (Arabic)', ar: 'الاسم (عربي)', width: 32, get: (x) => x.nameAr },
  {
    key: descEn,
    en: labels[0],
    ar: labels[1],
    width: 40,
    get: (x) => (x as unknown as Record<string, string>)[descEn] ?? '',
  },
  {
    key: descAr,
    en: labels[2],
    ar: labels[3],
    width: 40,
    get: (x) => (x as unknown as Record<string, string>)[descAr] ?? '',
  },
];

const codes = (l: { code: string | null; nameEn: string }[]) =>
  l.map((r) => r.code || r.nameEn).join('; ');

const APPLICATION_COLUMNS: ExcelColumn<ApplicationDto>[] = [
  ...named<ApplicationDto>(),
  { key: 'appType', en: 'Type', ar: 'النوع', width: 14, values: APP_TYPES, get: (x) => x.appType },
  { key: 'vendor', en: 'Vendor', ar: 'المورّد', width: 18, get: (x) => x.vendor },
  { key: 'version', en: 'Version', ar: 'الإصدار', width: 10, get: (x) => x.version },
  {
    key: 'businessOwner',
    en: 'Business owner (e-mail)',
    ar: 'مالك الأعمال (البريد)',
    width: 26,
    get: (x) => x.businessOwner?.email ?? null,
  },
  {
    key: 'itOwner',
    en: 'IT owner (e-mail)',
    ar: 'مالك تقنية المعلومات (البريد)',
    width: 26,
    get: (x) => x.itOwner?.email ?? null,
  },
  {
    key: 'department',
    en: 'Department',
    ar: 'الإدارة',
    width: 22,
    get: (x) => x.department?.nameEn || x.department?.nameAr || null,
  },
  {
    key: 'hosting',
    en: 'Hosting',
    ar: 'الاستضافة',
    width: 14,
    values: APP_HOSTINGS,
    get: (x) => x.hosting,
  },
  {
    key: 'hostingCountry',
    en: 'Hosting country (ISO)',
    ar: 'بلد الاستضافة (ISO)',
    width: 12,
    get: (x) => x.hostingCountry,
  },
  {
    key: 'lifecycle',
    en: 'Lifecycle',
    ar: 'دورة الحياة',
    width: 14,
    values: APP_LIFECYCLES,
    get: (x) => x.lifecycle,
  },
  {
    key: 'liveFrom',
    en: 'Live from (date)',
    ar: 'التشغيل منذ (تاريخ)',
    width: 14,
    date: true,
    get: (x) => iso(x.liveFrom),
  },
  {
    key: 'phaseOutFrom',
    en: 'Phase-out from (date)',
    ar: 'بدء الإيقاف التدريجي (تاريخ)',
    width: 14,
    date: true,
    get: (x) => iso(x.phaseOutFrom),
  },
  {
    key: 'retiredAt',
    en: 'Retired (date)',
    ar: 'الإيقاف (تاريخ)',
    width: 14,
    date: true,
    get: (x) => iso(x.retiredAt),
  },
  {
    key: 'criticality',
    en: 'Criticality',
    ar: 'الأهمية الحرجة',
    width: 12,
    values: CRITICALITIES,
    get: (x) => x.criticality,
  },
  {
    key: 'dataClassification',
    en: 'Data classification',
    ar: 'تصنيف البيانات',
    width: 16,
    values: DATA_CLASSIFICATIONS,
    get: (x) => x.dataClassification,
  },
  {
    key: 'licenceNotes',
    en: 'Licence / contract notes',
    ar: 'ملاحظات الترخيص / العقد',
    width: 30,
    get: (x) => x.licenceNotes,
  },
  { key: 'url', en: 'URL', ar: 'الرابط', width: 30, get: (x) => x.url },
  {
    key: 'capabilities',
    en: 'Capabilities (codes)',
    ar: 'القدرات (الرموز)',
    width: 24,
    get: (x) => codes(x.capabilities),
  },
];

const INTERFACE_COLUMNS: ExcelColumn<InterfaceDto>[] = [
  ...named<InterfaceDto>(),
  {
    key: 'source',
    en: 'Source application (code)',
    ar: 'التطبيق المصدر (الرمز)',
    width: 18,
    get: (x) => x.source.code || x.source.nameEn,
  },
  {
    key: 'target',
    en: 'Target application (code)',
    ar: 'التطبيق الهدف (الرمز)',
    width: 18,
    get: (x) => x.target.code || x.target.nameEn,
  },
  {
    key: 'direction',
    en: 'Direction',
    ar: 'الاتجاه',
    width: 12,
    values: INTERFACE_DIRECTIONS,
    get: (x) => x.direction,
  },
  {
    key: 'technology',
    en: 'Technology',
    ar: 'التقنية',
    width: 14,
    values: INTERFACE_TECHNOLOGIES,
    get: (x) => x.technology,
  },
  {
    key: 'frequency',
    en: 'Frequency',
    ar: 'التكرار',
    width: 12,
    values: INTERFACE_FREQUENCIES,
    get: (x) => x.frequency,
  },
  {
    key: 'dataObjects',
    en: 'Data objects (codes)',
    ar: 'كائنات البيانات (الرموز)',
    width: 24,
    get: (x) => codes(x.dataObjects),
  },
  {
    key: 'owner',
    en: 'Owner (e-mail)',
    ar: 'المالك (البريد)',
    width: 26,
    get: (x) => x.owner?.email ?? null,
  },
  {
    key: 'status',
    en: 'Status',
    ar: 'الحالة',
    width: 12,
    values: EA_STATUSES,
    get: (x) => x.status,
  },
];

const crudText = (u: { create: boolean; read: boolean; update: boolean; delete: boolean }) =>
  `${u.create ? 'C' : ''}${u.read ? 'R' : ''}${u.update ? 'U' : ''}${u.delete ? 'D' : ''}`;

const DATA_OBJECT_COLUMNS: ExcelColumn<DataObjectDto>[] = [
  ...named<DataObjectDto>('definitionEn', 'definitionAr', [
    'Definition (English)',
    'التعريف (إنجليزي)',
    'Definition (Arabic)',
    'التعريف (عربي)',
  ]),
  {
    key: 'classification',
    en: 'Classification',
    ar: 'التصنيف',
    width: 16,
    values: DATA_CLASSIFICATIONS,
    get: (x) => x.classification,
  },
  {
    key: 'systemOfRecord',
    en: 'System of record (code)',
    ar: 'نظام السجل (الرمز)',
    width: 18,
    get: (x) => (x.systemOfRecord ? x.systemOfRecord.code || x.systemOfRecord.nameEn : null),
  },
  {
    key: 'crud',
    en: 'CRUD (APP:CRUD; …)',
    ar: 'الإنشاء/القراءة/التعديل/الحذف (APP:CRUD; …)',
    width: 36,
    get: (x) =>
      x.usages
        .map((u) => `${u.application.code || u.application.nameEn}:${crudText(u)}`)
        .join('; '),
  },
  {
    key: 'owner',
    en: 'Owner (e-mail)',
    ar: 'المالك (البريد)',
    width: 26,
    get: (x) => x.owner?.email ?? null,
  },
];

function capabilityColumns(parents: Map<string, string>): ExcelColumn<CapabilityDto>[] {
  return [
    ...named<CapabilityDto>(),
    {
      key: 'parent',
      en: 'Parent capability (code)',
      ar: 'القدرة الأم (الرمز)',
      width: 16,
      get: (x) => (x.parentId ? (parents.get(x.parentId) ?? null) : null),
    },
    { key: 'level', en: 'Level', ar: 'المستوى', width: 8, get: (x) => x.level },
    {
      key: 'importance',
      en: 'Strategic importance',
      ar: 'الأهمية الاستراتيجية',
      width: 14,
      values: STRATEGIC_IMPORTANCE,
      get: (x) => x.importance,
    },
    {
      key: 'owner',
      en: 'Owner (e-mail)',
      ar: 'المالك (البريد)',
      width: 26,
      get: (x) => x.owner?.email ?? null,
    },
    {
      key: 'processes',
      en: 'Processes (codes)',
      ar: 'العمليات (الرموز)',
      width: 24,
      get: (x) => x.processes.map((p) => p.code).join('; '),
    },
    {
      key: 'applications',
      en: 'Applications (codes)',
      ar: 'التطبيقات (الرموز)',
      width: 24,
      get: (x) => codes(x.applications),
    },
  ];
}

const SHEETS: Record<EaImportKind, [string, string]> = {
  applications: ['Applications', 'التطبيقات'],
  interfaces: ['Interfaces', 'الواجهات'],
  'data-objects': ['Data objects', 'كائنات البيانات'],
  capabilities: ['Capabilities', 'القدرات'],
};
const ENTITY = {
  applications: 'Application',
  interfaces: 'AppInterface',
  'data-objects': 'DataObject',
  capabilities: 'Capability',
} as const;

/**
 * Excel export, template and import of the four architecture catalogues (Phase 4.3). Import is an
 * upsert by code, validated completely first: any error and nothing is imported.
 */
@Injectable()
export class EaExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ea: EaService,
  ) {}

  private async items(kind: EaImportKind): Promise<AnyDto[]> {
    const q = { page: 1, pageSize: 100_000, order: 'asc' as const, sort: 'code' };
    if (kind === 'applications') return (await this.ea.listApplications(q)).items;
    if (kind === 'interfaces') return (await this.ea.listInterfaces(q)).items;
    if (kind === 'data-objects') return (await this.ea.listDataObjects(q)).items;
    return this.ea.listCapabilities();
  }

  private async columns(kind: EaImportKind): Promise<ExcelColumn<AnyDto>[]> {
    if (kind === 'applications') return APPLICATION_COLUMNS as ExcelColumn<AnyDto>[];
    if (kind === 'interfaces') return INTERFACE_COLUMNS as ExcelColumn<AnyDto>[];
    if (kind === 'data-objects') return DATA_OBJECT_COLUMNS as ExcelColumn<AnyDto>[];
    const all = await this.prisma.capability.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true, nameEn: true },
    });
    return capabilityColumns(
      new Map(all.map((c) => [c.id, c.code || c.nameEn])),
    ) as ExcelColumn<AnyDto>[];
  }

  async export(kind: EaImportKind, locale: Locale, actor: AuthUser, meta: RequestMeta) {
    const items = await this.items(kind);
    const data = await catalogueWorkbook(
      SHEETS[kind][locale === 'ar' ? 1 : 0],
      await this.columns(kind),
      items,
      locale,
    );
    await this.audit.log({
      action: 'EXPORT',
      entityType: ENTITY[kind],
      userId: actor.id,
      summary: { report: `ea-${kind}`, locale, rows: items.length },
      meta,
    });
    return { data, fileName: `${kind}.xlsx`, contentType: XLSX_TYPE } satisfies ExcelFile;
  }

  async template(kind: EaImportKind, locale: Locale): Promise<ExcelFile> {
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

  async import(
    kind: EaImportKind,
    file: Express.Multer.File | undefined,
    dryRun: boolean,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<EaImportReportDto> {
    const { rows, present } = await readUpload(file, await this.columns(kind));
    const [users, departments, apps, dataObjects, capabilities, processes] = await Promise.all([
      this.prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, email: true } }),
      this.prisma.department.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.prisma.repoObject.findMany({
        where: { type: 'SYSTEM', deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.prisma.dataObject.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.prisma.capability.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true, nameEn: true, nameAr: true, parentId: true, level: true },
      }),
      this.prisma.process.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true },
      }),
    ]);
    const userIds = lookup(users, (u) => u.email);
    const deptIds = lookup(
      departments,
      (d) => d.code,
      (d) => d.nameEn,
      (d) => d.nameAr,
    );
    const appIds = lookup(
      apps,
      (a) => a.code,
      (a) => a.nameEn,
      (a) => a.nameAr,
    );
    const dataIds = lookup(
      dataObjects,
      (d) => d.code,
      (d) => d.nameEn,
      (d) => d.nameAr,
    );
    const capIds = lookup(
      capabilities,
      (c) => c.code,
      (c) => c.nameEn,
      (c) => c.nameAr,
    );
    const processIds = lookup(processes, (p) => p.code);
    const existing = new Map<string, string>();
    const own =
      kind === 'applications'
        ? apps
        : kind === 'data-objects'
          ? dataObjects
          : kind === 'capabilities'
            ? capabilities
            : await this.prisma.appInterface.findMany({
                where: { deletedAt: null },
                select: { id: true, code: true },
              });
    for (const o of own) if (o.code) existing.set(norm(o.code), o.id);
    // Capabilities of this file can be parents of later rows.
    const fileCodes = new Set(rows.map((r) => norm(r.values.code ?? '')));

    const errors: EaImportRowIssue[] = [];
    const seen = new Set<string>();
    const prepared: {
      row: number;
      code: string;
      input: Record<string, unknown>;
      parent?: string;
    }[] = [];
    const schemas: Record<EaImportKind, [z.ZodType, z.ZodType]> = {
      applications: [createApplicationSchema, updateApplicationSchema],
      interfaces: [createInterfaceSchema, updateInterfaceSchema],
      'data-objects': [createDataObjectSchema, updateDataObjectSchema],
      capabilities: [createCapabilitySchema, updateCapabilitySchema],
    };
    const PLACEHOLDER = '00000000-0000-4000-8000-000000000000';

    for (const { row, values } of rows) {
      const err = (column: string, code: string) => errors.push({ row, column, code });
      const v = (k: string) => (present.has(k) ? values[k] : undefined);
      const code = values.code;
      if (!code) err('code', 'REQUIRED');
      else if (seen.has(norm(code))) err('code', 'DUPLICATE_IN_FILE');
      seen.add(norm(code ?? ''));
      const input: Record<string, unknown> = { code };
      const text = (...keys: string[]) => {
        for (const k of keys) if (v(k) !== undefined) input[k] = v(k);
      };
      const enumOf = (k: string, allowed: readonly string[]) => {
        const raw = v(k);
        if (!raw) return;
        const up = raw.toUpperCase().replace(/[\s-]+/g, '_');
        if (!allowed.includes(up)) err(k, 'INVALID_VALUE');
        else input[k] = up;
      };
      const date = (k: string) => {
        const raw = v(k);
        if (raw === undefined) return;
        if (!raw) input[k] = null;
        else if (Number.isNaN(Date.parse(raw))) err(k, 'INVALID_DATE');
        else input[k] = raw;
      };
      const one = (k: string, map: Map<string, string>, target: string, unknown: string) => {
        const raw = v(k);
        if (raw === undefined) return;
        if (!raw) input[target] = null;
        else if (map.has(norm(raw))) input[target] = map.get(norm(raw));
        else err(k, unknown);
      };
      const many = (k: string, map: Map<string, string>, target: string, unknown: string) => {
        const raw = v(k);
        if (raw === undefined) return;
        const found: string[] = [];
        for (const c of splitList(raw)) {
          const id = map.get(norm(c));
          if (id) found.push(id);
          else err(k, unknown);
        }
        input[target] = found;
      };

      let parent: string | undefined;
      if (kind === 'applications') {
        text('nameEn', 'nameAr', 'descriptionEn', 'descriptionAr', 'vendor', 'version');
        text('hostingCountry', 'licenceNotes');
        if (v('url') !== undefined) input.url = v('url') || null;
        enumOf('appType', APP_TYPES);
        enumOf('hosting', APP_HOSTINGS);
        enumOf('lifecycle', APP_LIFECYCLES);
        enumOf('criticality', CRITICALITIES);
        enumOf('dataClassification', DATA_CLASSIFICATIONS);
        for (const k of ['liveFrom', 'phaseOutFrom', 'retiredAt']) date(k);
        one('businessOwner', userIds, 'businessOwnerId', 'UNKNOWN_USER');
        one('itOwner', userIds, 'itOwnerId', 'UNKNOWN_USER');
        one('department', deptIds, 'departmentId', 'UNKNOWN_DEPARTMENT');
        many('capabilities', capIds, 'capabilityIds', 'UNKNOWN_CAPABILITY');
      } else if (kind === 'interfaces') {
        text('nameEn', 'nameAr', 'descriptionEn', 'descriptionAr');
        enumOf('direction', INTERFACE_DIRECTIONS);
        enumOf('technology', INTERFACE_TECHNOLOGIES);
        enumOf('frequency', INTERFACE_FREQUENCIES);
        enumOf('status', EA_STATUSES);
        one('source', appIds, 'sourceId', 'UNKNOWN_APPLICATION');
        one('target', appIds, 'targetId', 'UNKNOWN_APPLICATION');
        one('owner', userIds, 'ownerId', 'UNKNOWN_USER');
        many('dataObjects', dataIds, 'dataObjectIds', 'UNKNOWN_DATA_OBJECT');
      } else if (kind === 'data-objects') {
        text('nameEn', 'nameAr', 'definitionEn', 'definitionAr');
        enumOf('classification', DATA_CLASSIFICATIONS);
        one('systemOfRecord', appIds, 'systemOfRecordId', 'UNKNOWN_APPLICATION');
        one('owner', userIds, 'ownerId', 'UNKNOWN_USER');
        const raw = v('crud');
        if (raw !== undefined) {
          const usages: Record<string, unknown>[] = [];
          for (const part of splitList(raw)) {
            const m = /^(.+?)\s*:\s*([CRUD]*)$/i.exec(part);
            const app = m && appIds.get(norm(m[1]));
            if (!m) err('crud', 'INVALID_VALUE');
            else if (!app) err('crud', 'UNKNOWN_APPLICATION');
            else {
              const f = m[2].toUpperCase();
              usages.push({
                applicationId: app,
                create: f.includes('C'),
                read: f.includes('R'),
                update: f.includes('U'),
                delete: f.includes('D'),
              });
            }
          }
          input.usages = usages;
        }
      } else {
        text('nameEn', 'nameAr', 'descriptionEn', 'descriptionAr');
        enumOf('importance', STRATEGIC_IMPORTANCE);
        one('owner', userIds, 'ownerId', 'UNKNOWN_USER');
        many('processes', processIds, 'processIds', 'UNKNOWN_PROCESS');
        many('applications', appIds, 'applicationIds', 'UNKNOWN_APPLICATION');
        const p = v('parent');
        if (p) {
          if (!capIds.has(norm(p)) && !fileCodes.has(norm(p))) err('parent', 'UNKNOWN_CAPABILITY');
          else if (norm(p) === norm(code ?? '')) err('parent', 'INVALID_PARENT');
          else parent = p;
        } else if (p === '') input.parentId = null;
      }

      const isNew = !existing.has(norm(code ?? ''));
      const parsed = schemas[kind][isNew ? 0 : 1].safeParse({
        ...input,
        ...(parent ? { parentId: PLACEHOLDER } : {}),
      });
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
      if (code) prepared.push({ row, code, input, parent });
    }

    const unique = (l: EaImportRowIssue[]) => [
      ...new Map(l.map((e) => [`${e.row}|${e.column}|${e.code}`, e])).values(),
    ];
    const report: EaImportReportDto = {
      kind,
      rows: rows.length,
      created: prepared.filter((p) => !existing.has(norm(p.code))).length,
      updated: prepared.filter((p) => existing.has(norm(p.code))).length,
      errors: unique(errors).slice(0, 500),
      imported: false,
    };
    if (dryRun || errors.length) return report;

    // Capabilities: parents before children (a parent of the file is created first).
    const pending = [...prepared];
    const ordered: typeof prepared = [];
    while (pending.length) {
      const next = pending.findIndex(
        (p) =>
          !p.parent ||
          existing.has(norm(p.parent)) ||
          !pending.some((q) => norm(q.code) === norm(p.parent!)),
      );
      ordered.push(...pending.splice(next < 0 ? 0 : next, 1));
    }
    for (const p of ordered) {
      const id = existing.get(norm(p.code));
      const input = { ...p.input };
      if (p.parent) input.parentId = existing.get(norm(p.parent)) ?? capIds.get(norm(p.parent));
      let savedId: string;
      if (kind === 'applications')
        savedId = id
          ? (await this.ea.updateApplication(id, input, actor, meta)).item.id
          : (await this.ea.createApplication(input as never, actor, meta)).item.id;
      else if (kind === 'interfaces')
        savedId = id
          ? (await this.ea.updateInterface(id, input, actor, meta)).id
          : (await this.ea.createInterface(input as never, actor, meta)).id;
      else if (kind === 'data-objects')
        savedId = id
          ? (await this.ea.updateDataObject(id, input, actor, meta)).id
          : (await this.ea.createDataObject(input as never, actor, meta)).id;
      else
        savedId = id
          ? (await this.ea.updateCapability(id, input, actor, meta)).id
          : (await this.ea.createCapability(input as never, actor, meta)).id;
      existing.set(norm(p.code), savedId);
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
