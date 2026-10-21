import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PERMISSIONS,
  SETTING_KEYS,
  type ApprovalRule,
  type GovernanceSettingsDto,
  type GovernanceSettingsInput,
  type ItemGovernanceInput,
  type Permission,
  type SystemRoleKey,
  type WorkflowAssigneeDto,
  type WorkflowAssigneeInput,
  type WorkflowDto,
  type WorkflowInput,
  type WorkflowSource,
  type WorkflowStepInput,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { badRequest, conflict, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { DocsAccessService } from '../docs/docs-access.service';
import type { ContentItem } from './content.service';

export const DEFAULT_GOVERNANCE: GovernanceSettingsDto = {
  reviewIntervalMonths: 12,
  reminderDays: 14,
  reviewDueDays: 5,
  defaultWorkflowId: null,
  categoryWorkflows: { MANAGEMENT: null, CORE: null, SUPPORT: null },
};

type WorkflowRow = Prisma.WorkflowGetPayload<object>;

export interface ResolvedStep {
  nameEn: string;
  nameAr: string;
  rule: ApprovalRule;
  candidateIds: string[];
}

const READ_PERMISSION = { PROCESS: PERMISSIONS.PROCESSES_READ, PAGE: PERMISSIONS.DOCS_READ };

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly docsAccess: DocsAccessService,
  ) {}

  // ---------- Governance settings ----------

  async settings(): Promise<GovernanceSettingsDto> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.GOVERNANCE } });
    const v = (row?.value ?? {}) as Partial<GovernanceSettingsDto>;
    return {
      ...DEFAULT_GOVERNANCE,
      ...v,
      categoryWorkflows: {
        ...DEFAULT_GOVERNANCE.categoryWorkflows,
        ...(v.categoryWorkflows ?? {}),
      },
    };
  }

  async updateSettings(input: GovernanceSettingsInput, actor: AuthUser, meta: RequestMeta) {
    const ids = [input.defaultWorkflowId, ...Object.values(input.categoryWorkflows)].filter(
      (v): v is string => !!v,
    );
    await this.assertTemplates(ids);
    const before = await this.settings();
    await this.prisma.$transaction(async (tx) => {
      const value = input as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.GOVERNANCE },
        create: { key: SETTING_KEYS.GOVERNANCE, value, updatedById: actor.id },
        update: { value, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: SETTING_KEYS.GOVERNANCE,
          userId: actor.id,
          summary: { before, after: input },
          meta,
        },
        tx,
      );
    });
    return this.settings();
  }

  private async assertTemplates(ids: string[]) {
    if (!ids.length) return;
    const count = await this.prisma.workflow.count({
      where: { id: { in: [...new Set(ids)] }, deletedAt: null, isTemplate: true },
    });
    if (count !== new Set(ids).size) throw badRequest('WORKFLOW_NOT_FOUND');
  }

  // ---------- Templates ----------

  async toDtos(rows: WorkflowRow[]): Promise<WorkflowDto[]> {
    const steps = rows.flatMap((r) => r.steps as unknown as WorkflowStepInput[]);
    const assignees = steps.flatMap((s) => s.assignees);
    const userIds = assignees.flatMap((a) => (a.type === 'USER' ? [a.userId] : []));
    const deptIds = assignees.flatMap((a) =>
      a.type === 'ROLE' && a.departmentId ? [a.departmentId] : [],
    );
    const [users, depts, settings, usage] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, nameEn: true, nameAr: true },
      }),
      this.prisma.department.findMany({
        where: { id: { in: deptIds } },
        select: { id: true, nameEn: true, nameAr: true },
      }),
      this.settings(),
      this.usage(rows.map((r) => r.id)),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const deptById = new Map(depts.map((d) => [d.id, d]));
    const label = (a: WorkflowAssigneeInput): WorkflowAssigneeDto => {
      if (a.type === 'USER') {
        const u = userById.get(a.userId);
        return {
          type: 'USER',
          userId: a.userId,
          label: u ? { nameEn: u.nameEn, nameAr: u.nameAr, email: u.email } : null,
        };
      }
      if (a.type === 'ROLE') {
        const d = a.departmentId ? deptById.get(a.departmentId) : undefined;
        return {
          type: 'ROLE',
          roleKey: a.roleKey,
          departmentId: a.departmentId ?? null,
          label: d ? { nameEn: d.nameEn, nameAr: d.nameAr } : null,
        };
      }
      return { type: 'OWNER', label: null };
    };
    const defaults = [settings.defaultWorkflowId, ...Object.values(settings.categoryWorkflows)];
    return rows.map((r) => ({
      id: r.id,
      nameEn: r.nameEn,
      nameAr: r.nameAr,
      descriptionEn: r.descriptionEn,
      descriptionAr: r.descriptionAr,
      steps: (r.steps as unknown as WorkflowStepInput[]).map((s) => ({
        nameEn: s.nameEn ?? '',
        nameAr: s.nameAr ?? '',
        rule: s.rule,
        assignees: s.assignees.map(label),
      })),
      autoPublish: r.autoPublish,
      isTemplate: r.isTemplate,
      usage: (usage.get(r.id) ?? 0) + defaults.filter((d) => d === r.id).length,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  private async usage(ids: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const add = (rows: { workflowId: string | null; _count: { _all: number } }[]) => {
      for (const r of rows) {
        if (r.workflowId) map.set(r.workflowId, (map.get(r.workflowId) ?? 0) + r._count._all);
      }
    };
    const where = { workflowId: { in: ids }, deletedAt: null };
    const [processes, pages, spaces] = await Promise.all([
      this.prisma.process.findMany({ where, select: { workflowId: true } }),
      this.prisma.page.findMany({ where, select: { workflowId: true } }),
      this.prisma.space.findMany({ where, select: { workflowId: true } }),
    ]);
    add(
      [...processes, ...pages, ...spaces].map((r) => ({
        workflowId: r.workflowId,
        _count: { _all: 1 },
      })),
    );
    return map;
  }

  async list(): Promise<WorkflowDto[]> {
    const rows = await this.prisma.workflow.findMany({
      where: { deletedAt: null, isTemplate: true },
      orderBy: { nameEn: 'asc' },
    });
    return this.toDtos(rows);
  }

  async get(id: string): Promise<WorkflowDto> {
    const row = await this.prisma.workflow.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw notFound('Workflow');
    return (await this.toDtos([row]))[0];
  }

  private async assertAssignees(steps: WorkflowStepInput[]) {
    const assignees = steps.flatMap((s) => s.assignees);
    const userIds = [...new Set(assignees.flatMap((a) => (a.type === 'USER' ? [a.userId] : [])))];
    const deptIds = [
      ...new Set(
        assignees.flatMap((a) => (a.type === 'ROLE' && a.departmentId ? [a.departmentId] : [])),
      ),
    ];
    if (userIds.length) {
      const n = await this.prisma.user.count({ where: { id: { in: userIds }, deletedAt: null } });
      if (n !== userIds.length) throw badRequest('USER_NOT_FOUND');
    }
    if (deptIds.length) {
      const n = await this.prisma.department.count({
        where: { id: { in: deptIds }, deletedAt: null },
      });
      if (n !== deptIds.length) throw badRequest('DEPARTMENT_NOT_FOUND');
    }
  }

  private data(input: WorkflowInput) {
    return {
      nameEn: input.nameEn ?? '',
      nameAr: input.nameAr ?? '',
      descriptionEn: input.descriptionEn ?? '',
      descriptionAr: input.descriptionAr ?? '',
      steps: input.steps as unknown as Prisma.InputJsonValue,
      autoPublish: input.autoPublish,
    };
  }

  async create(input: WorkflowInput, actor: AuthUser, meta: RequestMeta, isTemplate = true) {
    await this.assertAssignees(input.steps);
    const row = await this.prisma.$transaction(async (tx) => {
      const w = await tx.workflow.create({
        data: { ...this.data(input), isTemplate, createdById: actor.id, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'Workflow',
          entityId: w.id,
          userId: actor.id,
          summary: {
            after: { nameEn: w.nameEn, nameAr: w.nameAr, steps: input.steps.length, isTemplate },
          },
          meta,
        },
        tx,
      );
      return w;
    });
    return (await this.toDtos([row]))[0];
  }

  async update(id: string, input: WorkflowInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.prisma.workflow.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Workflow');
    await this.assertAssignees(input.steps);
    const row = await this.prisma.$transaction(async (tx) => {
      const w = await tx.workflow.update({
        where: { id },
        data: { ...this.data(input), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Workflow',
          entityId: id,
          userId: actor.id,
          summary: {
            before: { nameEn: before.nameEn, steps: before.steps, autoPublish: before.autoPublish },
            after: { nameEn: w.nameEn, steps: w.steps, autoPublish: w.autoPublish },
          },
          meta,
        },
        tx,
      );
      return w;
    });
    return (await this.toDtos([row]))[0];
  }

  /** Templates in use (as a default or by an item) cannot be deleted. */
  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const w = await this.prisma.workflow.findFirst({
      where: { id, deletedAt: null, isTemplate: true },
    });
    if (!w) throw notFound('Workflow');
    if ((await this.toDtos([w]))[0].usage > 0) throw conflict('WORKFLOW_IN_USE');
    await this.prisma.$transaction(async (tx) => {
      await tx.workflow.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'Workflow',
          entityId: id,
          userId: actor.id,
          summary: { before: { nameEn: w.nameEn, nameAr: w.nameAr } },
          meta,
        },
        tx,
      );
    });
  }

  // ---------- Resolution ----------

  /** The workflow that applies to an item and where it comes from. */
  async resolve(
    item: ContentItem,
  ): Promise<{ source: WorkflowSource; workflow: WorkflowRow | null }> {
    const find = (id: string | null | undefined) =>
      id
        ? this.prisma.workflow.findFirst({ where: { id, deletedAt: null } })
        : Promise.resolve(null);
    const own = await find(item.workflowId);
    if (own) return { source: 'ITEM', workflow: own };
    const settings = await this.settings();
    if (item.type === 'PROCESS' && item.category) {
      const w = await find(settings.categoryWorkflows[item.category]);
      if (w) return { source: 'CATEGORY', workflow: w };
    }
    if (item.type === 'PAGE') {
      const w = await find(item.spaceWorkflowId);
      if (w) return { source: 'SPACE', workflow: w };
    }
    const d = await find(settings.defaultWorkflowId);
    if (d) return { source: 'DEFAULT', workflow: d };
    return { source: 'NONE', workflow: null };
  }

  /** Users each step would ask, before excluding the submitter. */
  async resolveSteps(item: ContentItem, workflow: WorkflowRow): Promise<ResolvedStep[]> {
    const steps = workflow.steps as unknown as WorkflowStepInput[];
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        departmentId: true,
        roles: {
          select: {
            role: {
              select: {
                key: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
      },
    });
    const pageSpace =
      item.type === 'PAGE'
        ? await this.prisma.space.findUnique({
            where: { id: item.spaceId! },
            include: { grants: true },
          })
        : null;
    const canRead = (u: (typeof users)[number]) => {
      const permissions = new Set(
        u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key as Permission)),
      );
      if (!permissions.has(READ_PERMISSION[item.type])) return false;
      if (!pageSpace) return true;
      return this.docsAccess.access(
        {
          id: u.id,
          email: '',
          nameEn: '',
          nameAr: '',
          locale: 'en',
          departmentId: u.departmentId,
          roles: u.roles.map((r) => r.role.key as SystemRoleKey),
          permissions,
        },
        pageSpace,
      ).canView;
    };
    const readers = new Map(users.filter(canRead).map((u) => [u.id, u]));
    return steps.map((s) => {
      const ids = new Set<string>();
      for (const a of s.assignees) {
        if (a.type === 'USER' && readers.has(a.userId)) ids.add(a.userId);
        if (a.type === 'OWNER' && item.ownerId && readers.has(item.ownerId)) ids.add(item.ownerId);
        if (a.type === 'ROLE') {
          for (const u of readers.values()) {
            if (!u.roles.some((r) => r.role.key === a.roleKey)) continue;
            if (a.departmentId && u.departmentId !== a.departmentId) continue;
            ids.add(u.id);
          }
        }
      }
      return {
        nameEn: s.nameEn ?? '',
        nameAr: s.nameAr ?? '',
        rule: s.rule,
        candidateIds: [...ids],
      };
    });
  }

  // ---------- Per-item settings ----------

  async updateItem(
    item: ContentItem,
    input: ItemGovernanceInput,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    if (!item.canManage) throw forbidden('You cannot change the governance settings of this item');
    if (input.ownerId !== undefined && item.type === 'PROCESS')
      throw badRequest('USE_PROCESS_OWNER');
    if (input.ownerId) {
      const u = await this.prisma.user.findFirst({ where: { id: input.ownerId, deletedAt: null } });
      if (!u) throw badRequest('OWNER_NOT_FOUND');
    }
    if (input.workflowId) await this.assertTemplates([input.workflowId]);
    if (input.customWorkflow) await this.assertAssignees(input.customWorkflow.steps);
    const current = item.workflowId
      ? await this.prisma.workflow.findUnique({ where: { id: item.workflowId } })
      : null;
    const ownCustom = current && !current.isTemplate ? current : null;

    await this.prisma.$transaction(async (tx) => {
      let workflowId: string | null | undefined;
      if (input.customWorkflow) {
        const data = this.data(input.customWorkflow);
        workflowId = ownCustom
          ? (
              await tx.workflow.update({
                where: { id: ownCustom.id },
                data: { ...data, updatedById: actor.id },
              })
            ).id
          : (
              await tx.workflow.create({
                data: { ...data, isTemplate: false, createdById: actor.id, updatedById: actor.id },
              })
            ).id;
      } else if (input.customWorkflow === null || input.workflowId !== undefined) {
        workflowId = input.workflowId ?? null;
        if (ownCustom && workflowId !== ownCustom.id) {
          await tx.workflow.update({
            where: { id: ownCustom.id },
            data: { deletedAt: new Date() },
          });
        }
      }
      const data = {
        ...(workflowId !== undefined ? { workflowId } : {}),
        ...(input.nextReviewAt !== undefined ? { nextReviewAt: input.nextReviewAt } : {}),
      };
      if (item.type === 'PROCESS') await tx.process.update({ where: { id: item.id }, data });
      else {
        await tx.page.update({
          where: { id: item.id },
          data: { ...data, ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}) },
        });
      }
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: item.type === 'PROCESS' ? 'Process' : 'Page',
          entityId: item.id,
          userId: actor.id,
          summary: {
            governance: {
              workflowId:
                workflowId === undefined ? undefined : { from: item.workflowId, to: workflowId },
              customWorkflow: input.customWorkflow ? input.customWorkflow.steps.length : undefined,
              nextReviewAt:
                input.nextReviewAt === undefined
                  ? undefined
                  : { from: item.nextReviewAt, to: input.nextReviewAt },
              ownerId:
                input.ownerId === undefined ? undefined : { from: item.ownerId, to: input.ownerId },
            },
          },
          meta,
        },
        tx,
      );
    });
  }

  /** Default workflow of a space (documentation managers, space managers). */
  async setSpaceWorkflow(
    spaceId: string,
    workflowId: string | null,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const { space, access } = await this.docsAccess.space(spaceId, actor);
    if (!access.canManage && !actor.permissions.has(PERMISSIONS.GOVERNANCE_MANAGE)) {
      throw forbidden('You cannot manage this space');
    }
    if (workflowId) await this.assertTemplates([workflowId]);
    await this.prisma.$transaction(async (tx) => {
      await tx.space.update({
        where: { id: spaceId },
        data: { workflowId, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Space',
          entityId: spaceId,
          userId: actor.id,
          summary: { workflowId: { from: space.workflowId, to: workflowId } },
          meta,
        },
        tx,
      );
    });
    return { workflowId };
  }
}
