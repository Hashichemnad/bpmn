import { createHash, randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Prisma, type EventLog } from '@prisma/client';
import {
  PERMISSIONS,
  SETTING_KEYS,
  analysisRequestSchema,
  resolveDiagramTheme,
  type AnalysisRequest,
  type AnalysisResponse,
  type DiscoverProcessInput,
  type DiscoverResultDto,
  type FilterPresetDto,
  type FilterPresetInput,
  type HeuristicsNet,
  type LogAnalysis,
  type MiningExportKind,
  type MiningFilter,
  type NetStructureNode,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { badRequest, forbidden, notFound } from '../common/app-exception';
import { XLSX_TYPE, addSheet, type ExcelFile } from '../common/excel';
import { ProcessesService } from '../processes/processes.service';
import { ModelsService } from '../models/models.service';
import { structureToBpmn } from '../ai/bpmn/structure-to-bpmn';
import type { ProcessStructure } from '../ai/bpmn/process-structure';
import { EventLogsService } from './event-logs.service';
import { MiningJobsService, toJobDto, type JobContext } from './jobs/mining-jobs.service';
import { SnapshotService } from './snapshot.service';

const ARABIC = /[؀-ۿ]/;
/** Puts a log string into the English or Arabic label by its script. */
const bilingual = (s: string) =>
  ARABIC.test(s) ? { nameEn: '', nameAr: s } : { nameEn: s, nameAr: '' };

/**
 * Discovery and analysis (Phase 5.1, D-133, D-134): analysis bundles (map, variants, statistics,
 * bottlenecks) computed in worker threads as jobs and cached per log data version and request;
 * Excel exports; saved filters; "Generate BPMN from log" (heuristics miner → new draft process).
 */
@Injectable()
export class MiningAnalysisService implements OnModuleInit {
  private readonly inflight = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logs: EventLogsService,
    private readonly jobs: MiningJobsService,
    private readonly snapshots: SnapshotService,
    private readonly processes: ProcessesService,
    private readonly models: ModelsService,
  ) {}

  onModuleInit() {
    this.jobs.register('ANALYSE', (ctx) => this.runAnalysis(ctx));
    this.jobs.register('DISCOVER', (ctx) => this.runDiscovery(ctx));
  }

  cacheKey(log: Pick<EventLog, 'id' | 'dataVersion'>, kind: string, request: unknown) {
    return createHash('sha256')
      .update(`${log.id}|${log.dataVersion}|${kind}|${JSON.stringify(request)}`)
      .digest('hex');
  }

  async cached<T>(key: string): Promise<T | null> {
    const row = await this.prisma.miningResultCache.findUnique({ where: { key } });
    if (!row) return null;
    void this.prisma.miningResultCache
      .update({ where: { key }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return row.result as T;
  }

  async store(log: EventLog, key: string, kind: string, result: unknown) {
    await this.prisma.miningResultCache.upsert({
      where: { key },
      create: {
        key,
        logId: log.id,
        dataVersion: log.dataVersion,
        kind,
        result: result as Prisma.InputJsonValue,
      },
      update: { result: result as Prisma.InputJsonValue, lastUsedAt: new Date() },
    });
  }

  /** Cached result, or a job (deduplicated) awaited for up to `waitMs`. */
  async analyse(
    logId: string,
    input: Partial<AnalysisRequest>,
    /** null = system access for aggregated, case-free views (portal performance tab, D-142). */
    user: AuthUser | null,
    waitMs = 8000,
  ): Promise<AnalysisResponse<LogAnalysis>> {
    const log = user ? await this.logs.ready(logId, user) : await this.logs.readyAny(logId);
    const request = analysisRequestSchema.parse(input);
    const key = this.cacheKey(log, 'analysis', request);
    const hit = await this.cached<LogAnalysis>(key);
    if (hit) return { status: 'DONE', result: hit, job: null };
    let jobId = this.inflight.get(key);
    if (!jobId) {
      const job = await this.jobs.enqueue({
        kind: 'ANALYSE',
        logId,
        params: { request, key },
        userId: user?.id ?? null,
      });
      jobId = job.id;
      this.inflight.set(key, jobId);
    }
    const job = await this.jobs.wait(jobId, waitMs);
    if (job.status === 'DONE') {
      const result = await this.cached<LogAnalysis>(key);
      if (result) return { status: 'DONE', result, job: null };
    }
    if (job.status === 'FAILED' || job.status === 'CANCELLED') this.inflight.delete(key);
    return { status: 'RUNNING', result: null, job: toJobDto(job) };
  }

  private async runAnalysis(ctx: JobContext) {
    const { request, key } = ctx.job.params as { request: AnalysisRequest; key: string };
    try {
      const log = await this.prisma.eventLog.findUniqueOrThrow({ where: { id: ctx.job.logId! } });
      await ctx.progress(0.05, 'load');
      const bytes = await this.snapshots.load(log);
      const result = await ctx.worker<LogAnalysis>('analyse', { bytes, request }, [0.1, 0.95]);
      await this.store(log, key, 'analysis', result);
      return { key };
    } finally {
      this.inflight.delete(key);
    }
  }

  // ---------- Excel ----------

  async export(
    logId: string,
    kind: MiningExportKind,
    request: Partial<AnalysisRequest>,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<ExcelFile> {
    const res = await this.analyse(logId, request, user, 60_000);
    if (!res.result) throw badRequest('ANALYSIS_RUNNING', 'The analysis is still running');
    const log = await this.logs.ready(logId, user);
    const a = res.result;
    const ar = user.locale === 'ar';
    const L = (en: string, arText: string) => (ar ? arText : en);
    const h = (ms: number | null | undefined) =>
      ms === null || ms === undefined ? null : Math.round((ms / 3_600_000) * 100) / 100;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ProcessHub';
    const sheet = (name: string, header: string[], rows: (string | number | null)[][]) => {
      const ws = addSheet(
        wb,
        name,
        header,
        header.map((x) => Math.max(14, x.length + 4)),
        user.locale,
      );
      for (const r of rows) ws.addRow(r);
    };
    if (kind === 'variants')
      sheet(
        L('Variants', 'المتغيرات'),
        [
          L('Rank', 'الترتيب'),
          L('Cases', 'الحالات'),
          L('Share %', 'النسبة %'),
          L('Mean hours', 'متوسط الساعات'),
          L('Median hours', 'وسيط الساعات'),
          L('Steps', 'عدد الخطوات'),
          L('Path', 'المسار'),
          L('Example cases', 'أمثلة'),
        ],
        a.variants.items.map((v, i) => [
          i + 1,
          v.count,
          Math.round(v.share * 1000) / 10,
          h(v.meanMs),
          h(v.medianMs),
          v.activities.length,
          v.activities.join(' → '),
          v.exampleCases.join(', '),
        ]),
      );
    if (kind === 'bottlenecks') {
      sheet(
        L('Slowest transitions', 'أبطأ الانتقالات'),
        [
          L('From', 'من'),
          L('To', 'إلى'),
          L('Count', 'العدد'),
          L('Mean hours', 'متوسط الساعات'),
          L('Median hours', 'وسيط الساعات'),
          L('Max hours', 'أقصى الساعات'),
          L('Total hours', 'إجمالي الساعات'),
          L('Slowest cases', 'أبطأ الحالات'),
        ],
        a.bottlenecks.edges.map((e) => [
          e.from,
          e.to,
          e.count,
          h(e.duration?.mean),
          h(e.duration?.median),
          h(e.duration?.max),
          h(e.duration?.total),
          e.slowCases.map((c) => c.caseId).join(', '),
        ]),
      );
      sheet(
        L('Slowest activities', 'أبطأ الأنشطة'),
        [
          L('Activity', 'النشاط'),
          L('Events', 'الأحداث'),
          L('Mean waiting hours', 'متوسط الانتظار (ساعات)'),
          L('Mean processing hours', 'متوسط المعالجة (ساعات)'),
          L('Slowest cases', 'أبطأ الحالات'),
        ],
        a.bottlenecks.activities.map((n) => [
          n.activity,
          n.events,
          h(n.waiting?.mean),
          h(n.processing?.mean),
          n.slowCases.map((c) => c.caseId).join(', '),
        ]),
      );
    }
    if (kind === 'activities')
      sheet(
        L('Activities', 'الأنشطة'),
        [
          L('Activity', 'النشاط'),
          L('Events', 'الأحداث'),
          L('Cases', 'الحالات'),
          L('Starts', 'بدايات'),
          L('Ends', 'نهايات'),
          L('Mean processing hours', 'متوسط المعالجة (ساعات)'),
          L('Mean waiting hours', 'متوسط الانتظار (ساعات)'),
        ],
        a.map.nodes.map((n) => [
          n.activity,
          n.events,
          n.cases,
          n.starts,
          n.ends,
          h(n.processing?.mean),
          h(n.waiting?.mean),
        ]),
      );
    if (kind === 'resources')
      sheet(
        L('Resources', 'الموارد'),
        [
          L('Resource', 'المورد'),
          L('Events', 'الأحداث'),
          L('Cases', 'الحالات'),
          L('Activities', 'الأنشطة'),
        ],
        a.stats.resources.map((r) => [
          r.resource,
          r.events,
          r.cases,
          r.activities.map((x) => `${x.activity} (${x.events})`).join(', '),
        ]),
      );
    if (kind === 'handovers') {
      const header = [L('From', 'من'), L('To', 'إلى'), L('Handovers', 'التسليمات')];
      sheet(
        L('Resources', 'الموارد'),
        header,
        a.stats.handovers.map((x) => [x.from, x.to, x.count]),
      );
      sheet(
        L('Departments', 'الإدارات'),
        header,
        a.stats.departmentHandovers.map((x) => [x.from, x.to, x.count]),
      );
    }
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'EventLog',
      entityId: logId,
      userId: user.id,
      summary: { kind, filters: (request.filters ?? []).length },
      meta,
    });
    return {
      data: Buffer.from(await wb.xlsx.writeBuffer()),
      fileName: `${log.code}-${kind}.xlsx`,
      contentType: XLSX_TYPE,
    };
  }

  // ---------- Saved filters (per user) ----------

  async presets(logId: string, user: AuthUser): Promise<FilterPresetDto[]> {
    await this.logs.visible(logId, user);
    const rows = await this.prisma.miningFilterPreset.findMany({
      where: { userId: user.id, OR: [{ logId }, { logId: null }] },
      orderBy: { name: 'asc' },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      filters: p.filters as MiningFilter[],
      logId: p.logId,
    }));
  }

  async savePreset(
    logId: string,
    input: FilterPresetInput,
    user: AuthUser,
  ): Promise<FilterPresetDto> {
    await this.logs.visible(logId, user);
    const p = await this.prisma.miningFilterPreset.create({
      data: {
        userId: user.id,
        logId: input.global ? null : logId,
        name: input.name,
        filters: input.filters as Prisma.InputJsonValue,
      },
    });
    return { id: p.id, name: p.name, filters: p.filters as MiningFilter[], logId: p.logId };
  }

  async deletePreset(id: string, user: AuthUser) {
    const p = await this.prisma.miningFilterPreset.findUnique({ where: { id } });
    if (!p || p.userId !== user.id) throw notFound('Filter');
    await this.prisma.miningFilterPreset.delete({ where: { id } });
  }

  // ---------- Generate BPMN from log (D-134) ----------

  private async runDiscovery(ctx: JobContext) {
    const log = await this.prisma.eventLog.findUniqueOrThrow({ where: { id: ctx.job.logId! } });
    const { options } = ctx.job.params as { options: DiscoverProcessInput['options'] };
    const bytes = await this.snapshots.load(log);
    return ctx.worker<{
      net: HeuristicsNet;
      structure: { nodes: NetStructureNode[]; flows: { from: string; to: string }[] };
    }>('discover', { bytes, options }, [0.1, 0.9]);
  }

  async discover(
    logId: string,
    input: DiscoverProcessInput,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<DiscoverResultDto> {
    const log = await this.logs.ready(logId, actor);
    if (!actor.permissions.has(PERMISSIONS.PROCESSES_CREATE))
      throw forbidden('You cannot create processes');
    if (
      !actor.permissions.has(PERMISSIONS.MODELS_EDIT) &&
      !actor.permissions.has(PERMISSIONS.MODELS_EDIT_OWN)
    )
      throw forbidden('You cannot create process models');
    const job = await this.jobs.enqueue({
      kind: 'DISCOVER',
      logId,
      params: { options: input.options },
      userId: actor.id,
    });
    const done = await this.jobs.wait(job.id, 120_000);
    if (done.status !== 'DONE') throw badRequest('DISCOVERY_FAILED', done.error ?? done.status);
    const { net, structure: s } = done.result as unknown as {
      net: HeuristicsNet;
      structure: { nodes: NetStructureNode[]; flows: { from: string; to: string }[] };
    };
    if (!net.activities.length)
      throw badRequest('EMPTY_LOG', 'No activities left after the filters');
    const laneNames = input.lanes
      ? [...new Set(s.nodes.map((n) => n.lane).filter((x): x is string => !!x))]
      : [];
    const laneId = new Map(laneNames.map((l, i) => [l, `Lane_${i + 1}`]));
    const nameEn = input.nameEn || (input.nameAr ? '' : log.nameEn || log.nameAr);
    const nameAr = input.nameAr || (input.nameEn ? '' : log.nameAr);
    const structure: ProcessStructure = {
      nameEn,
      nameAr,
      descriptionEn: `Discovered from event log ${log.code} (${net.cases} cases).`,
      descriptionAr: `مكتشفة من سجل الأحداث ${log.code} (${net.cases} حالة).`,
      explanation: '',
      lanes: laneNames.map((l) => ({ id: laneId.get(l)!, ...bilingual(l) })),
      nodes: s.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        eventDefinition: 'none',
        ...(n.name ? bilingual(n.name) : { nameEn: '', nameAr: '' }),
        lane: (n.lane && laneId.get(n.lane)) || '',
        descriptionEn: '',
        descriptionAr: '',
        systemEn: '',
        systemAr: '',
      })),
      flows: s.flows.map((f) => ({ ...f, nameEn: '', nameAr: '' })),
    };
    const themeRow = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.DIAGRAM_THEME },
    });
    const bpmnXml = structureToBpmn(structure, {
      key: randomBytes(4).toString('hex'),
      theme: resolveDiagramTheme(themeRow?.value),
    });
    const process = await this.processes.create(
      {
        code: input.code,
        nameEn,
        nameAr,
        descriptionEn: structure.descriptionEn,
        descriptionAr: structure.descriptionAr,
        category: input.category,
        parentId: input.parentId ?? null,
        ownerId: actor.id,
        departmentId: log.departmentId,
      },
      actor,
      meta,
    );
    await this.models.saveModel(
      process.id,
      bpmnXml,
      { ...actor, permissions: new Set([...actor.permissions, PERMISSIONS.MODELS_EDIT]) },
      meta,
    );
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'EventLog',
      entityId: logId,
      userId: actor.id,
      summary: {
        discoveredProcess: { id: process.id, code: process.code },
        options: input.options,
      },
      meta,
    });
    return {
      processId: process.id,
      code: process.code,
      activities: net.activities.length,
      arcs: net.arcs.length,
      gateways: s.nodes.filter((n) => n.type.endsWith('Gateway')).length,
      lanes: laneNames.length,
    };
  }
}
