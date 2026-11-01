import { createHash } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  PERMISSIONS,
  DEFAULT_UAE_HOLIDAYS,
  SETTING_KEYS,
  holidayListSchema,
  resolveHolidays,
  type HolidayEntry,
  isStepNode,
  modelArrivalsPerMonth,
  parseBpmnGraph,
  scenarioParamsSchema,
  stableJson,
  validateScenario,
  type AiScenarioProposal,
  type BpmnGraph,
  type CreateSimulationInput,
  type Locale,
  type ScenarioDto,
  type ScenarioInput,
  type ScenarioParams,
  type SimulationDefaultsDto,
  type SimulationDto,
  type SimulationListItemDto,
  type SimulationResult,
  type UpdateSimulationInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { badRequest, forbidden, notFound } from '../common/app-exception';
import { XLSX_TYPE, addSheet, type ExcelFile } from '../common/excel';
import { AiGatewayService, AiOutputInvalid } from '../ai/ai-gateway.service';
import { userLanguage } from '../ai/prompts';
import { MiningJobsService, toJobDto, type JobContext } from './jobs/mining-jobs.service';
import { ConformanceService } from './conformance.service';

const userRef = { select: { id: true, email: true, nameEn: true, nameAr: true } } as const;
const SIM_INCLUDE = {
  process: { select: { id: true, code: true, nameEn: true, nameAr: true, departmentId: true } },
  scenarios: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
} satisfies Prisma.SimulationInclude;

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

const proposalsSchema = z.object({
  proposals: z
    .array(
      z.object({
        nameEn: z.string().max(200),
        nameAr: z.string().max(200),
        rationale: z.string().max(3000),
        capacities: z.record(z.string(), z.number().int().min(1).max(1000)),
        durations: z.record(z.string(), z.number().min(0).max(100_000)),
      }),
    )
    .max(5),
});

/**
 * Simulation (Phase 5.1, D-138 – D-140): simulations of a process with as-is / to-be scenarios,
 * validation, runs as jobs in worker threads (results stored with the scenario and the model they
 * ran against), comparison export, defaults from mining, AI explanations and proposals.
 */
@Injectable()
export class SimulationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: MiningJobsService,
    private readonly conformance: ConformanceService,
    private readonly ai: AiGatewayService,
  ) {}

  onModuleInit() {
    this.jobs.register('SIMULATE', (ctx) => this.run(ctx));
  }

  private assertRead(user: AuthUser) {
    if (!user.permissions.has(PERMISSIONS.PROCESSES_READ)) throw forbidden();
  }

  /**
   * Who changes, runs or deletes a simulation (SEC-19): its owner, mining managers of the process's
   * department, or administrators with settings rights — not every mining manager.
   */
  private canManage(
    user: AuthUser,
    s?: { ownerId: string | null; process: { departmentId: string | null } },
  ) {
    if (user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)) return true;
    if (!user.permissions.has(PERMISSIONS.MINING_MANAGE)) return false;
    if (!s) return true;
    return (
      s.ownerId === user.id || (!!user.departmentId && s.process.departmentId === user.departmentId)
    );
  }

  /** The simulation if the user may change it (403 otherwise). */
  private async findManaged(id: string, user: AuthUser) {
    const s = await this.find(id);
    if (!this.canManage(user, s)) throw forbidden('You may not change this simulation');
    return s;
  }

  private async find(id: string) {
    const s = await this.prisma.simulation.findUnique({ where: { id }, include: SIM_INCLUDE });
    if (!s) throw notFound('Simulation');
    return s;
  }

  /** Model of a scenario: a process version or the working model. */
  private async modelXml(
    processId: string,
    version: number | null,
  ): Promise<{ xml: string; label: string }> {
    if (version) {
      const v = await this.prisma.processVersion.findUnique({
        where: { processId_versionNumber: { processId, versionNumber: version } },
      });
      if (!v) throw badRequest('VERSION_NOT_FOUND');
      return { xml: v.bpmnXml, label: `v${version}` };
    }
    const m = await this.prisma.processModel.findUnique({ where: { processId } });
    if (!m) throw badRequest('PROCESS_WITHOUT_MODEL');
    return { xml: m.bpmnXml, label: `working:${hash(m.bpmnXml)}` };
  }

  private modelFacts(graph: BpmnGraph, versions: number[]): SimulationDto['model'] {
    const name = (n: { nameEn: string; nameAr: string; name: string }) => ({
      nameEn: n.nameEn || n.name,
      nameAr: n.nameAr,
    });
    return {
      steps: graph.nodes.filter(isStepNode).map((n) => ({
        id: n.id,
        ...name(n),
        laneId: n.laneId,
        durationMinutes: n.attributes.durationMinutes ?? null,
        costPerExecution: n.attributes.costPerExecution ?? null,
      })),
      lanes: graph.lanes.map((l) => ({ id: l.id, ...name(l) })),
      gateways: graph.nodes
        .filter((n) => n.type === 'bpmn:ExclusiveGateway' || n.type === 'bpmn:InclusiveGateway')
        .map((n) => ({
          id: n.id,
          ...name(n),
          type: n.type,
          flows: graph.flows
            .filter((f) => f.from === n.id)
            .map((f) => {
              const to = graph.nodes.find((x) => x.id === f.to);
              return {
                id: f.id,
                to: f.to,
                nameEn: f.nameEn || f.name || to?.nameEn || to?.name || f.to,
                nameAr: f.nameAr || to?.nameAr || '',
              };
            }),
        }))
        .filter((g) => g.flows.length > 1),
      arrivalsPerMonth: modelArrivalsPerMonth(graph),
      versions,
    };
  }

  private async toDto(
    s: Awaited<ReturnType<SimulationService['find']>>,
    user: AuthUser,
  ): Promise<SimulationDto> {
    const working = await this.modelXml(s.processId, null).catch(() => null);
    const graph = parseBpmnGraph(working?.xml ?? '');
    const versions = (
      await this.prisma.processVersion.findMany({
        where: { processId: s.processId },
        select: { versionNumber: true },
        orderBy: { versionNumber: 'desc' },
      })
    ).map((v) => v.versionNumber);
    const owner = s.ownerId
      ? await this.prisma.user.findUnique({ where: { id: s.ownerId }, ...userRef })
      : null;
    const job = await this.prisma.miningJob.findFirst({
      where: {
        kind: 'SIMULATE',
        scenarioId: { in: s.scenarios.map((x) => x.id) },
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    const central = await this.holidays();
    const scenarios: ScenarioDto[] = [];
    for (const sc of s.scenarios) {
      const params = scenarioParamsSchema.parse(sc.params ?? {});
      const model = sc.processVersion
        ? await this.modelXml(s.processId, sc.processVersion).catch(() => null)
        : working;
      const g = model ? (model === working ? graph : parseBpmnGraph(model.xml)) : graph;
      const resolved = resolveHolidays(params, central);
      const paramsHash = hash(stableJson(resolved));
      scenarios.push({
        id: sc.id,
        nameEn: sc.nameEn,
        nameAr: sc.nameAr,
        kind: sc.kind,
        sortOrder: sc.sortOrder,
        processVersion: sc.processVersion,
        params,
        result: (sc.result as SimulationResult | null) ?? null,
        resultModel: sc.resultModel?.split('|')[0].split(':')[0] ?? null,
        ranAt: sc.ranAt?.toISOString() ?? null,
        issues: model
          ? validateScenario(g, resolved)
          : [{ code: 'NO_START', severity: 'error', elementId: null }],
        stale: !!sc.result && (!model || sc.resultModel !== `${model.label}|${paramsHash}`),
      });
    }
    return {
      id: s.id,
      code: s.code,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      descriptionEn: s.descriptionEn,
      descriptionAr: s.descriptionAr,
      process: s.process,
      logId: s.logId,
      owner,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      canManage: this.canManage(user, s),
      scenarios,
      model: this.modelFacts(graph, versions),
      job: job ? toJobDto(job) : null,
    };
  }

  async list(processId: string | undefined, user: AuthUser): Promise<SimulationListItemDto[]> {
    this.assertRead(user);
    const rows = await this.prisma.simulation.findMany({
      where: { ...(processId ? { processId } : {}), process: { deletedAt: null } },
      include: {
        process: { select: { id: true, code: true, nameEn: true, nameAr: true } },
        scenarios: { select: { ranAt: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id,
      code: s.code,
      nameEn: s.nameEn,
      nameAr: s.nameAr,
      process: s.process,
      scenarios: s.scenarios.length,
      lastRunAt:
        s.scenarios
          .map((x) => x.ranAt)
          .filter((x): x is Date => !!x)
          .sort((a, b) => b.getTime() - a.getTime())[0]
          ?.toISOString() ?? null,
      updatedAt: s.updatedAt.toISOString(),
    }));
  }

  async detail(id: string, user: AuthUser) {
    this.assertRead(user);
    return this.toDto(await this.find(id), user);
  }

  /** Branch probabilities from the cases of a log linked to the process; arrivals per month. */
  async defaults(
    processId: string,
    user: AuthUser,
    logId?: string | null,
  ): Promise<SimulationDefaultsDto> {
    const logs = await this.conformance.processLogs(processId, user);
    const log = logs.find((l) => l.id === logId) ?? logs[0];
    if (!log) return { probabilities: {}, arrivalsPerMonth: null, logId: null };
    const res = await this.conformance.conformance(log.id, {}, user, 60_000).catch(() => null);
    const flows = res?.result?.flows ?? {};
    const model = await this.prisma.processModel.findUnique({ where: { processId } });
    const graph = parseBpmnGraph(model?.bpmnXml ?? '');
    const probabilities: Record<string, number> = {};
    for (const g of graph.nodes.filter(
      (n) => n.type === 'bpmn:ExclusiveGateway' || n.type === 'bpmn:InclusiveGateway',
    )) {
      const outs = graph.flows.filter((f) => f.from === g.id);
      const total = outs.reduce((s, f) => s + (flows[f.id] ?? 0), 0);
      if (outs.length < 2 || !total) continue;
      let left = 100;
      outs.forEach((f, i) => {
        const v =
          i === outs.length - 1 ? left : Math.round(((flows[f.id] ?? 0) / total) * 1000) / 10;
        probabilities[f.id] = Math.round(v * 10) / 10;
        left -= v;
      });
    }
    const months =
      log.periodStart && log.periodEnd
        ? Math.max(
            1 / 30,
            (Date.parse(log.periodEnd) - Date.parse(log.periodStart)) / (30.4 * 86_400_000),
          )
        : null;
    return {
      probabilities,
      arrivalsPerMonth: months ? Math.round((log.caseCount / months) * 10) / 10 : null,
      logId: log.id,
    };
  }

  private async nextCode(tx: Prisma.TransactionClient) {
    const rows = await tx.simulation.findMany({
      where: { code: { startsWith: 'SIM-' } },
      select: { code: true },
    });
    const max = rows.reduce((m, r) => {
      const n = Number(r.code.slice(4));
      return Number.isInteger(n) && n > m ? n : m;
    }, 0);
    return `SIM-${String(max + 1).padStart(3, '0')}`;
  }

  /** Default parameters: model arrivals or the log's, UAE holidays of the year, one person per lane. */
  private async initialParams(
    processId: string,
    user: AuthUser,
    logId?: string | null,
  ): Promise<ScenarioParams> {
    const model = await this.prisma.processModel.findUnique({ where: { processId } });
    if (!model) throw badRequest('PROCESS_WITHOUT_MODEL');
    const graph = parseBpmnGraph(model.bpmnXml);
    const d = await this.defaults(processId, user, logId);
    const year = new Date().getUTCFullYear();
    const start = new Date(Date.UTC(year, new Date().getUTCMonth() + 1, 1))
      .toISOString()
      .slice(0, 10);
    const fromModel = modelArrivalsPerMonth(graph);
    return scenarioParamsSchema.parse({
      arrival:
        fromModel > 0
          ? { unit: 'model', rate: 0 }
          : { unit: 'month', rate: d.arrivalsPerMonth ?? 100 },
      // Holidays: the central list (D-143), unless a scenario switches to its own.
      calendar: { useCentralHolidays: true },
      startDate: start,
      resources: Object.fromEntries(
        graph.lanes.map((l) => [l.id, { capacity: 1, costPerHour: 0 }]),
      ),
      probabilities: d.probabilities,
    });
  }

  async create(input: CreateSimulationInput, actor: AuthUser, meta: RequestMeta) {
    this.assertRead(actor);
    const proc = await this.prisma.process.findFirst({
      where: { id: input.processId, deletedAt: null },
    });
    if (!proc) throw badRequest('PROCESS_NOT_FOUND');
    // Only a log the user may see is linked (SEC-19); otherwise 404 like the log itself.
    if (
      input.logId &&
      !(await this.conformance.processLogs(proc.id, actor)).some((l) => l.id === input.logId)
    )
      throw notFound('Event log');
    const params = await this.initialParams(proc.id, actor, input.logId);
    const sim = await this.prisma.$transaction(async (tx) => {
      const s = await tx.simulation.create({
        data: {
          code: await this.nextCode(tx),
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          processId: proc.id,
          logId: input.logId ?? null,
          ownerId: actor.id,
          createdById: actor.id,
          updatedById: actor.id,
          scenarios: {
            create: {
              nameEn: 'As-is',
              nameAr: 'الوضع الحالي',
              kind: 'AS_IS',
              params: params as unknown as Prisma.InputJsonValue,
            },
          },
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'SimulationScenario',
          entityId: s.id,
          userId: actor.id,
          summary: { code: s.code, processId: proc.id },
          meta,
        },
        tx,
      );
      return s;
    });
    return this.detail(sim.id, actor);
  }

  async update(id: string, input: UpdateSimulationInput, actor: AuthUser) {
    await this.findManaged(id, actor);
    await this.prisma.simulation.update({
      where: { id },
      data: { ...input, updatedById: actor.id },
    });
    return this.detail(id, actor);
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const s = await this.findManaged(id, actor);
    await this.prisma.simulation.delete({ where: { id } });
    await this.audit.log({
      action: 'DELETE',
      entityType: 'SimulationScenario',
      entityId: id,
      userId: actor.id,
      summary: { code: s.code, scenarios: s.scenarios.length },
      meta,
    });
  }

  async addScenario(id: string, input: ScenarioInput, actor: AuthUser) {
    const s = await this.findManaged(id, actor);
    const source = input.copyFrom
      ? s.scenarios.find((x) => x.id === input.copyFrom)
      : s.scenarios[0];
    if (input.copyFrom && !source) throw notFound('Scenario');
    if (input.processVersion) await this.modelXml(s.processId, input.processVersion);
    const params = input.params ?? scenarioParamsSchema.parse(source?.params ?? {});
    await this.prisma.simulationScenario.create({
      data: {
        simulationId: id,
        nameEn: input.nameEn ?? (source ? `${source.nameEn} (to-be)` : 'To-be'),
        nameAr: input.nameAr ?? (source ? `${source.nameAr} (المستقبلي)` : 'الوضع المستقبلي'),
        kind: input.kind ?? 'TO_BE',
        sortOrder: s.scenarios.length,
        processVersion: input.processVersion ?? source?.processVersion ?? null,
        params: params as unknown as Prisma.InputJsonValue,
      },
    });
    await this.prisma.simulation.update({ where: { id }, data: { updatedById: actor.id } });
    return this.detail(id, actor);
  }

  async updateScenario(id: string, scenarioId: string, input: ScenarioInput, actor: AuthUser) {
    const s = await this.findManaged(id, actor);
    if (!s.scenarios.some((x) => x.id === scenarioId)) throw notFound('Scenario');
    if (input.processVersion) await this.modelXml(s.processId, input.processVersion);
    await this.prisma.simulationScenario.update({
      where: { id: scenarioId },
      data: {
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        kind: input.kind,
        processVersion: input.processVersion,
        params: input.params as unknown as Prisma.InputJsonValue | undefined,
      },
    });
    await this.prisma.simulation.update({ where: { id }, data: { updatedById: actor.id } });
    return this.detail(id, actor);
  }

  async removeScenario(id: string, scenarioId: string, actor: AuthUser) {
    const s = await this.findManaged(id, actor);
    if (!s.scenarios.some((x) => x.id === scenarioId)) throw notFound('Scenario');
    if (s.scenarios.length === 1) throw badRequest('LAST_SCENARIO');
    await this.prisma.simulationScenario.delete({ where: { id: scenarioId } });
    return this.detail(id, actor);
  }

  // ---------- Central public holiday list (D-143) ----------

  /** The central list (Setting `mining.holidays`); the UAE default until an admin saves one. */
  async holidays(): Promise<HolidayEntry[]> {
    const row = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.MINING_HOLIDAYS },
    });
    const parsed = holidayListSchema.safeParse(row?.value ?? null);
    return parsed.success ? parsed.data.holidays : DEFAULT_UAE_HOLIDAYS;
  }

  async setHolidays(list: HolidayEntry[], actor: AuthUser, meta: RequestMeta) {
    const before = await this.holidays();
    const holidays = [...list].sort((a, b) => a.date.localeCompare(b.date));
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.MINING_HOLIDAYS },
        create: { key: SETTING_KEYS.MINING_HOLIDAYS, value: { holidays }, updatedById: actor.id },
        update: { value: { holidays }, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: SETTING_KEYS.MINING_HOLIDAYS,
          userId: actor.id,
          summary: {
            added: holidays
              .filter((x) => !before.some((b) => b.date === x.date))
              .map((x) => x.date),
            removed: before
              .filter((b) => !holidays.some((x) => x.date === b.date))
              .map((b) => b.date),
            confirmed: holidays
              .filter((x) => !x.expected && before.some((b) => b.date === x.date && b.expected))
              .map((x) => x.date),
          },
          meta,
        },
        tx,
      );
    });
    return this.holidays();
  }

  // ---------- Runs ----------

  async start(id: string, scenarioIds: string[] | undefined, actor: AuthUser, meta: RequestMeta) {
    await this.findManaged(id, actor);
    const dto = await this.detail(id, actor);
    const chosen = dto.scenarios.filter((x) => !scenarioIds || scenarioIds.includes(x.id));
    const blocked = chosen.filter((x) => x.issues.some((i) => i.severity === 'error'));
    if (blocked.length)
      throw badRequest('SIMULATION_INVALID', 'Fix the errors before running', {
        scenarios: blocked.map((b) => ({
          id: b.id,
          issues: b.issues.filter((i) => i.severity === 'error'),
        })),
      });
    const jobs = [];
    for (const sc of chosen)
      jobs.push(
        await this.jobs.enqueue({
          kind: 'SIMULATE',
          scenarioId: sc.id,
          params: { simulationId: id },
          userId: actor.id,
        }),
      );
    await this.audit.log({
      action: 'UPDATE',
      entityType: 'SimulationScenario',
      entityId: id,
      userId: actor.id,
      summary: { run: chosen.map((c) => c.nameEn || c.nameAr) },
      meta,
    });
    return jobs.map(toJobDto);
  }

  private async run(ctx: JobContext) {
    const sc = await this.prisma.simulationScenario.findUniqueOrThrow({
      where: { id: ctx.job.scenarioId! },
      include: { simulation: true },
    });
    const params = resolveHolidays(
      scenarioParamsSchema.parse(sc.params ?? {}),
      await this.holidays(),
    );
    const model = await this.modelXml(sc.simulation.processId, sc.processVersion);
    const result = await ctx.worker<SimulationResult>(
      'simulate',
      { bpmnXml: model.xml, params },
      [0.02, 0.98],
    );
    await this.prisma.simulationScenario.update({
      where: { id: sc.id },
      data: {
        result: result as unknown as Prisma.InputJsonValue,
        resultModel: `${model.label}|${hash(stableJson(params))}`,
        ranAt: new Date(),
        ranById: ctx.job.createdById,
      },
    });
    return { completed: result.cases.completed, events: result.events };
  }

  // ---------- Excel comparison ----------

  async export(id: string, user: AuthUser, meta: RequestMeta): Promise<ExcelFile> {
    const dto = await this.detail(id, user);
    const ar = user.locale === 'ar';
    const L = (en: string, arText: string) => (ar ? arText : en);
    const name = (x: { nameEn: string; nameAr: string }) =>
      ar ? x.nameAr || x.nameEn : x.nameEn || x.nameAr;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ProcessHub';
    const ran = dto.scenarios.filter((s) => s.result);
    const header = [L('Measure', 'المقياس'), ...ran.map(name)];
    const ws = addSheet(
      wb,
      L('Comparison', 'المقارنة'),
      header,
      header.map((_, i) => (i ? 18 : 34)),
      user.locale,
    );
    const row = (label: string, get: (r: SimulationResult) => number | null) =>
      ws.addRow([
        label,
        ...ran.map((s) => {
          const v = get(s.result!);
          return v === null ? null : Math.round(v * 100) / 100;
        }),
      ]);
    row(L('Cases completed', 'الحالات المكتملة'), (r) => r.cases.completed);
    row(L('Cases in progress at the end', 'الحالات الجارية في النهاية'), (r) => r.cases.inProgress);
    row(
      L('Throughput mean (hours)', 'متوسط مدة الإنجاز (ساعات)'),
      (r) => r.throughput?.mean ?? null,
    );
    row(L('Throughput P90 (hours)', 'مدة الإنجاز P90 (ساعات)'), (r) => r.throughput?.p90 ?? null);
    row(L('Cost per case', 'التكلفة لكل حالة'), (r) => r.costPerCase);
    row(L('Total cost', 'التكلفة الإجمالية'), (r) => r.totalCost);
    row(L('Cases within SLA (%)', 'الحالات ضمن مستوى الخدمة (%)'), (r) =>
      r.slaShare === null ? null : r.slaShare * 100,
    );
    row(L('Steps within SLA (%)', 'الخطوات ضمن مستوى الخدمة (%)'), (r) =>
      r.stepSlaShare === null ? null : r.stepSlaShare * 100,
    );
    const lanes = [
      ...new Map(
        ran.flatMap((s) => s.result!.resources.map((x) => [x.laneId, x.name] as const)),
      ).entries(),
    ];
    for (const [lane, ln] of lanes) {
      row(`${L('Utilisation', 'الاستخدام')} ${ln} (%)`, (r) => {
        const x = r.resources.find((y) => y.laneId === lane);
        return x ? x.utilisation * 100 : null;
      });
      row(
        `${L('Mean queue', 'متوسط الطابور')} ${ln}`,
        (r) => r.resources.find((y) => y.laneId === lane)?.meanQueue ?? null,
      );
    }
    const steps = addSheet(
      wb,
      L('Steps', 'الخطوات'),
      [
        L('Scenario', 'السيناريو'),
        L('Step', 'الخطوة'),
        L('Executions', 'التنفيذات'),
        L('Mean waiting (min)', 'متوسط الانتظار (د)'),
        L('Mean processing (min)', 'متوسط المعالجة (د)'),
        L('Cost', 'التكلفة'),
      ],
      [24, 34, 14, 18, 18, 14],
      user.locale,
    );
    const stepName = new Map(dto.model.steps.map((s) => [s.id, name(s)]));
    for (const s of ran)
      for (const st of s.result!.steps)
        steps.addRow([
          name(s),
          stepName.get(st.elementId) ?? st.elementId,
          st.executions,
          Math.round(st.meanWaiting * 10) / 10,
          Math.round(st.meanProcessing * 10) / 10,
          Math.round(st.cost),
        ]);
    await this.audit.log({
      action: 'EXPORT',
      entityType: 'SimulationScenario',
      entityId: id,
      userId: user.id,
      summary: { code: dto.code },
      meta,
    });
    return {
      data: Buffer.from(await wb.xlsx.writeBuffer()),
      fileName: `${dto.code}-comparison.xlsx`,
      contentType: XLSX_TYPE,
    };
  }

  // ---------- AI (proposals only, D-140) ----------

  private describe(dto: SimulationDto, language: Locale) {
    const name = (x: { nameEn: string; nameAr: string }) =>
      language === 'ar' ? x.nameAr || x.nameEn : x.nameEn || x.nameAr;
    const steps = dto.model.steps.map(
      (s) =>
        `- step id=${s.id} "${name(s)}" lane=${s.laneId ?? '-'} planned=${s.durationMinutes ?? '?'} min`,
    );
    const lanes = dto.model.lanes.map((l) => `- lane id=${l.id} "${name(l)}"`);
    const scenarios = dto.scenarios
      .filter((s) => s.result)
      .map((s) => {
        const r = s.result!;
        return [
          `Scenario "${name(s)}" (${s.kind}): capacities ${JSON.stringify(Object.fromEntries(Object.entries(s.params.resources).map(([k, v]) => [k, v.capacity])))}`,
          `  completed ${r.cases.completed}, in progress ${r.cases.inProgress}, throughput mean ${r.throughput?.mean.toFixed(1) ?? '-'} h, P90 ${r.throughput?.p90.toFixed(1) ?? '-'} h, cost/case ${r.costPerCase.toFixed(1)}`,
          ...r.resources.map(
            (x) =>
              `  lane ${x.laneId}: utilisation ${(x.utilisation * 100).toFixed(0)} %, mean queue ${x.meanQueue.toFixed(1)}`,
          ),
          ...r.steps.map(
            (x) =>
              `  step ${x.elementId}: waiting ${x.meanWaiting.toFixed(0)} min, processing ${x.meanProcessing.toFixed(0)} min`,
          ),
        ].join('\n');
      });
    return `Process ${dto.process.code} "${name(dto.process)}"\n<steps>\n${steps.join('\n')}\n</steps>\n<lanes>\n${lanes.join('\n')}\n</lanes>\n<results>\n${scenarios.join('\n\n')}\n</results>`;
  }

  async explain(id: string, user: AuthUser, meta: RequestMeta): Promise<{ text: string }> {
    const dto = await this.detail(id, user);
    if (!dto.scenarios.some((s) => s.result)) throw badRequest('NO_RESULTS');
    const session = await this.ai.begin(user, meta);
    const text = await this.ai.call(session, {
      feature: 'SIMULATION',
      system:
        'You are a business process analyst. Explain discrete-event simulation results to a process owner: compare the scenarios, name the bottleneck (high utilisation, long queues, long waiting) and what drives throughput time and cost. Use short paragraphs and bullet points, no tables. Do not invent numbers: use only the figures given.',
      messages: [
        {
          role: 'user',
          text: `Explain these results in ${userLanguage(user.locale)}.\n\n${this.describe(dto, user.locale)}`,
        },
      ],
      maxTokens: 2500,
      effort: 'low',
      entity: { type: 'PROCESS', id: dto.process.id },
    });
    return { text };
  }

  async suggest(
    id: string,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<{ proposals: AiScenarioProposal[] }> {
    const dto = await this.detail(id, user);
    if (!dto.scenarios.some((s) => s.result)) throw badRequest('NO_RESULTS');
    const laneIds = new Set(dto.model.lanes.map((l) => l.id));
    const stepIds = new Set(dto.model.steps.map((s) => s.id));
    const session = await this.ai.begin(user, meta);
    return this.ai.call(session, {
      feature: 'SIMULATION',
      system:
        'You are a business process analyst. Propose up to three improvement scenarios for a discrete-event simulation: change the capacity (people) of lanes and / or the duration (minutes) of steps. Only use the lane and step ids given. Each proposal: a short bilingual name (English and Arabic), a rationale, the changed capacities and durations.',
      messages: [
        {
          role: 'user',
          text: `Write the rationale in ${userLanguage(user.locale)}.\n\n${this.describe(dto, user.locale)}`,
        },
      ],
      maxTokens: 3000,
      effort: 'low',
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['proposals'],
          properties: {
            proposals: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['nameEn', 'nameAr', 'rationale', 'capacities', 'durations'],
                properties: {
                  nameEn: { type: 'string' },
                  nameAr: { type: 'string' },
                  rationale: { type: 'string' },
                  capacities: { type: 'object', additionalProperties: { type: 'integer' } },
                  durations: { type: 'object', additionalProperties: { type: 'number' } },
                },
              },
            },
          },
        },
        parse: (value: unknown) => {
          const res = proposalsSchema.safeParse(value);
          if (!res.success)
            throw new AiOutputInvalid(
              res.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`),
            );
          // Ids the model invented are dropped.
          return {
            proposals: res.data.proposals.map((p) => ({
              ...p,
              capacities: Object.fromEntries(
                Object.entries(p.capacities).filter(([k]) => laneIds.has(k)),
              ),
              durations: Object.fromEntries(
                Object.entries(p.durations).filter(([k]) => stepIds.has(k)),
              ),
            })),
          };
        },
      },
      entity: { type: 'PROCESS', id: dto.process.id },
    });
  }
}
