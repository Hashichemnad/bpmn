import { createHash } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  conformanceRequestSchema,
  isStepNode,
  parseBpmnGraph,
  type AnalysisResponse,
  type ApplySuggestionsInput,
  type ConformanceRequest,
  type ConformanceResult,
  type ProcessLogDto,
  type StepSuggestionDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { badRequest } from '../common/app-exception';
import { ModelsService } from '../models/models.service';
import { EventLogsService } from './event-logs.service';
import { MiningAnalysisService } from './analysis.service';
import { MiningJobsService, toJobDto, type JobContext } from './jobs/mining-jobs.service';
import { SnapshotService } from './snapshot.service';
import { setPhAttributes } from './bpmn-attributes';

/** Suggest a change when the measured median differs from the planned value by more than this. */
const SUGGEST_RATIO = 0.2;
const MIN_OBSERVATIONS = 5;

/**
 * Conformance (Phase 5.1, D-135, D-137): token-based replay of a log on the working model of its
 * linked process (worker job, cached per log version + model + activity mapping), the logs linked to
 * a process (modeler overlay), and planned vs measured step times with accepted updates.
 */
@Injectable()
export class ConformanceService implements OnModuleInit {
  private readonly inflight = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly logs: EventLogsService,
    private readonly analysis: MiningAnalysisService,
    private readonly jobs: MiningJobsService,
    private readonly snapshots: SnapshotService,
    private readonly models: ModelsService,
  ) {}

  onModuleInit() {
    this.jobs.register('CONFORMANCE', (ctx) => this.run(ctx));
  }

  /** Model and activity mapping of a log (the inputs of the replay). */
  private async inputs(logId: string) {
    const log = await this.prisma.eventLog.findUniqueOrThrow({ where: { id: logId } });
    if (!log.processId) throw badRequest('LOG_WITHOUT_PROCESS');
    const model = await this.prisma.processModel.findUnique({
      where: { processId: log.processId },
    });
    if (!model) throw badRequest('PROCESS_WITHOUT_MODEL');
    const acts = await this.prisma.miningActivity.findMany({ where: { logId } });
    const mapping = Object.fromEntries(acts.map((a) => [a.name, a.bpmnElementId]));
    return { log, model, mapping };
  }

  async conformance(
    logId: string,
    input: Partial<ConformanceRequest>,
    /** null = system access (portal performance tab, aggregated values only). */
    user: AuthUser | null,
    waitMs = 8000,
  ): Promise<AnalysisResponse<ConformanceResult>> {
    if (user) await this.logs.ready(logId, user);
    else await this.logs.readyAny(logId);
    const request = conformanceRequestSchema.parse(input);
    const { log, model, mapping } = await this.inputs(logId);
    const modelHash = createHash('sha256').update(model.bpmnXml).digest('hex').slice(0, 16);
    const key = this.analysis.cacheKey(log, 'conformance', { request, modelHash, mapping });
    const hit = await this.analysis.cached<ConformanceResult>(key);
    if (hit) return { status: 'DONE', result: hit, job: null };
    let jobId = this.inflight.get(key);
    if (!jobId) {
      const job = await this.jobs.enqueue({
        kind: 'CONFORMANCE',
        logId,
        params: { request, key },
        userId: user?.id ?? null,
      });
      jobId = job.id;
      this.inflight.set(key, jobId);
    }
    const job = await this.jobs.wait(jobId, waitMs);
    if (job.status === 'DONE') {
      const result = await this.analysis.cached<ConformanceResult>(key);
      if (result) return { status: 'DONE', result, job: null };
    }
    if (job.status !== 'QUEUED' && job.status !== 'RUNNING') this.inflight.delete(key);
    return { status: 'RUNNING', result: null, job: toJobDto(job) };
  }

  private async run(ctx: JobContext) {
    const { request, key } = ctx.job.params as { request: ConformanceRequest; key: string };
    try {
      const { log, model, mapping } = await this.inputs(ctx.job.logId!);
      const bytes = await this.snapshots.load(log);
      const result = await ctx.worker<ConformanceResult>(
        'conformance',
        { bytes, bpmnXml: model.bpmnXml, mapping, request },
        [0.1, 0.95],
      );
      await this.analysis.store(log, key, 'conformance', result);
      return { key, fitness: result.fitness };
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Imported logs linked to a process that the user may see (modeler overlay, process page). */
  async processLogs(processId: string, user: AuthUser): Promise<ProcessLogDto[]> {
    const rows = await this.prisma.eventLog.findMany({
      where: { AND: [this.logs.visibleWhere(user), { processId, status: 'READY' }] },
      include: { _count: { select: { activities: { where: { bpmnElementId: { not: null } } } } } },
      orderBy: { importedAt: 'desc' },
    });
    return rows.map((l) => ({
      id: l.id,
      code: l.code,
      nameEn: l.nameEn,
      nameAr: l.nameAr,
      caseCount: l.caseCount,
      periodStart: l.periodStart?.toISOString() ?? null,
      periodEnd: l.periodEnd?.toISOString() ?? null,
      mappedActivities: l._count.activities,
    }));
  }

  // ---------- Planned vs measured step times (D-137) ----------

  async suggestions(logId: string, user: AuthUser): Promise<StepSuggestionDto[]> {
    const res = await this.conformance(logId, {}, user, 60_000);
    if (!res.result) throw badRequest('ANALYSIS_RUNNING');
    const { model } = await this.inputs(logId);
    const graph = parseBpmnGraph(model.bpmnXml);
    const min = (ms: number | undefined) => (ms === undefined ? null : Math.round(ms / 60_000));
    const differs = (planned: number | null, measured: number | null) =>
      measured !== null &&
      (planned === null || planned === 0
        ? measured > 0
        : Math.abs(measured - planned) / planned > SUGGEST_RATIO);
    return graph.nodes
      .filter((n) => isStepNode(n) && res.result!.elements[n.id])
      .map((n) => {
        const s = res.result!.elements[n.id];
        const measuredDuration = s.processing ? min(s.processing.median) : null;
        const measuredWaiting = s.waiting ? min(s.waiting.median) : null;
        const plannedDuration = n.attributes.durationMinutes ?? null;
        const plannedWaiting = n.attributes.waitingMinutes ?? null;
        const enough = s.events >= MIN_OBSERVATIONS;
        return {
          elementId: n.id,
          nameEn: n.nameEn || n.name,
          nameAr: n.nameAr,
          observations: s.events,
          plannedDuration,
          measuredDuration,
          plannedWaiting,
          measuredWaiting,
          suggestDuration: enough && differs(plannedDuration, measuredDuration),
          suggestWaiting: enough && differs(plannedWaiting, measuredWaiting),
        };
      });
  }

  /** Writes the accepted values into the working model and saves a new version with the note. */
  async applySuggestions(
    logId: string,
    input: ApplySuggestionsInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const log = await this.logs.ready(logId, actor);
    const { model } = await this.inputs(log.id);
    const ids = new Set(parseBpmnGraph(model.bpmnXml).nodes.map((n) => n.id));
    let xml = model.bpmnXml;
    for (const item of input.items) {
      if (!ids.has(item.elementId)) throw badRequest('STEP_NOT_FOUND', item.elementId);
      const attrs: Record<string, string | null> = {};
      if (item.durationMinutes !== undefined)
        attrs.durationMinutes =
          item.durationMinutes === null ? null : String(Math.round(item.durationMinutes));
      if (item.waitingMinutes !== undefined)
        attrs.waitingMinutes =
          item.waitingMinutes === null ? null : String(Math.round(item.waitingMinutes));
      xml = setPhAttributes(xml, item.elementId, attrs);
    }
    const version = await this.models.createVersion(
      log.processId!,
      { bpmnXml: xml, changeNote: input.changeNote },
      actor,
      meta,
    );
    return { processId: log.processId!, version };
  }
}
