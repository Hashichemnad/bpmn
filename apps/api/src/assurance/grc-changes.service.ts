import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  PERMISSIONS,
  needsChangeApproval,
  stepAssignees,
  stepOutcome,
  type GrcChangeDecisionInput,
  type GrcChangeDto,
  type GrcChangeFieldDto,
  type GrcChangeListQuery,
  type GrcChangeStatus,
  type GrcChangeTaskStatus,
  type GrcChangeType,
  type GrcItemDetailDto,
  type GrcObjectType,
  type GrcStatus,
  type UpdateControlInput,
  type UpdateRiskInput,
  type UserRef,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppException, badRequest, conflict, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { GrcService } from '../grc/grc.service';
import { GrcSettingsService } from '../grc/grc-settings.service';
import { WorkflowsService } from '../governance/workflows.service';
import type { ContentItem } from '../governance/content.service';
import { actorParams } from '../governance/reviews.service';

type ChangeRow = Prisma.GrcChangeGetPayload<{ include: { tasks: true; object: true } }>;
interface StepSnapshot {
  nameEn: string;
  nameAr: string;
  rule: 'ANY' | 'ALL';
  assigneeIds: string[];
}
type Input = UpdateRiskInput | UpdateControlInput;

const ENTITY: Record<GrcChangeType, 'Risk' | 'Control'> = { RISK: 'Risk', CONTROL: 'Control' };
const PATH: Record<GrcChangeType, string> = { RISK: '/grc/risks', CONTROL: '/grc/controls' };
const userSelect = { id: true, email: true, nameEn: true, nameAr: true } as const;

/** Fields whose value is a user, department or library objects (shown by name). */
const USER_FIELDS = ['ownerId'];
const DEPARTMENT_FIELDS = ['departmentId'];
const OBJECT_FIELDS = ['controlIds', 'riskIds', 'requirementIds', 'systemId'];

const norm = (v: unknown): unknown => {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return [...v].map(String).sort();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return v.slice(0, 10);
  return v;
};
const same = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

/**
 * Approval of changes to active risks and controls (Phase 4.2, D-098). When enabled in
 * Settings → Risk & Compliance, an update of a non-draft risk or control is stored as a proposed
 * change and routed through a governance workflow (four-eyes: never the submitter); the item keeps
 * its current values until the last step approves, then the stored input is applied unchanged.
 */
@Injectable()
export class GrcChangesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly grc: GrcService,
    private readonly settings: GrcSettingsService,
    private readonly workflows: WorkflowsService,
  ) {}

  onModuleInit() {
    this.grc.setChangeGate({
      submit: (type, id, status, input, actor, meta) =>
        this.submitIfNeeded(type, id, status, input, actor, meta),
      pending: async (id, actor) => {
        const row = await this.prisma.grcChange.findFirst({
          where: { objectId: id, status: 'PENDING' },
          include: { tasks: true, object: true },
        });
        return row ? (await this.toDtos([row], actor))[0] : null;
      },
    });
  }

  /** Current values of the fields an update touches (normalised for comparison). */
  private async current(type: GrcChangeType, id: string): Promise<Record<string, unknown>> {
    const o = await this.prisma.repoObject.findUniqueOrThrow({
      where: { id },
      include: {
        risk: { include: { controls: true } },
        control: { include: { risks: true, requirements: true } },
      },
    });
    const common = {
      code: o.code,
      nameEn: o.nameEn,
      nameAr: o.nameAr,
      descriptionEn: o.descriptionEn,
      descriptionAr: o.descriptionAr,
      ownerId: o.ownerId,
    };
    if (type === 'RISK') {
      const { controls, objectId: _id, reminderSentFor: _r, lastAssessedAt: _l, ...r } = o.risk!;
      return { ...common, ...r, controlIds: controls.map((c) => c.controlId) };
    }
    const {
      risks,
      requirements,
      objectId: _id,
      reminderSentFor: _r,
      lastAssessedAt: _l,
      ...c
    } = o.control!;
    return {
      ...common,
      ...c,
      riskIds: risks.map((x) => x.riskId),
      requirementIds: requirements.map((x) => x.requirementId),
    };
  }

  private async submitIfNeeded(
    type: GrcChangeType,
    id: string,
    status: GrcStatus,
    input: Input,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<GrcItemDetailDto | null> {
    const settings = await this.settings.get();
    if (!needsChangeApproval(type, status, settings)) return null;
    if (await this.prisma.grcChange.count({ where: { objectId: id, status: 'PENDING' } }))
      throw conflict('CHANGE_PENDING', 'A change of this item is already waiting for approval');
    const before = await this.current(type, id);
    const fields: GrcChangeFieldDto[] = Object.entries(input)
      .filter(([k, v]) => k !== 'comment' && v !== undefined && !same(before[k], v))
      .map(([field, to]) => ({ field, from: norm(before[field]), to: norm(to) }));
    if (!fields.length) throw badRequest('NO_CHANGES', 'Nothing would change');

    const wid =
      settings.changeApproval.workflowId ?? (await this.workflows.settings()).defaultWorkflowId;
    const workflow = wid
      ? await this.prisma.workflow.findFirst({ where: { id: wid, deletedAt: null } })
      : null;
    if (!workflow) throw badRequest('NO_WORKFLOW', 'No approval workflow is configured');
    const object = await this.prisma.repoObject.findUniqueOrThrow({ where: { id } });
    const resolved = await this.workflows.resolveSteps(
      { type: 'PROCESS', id, ownerId: object.ownerId } as unknown as ContentItem,
      workflow,
    );
    // Approvers must see the Risk & Compliance registers.
    const readers = new Set(
      (
        await this.prisma.user.findMany({
          where: {
            id: { in: resolved.flatMap((s) => s.candidateIds) },
            roles: {
              some: {
                role: { permissions: { some: { permission: { key: PERMISSIONS.GRC_READ } } } },
              },
            },
          },
          select: { id: true },
        })
      ).map((u) => u.id),
    );
    const steps: StepSnapshot[] = resolved.map((s, i) => {
      const { assigneeIds, onlySubmitter } = stepAssignees(
        s.candidateIds.filter((c) => readers.has(c)),
        actor.id,
      );
      const details = { step: i, nameEn: s.nameEn, nameAr: s.nameAr };
      if (onlySubmitter)
        throw badRequest(
          'SELF_APPROVAL_NOT_ALLOWED',
          'You are the only approver of a workflow step; assign another approver first',
          details,
        );
      if (!assigneeIds.length)
        throw badRequest('WORKFLOW_NO_ASSIGNEES', 'A workflow step has nobody to review', details);
      return { nameEn: s.nameEn, nameAr: s.nameAr, rule: s.rule, assigneeIds };
    });

    const change = await this.prisma.$transaction(async (tx) => {
      const c = await tx.grcChange.create({
        data: {
          objectId: id,
          proposed: input as Prisma.InputJsonValue,
          fields: fields as unknown as Prisma.InputJsonValue,
          comment: input.comment ?? '',
          workflowId: workflow.id,
          workflowNameEn: workflow.nameEn,
          workflowNameAr: workflow.nameAr,
          steps: steps as unknown as Prisma.InputJsonValue,
          submittedById: actor.id,
        },
      });
      await tx.grcChangeTask.createMany({
        data: steps[0].assigneeIds.map((assigneeId) => ({
          changeId: c.id,
          stepIndex: 0,
          assigneeId,
        })),
      });
      await this.audit.log(
        {
          action: 'SUBMIT',
          entityType: ENTITY[type],
          entityId: id,
          userId: actor.id,
          summary: { changeId: c.id, fields, workflow: workflow.nameEn || workflow.nameAr },
          meta,
        },
        tx,
      );
      return c;
    });
    await this.notify(type, object, 'requested', steps[0].assigneeIds, actor, steps[0]);
    void change;
    return type === 'RISK' ? this.grc.getRisk(id, actor) : this.grc.getControl(id, actor);
  }

  private async notify(
    type: GrcChangeType,
    object: { id: string; code: string | null; nameEn: string; nameAr: string },
    kind: 'requested' | 'approved' | 'rejected',
    userIds: (string | null)[],
    actor: AuthUser,
    step?: { nameEn: string; nameAr: string },
    comment?: string,
  ) {
    await this.notifications.notify({
      userIds,
      type: 'GRC_CHANGE',
      actorId: actor.id,
      params: {
        kind,
        itemType: type,
        code: object.code ?? '',
        titleEn: object.nameEn,
        titleAr: object.nameAr,
        ...actorParams(actor),
        ...(step ? { stepEn: step.nameEn, stepAr: step.nameAr } : {}),
        ...(comment ? { comment } : {}),
      },
      link: `${PATH[type]}/${object.id}`,
    });
  }

  private async load(id: string): Promise<ChangeRow> {
    const row = await this.prisma.grcChange.findUnique({
      where: { id },
      include: { tasks: true, object: true },
    });
    if (!row || row.object.deletedAt) throw notFound('Change');
    return row;
  }

  async list(q: GrcChangeListQuery, actor: AuthUser): Promise<GrcChangeDto[]> {
    const rows = await this.prisma.grcChange.findMany({
      where: {
        status: q.status,
        objectId: q.objectId,
        object: { deletedAt: null },
        ...(q.mine ? { status: 'PENDING', tasks: { some: { assigneeId: actor.id } } } : {}),
      },
      include: { tasks: true, object: true },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });
    const dtos = await this.toDtos(rows, actor);
    return q.mine ? dtos.filter((d) => d.canDecide) : dtos;
  }

  async get(id: string, actor: AuthUser): Promise<GrcChangeDto> {
    return (await this.toDtos([await this.load(id)], actor))[0];
  }

  async decide(id: string, input: GrcChangeDecisionInput, actor: AuthUser, meta: RequestMeta) {
    const change = await this.load(id);
    if (change.status !== 'PENDING') throw conflict('CHANGE_CLOSED');
    const task = change.tasks.find(
      (t) =>
        t.assigneeId === actor.id && t.stepIndex === change.currentStep && t.status === 'PENDING',
    );
    if (!task)
      throw new AppException(HttpStatus.FORBIDDEN, 'NOT_YOUR_TASK', 'No open approval for you');
    const type = change.object.type as GrcChangeType;
    const steps = change.steps as unknown as StepSnapshot[];
    const status: GrcChangeTaskStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const upd = await this.prisma.grcChangeTask.updateMany({
      where: { id: task.id, status: 'PENDING' },
      data: { status, comment: input.comment ?? null, decidedAt: new Date() },
    });
    if (!upd.count) throw conflict('CHANGE_CLOSED');
    const stepTasks = (
      await this.prisma.grcChangeTask.findMany({
        where: { changeId: id, stepIndex: change.currentStep },
      })
    ).map((t) => ({ assigneeId: t.assigneeId, status: t.status as GrcChangeTaskStatus }));
    const outcome = stepOutcome(steps[change.currentStep].rule, stepTasks);
    const base = { entityType: ENTITY[type], entityId: change.objectId, userId: actor.id, meta };

    if (outcome === 'REJECTED') {
      await this.close(change, 'REJECTED');
      await this.audit.log({
        ...base,
        action: 'REJECT',
        summary: { changeId: id, comment: input.comment ?? null },
      });
      await this.notify(
        type,
        change.object,
        'rejected',
        [change.submittedById, change.object.ownerId],
        actor,
        undefined,
        input.comment,
      );
    } else if (outcome === 'APPROVED') {
      const next = change.currentStep + 1;
      if (next < steps.length) {
        await this.prisma.$transaction([
          this.prisma.grcChange.update({ where: { id }, data: { currentStep: next } }),
          this.prisma.grcChangeTask.updateMany({
            where: { changeId: id, stepIndex: change.currentStep, status: 'PENDING' },
            data: { status: 'SKIPPED' },
          }),
          this.prisma.grcChangeTask.createMany({
            data: steps[next].assigneeIds.map((assigneeId) => ({
              changeId: id,
              stepIndex: next,
              assigneeId,
            })),
          }),
        ]);
        await this.audit.log({
          ...base,
          action: 'APPROVE',
          summary: { changeId: id, step: change.currentStep, final: false },
        });
        await this.notify(
          type,
          change.object,
          'requested',
          steps[next].assigneeIds,
          actor,
          steps[next],
        );
      } else {
        // The approved input is applied as proposed; the current values change only now.
        const proposed = change.proposed as Input;
        if (type === 'RISK')
          await this.grc.updateRisk(change.objectId, proposed, actor, meta, { approved: true });
        else
          await this.grc.updateControl(change.objectId, proposed, actor, meta, { approved: true });
        await this.close(change, 'APPROVED');
        await this.audit.log({
          ...base,
          action: 'APPROVE',
          summary: { changeId: id, final: true, fields: change.fields },
        });
        await this.notify(
          type,
          change.object,
          'approved',
          [change.submittedById, change.object.ownerId],
          actor,
        );
      }
    }
    return this.get(id, actor);
  }

  private close(change: ChangeRow, status: GrcChangeStatus) {
    return this.prisma.$transaction([
      this.prisma.grcChange.update({
        where: { id: change.id },
        data: { status, completedAt: new Date() },
      }),
      this.prisma.grcChangeTask.updateMany({
        where: { changeId: change.id, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      }),
    ]);
  }

  async withdraw(id: string, actor: AuthUser, meta: RequestMeta) {
    const change = await this.load(id);
    if (change.status !== 'PENDING') throw conflict('CHANGE_CLOSED');
    if (change.submittedById !== actor.id && !actor.permissions.has(PERMISSIONS.GRC_ADMIN))
      throw forbidden();
    await this.close(change, 'WITHDRAWN');
    await this.audit.log({
      action: 'WITHDRAW',
      entityType: ENTITY[change.object.type as GrcChangeType],
      entityId: change.objectId,
      userId: actor.id,
      summary: { changeId: id },
      meta,
    });
    return this.get(id, actor);
  }

  /** DTOs with user / department / object ids in the before / after shown by name. */
  async toDtos(rows: ChangeRow[], actor?: AuthUser): Promise<GrcChangeDto[]> {
    const fields = rows.flatMap((r) => r.fields as unknown as GrcChangeFieldDto[]);
    const idsOf = (names: string[]) =>
      fields
        .filter((f) => names.includes(f.field))
        .flatMap((f) => [f.from, f.to].flat())
        .filter((v): v is string => typeof v === 'string');
    const userIds = [
      ...idsOf(USER_FIELDS),
      ...rows.flatMap((r) => [r.submittedById, ...r.tasks.map((t) => t.assigneeId)]),
    ].filter((v): v is string => !!v);
    const [users, departments, objects, statuses] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: userSelect }),
      this.prisma.department.findMany({
        where: { id: { in: idsOf(DEPARTMENT_FIELDS) } },
        select: { id: true, nameEn: true, nameAr: true },
      }),
      this.prisma.repoObject.findMany({
        where: { id: { in: idsOf(OBJECT_FIELDS) } },
        select: { id: true, code: true, nameEn: true, nameAr: true },
      }),
      this.statusOf(rows.map((r) => r.objectId)),
    ]);
    const userById = new Map<string, UserRef>(users.map((u) => [u.id, u]));
    const label = new Map<string, { en: string; ar: string }>([
      ...users.map((u) => [u.id, { en: u.nameEn || u.email, ar: u.nameAr || u.email }] as const),
      ...departments.map((d) => [d.id, { en: d.nameEn, ar: d.nameAr }] as const),
      ...objects.map(
        (o) =>
          [
            o.id,
            {
              en: [o.code, o.nameEn || o.nameAr].filter(Boolean).join(' '),
              ar: [o.code, o.nameAr || o.nameEn].filter(Boolean).join(' '),
            },
          ] as const,
      ),
    ]);
    const show = (field: string, v: unknown): unknown => {
      if (![...USER_FIELDS, ...DEPARTMENT_FIELDS, ...OBJECT_FIELDS].includes(field)) return v;
      if (Array.isArray(v)) return v.map((x) => label.get(String(x)) ?? x);
      return typeof v === 'string' ? (label.get(v) ?? v) : v;
    };
    return rows.map((r) => {
      const steps = r.steps as unknown as StepSnapshot[];
      return {
        id: r.id,
        object: {
          id: r.object.id,
          type: r.object.type as GrcObjectType,
          code: r.object.code,
          nameEn: r.object.nameEn,
          nameAr: r.object.nameAr,
          status: statuses.get(r.objectId) ?? 'ACTIVE',
        },
        status: r.status as GrcChangeStatus,
        fields: (r.fields as unknown as GrcChangeFieldDto[]).map((f) => ({
          field: f.field,
          from: show(f.field, f.from),
          to: show(f.field, f.to),
        })),
        comment: r.comment,
        workflowNameEn: r.workflowNameEn,
        workflowNameAr: r.workflowNameAr,
        steps: steps.map((s, i) => ({
          nameEn: s.nameEn,
          nameAr: s.nameAr,
          rule: s.rule,
          tasks: r.tasks
            .filter((t) => t.stepIndex === i)
            .map((t) => ({
              assignee: userById.get(t.assigneeId) ?? null,
              status: t.status as GrcChangeTaskStatus,
              comment: t.comment,
              decidedAt: t.decidedAt?.toISOString() ?? null,
            })),
        })),
        currentStep: r.currentStep,
        submittedBy: r.submittedById ? (userById.get(r.submittedById) ?? null) : null,
        submittedAt: r.submittedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
        canDecide:
          !!actor &&
          r.status === 'PENDING' &&
          r.tasks.some(
            (t) =>
              t.assigneeId === actor.id && t.stepIndex === r.currentStep && t.status === 'PENDING',
          ),
        canWithdraw:
          !!actor &&
          r.status === 'PENDING' &&
          (r.submittedById === actor.id || actor.permissions.has(PERMISSIONS.GRC_ADMIN)),
      };
    });
  }

  private async statusOf(ids: string[]) {
    const [risks, controls] = await Promise.all([
      this.prisma.risk.findMany({
        where: { objectId: { in: ids } },
        select: { objectId: true, status: true },
      }),
      this.prisma.control.findMany({
        where: { objectId: { in: ids } },
        select: { objectId: true, status: true },
      }),
    ]);
    return new Map<string, GrcStatus>([...risks, ...controls].map((x) => [x.objectId, x.status]));
  }
}
