import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Prisma, type ImportBatch, type ImportFile } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  PERMISSIONS,
  SETTING_KEYS,
  type ImportSettings,
  IMPORT_KIND_INFO,
  IMPORT_LIMITS,
  canImportKind,
  importEntityHref,
  matchesImportFilter,
  summariseImport,
  type AuditEntityType,
  type ImportBatchDto,
  type ImportBatchSummaryDto,
  type ImportColumnDto,
  type ImportDecisionInput,
  type ImportEntity,
  type ImportFieldDto,
  type ImportIssue,
  type ImportItemOutcome,
  type ImportItemRecordDto,
  type ImportItemsQuery,
  type ImportKind,
  type ImportKindDto,
  type ImportListQuery,
  type ImportOptions,
  type ImportPreviewItem,
  type ImportResultDto,
  type ImportSummaryDto,
  type ImportUndoCheckDto,
  type Locale,
  type Paginated,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { AuthUserLoader } from '../auth/auth-user.loader';
import { badRequest, conflict, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { XLSX_TYPE, addSheet, type ExcelFile } from '../common/excel';
import { MiningJobsService, type JobContext } from '../mining/jobs/mining-jobs.service';
import { MiningAbortError } from '../mining/jobs/worker-runner';
import { safeFileName } from '../docs/attachment-type';
import { DocsAccessService } from '../docs/docs-access.service';
import {
  IMPORTER,
  type ApplyContext,
  type Importer,
  type LoadedImportFile,
  type ParseContext,
  type ParsedItem,
} from './importer';
import { ImportFileError, checkUpload, sha256, sniffType } from './safe-upload';
import { readImportSettings } from './import-settings';

export const batchNumber = (n: number) => `IMP-${String(n).padStart(4, '0')}`;

const AUDIT_ENTITY: Record<ImportEntity, AuditEntityType> = {
  PROCESS: 'Process',
  PROCESS_MODEL: 'ProcessModel',
  DEPARTMENT: 'Department',
  USER: 'User',
  DIAGRAM: 'Diagram',
  PAGE: 'Page',
  ATTACHMENT: 'Attachment',
  REPO_OBJECT: 'RepoObject',
  PAGE_LINK: 'PageLink',
  OBJECT_LINK: 'ObjectLink',
  MODULE_ROWS: 'ImportBatch',
};

interface StoredPreview {
  items: ParsedItem[];
  columns: ImportColumnDto[];
  fields: ImportFieldDto[];
  issues: ImportIssue[];
}

const emptyPreview = (): StoredPreview => ({ items: [], columns: [], fields: [], issues: [] });

type BatchWithFiles = ImportBatch & { files: ImportFile[] };

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/** Public part of a preview item (the importer payload stays on the server). */
const publicItem = ({ data: _d, order: _o, ...rest }: ParsedItem): ImportPreviewItem => rest;

/**
 * Import Center batches (M15, D-155 – D-157): files, the parse and apply jobs on the mining job
 * runner, preview decisions, undo and the result report. The importers parse and write; this
 * service owns the life cycle.
 */
@Injectable()
export class ImportsService implements OnModuleInit {
  private readonly logger = new Logger(ImportsService.name);
  private readonly registry = new Map<ImportKind, Importer>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly jobs: MiningJobsService,
    private readonly users: AuthUserLoader,
    private readonly docsAccess: DocsAccessService,
    @Inject(IMPORTER) importers: Importer[],
  ) {
    for (const imp of importers) for (const k of imp.kinds) this.registry.set(k, imp);
  }

  async onModuleInit() {
    this.jobs.register('IMPORT_PARSE', (ctx) => this.runParse(ctx));
    this.jobs.register('IMPORT_APPLY', (ctx) => this.runApply(ctx));
    // Jobs interrupted by a restart: the job runner marks them failed; so do we.
    await this.prisma.importBatch.updateMany({
      where: { status: { in: ['PARSING', 'APPLYING'] } },
      data: { status: 'FAILED', error: 'INTERRUPTED' },
    });
  }

  importer(kind: ImportKind): Importer {
    const imp = this.registry.get(kind);
    if (!imp) throw badRequest('IMPORT_KIND_UNAVAILABLE');
    return imp;
  }

  getSettings() {
    return readImportSettings(this.prisma);
  }

  async saveSettings(input: ImportSettings, actor: AuthUser, meta: RequestMeta) {
    const before = await this.getSettings();
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEYS.IMPORTS },
      create: { key: SETTING_KEYS.IMPORTS, value: input, updatedById: actor.id },
      update: { value: input, updatedById: actor.id },
    });
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'Setting',
      entityId: SETTING_KEYS.IMPORTS,
      userId: actor.id,
      summary: { before, after: input },
      meta,
    });
    return this.getSettings();
  }

  kinds(actor: AuthUser): ImportKindDto[] {
    return [...this.registry.keys()]
      .filter((k) => canImportKind(k, actor.permissions, actor.roles))
      .map((kind) => ({ kind, info: IMPORT_KIND_INFO[kind] }));
  }

  /** Managers see every batch; Process Owners only their own (others answer 404). */
  private assertBatch(b: ImportBatch, actor: AuthUser) {
    if (!ImportsService.isManager(actor) && b.createdById !== actor.id)
      throw notFound('Import batch');
    this.assertKind(b.kind as ImportKind, actor);
  }

  private assertKind(kind: ImportKind, actor: AuthUser) {
    if (!canImportKind(kind, actor.permissions, actor.roles))
      throw forbidden('You cannot run this import');
    this.importer(kind);
  }

  // ---------- Create / read ----------

  async create(
    kind: ImportKind,
    files: UploadedFile[],
    options: ImportOptions,
    note: string | undefined,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<ImportBatchDto> {
    this.assertKind(kind, actor);
    const info = IMPORT_KIND_INFO[kind];
    if (!ImportsService.isManager(actor)) options = { ...options, defaultOwnerId: actor.id };
    if (!files.length) throw badRequest('FILE_REQUIRED');
    if (files.length > (info.multiple ? IMPORT_LIMITS.files : 1))
      throw badRequest('TOO_MANY_FILES');
    const total = files.reduce((s, f) => s + f.size, 0);
    if (total > IMPORT_LIMITS.batchBytes) throw badRequest('FILE_TOO_LARGE');
    const checked = files.map((f) => {
      const fileName = safeFileName(f.originalname);
      try {
        const { type } = checkUpload(fileName, f.buffer, info.extensions);
        return { fileName, data: f.buffer, type };
      } catch (e) {
        if (e instanceof ImportFileError) throw badRequest(e.code, e.message, e.params);
        throw e;
      }
    });
    await this.assertOptions(options, actor);
    const batch = await this.prisma.importBatch.create({
      data: {
        kind,
        note: note ?? '',
        options: options as Prisma.InputJsonValue,
        createdById: actor.id,
      },
    });
    for (const f of checked) {
      const id = randomUUID();
      const storageKey = `imports/${batch.id}/${id}`;
      await this.storage.put(storageKey, f.data, 'application/octet-stream');
      await this.prisma.importFile.create({
        data: {
          id,
          batchId: batch.id,
          fileName: f.fileName,
          contentType: f.type,
          size: f.data.length,
          sha256: sha256(f.data),
          storageKey,
        },
      });
    }
    await this.audit.log({
      action: 'CREATE',
      entityType: 'ImportBatch',
      entityId: batch.id,
      userId: actor.id,
      summary: { number: batchNumber(batch.number), kind, files: checked.map((f) => f.fileName) },
      meta,
    });
    await this.startParse(batch.id, actor.id);
    return this.get(batch.id, actor);
  }

  /** Process Owners (`import.own`) import only into what they own or may edit (D-164). */
  static isManager(actor: AuthUser) {
    return actor.permissions.has(PERMISSIONS.IMPORT_MANAGE);
  }

  private async assertOptions(o: ImportOptions, actor: AuthUser) {
    if (!ImportsService.isManager(actor)) {
      if (o.defaultOwnerId && o.defaultOwnerId !== actor.id)
        throw forbidden('Owners import for themselves');
      if (o.parentProcessId) {
        const parent = await this.prisma.process.findFirst({
          where: { id: o.parentProcessId, deletedAt: null },
        });
        if (parent && parent.ownerId !== actor.id) throw forbidden('You do not own this process');
      }
      if (o.spaceId) await this.docsAccess.space(o.spaceId, actor, 'edit');
    }
    if (o.defaultOwnerId) {
      const u = await this.prisma.user.findFirst({
        where: { id: o.defaultOwnerId, deletedAt: null },
      });
      if (!u) throw badRequest('UNKNOWN_OWNER');
    }
    if (o.parentProcessId) {
      const p = await this.prisma.process.findFirst({
        where: { id: o.parentProcessId, deletedAt: null },
      });
      if (!p) throw badRequest('UNKNOWN_PARENT_PROCESS');
    }
    if (o.spaceId) {
      const s = await this.prisma.space.findFirst({ where: { id: o.spaceId, deletedAt: null } });
      if (!s) throw badRequest('UNKNOWN_SPACE');
    }
    if (o.parentPageId) {
      const p = await this.prisma.page.findFirst({
        where: {
          id: o.parentPageId,
          deletedAt: null,
          ...(o.spaceId ? { spaceId: o.spaceId } : {}),
        },
      });
      if (!p) throw badRequest('UNKNOWN_PARENT_PAGE');
    }
  }

  private async startParse(id: string, userId: string) {
    const job = await this.jobs.enqueue({ kind: 'IMPORT_PARSE', params: { batchId: id }, userId });
    await this.prisma.importBatch.update({
      where: { id },
      data: { status: 'PARSING', jobId: job.id, progress: 0, message: '', error: null },
    });
  }

  private async find(id: string): Promise<BatchWithFiles> {
    const b = await this.prisma.importBatch.findUnique({
      where: { id },
      include: { files: { orderBy: { createdAt: 'asc' } } },
    });
    if (!b) throw notFound('Import batch');
    return b;
  }

  async list(q: ImportListQuery, actor: AuthUser): Promise<Paginated<ImportBatchSummaryDto>> {
    const where: Prisma.ImportBatchWhereInput = {
      kind: q.kind,
      status: q.status,
      ...(ImportsService.isManager(actor) ? {} : { createdById: actor.id }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.importBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          number: true,
          kind: true,
          status: true,
          note: true,
          progress: true,
          summary: true,
          result: true,
          createdById: true,
          createdAt: true,
          appliedAt: true,
          files: { select: { fileName: true }, orderBy: { createdAt: 'asc' } },
        },
      }),
      this.prisma.importBatch.count({ where }),
    ]);
    const people = await this.people(rows.map((r) => r.createdById));
    return {
      items: rows.map((r) => ({
        id: r.id,
        number: batchNumber(r.number),
        kind: r.kind as ImportKind,
        status: r.status,
        note: r.note,
        fileNames: r.files.map((f) => f.fileName),
        progress: r.progress,
        summary: (r.summary as ImportSummaryDto | null) ?? null,
        result: (r.result as ImportResultDto | null) ?? null,
        createdBy: (r.createdById && people.get(r.createdById)) || null,
        createdAt: r.createdAt.toISOString(),
        appliedAt: r.appliedAt?.toISOString() ?? null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  private async people(ids: (string | null)[]) {
    const list = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids.filter((x): x is string => !!x))] } },
      select: { id: true, nameEn: true, nameAr: true },
    });
    return new Map(list.map((u) => [u.id, u]));
  }

  async get(id: string, actor?: AuthUser): Promise<ImportBatchDto> {
    const b = await this.find(id);
    if (actor) this.assertBatch(b, actor);
    const preview = (b.preview as StoredPreview | null) ?? emptyPreview();
    const people = await this.people([b.createdById]);
    const canUndo = await this.canUndoQuick(b);
    return {
      id: b.id,
      number: batchNumber(b.number),
      kind: b.kind as ImportKind,
      status: b.status,
      note: b.note,
      options: b.options as ImportOptions,
      files: b.files.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        contentType: f.contentType,
        size: f.size,
      })),
      progress: b.progress,
      message: b.message,
      jobId: b.jobId,
      error: b.error,
      issues: preview.issues,
      columns: preview.columns,
      fields: preview.fields,
      summary: (b.summary as ImportSummaryDto | null) ?? null,
      result: (b.result as ImportResultDto | null) ?? null,
      createdBy: (b.createdById && people.get(b.createdById)) || null,
      createdAt: b.createdAt.toISOString(),
      parsedAt: b.parsedAt?.toISOString() ?? null,
      appliedAt: b.appliedAt?.toISOString() ?? null,
      undoneAt: b.undoneAt?.toISOString() ?? null,
      canUndo,
    };
  }

  private async canUndoQuick(b: ImportBatch) {
    if (!IMPORT_KIND_INFO[b.kind as ImportKind]?.undo) return false;
    if (!['APPLIED', 'CANCELLED', 'FAILED'].includes(b.status) || !b.appliedAt) return false;
    return (
      (await this.prisma.importItem.count({ where: { batchId: b.id, outcome: 'CREATED' } })) > 0
    );
  }

  async items(
    id: string,
    q: ImportItemsQuery,
    actor: AuthUser,
  ): Promise<Paginated<ImportPreviewItem>> {
    const b = await this.find(id);
    this.assertBatch(b, actor);
    const preview = (b.preview as StoredPreview | null) ?? emptyPreview();
    const needle = q.q?.toLowerCase();
    const list = preview.items.filter(
      (i) =>
        matchesImportFilter(i, q.filter) &&
        (!needle ||
          [i.key, i.nameEn, i.nameAr, i.source].some((s) => s.toLowerCase().includes(needle))),
    );
    const start = (q.page - 1) * q.pageSize;
    return {
      items: list.slice(start, start + q.pageSize).map(publicItem),
      total: list.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Records written by the applied batch (result list with links and before / after). */
  async records(id: string, actor: AuthUser, page = 1, pageSize = 50) {
    const b = await this.find(id);
    this.assertBatch(b, actor);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.importItem.findMany({
        where: { batchId: id },
        orderBy: { seq: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.importItem.count({ where: { batchId: id } }),
    ]);
    const pageIds = rows
      .filter((r) => r.entityType === 'PAGE' && r.entityId)
      .map((r) => r.entityId!);
    const spaces = new Map(
      (
        await this.prisma.page.findMany({
          where: { id: { in: pageIds } },
          select: { id: true, spaceId: true },
        })
      ).map((p) => [p.id, p.spaceId]),
    );
    return {
      items: rows.map((r): ImportItemRecordDto => ({
        id: r.id,
        ref: r.ref,
        entity: r.entityType as ImportEntity,
        entityId: r.entityId,
        outcome: r.outcome as ImportItemOutcome,
        key: r.key,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        source: r.source,
        error: r.error,
        before: (r.before as Record<string, unknown> | null) ?? null,
        after: (r.after as Record<string, unknown> | null) ?? null,
        href:
          r.outcome === 'UNDONE'
            ? null
            : importEntityHref(
                r.entityType as ImportEntity,
                r.entityId,
                r.entityId ? spaces.get(r.entityId) : null,
              ),
      })),
      total,
      page,
      pageSize,
    };
  }

  // ---------- Preview changes ----------

  /** New options / column mapping: the preview is built again. */
  async updateOptions(id: string, options: ImportOptions, actor: AuthUser, meta: RequestMeta) {
    const b = await this.find(id);
    this.assertBatch(b, actor);
    if (!['READY', 'FAILED', 'CANCELLED', 'UPLOADED'].includes(b.status) || b.appliedAt)
      throw conflict('IMPORT_NOT_EDITABLE');
    // Process Owners (D-164): what they import is always theirs.
    if (!ImportsService.isManager(actor)) options = { ...options, defaultOwnerId: actor.id };
    await this.assertOptions(options, actor);
    await this.prisma.importBatch.update({
      where: { id },
      data: { options: options as Prisma.InputJsonValue },
    });
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'ImportBatch',
      entityId: id,
      userId: actor.id,
      summary: { number: batchNumber(b.number), options },
      meta,
    });
    await this.startParse(id, actor.id);
    return this.get(id, actor);
  }

  /** Skip / include an item, accept / reject its suggestions. */
  async decide(id: string, ref: string, input: ImportDecisionInput, actor: AuthUser) {
    const b = await this.find(id);
    this.assertBatch(b, actor);
    if (b.status !== 'READY') throw conflict('IMPORT_NOT_EDITABLE');
    const preview = (b.preview as StoredPreview | null) ?? emptyPreview();
    const item = preview.items.find((i) => i.ref === ref);
    if (!item) throw notFound('Import item');
    if (input.skip !== undefined) item.skip = input.skip;
    for (const [sid, accepted] of Object.entries(input.suggestions ?? {})) {
      const s = item.suggestions.find((x) => x.id === sid);
      if (s) s.accepted = accepted;
    }
    await this.prisma.importBatch.update({
      where: { id },
      data: {
        preview: preview as unknown as Prisma.InputJsonValue,
        summary: summariseImport(preview.items) as unknown as Prisma.InputJsonValue,
      },
    });
    return publicItem(item);
  }

  /** Accept or reject every suggestion of the batch at once. */
  async decideAll(id: string, accepted: boolean, actor: AuthUser) {
    const b = await this.find(id);
    this.assertBatch(b, actor);
    if (b.status !== 'READY') throw conflict('IMPORT_NOT_EDITABLE');
    const preview = (b.preview as StoredPreview | null) ?? emptyPreview();
    for (const i of preview.items) for (const s of i.suggestions) s.accepted = accepted;
    await this.prisma.importBatch.update({
      where: { id },
      data: { preview: preview as unknown as Prisma.InputJsonValue },
    });
    return this.get(id, actor);
  }

  // ---------- Apply / cancel ----------

  async apply(id: string, actor: AuthUser, meta: RequestMeta) {
    const b = await this.find(id);
    this.assertBatch(b, actor);
    if (b.status !== 'READY') throw conflict('IMPORT_NOT_READY');
    const preview = (b.preview as StoredPreview | null) ?? emptyPreview();
    const summary = summariseImport(preview.items);
    if (summary.blocking) throw badRequest('IMPORT_HAS_ERRORS');
    if (!summary.create && !summary.update) throw badRequest('IMPORT_NOTHING_TO_DO');
    const job = await this.jobs.enqueue({
      kind: 'IMPORT_APPLY',
      params: { batchId: id },
      userId: actor.id,
    });
    const res = await this.prisma.importBatch.updateMany({
      where: { id, status: 'READY' },
      data: { status: 'APPLYING', jobId: job.id, progress: 0, message: '', appliedById: actor.id },
    });
    if (!res.count) {
      await this.jobs.cancel(job.id);
      throw conflict('IMPORT_NOT_READY');
    }
    await this.audit.log({
      action: 'IMPORT',
      entityType: 'ImportBatch',
      entityId: id,
      userId: actor.id,
      summary: { number: batchNumber(b.number), kind: b.kind, ...summary },
      meta,
    });
    return this.get(id, actor);
  }

  async cancel(id: string, actor: AuthUser) {
    const b = await this.find(id);
    this.assertBatch(b, actor);
    if (!['PARSING', 'APPLYING'].includes(b.status) || !b.jobId)
      throw conflict('IMPORT_NOT_RUNNING');
    await this.jobs.cancel(b.jobId);
    // A queued job never reaches the handler: mark the batch here.
    const job = await this.jobs.get(b.jobId);
    if (job.status === 'CANCELLED')
      await this.prisma.importBatch.updateMany({
        where: { id, status: { in: ['PARSING', 'APPLYING'] } },
        data: { status: 'CANCELLED' },
      });
    return this.get(id, actor);
  }

  /** Discards a batch that was never applied (files removed from storage). */
  async discard(id: string, actor: AuthUser, meta: RequestMeta) {
    const b = await this.find(id);
    this.assertBatch(b, actor);
    if (b.appliedAt || ['PARSING', 'APPLYING'].includes(b.status))
      throw conflict('IMPORT_NOT_EDITABLE');
    if (await this.prisma.importItem.count({ where: { batchId: id } }))
      throw conflict('IMPORT_NOT_EDITABLE');
    for (const f of b.files) await this.storage.remove(f.storageKey).catch(() => undefined);
    await this.prisma.importBatch.delete({ where: { id } });
    await this.audit.log({
      action: 'DELETE',
      entityType: 'ImportBatch',
      entityId: id,
      userId: actor.id,
      summary: { number: batchNumber(b.number), kind: b.kind },
      meta,
    });
  }

  // ---------- Jobs ----------

  private async loadFiles(b: BatchWithFiles): Promise<LoadedImportFile[]> {
    const info = IMPORT_KIND_INFO[b.kind as ImportKind];
    const out: LoadedImportFile[] = [];
    for (const f of b.files) {
      const stream = await this.storage.get(f.storageKey);
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
      const data = Buffer.concat(chunks);
      if (sha256(data) !== f.sha256)
        throw new ImportFileError('FILE_CHANGED', { file: f.fileName });
      const { ext } = checkUpload(f.fileName, data, info.extensions);
      out.push({ id: f.id, fileName: f.fileName, ext, type: sniffType(data), data });
    }
    return out;
  }

  private async actorOf(b: ImportBatch, userId: string | null): Promise<AuthUser> {
    const actor = await this.users.load(userId ?? b.createdById ?? '');
    if (!actor) throw new Error('IMPORT_USER_INACTIVE');
    return actor;
  }

  private previousLookup =
    (batchId: string) =>
    async (entity: ImportEntity, keys: string[]): Promise<Map<string, string>> => {
      const out = new Map<string, string>();
      const wanted = [...new Set(keys.filter(Boolean))];
      if (!wanted.length) return out;
      const rows = await this.prisma.importItem.findMany({
        where: {
          entityType: entity,
          externalKey: { in: wanted },
          outcome: { in: ['CREATED', 'UPDATED'] },
          entityId: { not: null },
          batchId: { not: batchId },
        },
        orderBy: { createdAt: 'desc' },
        select: { externalKey: true, entityId: true },
      });
      const alive = await this.aliveIds(
        entity,
        rows.map((r) => r.entityId!),
      );
      for (const r of rows)
        if (!out.has(r.externalKey) && alive.has(r.entityId!)) out.set(r.externalKey, r.entityId!);
      return out;
    };

  private async aliveIds(entity: ImportEntity, ids: string[]): Promise<Set<string>> {
    const where = { id: { in: ids }, deletedAt: null };
    const pick = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
    switch (entity) {
      case 'PROCESS':
      case 'PROCESS_MODEL':
        return pick(await this.prisma.process.findMany({ where, select: { id: true } }));
      case 'PAGE':
        return pick(await this.prisma.page.findMany({ where, select: { id: true } }));
      case 'DIAGRAM':
        return pick(await this.prisma.diagram.findMany({ where, select: { id: true } }));
      case 'REPO_OBJECT':
        return pick(await this.prisma.repoObject.findMany({ where, select: { id: true } }));
      case 'DEPARTMENT':
        return pick(await this.prisma.department.findMany({ where, select: { id: true } }));
      case 'USER':
        return pick(await this.prisma.user.findMany({ where, select: { id: true } }));
      case 'ATTACHMENT':
        return pick(await this.prisma.attachment.findMany({ where, select: { id: true } }));
      default:
        return new Set(ids);
    }
  }

  private async runParse(ctx: JobContext) {
    const { batchId } = ctx.job.params as { batchId: string };
    const b = await this.find(batchId);
    const kind = b.kind as ImportKind;
    try {
      const actor = await this.actorOf(b, ctx.job.createdById);
      await ctx.progress(0.02, 'files');
      const files = await this.loadFiles(b);
      const pctx: ParseContext = {
        batchId,
        batchNumber: batchNumber(b.number),
        kind,
        options: b.options as ImportOptions,
        actor,
        files,
        progress: (v, m) => ctx.progress(0.05 + 0.9 * v, m),
        previous: this.previousLookup(batchId),
      };
      const out = await this.importer(kind).parse(pctx);
      if (out.items.length > IMPORT_LIMITS.items)
        throw new ImportFileError('TOO_MANY_ITEMS', { max: IMPORT_LIMITS.items });
      const preview: StoredPreview = {
        items: out.items,
        columns: out.columns ?? [],
        fields: out.fields ?? [],
        issues: out.issues ?? [],
      };
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: {
          status: 'READY',
          preview: preview as unknown as Prisma.InputJsonValue,
          summary: summariseImport(out.items) as unknown as Prisma.InputJsonValue,
          progress: 1,
          message: '',
          parsedAt: new Date(),
          error: null,
        },
      });
      return { items: out.items.length };
    } catch (e) {
      await this.failBatch(batchId, e, ctx);
      if (e instanceof MiningAbortError || ctx.signal.aborted) throw e;
      return { failed: true };
    }
  }

  private async failBatch(batchId: string, e: unknown, ctx: JobContext) {
    const cancelled = e instanceof MiningAbortError || ctx.signal.aborted;
    const fileError = e instanceof ImportFileError;
    if (!cancelled && !fileError)
      this.logger.warn(`Import ${batchId} failed: ${(e as Error).message}`);
    const preview: StoredPreview = emptyPreview();
    if (fileError) preview.issues = [{ level: 'ERROR', code: e.code, params: e.params }];
    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: {
        status: cancelled ? 'CANCELLED' : 'FAILED',
        error: cancelled
          ? null
          : fileError
            ? e.code
            : ((e as Error).message || 'FAILED').slice(0, 500),
        ...(fileError
          ? { preview: preview as unknown as Prisma.InputJsonValue, summary: Prisma.DbNull }
          : {}),
      },
    });
  }

  private async runApply(ctx: JobContext) {
    const { batchId } = ctx.job.params as { batchId: string };
    const b = await this.find(batchId);
    const kind = b.kind as ImportKind;
    const preview = (b.preview as StoredPreview | null) ?? emptyPreview();
    const items = preview.items
      .filter((i) => !i.skip && i.action !== 'SKIP' && !i.issues.some((x) => x.level === 'ERROR'))
      .map((i, n) => ({ i, n }))
      .sort((a, z) => (a.i.order ?? 0) - (z.i.order ?? 0) || a.n - z.n)
      .map((x) => x.i);
    const result: ImportResultDto = { created: 0, updated: 0, skipped: 0, failed: 0, undone: 0 };
    let seq = await this.prisma.importItem.count({ where: { batchId } });
    let done = 0;
    let files: LoadedImportFile[] | null = null;
    const number = batchNumber(b.number);
    try {
      const actor = await this.actorOf(b, ctx.job.createdById);
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: { appliedAt: new Date() },
      });
      const actx: ApplyContext = {
        batchId,
        batchNumber: number,
        kind,
        options: b.options as ImportOptions,
        actor,
        files: async () => (files ??= await this.loadFiles(b)),
        progress: (v, m) => ctx.progress(v, m),
        step: async (item, fn) => {
          await ctx.progress(done / Math.max(1, items.length), item.key);
          done++;
          try {
            const records = await this.prisma.$transaction(
              async (tx) => {
                const out = await fn(tx);
                const list = Array.isArray(out) ? out : [out];
                for (const r of list) {
                  await tx.importItem.create({
                    data: {
                      batchId,
                      ref: item.ref,
                      entityType: r.entity,
                      entityId: r.entityId,
                      outcome: r.outcome,
                      externalKey: r.externalKey ?? '',
                      key: r.key ?? item.key,
                      nameEn: r.nameEn ?? item.nameEn,
                      nameAr: r.nameAr ?? item.nameAr,
                      source: item.source,
                      before: (r.before ?? undefined) as Prisma.InputJsonValue | undefined,
                      after: (r.after ?? undefined) as Prisma.InputJsonValue | undefined,
                      seq: seq++,
                    },
                  });
                  if (r.outcome !== 'SKIPPED' && r.entity !== 'MODULE_ROWS')
                    await this.audit.log(
                      {
                        action: r.outcome === 'CREATED' ? 'CREATE' : 'UPDATE',
                        entityType: AUDIT_ENTITY[r.entity],
                        entityId: r.entityId,
                        userId: actor.id,
                        summary: {
                          importBatch: number,
                          source: item.source,
                          key: r.key ?? item.key,
                          ...(r.before ? { before: r.before } : {}),
                          ...(r.after ? { after: r.after } : {}),
                        },
                      },
                      tx,
                    );
                }
                return list;
              },
              { timeout: 60_000, maxWait: 10_000 },
            );
            for (const r of records) {
              if (r.outcome === 'CREATED') result.created++;
              else if (r.outcome === 'UPDATED') result.updated++;
              else result.skipped++;
            }
            return records;
          } catch (e) {
            if (e instanceof MiningAbortError || ctx.signal.aborted) throw e;
            result.failed++;
            const message =
              e instanceof ImportFileError
                ? e.code
                : ((e as Error).message || 'FAILED').slice(0, 500);
            await this.prisma.importItem.create({
              data: {
                batchId,
                ref: item.ref,
                entityType: item.entity,
                outcome: 'FAILED',
                key: item.key,
                nameEn: item.nameEn,
                nameAr: item.nameAr,
                source: item.source,
                error: message,
                seq: seq++,
              },
            });
            return null;
          }
        },
      };
      const out = await this.importer(kind).apply(actx, items, preview.items);
      if (out?.module) result.module = out.module;
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: {
          status: 'APPLIED',
          progress: 1,
          message: '',
          result: result as unknown as Prisma.InputJsonValue,
        },
      });
      return result;
    } catch (e) {
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: { result: result as unknown as Prisma.InputJsonValue },
      });
      await this.failBatch(batchId, e, ctx);
      if (e instanceof MiningAbortError || ctx.signal.aborted) throw e;
      return { failed: true };
    }
  }

  // ---------- Undo ----------

  async undoCheck(id: string, actor: AuthUser): Promise<ImportUndoCheckDto> {
    const b = await this.find(id);
    this.assertBatch(b, actor);
    return this.checkUndo(b);
  }

  private async checkUndo(b: ImportBatch): Promise<ImportUndoCheckDto> {
    const blockers: ImportUndoCheckDto['blockers'] = [];
    if (!IMPORT_KIND_INFO[b.kind as ImportKind]?.undo || !(await this.canUndoQuick(b)))
      return { canUndo: false, items: 0, blockers };
    const created = await this.prisma.importItem.findMany({
      where: { batchId: b.id, outcome: 'CREATED' },
      orderBy: { seq: 'desc' },
    });
    const ids = (e: ImportEntity) =>
      created.filter((c) => c.entityType === e && c.entityId).map((c) => c.entityId!);
    const block = (c: (typeof created)[number], reason: string) =>
      blockers.push({
        entity: c.entityType as ImportEntity,
        key: c.key,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        reason,
      });
    const byId = new Map(created.map((c) => [`${c.entityType}:${c.entityId}`, c]));
    const processIds = ids('PROCESS');
    const pageIds = ids('PAGE');
    const [processes, pages, diagrams, users, childProcesses, childPages] = await Promise.all([
      this.prisma.process.findMany({
        where: { id: { in: processIds }, deletedAt: null },
        select: { id: true, status: true },
      }),
      this.prisma.page.findMany({
        where: { id: { in: pageIds }, deletedAt: null },
        select: { id: true, status: true },
      }),
      this.prisma.diagram.findMany({
        where: { id: { in: ids('DIAGRAM') }, deletedAt: null },
        select: { id: true, status: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: ids('USER') }, deletedAt: null },
        select: { id: true, lastLoginAt: true },
      }),
      this.prisma.process.findMany({
        where: { parentId: { in: processIds }, deletedAt: null, id: { notIn: processIds } },
        select: { parentId: true },
      }),
      this.prisma.page.findMany({
        where: { parentId: { in: pageIds }, deletedAt: null, id: { notIn: pageIds } },
        select: { parentId: true },
      }),
    ]);
    for (const p of processes)
      if (p.status !== 'DRAFT') block(byId.get(`PROCESS:${p.id}`)!, 'NOT_DRAFT');
    for (const p of pages) if (p.status !== 'DRAFT') block(byId.get(`PAGE:${p.id}`)!, 'NOT_DRAFT');
    for (const d of diagrams)
      if (d.status !== 'DRAFT') block(byId.get(`DIAGRAM:${d.id}`)!, 'NOT_DRAFT');
    for (const u of users) if (u.lastLoginAt) block(byId.get(`USER:${u.id}`)!, 'USER_SIGNED_IN');
    for (const c of childProcesses) block(byId.get(`PROCESS:${c.parentId}`)!, 'HAS_CHILDREN');
    for (const c of childPages) block(byId.get(`PAGE:${c.parentId}`)!, 'HAS_CHILDREN');
    return { canUndo: blockers.length === 0, items: created.length, blockers };
  }

  async undo(id: string, actor: AuthUser, meta: RequestMeta) {
    const b = await this.find(id);
    this.assertBatch(b, actor);
    if (['PARSING', 'APPLYING'].includes(b.status)) throw conflict('IMPORT_RUNNING');
    const check = await this.checkUndo(b);
    if (!check.canUndo) throw conflict('IMPORT_UNDO_BLOCKED', undefined);
    const created = await this.prisma.importItem.findMany({
      where: { batchId: id, outcome: 'CREATED' },
      orderBy: { seq: 'desc' },
    });
    const now = new Date();
    const number = batchNumber(b.number);
    let undone = 0;
    await this.prisma.$transaction(
      async (tx) => {
        for (const c of created) {
          if (!c.entityId) continue;
          const where = { id: c.entityId, deletedAt: null };
          const del = { deletedAt: now, updatedById: actor.id };
          switch (c.entityType as ImportEntity) {
            case 'PROCESS':
              await tx.process.updateMany({ where, data: del });
              break;
            case 'PAGE':
              await tx.page.updateMany({
                where,
                data: { deletedAt: now, deletedById: actor.id, deleteBatchId: b.id },
              });
              break;
            case 'DIAGRAM':
              await tx.diagram.updateMany({ where, data: del });
              break;
            case 'REPO_OBJECT':
              await tx.repoObject.updateMany({ where, data: del });
              break;
            case 'DEPARTMENT':
              await tx.department.updateMany({ where, data: del });
              break;
            case 'USER':
              await tx.user.updateMany({
                where,
                data: { ...del, status: 'INACTIVE' },
              });
              await tx.refreshToken.updateMany({
                where: { userId: c.entityId, revokedAt: null },
                data: { revokedAt: now },
              });
              break;
            case 'ATTACHMENT':
              await tx.attachment.updateMany({ where, data: { deletedAt: now } });
              break;
            case 'PAGE_LINK':
              await tx.pageLink.deleteMany({ where: { id: c.entityId } });
              break;
            case 'OBJECT_LINK':
              await tx.objectLink.deleteMany({ where: { id: c.entityId } });
              break;
            case 'PROCESS_MODEL':
              await tx.processModel.deleteMany({ where: { processId: c.entityId } });
              break;
            default:
              continue;
          }
          await tx.importItem.update({ where: { id: c.id }, data: { outcome: 'UNDONE' } });
          await this.audit.log(
            {
              action: 'DELETE',
              entityType: AUDIT_ENTITY[c.entityType as ImportEntity],
              entityId: c.entityId,
              userId: actor.id,
              summary: { importBatch: number, undo: true, key: c.key },
              meta,
            },
            tx,
          );
          undone++;
        }
        const result = {
          ...((b.result as ImportResultDto | null) ?? {}),
          undone,
        } as ImportResultDto;
        await tx.importBatch.update({
          where: { id },
          data: {
            status: 'UNDONE',
            undoneAt: now,
            undoneById: actor.id,
            result: result as unknown as Prisma.InputJsonValue,
          },
        });
        await this.audit.log(
          {
            action: 'UNDO',
            entityType: 'ImportBatch',
            entityId: id,
            userId: actor.id,
            summary: { number, undone },
            meta,
          },
          tx,
        );
      },
      { timeout: 120_000 },
    );
    return this.get(id, actor);
  }

  // ---------- Files, report, template ----------

  async file(id: string, fileId: string, actor: AuthUser) {
    const b = await this.find(id);
    this.assertBatch(b, actor);
    const f = b.files.find((x) => x.id === fileId);
    if (!f) throw notFound('File');
    return { file: f, stream: await this.storage.get(f.storageKey) };
  }

  /** Dry-run / result report: one row per preview item, with the outcome once applied. */
  async report(id: string, locale: Locale, actor: AuthUser, meta: RequestMeta): Promise<ExcelFile> {
    const b = await this.find(id);
    this.assertBatch(b, actor);
    const preview = (b.preview as StoredPreview | null) ?? emptyPreview();
    const records = await this.prisma.importItem.findMany({
      where: { batchId: id },
      orderBy: { seq: 'asc' },
    });
    const ar = locale === 'ar';
    const L = (en: string, a: string) => (ar ? a : en);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ProcessHub';
    const head = addSheet(
      wb,
      L('Batch', 'الدفعة'),
      [L('Field', 'الحقل'), L('Value', 'القيمة')],
      [28, 60],
      locale,
    );
    const summary = summariseImport(preview.items);
    const result = b.result as ImportResultDto | null;
    const rows: [string, string | number][] = [
      [L('Batch', 'الدفعة'), batchNumber(b.number)],
      [L('Kind', 'النوع'), b.kind],
      [L('Status', 'الحالة'), b.status],
      [L('Files', 'الملفات'), b.files.map((f) => f.fileName).join(', ')],
      [L('Items', 'العناصر'), summary.items],
      [L('To create', 'للإنشاء'), summary.create],
      [L('To update', 'للتحديث'), summary.update],
      [L('Skipped', 'متجاوز'), summary.skip],
      [L('Errors', 'الأخطاء'), summary.errors],
      [L('Warnings', 'التحذيرات'), summary.warnings],
    ];
    if (result)
      rows.push(
        [L('Created', 'تم الإنشاء'), result.created],
        [L('Updated', 'تم التحديث'), result.updated],
        [L('Failed', 'فشل'), result.failed],
        [L('Undone', 'تم التراجع'), result.undone],
      );
    for (const r of rows) head.addRow(r);
    const ws = addSheet(
      wb,
      L('Items', 'العناصر'),
      [
        L('Reference', 'المرجع'),
        L('Type', 'النوع'),
        L('Key', 'المفتاح'),
        L('Name (English)', 'الاسم (إنجليزي)'),
        L('Name (Arabic)', 'الاسم (عربي)'),
        L('Planned', 'المخطط'),
        L('Outcome', 'النتيجة'),
        L('Source', 'المصدر'),
        L('Issues', 'الملاحظات'),
      ],
      [16, 14, 22, 32, 32, 10, 12, 30, 60],
      locale,
    );
    const outcome = new Map<string, string>();
    for (const r of records)
      outcome.set(
        r.ref,
        [outcome.get(r.ref), r.outcome + (r.error ? `: ${r.error}` : '')]
          .filter(Boolean)
          .join('; '),
      );
    for (const i of preview.items)
      ws.addRow([
        i.ref,
        i.entity,
        i.key,
        i.nameEn,
        i.nameAr,
        i.skip ? 'SKIP' : i.action,
        outcome.get(i.ref) ?? '',
        i.source,
        i.issues
          .map((x) => `${x.level}: ${x.code}${x.params ? ` ${JSON.stringify(x.params)}` : ''}`)
          .join('\n'),
      ]);
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'ImportBatch',
      entityId: id,
      userId: actor.id,
      summary: { number: batchNumber(b.number), report: true },
      meta,
    });
    return {
      data: Buffer.from(await wb.xlsx.writeBuffer()),
      fileName: `${batchNumber(b.number)}-report.xlsx`,
      contentType: XLSX_TYPE,
    };
  }

  async template(kind: ImportKind, locale: Locale, actor: AuthUser): Promise<ExcelFile> {
    this.assertKind(kind, actor);
    const imp = this.importer(kind);
    if (!imp.template || !IMPORT_KIND_INFO[kind].template) throw notFound('Template');
    return imp.template(kind, locale);
  }
}
