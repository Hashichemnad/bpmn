import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Prisma, type EventLog } from '@prisma/client';
import {
  LogDataBuilder,
  MINING_PREVIEW_ROWS,
  detectTimestampFormat,
  miningMappingSchema,
  type CreateEventLogInput,
  type ImportReportDto,
  type LogPreviewDto,
  type LogSummary,
  type MiningEventInput,
  type MiningFileFormat,
  type MiningMapping,
  type MiningMappingInput,
  type ProcessHubLogInput,
  type RawLog,
} from '@processhub/shared';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { badRequest, conflict } from '../common/app-exception';
import { EventLogsService } from './event-logs.service';
import { MiningJobsService, type JobContext } from './jobs/mining-jobs.service';
import { SnapshotService } from './snapshot.service';
import {
  XES_COLUMNS,
  detectDelimiter,
  detectFileFormat,
  openRows,
  readHead,
  type CellValue,
  type Row,
} from './import/file-readers';
import { RowNormaliser, detectFormatFromRows } from './import/normalise';
import { ModuleRef } from '@nestjs/core';
import { MiningKpiService } from './mining-kpi.service';

const BATCH = 5000;
const EXT: Record<MiningFileFormat, string> = { CSV: 'csv', XLSX: 'xlsx', XES: 'xes' };
const MIME: Record<MiningFileFormat, string> = {
  CSV: 'text/csv',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  XES: 'application/xml',
};

const COLUMN_GUESS: [keyof MiningMappingInput, RegExp][] = [
  ['caseColumn', /^(case|case[ _-]?id|ticket|request|order|application|حالة|رقم|الطلب|المعاملة)/i],
  ['activityColumn', /(activity|activit|step|task|event|نشاط|خطوة|مهمة|الإجراء)/i],
  ['startColumn', /(start|begin|بداية|بدء)/i],
  ['endColumn', /(end|complete|finish|timestamp|time|date|نهاية|انتهاء|تاريخ|وقت)/i],
  [
    'resourceColumn',
    /(resource|user|performer|employee|agent|actor|clerk|handler|assignee|officer|staff|مورد|موظف|مستخدم|المنفذ)/i,
  ],
  ['departmentColumn', /(department|dept|unit|team|group|division|قسم|إدارة|الإدارة|وحدة)/i],
];

const cellText = (v: CellValue | undefined) =>
  v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);

/**
 * Event log import (Phase 5.1, D-129, D-131, D-132): upload with type / size checks into the file
 * storage, preview with detected formats and a suggested mapping, validation and import as jobs
 * (streaming rows, batched inserts of 5,000 events, columnar snapshot sorted in a worker),
 * "Create log from ProcessHub" (governance reviews), deletion in batches.
 */
@Injectable()
export class LogImportService implements OnModuleInit {
  private readonly logger = new Logger(LogImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly logs: EventLogsService,
    private readonly jobs: MiningJobsService,
    private readonly snapshots: SnapshotService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    this.jobs.register('VALIDATE', (ctx) => this.runImport(ctx, true));
    this.jobs.register('IMPORT', (ctx) => this.runImport(ctx, false));
    this.jobs.register('DELETE', (ctx) => this.runDelete(ctx));
  }

  get maxBytes() {
    return this.config.MINING_UPLOAD_MAX_MB * 1024 * 1024;
  }

  // ---------- Upload and preview ----------

  async upload(
    file: Express.Multer.File | undefined,
    input: CreateEventLogInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    if (!file?.buffer?.length) throw badRequest('FILE_REQUIRED');
    if (file.size > this.maxBytes) throw badRequest('FILE_TOO_LARGE');
    const format = detectFileFormat(file.buffer.subarray(0, 4096), file.originalname);
    if (!format) throw badRequest('UNSUPPORTED_FILE_TYPE', 'CSV, Excel (.xlsx) or XES files only');
    const log = await this.logs.create(
      input,
      {
        source: 'FILE',
        fileName: file.originalname.slice(0, 255),
        fileFormat: format,
        fileSize: file.size,
      },
      actor,
      meta,
    );
    const key = `mining/${log.id}/source.${EXT[format]}`;
    await this.storage.put(key, file.buffer, MIME[format]);
    await this.prisma.eventLog.update({ where: { id: log.id }, data: { fileKey: key } });
    return { id: log.id };
  }

  private async rowsOf(
    log: EventLog,
    opts: { delimiter?: string | null; sheet?: string | null; onBytes?: (n: number) => void },
  ) {
    if (!log.fileKey || !log.fileFormat) throw badRequest('LOG_WITHOUT_FILE');
    const format = log.fileFormat as MiningFileFormat;
    let delimiter = opts.delimiter ?? null;
    if (format === 'CSV' && !delimiter)
      delimiter = detectDelimiter(
        (await readHead(await this.storage.get(log.fileKey), 64 * 1024)).toString('utf8'),
      );
    const source = await openRows(format, await this.storage.get(log.fileKey), {
      delimiter,
      sheet: opts.sheet,
      onBytes: opts.onBytes,
    });
    return { ...source, delimiter, format };
  }

  async preview(
    id: string,
    opts: { delimiter?: string | null; sheet?: string | null },
    user: AuthUser,
  ): Promise<LogPreviewDto> {
    const log = await this.logs.visible(id, user);
    let source;
    try {
      source = await this.rowsOf(log, opts);
    } catch (e) {
      throw badRequest('FILE_UNREADABLE', (e as Error).message);
    }
    const sample: Row[] = [];
    try {
      for await (const r of source.rows) {
        sample.push(r);
        if (sample.length >= 200) break;
      }
    } catch (e) {
      throw badRequest('FILE_UNREADABLE', (e as Error).message);
    }
    const columns = source.columns.map((name) => {
      const values = sample.map((r) => r.values[name]);
      const det = detectTimestampFormat(values);
      return {
        name,
        timestampFormat: det.share >= 0.8 ? det.format : null,
        ambiguous: det.ambiguous,
        samples: [...new Set(values.map(cellText).filter(Boolean))].slice(0, 5),
      };
    });
    const suggestion: MiningMappingInput = {
      caseColumn: '',
      activityColumn: '',
      attributeColumns: [],
      delimiter: (source.delimiter as MiningMappingInput['delimiter']) ?? null,
      sheet: opts.sheet ?? source.sheets[0] ?? null,
    };
    if (source.format === 'XES') {
      const has = (c: string) => source.columns.includes(c);
      suggestion.caseColumn = XES_COLUMNS.case;
      suggestion.activityColumn = XES_COLUMNS.activity;
      suggestion.endColumn = XES_COLUMNS.end;
      suggestion.startColumn = sample.some((r) => r.values[XES_COLUMNS.start])
        ? XES_COLUMNS.start
        : null;
      suggestion.resourceColumn =
        has(XES_COLUMNS.resource) && sample.some((r) => r.values[XES_COLUMNS.resource])
          ? XES_COLUMNS.resource
          : null;
      suggestion.departmentColumn =
        has(XES_COLUMNS.department) && sample.some((r) => r.values[XES_COLUMNS.department])
          ? XES_COLUMNS.department
          : null;
      suggestion.timestampFormat = 'iso';
    } else {
      const used = new Set<string>();
      for (const [field, re] of COLUMN_GUESS) {
        const isTime = field === 'startColumn' || field === 'endColumn';
        const col = columns.find(
          (c) => !used.has(c.name) && re.test(c.name) && (!isTime || c.timestampFormat),
        );
        if (col) {
          (suggestion as Record<string, unknown>)[field] = col.name;
          used.add(col.name);
        }
      }
      if (!suggestion.endColumn && !suggestion.startColumn) {
        const t = columns.find((c) => c.timestampFormat && !used.has(c.name));
        if (t) suggestion.endColumn = t.name;
      }
      suggestion.caseColumn ||= columns[0]?.name ?? '';
      suggestion.activityColumn ||=
        columns.find((c) => !used.has(c.name) && c.name !== suggestion.caseColumn)?.name ?? '';
      const timeCol = columns.find(
        (c) => c.name === (suggestion.endColumn ?? suggestion.startColumn),
      );
      suggestion.timestampFormat =
        (timeCol?.timestampFormat as MiningMappingInput['timestampFormat']) ?? null;
    }
    return {
      format: source.format,
      columns,
      rows: sample
        .slice(0, MINING_PREVIEW_ROWS)
        .map((r) =>
          Object.fromEntries(source.columns.map((c) => [c, cellText(r.values[c]).slice(0, 200)])),
        ),
      delimiter: source.delimiter,
      sheets: source.sheets,
      suggestion,
    };
  }

  async setMapping(id: string, mapping: MiningMapping, actor: AuthUser, meta: RequestMeta) {
    const log = await this.logs.manageable(id, actor);
    if (log.source !== 'FILE') throw badRequest('LOG_WITHOUT_FILE');
    const { columns } = await this.rowsOf(log, mapping);
    const used = [
      mapping.caseColumn,
      mapping.activityColumn,
      mapping.startColumn,
      mapping.endColumn,
      mapping.resourceColumn,
      mapping.departmentColumn,
      ...mapping.attributeColumns,
    ].filter((c): c is string => !!c);
    const missing = used.filter((c) => !columns.includes(c));
    if (missing.length)
      throw badRequest('COLUMN_NOT_FOUND', missing.join(', '), { columns: missing });
    await this.prisma.eventLog.update({
      where: { id },
      data: {
        mapping: mapping as Prisma.InputJsonValue,
        timeZone: mapping.timeZone,
        updatedById: actor.id,
      },
    });
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'EventLog',
      entityId: id,
      userId: actor.id,
      summary: { mapping },
      meta,
    });
    return this.logs.detail(id, actor);
  }

  private async assertIdle(logId: string) {
    const busy = await this.prisma.miningJob.findFirst({
      where: {
        logId,
        kind: { in: ['IMPORT', 'VALIDATE', 'DELETE'] },
        status: { in: ['QUEUED', 'RUNNING'] },
      },
    });
    if (busy) throw conflict('JOB_RUNNING', 'An import or validation of this log is running');
  }

  async startValidation(id: string, actor: AuthUser) {
    const log = await this.logs.manageable(id, actor);
    if (!log.mapping) throw badRequest('MAPPING_REQUIRED');
    await this.assertIdle(id);
    return this.jobs.enqueue({ kind: 'VALIDATE', logId: id, userId: actor.id });
  }

  async startImport(id: string, actor: AuthUser) {
    const log = await this.logs.manageable(id, actor);
    if (log.source === 'FILE' && !log.mapping) throw badRequest('MAPPING_REQUIRED');
    if (log.source === 'FILE' && !log.fileKey) throw badRequest('LOG_WITHOUT_FILE');
    await this.assertIdle(id);
    await this.prisma.eventLog.update({ where: { id }, data: { status: 'IMPORTING' } });
    return this.jobs.enqueue({ kind: 'IMPORT', logId: id, userId: actor.id });
  }

  // ---------- ProcessHub source (D-132) ----------

  async createFromProcessHub(input: ProcessHubLogInput, actor: AuthUser, meta: RequestMeta) {
    const nameEn = input.nameEn || (input.nameAr ? '' : 'ProcessHub reviews');
    const log = await this.logs.create(
      {
        nameEn,
        nameAr: input.nameAr || (input.nameEn ? '' : 'مراجعات ProcessHub'),
        descriptionEn: '',
        descriptionAr: '',
        departmentId: input.departmentId ?? null,
      },
      {
        source: 'PROCESSHUB',
        mapping: {
          itemTypes: input.itemTypes,
          from: input.from?.toISOString() ?? null,
          to: input.to?.toISOString() ?? null,
          language: input.language,
        } as Prisma.InputJsonValue,
        status: 'IMPORTING',
      },
      actor,
      meta,
    );
    const job = await this.jobs.enqueue({ kind: 'IMPORT', logId: log.id, userId: actor.id });
    return { id: log.id, job };
  }

  /** Events of governance reviews: submit → decisions per step → published / withdrawn. */
  private async *processHubEvents(params: {
    itemTypes: ('PROCESS' | 'PAGE' | 'DIAGRAM')[];
    from: string | null;
    to: string | null;
    language: 'en' | 'ar';
  }): AsyncGenerator<MiningEventInput> {
    const ar = params.language === 'ar';
    const reviews = await this.prisma.review.findMany({
      where: {
        entityType: { in: params.itemTypes },
        submittedAt: {
          ...(params.from ? { gte: new Date(params.from) } : {}),
          ...(params.to ? { lte: new Date(params.to) } : {}),
        },
      },
      include: { tasks: true, publications: { select: { publishedAt: true } } },
      orderBy: { submittedAt: 'asc' },
    });
    const userIds = new Set<string>();
    for (const r of reviews) {
      if (r.submittedById) userIds.add(r.submittedById);
      for (const t of r.tasks) userIds.add(t.assigneeId);
    }
    const users = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: {
            id: true,
            nameEn: true,
            nameAr: true,
            department: { select: { nameEn: true, nameAr: true } },
          },
        })
      ).map((u) => [u.id, u]),
    );
    const pick = (o: { nameEn: string; nameAr: string } | null | undefined) =>
      o ? (ar ? o.nameAr || o.nameEn : o.nameEn || o.nameAr) : null;
    const ids = (type: string) =>
      reviews.filter((r) => r.entityType === type).map((r) => r.entityId);
    const [processes, pages, diagrams] = await Promise.all([
      this.prisma.process.findMany({
        where: { id: { in: ids('PROCESS') } },
        select: { id: true, code: true },
      }),
      this.prisma.page.findMany({
        where: { id: { in: ids('PAGE') } },
        select: { id: true, titleEn: true, titleAr: true },
      }),
      this.prisma.diagram.findMany({
        where: { id: { in: ids('DIAGRAM') } },
        select: { id: true, code: true },
      }),
    ]);
    const label = new Map<string, string>([
      ...processes.map((p) => [p.id, p.code] as [string, string]),
      ...pages.map(
        (p) =>
          [p.id, (ar ? p.titleAr || p.titleEn : p.titleEn || p.titleAr).slice(0, 40)] as [
            string,
            string,
          ],
      ),
      ...diagrams.map((d) => [d.id, d.code] as [string, string]),
    ]);
    const typeName = {
      PROCESS: ar ? 'عملية' : 'Process',
      PAGE: ar ? 'صفحة' : 'Page',
      DIAGRAM: ar ? 'مخطط' : 'Diagram',
    };
    const A = ar
      ? {
          submit: 'تقديم للمراجعة',
          approve: 'موافقة',
          changes: 'طلب تعديلات',
          reject: 'رفض',
          publish: 'نشر',
          withdraw: 'سحب',
        }
      : {
          submit: 'Submit for review',
          approve: 'Approve',
          changes: 'Request changes',
          reject: 'Reject',
          publish: 'Publish',
          withdraw: 'Withdraw',
        };
    for (const r of reviews) {
      const caseId = `${label.get(r.entityId) ?? r.entityId.slice(0, 8)} v${r.versionNumber} #${r.id.slice(0, 6)}`;
      const workflow = ar
        ? r.workflowNameAr || r.workflowNameEn
        : r.workflowNameEn || r.workflowNameAr;
      const attrs = { itemType: typeName[r.entityType], workflow };
      const submitter = r.submittedById ? users.get(r.submittedById) : undefined;
      yield {
        caseId,
        activity: A.submit,
        start: null,
        end: r.submittedAt.getTime(),
        resource: pick(submitter),
        department: pick(submitter?.department),
        attrs,
      };
      const steps = (r.steps as { nameEn?: string; nameAr?: string }[] | null) ?? [];
      for (const t of r.tasks) {
        if (!t.decidedAt || t.status === 'PENDING' || t.status === 'SKIPPED') continue;
        const step = steps[t.stepIndex];
        const stepName = step ? (ar ? step.nameAr || step.nameEn : step.nameEn || step.nameAr) : '';
        const verb =
          t.status === 'APPROVED' ? A.approve : t.status === 'REJECTED' ? A.reject : A.changes;
        const u = users.get(t.assigneeId);
        yield {
          caseId,
          activity: stepName ? `${verb}: ${stepName}` : verb,
          start: t.createdAt.getTime(),
          end: Math.max(t.decidedAt.getTime(), t.createdAt.getTime()),
          resource: pick(u),
          department: pick(u?.department),
          attrs,
        };
      }
      for (const p of r.publications)
        yield { caseId, activity: A.publish, start: null, end: p.publishedAt.getTime(), attrs };
      if (r.status === 'WITHDRAWN' && r.completedAt)
        yield {
          caseId,
          activity: A.withdraw,
          start: null,
          end: r.completedAt.getTime(),
          resource: pick(submitter),
          attrs,
        };
    }
  }

  // ---------- Jobs ----------

  private async deleteEvents(logId: string, ctx?: JobContext, range: [number, number] = [0, 0.1]) {
    const total = await this.prisma.miningEvent.count({ where: { logId } });
    let done = 0;
    for (;;) {
      const n = await this.prisma
        .$executeRaw`DELETE FROM "MiningEvent" WHERE id IN (SELECT id FROM "MiningEvent" WHERE "logId" = ${logId}::uuid LIMIT 20000)`;
      if (!n) break;
      done += n;
      await ctx?.progress(range[0] + ((range[1] - range[0]) * done) / Math.max(total, 1), 'delete');
    }
  }

  /** Validation (dry run) or import of a log; returns the report. */
  private async runImport(ctx: JobContext, dryRun: boolean): Promise<ImportReportDto> {
    const started = Date.now();
    const logId = ctx.job.logId!;
    try {
      const log = await this.prisma.eventLog.findUniqueOrThrow({ where: { id: logId } });
      const result =
        log.source === 'PROCESSHUB'
          ? await this.importProcessHub(ctx, log)
          : await this.importFile(ctx, log, dryRun);
      result.report.durationMs = Date.now() - started;
      if (dryRun) {
        await this.prisma.eventLog.update({
          where: { id: logId },
          data: { importReport: result.report as unknown as Prisma.InputJsonValue },
        });
        return result.report;
      }
      await this.finishImport(ctx, log, result.builder, result.report, result.pseudonymised);
      return result.report;
    } catch (e) {
      if (!dryRun)
        await this.prisma.eventLog
          .update({ where: { id: logId }, data: { status: 'FAILED' } })
          .catch(() => undefined);
      throw e;
    }
  }

  private async importFile(ctx: JobContext, log: EventLog, dryRun: boolean) {
    const parsed = miningMappingSchema.safeParse(log.mapping);
    if (!parsed.success) throw new Error('MAPPING_REQUIRED');
    const mapping = parsed.data;
    // Timestamp format: from the mapping, or detected on the first 500 rows.
    let format = mapping.timestampFormat;
    let ambiguous = false;
    if (!format) {
      const head = await this.rowsOf(log, mapping);
      const sample: Row[] = [];
      for await (const r of head.rows) {
        sample.push(r);
        if (sample.length >= 500) break;
      }
      const det = detectFormatFromRows(sample, mapping);
      format = det.format;
      ambiguous = det.ambiguous;
    }
    if (!dryRun) await this.deleteEvents(log.id, ctx);
    const size = log.fileSize ?? 1;
    const base = dryRun ? 0 : 0.1;
    const span = dryRun ? 1 : 0.7;
    let bytes = 0;
    const source = await this.rowsOf(log, { ...mapping, onBytes: (n) => (bytes = n) });
    const norm = new RowNormaliser(mapping, format, ambiguous);
    const builder = new LogDataBuilder(mapping.attributeColumns);
    let batch: Prisma.MiningEventCreateManyInput[] = [];
    const flush = async () => {
      if (!batch.length || dryRun) return;
      await this.prisma.miningEvent.createMany({ data: batch });
      batch = [];
    };
    let n = 0;
    for await (const row of source.rows) {
      const e = norm.next(row);
      if (e) {
        if (!dryRun) {
          builder.add(e);
          batch.push(this.toRow(log.id, e));
          if (batch.length >= BATCH) await flush();
        }
      }
      if (++n % 2000 === 0) await ctx.progress(base + span * Math.min(bytes / size, 1), 'rows');
    }
    await flush();
    return { report: norm.finish(), builder, pseudonymised: mapping.pseudonymise };
  }

  private toRow(logId: string, e: MiningEventInput): Prisma.MiningEventCreateManyInput {
    const attrs = e.attrs && Object.keys(e.attrs).length ? e.attrs : undefined;
    return {
      logId,
      caseId: e.caseId,
      activity: e.activity,
      startAt: e.start === null ? null : new Date(e.start),
      endAt: new Date(e.end),
      resource: e.resource ?? null,
      department: e.department ?? null,
      attributes: attrs as Prisma.InputJsonValue | undefined,
    };
  }

  private async importProcessHub(ctx: JobContext, log: EventLog) {
    await this.deleteEvents(log.id, ctx);
    const params = log.mapping as {
      itemTypes: ('PROCESS' | 'PAGE' | 'DIAGRAM')[];
      from: string | null;
      to: string | null;
      language: 'en' | 'ar';
    };
    const builder = new LogDataBuilder(['itemType', 'workflow']);
    const report: ImportReportDto = {
      rows: 0,
      events: 0,
      cases: 0,
      activities: 0,
      resources: 0,
      missingCase: 0,
      missingActivity: 0,
      missingTimestamp: 0,
      unparsableTimestamp: 0,
      startAfterEnd: 0,
      duplicates: 0,
      skipped: 0,
      timestampFormat: null,
      ambiguousFormat: false,
      periodStart: null,
      periodEnd: null,
      samples: [],
    };
    let batch: Prisma.MiningEventCreateManyInput[] = [];
    const cases = new Set<string>();
    for await (const e of this.processHubEvents(params)) {
      report.rows++;
      report.events++;
      cases.add(e.caseId);
      builder.add(e);
      batch.push(this.toRow(log.id, e));
      if (batch.length >= BATCH) {
        await this.prisma.miningEvent.createMany({ data: batch });
        batch = [];
        await ctx.progress(0.5, 'rows');
      }
    }
    if (batch.length) await this.prisma.miningEvent.createMany({ data: batch });
    report.cases = cases.size;
    return { report, builder, pseudonymised: false };
  }

  /** Snapshot, activities, counts, version; removes the previous version's cache and snapshot. */
  private async finishImport(
    ctx: JobContext,
    log: EventLog,
    builder: LogDataBuilder,
    report: ImportReportDto,
    pseudonymised: boolean,
  ) {
    await ctx.progress(0.82, 'sort');
    const raw: RawLog = builder.raw();
    const { bytes, summary } = await ctx.worker<{ bytes: Uint8Array; summary: LogSummary }>(
      'prepareLog',
      { raw },
      [0.82, 0.92],
    );
    const version = log.dataVersion + 1;
    const key = await this.snapshots.save(log.id, version, bytes);
    await ctx.progress(0.95, 'activities');
    const existing = new Map(
      (await this.prisma.miningActivity.findMany({ where: { logId: log.id } })).map((a) => [
        a.name,
        a,
      ]),
    );
    await this.prisma.$transaction([
      this.prisma.miningActivity.deleteMany({
        where: { logId: log.id, name: { notIn: summary.activities.map((a) => a.name) } },
      }),
      ...summary.activities.map((a) =>
        this.prisma.miningActivity.upsert({
          where: { logId_name: { logId: log.id, name: a.name } },
          create: { logId: log.id, name: a.name, eventCount: a.events, caseCount: a.cases },
          update: {
            eventCount: a.events,
            caseCount: a.cases,
            bpmnElementId: existing.get(a.name)?.bpmnElementId ?? null,
          },
        }),
      ),
    ]);
    await this.prisma.miningResultCache.deleteMany({ where: { logId: log.id } });
    if (report.periodStart === null && summary.periodStart !== null) {
      report.periodStart = new Date(summary.periodStart).toISOString();
      report.periodEnd = new Date(summary.periodEnd!).toISOString();
    }
    report.activities = summary.activities.length;
    report.resources = summary.resources;
    // The uploaded file still holds the real ids: it is removed after a pseudonymised import (D-131).
    const dropFile = pseudonymised && log.fileKey;
    if (dropFile) await this.storage.remove(log.fileKey!).catch(() => undefined);
    await this.prisma.eventLog.update({
      where: { id: log.id },
      data: {
        status: 'READY',
        dataVersion: version,
        snapshotKey: key,
        caseCount: summary.cases,
        eventCount: summary.events,
        activityCount: summary.activities.length,
        resourceCount: summary.resources,
        hasStartTimes: summary.hasStartTimes,
        periodStart: summary.periodStart === null ? null : new Date(summary.periodStart),
        periodEnd: summary.periodEnd === null ? null : new Date(summary.periodEnd),
        attributeNames: builder.attrNames,
        importReport: report as unknown as Prisma.InputJsonValue,
        importedAt: new Date(),
        pseudonymised,
        ...(dropFile ? { fileKey: null } : {}),
      },
    });
    if (log.dataVersion > 0) await this.snapshots.remove(log.id, log.dataVersion);
    await this.logs.autoMatch(log.id);
    // KPIs calculated from this log (D-136) follow the new data.
    await this.moduleRef
      .get(MiningKpiService, { strict: false })
      .enqueueForLog(log.id, ctx.job.createdById)
      .catch(() => undefined);
    await this.audit.log({
      action: 'IMPORT',
      entityType: 'EventLog',
      entityId: log.id,
      userId: ctx.job.createdById,
      summary: {
        code: log.code,
        events: summary.events,
        cases: summary.cases,
        skipped: report.skipped,
        pseudonymised,
      },
    });
  }

  // ---------- Delete (hard, D-131) ----------

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const log = await this.logs.manageable(id, actor);
    await this.prisma.miningJob.updateMany({
      where: { logId: id, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { cancelRequested: true },
    });
    for (const j of await this.prisma.miningJob.findMany({
      where: { logId: id, status: { in: ['QUEUED', 'RUNNING'] } },
    }))
      await this.jobs.cancel(j.id);
    await this.prisma.eventLog.update({ where: { id }, data: { status: 'DELETING' } });
    await this.audit.log({
      action: 'DELETE',
      entityType: 'EventLog',
      entityId: id,
      userId: actor.id,
      summary: { code: log.code, nameEn: log.nameEn, events: log.eventCount, cases: log.caseCount },
      meta,
    });
    return this.jobs.enqueue({
      kind: 'DELETE',
      logId: null,
      params: { logId: id },
      userId: actor.id,
    });
  }

  private async runDelete(ctx: JobContext) {
    const { logId } = ctx.job.params as { logId: string };
    const log = await this.prisma.eventLog.findUnique({ where: { id: logId } });
    if (!log) return { deleted: 0 };
    await this.deleteEvents(logId, ctx, [0, 0.9]);
    if (log.fileKey) await this.storage.remove(log.fileKey).catch(() => undefined);
    if (log.dataVersion) await this.snapshots.remove(log.id, log.dataVersion);
    await this.prisma.eventLog.delete({ where: { id: logId } });
    return { deleted: log.eventCount };
  }

  /** Retention (Setting `mining.retentionMonths`): logs whose last event is older are deleted. */
  async purgeExpired(months: number | null, now = new Date()): Promise<number> {
    if (!months) return 0;
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    const expired = await this.prisma.eventLog.findMany({
      where: { status: { in: ['READY', 'FAILED'] }, periodEnd: { lt: cutoff } },
    });
    for (const log of expired) {
      await this.prisma.eventLog.update({ where: { id: log.id }, data: { status: 'DELETING' } });
      await this.audit.log({
        action: 'DELETE',
        entityType: 'EventLog',
        entityId: log.id,
        userId: null,
        summary: { code: log.code, reason: 'retention', months, events: log.eventCount },
      });
      await this.jobs.enqueue({ kind: 'DELETE', params: { logId: log.id } });
    }
    if (expired.length) this.logger.log(`Retention: ${expired.length} event log(s) deleted`);
    return expired.length;
  }
}
