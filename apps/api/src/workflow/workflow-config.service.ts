import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  checkDmnTable,
  checkExecutable,
  readDecisionTables,
  readWorkflowModel,
  timerStarts,
  type ExecCheckDto,
  type ExecIssue,
  type WorkflowConfigDto,
  type WorkflowConfigInput,
  type WorkflowDeploymentDto,
  type WorkflowModel,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { badRequest, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { userRefSelect } from '../governance/content.service';
import { canDeployWorkflow, canDesignWorkflow } from './workflow-access';
import { WorkflowEventLogService } from './workflow-event-log.service';
import { WorkflowTimersService } from './workflow-timers.service';

const processSelect = {
  id: true,
  code: true,
  nameEn: true,
  nameAr: true,
  ownerId: true,
  departmentId: true,
  status: true,
  deletedAt: true,
} satisfies Prisma.ProcessSelect;

/** Default case prefix from the process code: "PMS-01" → "PMS", "C.02.03" → "C0203". */
export function defaultPrefix(code: string): string {
  const letters = code
    .toUpperCase()
    .split(/[-_]/)[0]
    .replace(/[^A-Z0-9]/g, '');
  const p = /^[A-Z]/.test(letters) ? letters : `P${letters}`;
  return p.slice(0, 10) || 'CASE';
}

const decisionKey = (diagramId: string, decisionId: string) => `${diagramId}:${decisionId}`;

/**
 * Executable processes (step 1): execution settings per process, the executable check (shared rules +
 * DMN decisions and linked processes on the server) and deployment of the published version (D-147).
 */
@Injectable()
export class WorkflowConfigService {
  private readonly models = new Map<string, WorkflowModel>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eventLog: WorkflowEventLogService,
    private readonly timers: WorkflowTimersService,
  ) {}

  private async process(id: string) {
    const p = await this.prisma.process.findFirst({
      where: { id, deletedAt: null },
      select: processSelect,
    });
    if (!p) throw notFound('Process');
    return p;
  }

  /** The parsed model of a deployment (cached; deployments never change). */
  async model(definitionId: string): Promise<WorkflowModel> {
    const hit = this.models.get(definitionId);
    if (hit) return hit;
    const d = await this.prisma.workflowDefinition.findUniqueOrThrow({
      where: { id: definitionId },
      select: { model: true },
    });
    const m = d.model as unknown as WorkflowModel;
    if (this.models.size > 500) this.models.clear();
    this.models.set(definitionId, m);
    return m;
  }

  private async publishedVersion(processId: string) {
    const pub = await this.prisma.publication.findFirst({
      where: { entityType: 'PROCESS', entityId: processId, current: true },
      orderBy: { publishedAt: 'desc' },
      select: { versionNumber: true, versionLabel: true },
    });
    if (!pub) return null;
    const v = await this.prisma.processVersion.findUnique({
      where: { processId_versionNumber: { processId, versionNumber: pub.versionNumber } },
      select: { versionNumber: true, bpmnXml: true, label: true },
    });
    return v ? { ...v, label: pub.versionLabel ?? v.label } : null;
  }

  async get(processId: string, user: AuthUser): Promise<WorkflowConfigDto> {
    const p = await this.process(processId);
    const [cfg, defs, published] = await Promise.all([
      this.prisma.workflowProcessConfig.findUnique({ where: { processId } }),
      this.prisma.workflowDefinition.findMany({
        where: { processId },
        orderBy: { versionNumber: 'desc' },
        select: {
          id: true,
          versionNumber: true,
          versionLabel: true,
          deployedAt: true,
          deployedById: true,
          _count: { select: { cases: { where: { status: 'RUNNING' } } } },
        },
      }),
      this.prisma.publication.findFirst({
        where: { entityType: 'PROCESS', entityId: processId, current: true },
        select: { versionNumber: true },
      }),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: defs.map((d) => d.deployedById).filter((v): v is string => !!v) } },
      select: userRefSelect,
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const deployments: WorkflowDeploymentDto[] = defs.map((d) => ({
      id: d.id,
      versionNumber: d.versionNumber,
      versionLabel: d.versionLabel,
      deployedAt: d.deployedAt.toISOString(),
      deployedBy: d.deployedById ? (byId.get(d.deployedById) ?? null) : null,
      active: d.id === cfg?.activeDefinitionId,
      runningCases: d._count.cases,
    }));
    const canDesign = canDesignWorkflow(user, p);
    return {
      processId: p.id,
      code: p.code,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      enabled: cfg?.enabled ?? false,
      casePrefix: cfg?.casePrefix ?? defaultPrefix(p.code),
      startMode: (cfg?.startMode as 'ALL' | 'RESTRICTED') ?? 'ALL',
      startRoles: cfg?.startRoles ?? [],
      startDepartmentIds: cfg?.startDepartmentIds ?? [],
      allowWithdraw: cfg?.allowWithdraw ?? true,
      monitorUserIds: cfg?.monitorUserIds ?? [],
      retentionDays: cfg?.retentionDays ?? null,
      eventLog: cfg?.eventLog ?? true,
      pseudonymiseLog: cfg?.pseudonymiseLog ?? false,
      reminderMinutesBefore: cfg?.reminderMinutesBefore ?? null,
      escalationDelayMinutes: cfg?.escalationDelayMinutes ?? null,
      publishedVersion: published?.versionNumber ?? null,
      activeDeployment: deployments.find((d) => d.active) ?? null,
      deployments,
      eventLogId: cfg?.eventLogId ?? null,
      canDesign,
      canDeploy: canDeployWorkflow(user, p) && !!published,
    };
  }

  async update(
    processId: string,
    input: WorkflowConfigInput,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<WorkflowConfigDto> {
    const p = await this.process(processId);
    if (!canDesignWorkflow(user, p)) throw forbidden();
    const before = await this.prisma.workflowProcessConfig.findUnique({ where: { processId } });
    // While a version is deployed, switching the process on / off and changing who may start it
    // changes what is live for staff: deploy rights needed (D-154).
    if (
      before?.activeDefinitionId &&
      !canDeployWorkflow(user, p) &&
      (before.enabled !== input.enabled ||
        before.startMode !== input.startMode ||
        [...before.startRoles].sort().join() !== [...input.startRoles].sort().join() ||
        [...before.startDepartmentIds].sort().join() !==
          [...input.startDepartmentIds].sort().join() ||
        // Data protection settings of live cases (SEC-31): who monitors case data, how long form
        // data is kept and whether the live event log is pseudonymised.
        [...before.monitorUserIds].sort().join() !== [...input.monitorUserIds].sort().join() ||
        before.retentionDays !== input.retentionDays ||
        before.pseudonymiseLog !== input.pseudonymiseLog)
    )
      throw forbidden('DEPLOY_RIGHTS_REQUIRED');
    const clash = await this.prisma.workflowProcessConfig.findFirst({
      where: { casePrefix: input.casePrefix, processId: { not: processId } },
      select: { processId: true },
    });
    if (clash) throw badRequest('PREFIX_IN_USE');
    const data = {
      enabled: input.enabled,
      casePrefix: input.casePrefix,
      startMode: input.startMode,
      startRoles: input.startRoles,
      startDepartmentIds: input.startDepartmentIds,
      allowWithdraw: input.allowWithdraw,
      monitorUserIds: input.monitorUserIds,
      retentionDays: input.retentionDays,
      eventLog: input.eventLog,
      pseudonymiseLog: input.pseudonymiseLog,
      reminderMinutesBefore: input.reminderMinutesBefore,
      escalationDelayMinutes: input.escalationDelayMinutes,
      updatedById: user.id,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.workflowProcessConfig.upsert({
        where: { processId },
        create: { processId, ...data, createdById: user.id },
        update: data,
      });
      await this.audit.log(
        {
          action: before ? 'UPDATE' : 'CREATE',
          entityType: 'WorkflowProcessConfig',
          entityId: processId,
          userId: user.id,
          summary: {
            code: p.code,
            before: before
              ? {
                  enabled: before.enabled,
                  casePrefix: before.casePrefix,
                  startMode: before.startMode,
                  retentionDays: before.retentionDays,
                }
              : null,
            after: data,
          },
          meta,
        },
        tx,
      );
    });
    // Start timers only run while the process is executable.
    const cfg = await this.prisma.workflowProcessConfig.findUnique({ where: { processId } });
    if (cfg?.activeDefinitionId) {
      if (cfg.enabled)
        await this.timers.scheduleStartTimers(
          cfg.activeDefinitionId,
          await this.model(cfg.activeDefinitionId),
        );
      else await this.timers.cancelStartTimers(processId);
    }
    if (cfg?.enabled && cfg.eventLog) await this.eventLog.ensureLog(processId, user.id);
    return this.get(processId, user);
  }

  /** Executable check of the working model (or given XML) or of the published version. */
  async check(
    processId: string,
    source: 'working' | 'published',
    xml: string | undefined,
    user: AuthUser,
  ): Promise<ExecCheckDto> {
    const p = await this.process(processId);
    // The check parses the posted model and reads the linked decision tables: designers only (SEC-47).
    if (!canDesignWorkflow(user, p)) throw forbidden();
    let bpmnXml = xml;
    let versionNumber: number | null = null;
    if (source === 'published') {
      const v = await this.publishedVersion(processId);
      if (!v) return { issues: [], versionNumber: null, deployable: false };
      bpmnXml = v.bpmnXml;
      versionNumber = v.versionNumber;
    } else if (!bpmnXml) {
      const m = await this.prisma.processModel.findUnique({ where: { processId } });
      bpmnXml = m?.bpmnXml ?? '';
    }
    const { issues } = await this.fullCheck(p.id, bpmnXml ?? '');
    return {
      issues,
      versionNumber,
      deployable: source === 'published' && !issues.some((i) => i.severity === 'error'),
    };
  }

  private async fullCheck(processId: string, xml: string) {
    const model = readWorkflowModel(xml);
    const issues: ExecIssue[] = checkExecutable(model);
    const decisions: Record<string, string> = {};
    for (const n of Object.values(model.nodes)) {
      if (n.type === 'businessRuleTask' && n.decisionRef && n.decisionId) {
        const key = decisionKey(n.decisionRef, n.decisionId);
        if (decisions[key] !== undefined) continue;
        const dmn = await this.decisionXml(n.decisionRef);
        if (!dmn.xml) {
          issues.push({ code: dmn.code, severity: 'error', elementId: n.id });
          continue;
        }
        const table = readDecisionTables(dmn.xml).find((t) => t.id === n.decisionId);
        if (!table) {
          issues.push({
            code: 'DECISION_NOT_FOUND',
            severity: 'error',
            elementId: n.id,
            detail: n.decisionId,
          });
          continue;
        }
        const problems = checkDmnTable(table);
        if (problems.length)
          issues.push({
            code: 'DECISION_INVALID',
            severity: 'error',
            elementId: n.id,
            detail: problems
              .slice(0, 3)
              .map((x) => `${x.entry} — ${x.message}`)
              .join('; '),
          });
        decisions[key] = dmn.xml;
      }
      if (n.type === 'callActivity' && n.linkedProcessId) {
        if (n.linkedProcessId === processId) {
          issues.push({ code: 'LINKED_SELF', severity: 'error', elementId: n.id });
          continue;
        }
        const linked = await this.prisma.workflowProcessConfig.findUnique({
          where: { processId: n.linkedProcessId },
          select: { enabled: true, activeDefinitionId: true },
        });
        if (!linked?.enabled || !linked.activeDefinitionId)
          issues.push({ code: 'LINKED_NOT_EXECUTABLE', severity: 'error', elementId: n.id });
      }
    }
    return { model, issues, decisions };
  }

  /** DMN XML of a decision diagram: its published version, else its latest approved version. */
  private async decisionXml(
    diagramId: string,
  ): Promise<{ xml: string | null; code: 'DECISION_NOT_FOUND' | 'DECISION_NOT_APPROVED' }> {
    const d = await this.prisma.diagram.findFirst({
      where: { id: diagramId, deletedAt: null, type: 'DMN' },
      select: { id: true, status: true },
    });
    if (!d) return { xml: null, code: 'DECISION_NOT_FOUND' };
    const pub = await this.prisma.publication.findFirst({
      where: { entityType: 'DIAGRAM', entityId: diagramId, current: true },
      select: { versionNumber: true },
    });
    if (!pub && d.status !== 'APPROVED') return { xml: null, code: 'DECISION_NOT_APPROVED' };
    const v = await this.prisma.diagramVersion.findFirst({
      where: { diagramId, ...(pub ? { versionNumber: pub.versionNumber } : {}) },
      orderBy: { versionNumber: 'desc' },
      select: { content: true },
    });
    return v
      ? { xml: v.content, code: 'DECISION_NOT_FOUND' }
      : { xml: null, code: 'DECISION_NOT_APPROVED' };
  }

  /** Deploys the published version (blocking issues → 400 with the issue list). */
  async deploy(processId: string, user: AuthUser, meta: RequestMeta): Promise<WorkflowConfigDto> {
    const p = await this.process(processId);
    // Process Owner of this process or workflow admins only (D-154).
    if (!canDeployWorkflow(user, p)) throw forbidden('DEPLOY_RIGHTS_REQUIRED');
    const cfg = await this.prisma.workflowProcessConfig.findUnique({ where: { processId } });
    if (!cfg) throw badRequest('NOT_EXECUTABLE', 'Save the execution settings first');
    const v = await this.publishedVersion(processId);
    if (!v) throw badRequest('NOT_PUBLISHED');
    const { model, issues, decisions } = await this.fullCheck(processId, v.bpmnXml);
    const blocking = issues.filter((i) => i.severity === 'error');
    if (blocking.length)
      throw badRequest('EXECUTABLE_CHECK_FAILED', 'The process cannot be executed', blocking);
    const def = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.workflowDefinition.findUnique({
        where: { processId_versionNumber: { processId, versionNumber: v.versionNumber } },
      });
      const d =
        existing ??
        (await tx.workflowDefinition.create({
          data: {
            processId,
            versionNumber: v.versionNumber,
            versionLabel: v.label,
            bpmnXml: v.bpmnXml,
            model: model as unknown as Prisma.InputJsonValue,
            decisions,
            deployedById: user.id,
          },
        }));
      await tx.workflowProcessConfig.update({
        where: { processId },
        data: { activeDefinitionId: d.id, updatedById: user.id },
      });
      await this.audit.log(
        {
          action: 'DEPLOY',
          entityType: 'WorkflowDefinition',
          entityId: d.id,
          userId: user.id,
          summary: {
            process: p.code,
            versionNumber: v.versionNumber,
            previous: cfg.activeDefinitionId,
            warnings: issues.length,
          },
          meta,
        },
        tx,
      );
      return d;
    });
    await this.timers.cancelStartTimers(processId);
    if (cfg.enabled && timerStarts(model).length)
      await this.timers.scheduleStartTimers(def.id, model);
    if (cfg.enabled && cfg.eventLog) await this.eventLog.ensureLog(processId, user.id);
    return this.get(processId, user);
  }

  /** Decision table XML of a deployment (business rule tasks). */
  async deploymentDecisions(definitionId: string): Promise<Record<string, string>> {
    const d = await this.prisma.workflowDefinition.findUniqueOrThrow({
      where: { id: definitionId },
      select: { decisions: true },
    });
    return (d.decisions ?? {}) as Record<string, string>;
  }
}

export { decisionKey };
