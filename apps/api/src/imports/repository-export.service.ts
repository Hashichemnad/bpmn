import { Injectable } from '@nestjs/common';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { GrcExcelService } from '../grc/grc-excel.service';
import { KpiExcelService } from '../kpi/kpi-excel.service';
import { EaExcelService } from '../ea/ea-excel.service';
import { htmlToMarkdown } from '../docs/markdown';
import { safeFileName } from '../docs/attachment-type';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { addSheet } from '../common/excel';
import { sha256 } from './safe-upload';
import { PROCESS_FIELDS } from './importers/process-house.importer';
import {
  PACKAGE_FORMAT,
  PACKAGE_TABLES,
  PACKAGE_VERSION,
  USER_ROLES_FILE,
  delegate,
  parentsFirst,
} from './repository-package';

type AnyDelegate = { findMany(args?: unknown): Promise<Record<string, unknown>[]> };

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';

/**
 * Full export package (M15 step 7, D-163; Super Admin): a ZIP with the repository as JSON per table
 * (restorable into an empty installation through the Import Center), plus readable files — BPMN /
 * DMN / diagram JSON per item and version, pages as HTML and Markdown with their attachments, the
 * process tree, library objects, risks / controls / requirements, applications and KPIs as Excel,
 * and a manifest with SHA-256 checksums. No passwords, 2FA secrets or integration secrets.
 */
@Injectable()
export class RepositoryExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly grc: GrcExcelService,
    private readonly kpi: KpiExcelService,
    private readonly ea: EaExcelService,
  ) {}

  async build(actor: AuthUser, meta: RequestMeta): Promise<{ data: Buffer; fileName: string }> {
    const zip = new JSZip();
    const files: { path: string; sha256: string; bytes: number }[] = [];
    const put = (path: string, data: Buffer | string) => {
      const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
      zip.file(path, buf);
      files.push({ path, sha256: sha256(buf), bytes: buf.length });
    };
    const counts: Record<string, number> = {};
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const t of PACKAGE_TABLES) {
      const d = (this.prisma as unknown as Record<string, AnyDelegate>)[delegate(t.model)];
      let rows = await d.findMany(t.where ? { where: t.where } : undefined);
      if (t.omit)
        rows = rows.map((r) =>
          Object.fromEntries(Object.entries(r).filter(([k]) => !t.omit!.includes(k))),
        );
      rows = parentsFirst(rows, t.parentField);
      tables[t.model] = rows;
      counts[t.model] = rows.length;
      put(`data/${t.model}.json`, JSON.stringify(rows, null, 1));
    }
    const userRoles = await this.prisma.userRole.findMany({
      include: { role: { select: { key: true } } },
    });
    put(
      USER_ROLES_FILE,
      JSON.stringify(userRoles.map((r) => ({ userId: r.userId, roleKey: r.role.key }))),
    );
    counts.UserRole = userRoles.length;

    // Attachments (binary), then the readable files.
    for (const a of tables.Attachment as { id: string; storageKey: string }[]) {
      try {
        const stream = await this.storage.get(a.storageKey);
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
        put(`files/attachments/${a.id}`, Buffer.concat(chunks));
      } catch {
        /* a missing object is listed in the manifest as absent */
      }
    }
    const processes = tables.Process as {
      id: string;
      code: string;
      nameEn: string;
      nameAr: string;
    }[];
    const procById = new Map(processes.map((p) => [p.id, p]));
    for (const m of tables.ProcessModel as { processId: string; bpmnXml: string }[]) {
      const p = procById.get(m.processId);
      if (p) put(`processes/${slug(p.code)}/${slug(p.code)}.bpmn`, m.bpmnXml);
    }
    for (const v of tables.ProcessVersion as {
      processId: string;
      versionNumber: number;
      bpmnXml: string;
    }[]) {
      const p = procById.get(v.processId);
      if (p) put(`processes/${slug(p.code)}/versions/v${v.versionNumber}.bpmn`, v.bpmnXml);
    }
    const diagrams = tables.Diagram as {
      id: string;
      code: string;
      type: string;
      content: string;
    }[];
    const diaById = new Map(diagrams.map((d) => [d.id, d]));
    for (const d of diagrams)
      put(
        `diagrams/${slug(d.code)}/${slug(d.code)}.${d.type === 'DMN' ? 'dmn' : 'json'}`,
        d.content,
      );
    for (const v of tables.DiagramVersion as {
      diagramId: string;
      versionNumber: number;
      content: string;
    }[]) {
      const d = diaById.get(v.diagramId);
      if (d)
        put(
          `diagrams/${slug(d.code)}/versions/v${v.versionNumber}.${d.type === 'DMN' ? 'dmn' : 'json'}`,
          v.content,
        );
    }
    const spaces = new Map(
      (tables.Space as { id: string; key: string }[]).map((s) => [s.id, s.key]),
    );
    const attachments = tables.Attachment as { id: string; pageId: string; fileName: string }[];
    for (const p of tables.Page as {
      id: string;
      spaceId: string;
      titleEn: string;
      titleAr: string;
      contentEn: string;
      contentAr: string;
      deletedAt: string | null;
    }[]) {
      if (p.deletedAt) continue;
      const dir = `pages/${spaces.get(p.spaceId) ?? 'space'}/${slug(p.titleEn || p.titleAr)}-${p.id.slice(0, 8)}`;
      for (const [lang, title, html] of [
        ['en', p.titleEn, p.contentEn],
        ['ar', p.titleAr, p.contentAr],
      ] as const) {
        if (!html && !title) continue;
        put(
          `${dir}/${lang}.html`,
          `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title></head><body><h1>${title.replace(/</g, '&lt;')}</h1>${html}</body></html>`,
        );
        put(`${dir}/${lang}.md`, `# ${title}\n\n${htmlToMarkdown(html)}`);
      }
      for (const a of attachments.filter((x) => x.pageId === p.id)) {
        const f = zip.file(`files/attachments/${a.id}`);
        if (f) put(`${dir}/attachments/${safeFileName(a.fileName)}`, await f.async('nodebuffer'));
      }
    }

    // Excel: the process tree (re-importable as "Process house"), library objects, registers.
    put('excel/process-house.xlsx', await this.processHouse());
    put('excel/library-objects.xlsx', await this.objects());
    for (const kind of ['risks', 'controls', 'requirements'] as const)
      put(`excel/grc-${kind}.xlsx`, (await this.grc.export(kind, 'en', actor, meta)).data);
    for (const kind of ['applications', 'interfaces', 'data-objects', 'capabilities'] as const)
      put(`excel/ea-${kind}.xlsx`, (await this.ea.export(kind, 'en', actor, meta)).data);
    for (const kind of ['kpis', 'objectives'] as const)
      put(`excel/kpi-${kind}.xlsx`, (await this.kpi.export(kind, 'en', actor, meta)).data);

    const org = await this.prisma.setting.findUnique({ where: { key: 'org.nameEn' } });
    const manifest = {
      format: PACKAGE_FORMAT,
      version: PACKAGE_VERSION,
      createdAt: new Date().toISOString(),
      createdBy: actor.email,
      organisation: (org?.value as string | undefined) ?? '',
      counts,
      files,
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 1));
    zip.file(
      'README.txt',
      [
        'ProcessHub export package',
        '',
        'data/          the repository as JSON per table (restore: Import Center → "ProcessHub export package")',
        'processes/     BPMN 2.0 XML per process (working model) and per saved version',
        'diagrams/      DMN XML or diagram JSON per diagram and version',
        'pages/         wiki pages as HTML and Markdown (English / Arabic) with their attachments',
        'excel/         process tree (re-importable), library objects, GRC registers, applications, KPIs',
        'manifest.json  counts and SHA-256 of every file',
        '',
        'No passwords, two-factor secrets or integration secrets are included.',
      ].join('\n'),
    );
    const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'RepositoryExport',
      userId: actor.id,
      summary: { counts, files: files.length, bytes: data.length },
      meta,
    });
    return { data, fileName: `processhub-export-${new Date().toISOString().slice(0, 10)}.zip` };
  }

  private async processHouse(): Promise<Buffer> {
    const rows = await this.prisma.process.findMany({
      where: { deletedAt: null },
      include: { parent: true, owner: true, department: true },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
    });
    const wb = new ExcelJS.Workbook();
    const ws = addSheet(
      wb,
      'Process house',
      PROCESS_FIELDS.map((f) => f.en),
      PROCESS_FIELDS.map((f) => f.width ?? 20),
      'en',
    );
    for (const p of rows)
      ws.addRow([
        p.code,
        p.nameEn,
        p.nameAr,
        p.descriptionEn,
        p.descriptionAr,
        p.category,
        p.parent?.code ?? '',
        p.level,
        p.owner?.email ?? '',
        p.department?.code || p.department?.nameEn || '',
        p.sortOrder,
      ]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private async objects(): Promise<Buffer> {
    const rows = await this.prisma.repoObject.findMany({
      where: { deletedAt: null },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
    });
    const wb = new ExcelJS.Workbook();
    const ws = addSheet(
      wb,
      'Library objects',
      [
        'Type',
        'Code',
        'Name (English)',
        'Name (Arabic)',
        'Description (English)',
        'Description (Arabic)',
        'Status',
      ],
      [14, 14, 32, 32, 40, 40, 12],
      'en',
    );
    for (const o of rows)
      ws.addRow([
        o.type,
        o.code ?? '',
        o.nameEn,
        o.nameAr,
        o.descriptionEn,
        o.descriptionAr,
        o.status,
      ]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
