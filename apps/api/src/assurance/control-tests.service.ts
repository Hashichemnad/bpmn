import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  CONCLUSION_EFFECTIVENESS,
  OPEN_TEST_STATUSES,
  PERMISSIONS,
  TEST_FREQUENCY_MONTHS,
  addMonths,
  testPeriod,
  testProblems,
  type AssigneeDto,
  type ControlTestDetailDto,
  type ControlTestDto,
  type ControlTestListQuery,
  type ControlTestStatus,
  type CreateControlTestInput,
  type CreateTestPlanInput,
  type GrcStatus,
  type Paginated,
  type SystemRoleKey,
  type TestConclusion,
  type TestFrequency,
  type TestPlanDto,
  type TestResultsInput,
  type TestReviewInput,
  type TestSample,
  type TestType,
  type UpdateTestPlanInput,
  type UserRef,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { badRequest, conflict, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { AssuranceFilesService } from './assurance-files.service';
import { AssuranceEventsService } from './assurance-events.service';
import { AssigneeResolver, isAssignee } from './assignees';

const userSelect = { id: true, email: true, nameEn: true, nameAr: true } as const;
const controlInclude = {
  include: {
    object: {
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        deletedAt: true,
        owner: { select: userSelect },
      },
    },
    department: { select: { id: true, nameEn: true, nameAr: true } },
  },
} as const;
const testInclude = { control: controlInclude } satisfies Prisma.ControlTestInclude;
type TestRow = Prisma.ControlTestGetPayload<{ include: typeof testInclude }>;
const planInclude = {
  control: controlInclude,
  _count: { select: { tests: { where: { deletedAt: null } } } },
} satisfies Prisma.ControlTestPlanInclude;
type PlanRow = Prisma.ControlTestPlanGetPayload<{ include: typeof planInclude }>;

const ENTITY = 'ControlTest';
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const dueDate = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
const testLink = (id: string) => `/grc/tests/${id}`;

/**
 * Control testing (Phase 4.2, D-099): test plans per control, test instances created by the
 * scheduler or by hand, execution with samples and evidence, four-eyes review; the reviewed
 * conclusion becomes the control's operating effectiveness (with its assessment history).
 */
@Injectable()
export class ControlTestsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly files: AssuranceFilesService,
    private readonly events: AssuranceEventsService,
    private readonly assignees: AssigneeResolver,
  ) {}

  onModuleInit() {
    this.files.register('CONTROL_TEST', {
      canRead: async (id, user) => {
        const t = await this.prisma.controlTest.findFirst({ where: { id, deletedAt: null } });
        return !!t && this.canRead(t, user);
      },
      canWrite: async (id, user) => {
        const t = await this.prisma.controlTest.findFirst({ where: { id, deletedAt: null } });
        return !!t && this.mayExecute(t, user);
      },
    });
  }

  // ---------- Access ----------

  private tester(t: { testerId: string | null; testerRoleKey: string | null }) {
    return { userId: t.testerId, roleKey: t.testerRoleKey };
  }
  private reviewer(t: { reviewerId: string | null; reviewerRoleKey: string | null }) {
    return { userId: t.reviewerId, roleKey: t.reviewerRoleKey };
  }
  private manages(user: AuthUser) {
    return user.permissions.has(PERMISSIONS.GRC_EDIT);
  }

  /** Testers assigned (or Risk & Compliance editors) execute open tests. */
  private mayExecute(
    t: { status: string; testerId: string | null; testerRoleKey: string | null },
    user: AuthUser,
  ) {
    return (
      OPEN_TEST_STATUSES.includes(t.status as ControlTestStatus) &&
      user.permissions.has(PERMISSIONS.CONTROLS_TEST) &&
      (isAssignee(this.tester(t), user) || this.manages(user))
    );
  }

  /** Reviewers sign off submitted tests — never a test they executed (four-eyes). */
  private mayReview(
    t: {
      status: string;
      executedById: string | null;
      reviewerId: string | null;
      reviewerRoleKey: string | null;
    },
    user: AuthUser,
  ) {
    return (
      t.status === 'SUBMITTED' &&
      t.executedById !== user.id &&
      user.permissions.has(PERMISSIONS.CONTROLS_REVIEW) &&
      (isAssignee(this.reviewer(t), user) || this.manages(user))
    );
  }

  private canRead(
    t: Parameters<ControlTestsService['mayExecute']>[0] & {
      executedById: string | null;
      reviewerId: string | null;
      reviewerRoleKey: string | null;
    },
    user: AuthUser,
  ) {
    return (
      user.permissions.has(PERMISSIONS.GRC_READ) ||
      t.executedById === user.id ||
      (user.permissions.has(PERMISSIONS.CONTROLS_TEST) && isAssignee(this.tester(t), user)) ||
      (user.permissions.has(PERMISSIONS.CONTROLS_REVIEW) && isAssignee(this.reviewer(t), user))
    );
  }

  // ---------- DTOs ----------

  private async people(ids: (string | null)[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids.filter((v): v is string => !!v) } },
      select: userSelect,
    });
    return new Map<string, UserRef>(users.map((u) => [u.id, u]));
  }

  private assignee(
    byId: Map<string, UserRef>,
    userId: string | null,
    roleKey: string | null,
  ): AssigneeDto {
    return {
      user: userId ? (byId.get(userId) ?? null) : null,
      roleKey: (roleKey as SystemRoleKey) ?? null,
    };
  }

  private controlRef(c: TestRow['control'], status?: GrcStatus) {
    return {
      id: c.objectId,
      type: 'CONTROL' as const,
      code: c.object.code,
      nameEn: c.object.nameEn,
      nameAr: c.object.nameAr,
      status: status ?? c.status,
      keyControl: c.keyControl,
      department: c.department ?? null,
      owner: c.object.owner ?? null,
    };
  }

  private async toDtos(
    rows: TestRow[],
    user: AuthUser,
    now = new Date(),
  ): Promise<ControlTestDto[]> {
    const byId = await this.people(
      rows.flatMap((r) => [r.testerId, r.reviewerId, r.executedById, r.reviewedById]),
    );
    return rows.map((r) => ({
      id: r.id,
      planId: r.planId,
      control: this.controlRef(r.control),
      testType: r.testType as TestType,
      period: r.period,
      dueAt: r.dueAt.toISOString(),
      status: r.status as ControlTestStatus,
      origin: r.origin as 'SCHEDULED' | 'MANUAL',
      overdue: OPEN_TEST_STATUSES.includes(r.status as ControlTestStatus) && r.dueAt < now,
      procedure: r.procedure as { en: string; ar: string }[],
      sampleSize: r.sampleSize,
      tester: this.assignee(byId, r.testerId, r.testerRoleKey),
      reviewer: this.assignee(byId, r.reviewerId, r.reviewerRoleKey),
      samples: r.samples as unknown as TestSample[],
      conclusion: (r.conclusion as TestConclusion) ?? null,
      testerComment: r.testerComment,
      reviewComment: r.reviewComment,
      executedBy: r.executedById ? (byId.get(r.executedById) ?? null) : null,
      reviewedBy: r.reviewedById ? (byId.get(r.reviewedById) ?? null) : null,
      startedAt: iso(r.startedAt),
      submittedAt: iso(r.submittedAt),
      reviewedAt: iso(r.reviewedAt),
      closedAt: iso(r.closedAt),
      createdAt: r.createdAt.toISOString(),
      can: {
        execute: this.mayExecute(r, user),
        review: this.mayReview(r, user),
        close: r.status === 'REVIEWED' && (this.manages(user) || r.reviewedById === user.id),
        manage: this.manages(user),
      },
    }));
  }

  private async planDtos(rows: PlanRow[]): Promise<TestPlanDto[]> {
    const byId = await this.people(rows.flatMap((r) => [r.testerId, r.reviewerId]));
    return rows.map((r) => ({
      id: r.id,
      control: {
        id: r.controlId,
        type: 'CONTROL',
        code: r.control.object.code,
        nameEn: r.control.object.nameEn,
        nameAr: r.control.object.nameAr,
        status: r.control.status,
      },
      testType: r.testType as TestType,
      procedure: r.procedure as { en: string; ar: string }[],
      sampleSize: r.sampleSize,
      frequency: r.frequency as TestFrequency,
      tester: this.assignee(byId, r.testerId, r.testerRoleKey),
      reviewer: this.assignee(byId, r.reviewerId, r.reviewerRoleKey),
      nextDueAt: iso(r.nextDueAt),
      leadDays: r.leadDays,
      active: r.active,
      testCount: r._count.tests,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  // ---------- Plans ----------

  private async assertControl(id: string) {
    const c = await this.prisma.control.findFirst({
      where: { objectId: id, object: { deletedAt: null } },
    });
    if (!c) throw badRequest('INVALID_CONTROL_REFERENCE');
    return c;
  }

  private async assertUsers(ids: (string | null | undefined)[]) {
    const list = ids.filter((v): v is string => !!v);
    if (!list.length) return;
    const n = await this.prisma.user.count({ where: { id: { in: list }, deletedAt: null } });
    if (n !== new Set(list).size) throw badRequest('INVALID_USER');
  }

  async plans(controlId: string | undefined): Promise<TestPlanDto[]> {
    const rows = await this.prisma.controlTestPlan.findMany({
      where: { deletedAt: null, controlId, control: { object: { deletedAt: null } } },
      include: planInclude,
      orderBy: { createdAt: 'asc' },
    });
    return this.planDtos(rows);
  }

  async createPlan(input: CreateTestPlanInput, actor: AuthUser, meta: RequestMeta) {
    await this.assertControl(input.controlId);
    await this.assertUsers([input.testerId, input.reviewerId]);
    const plan = await this.prisma.$transaction(async (tx) => {
      const p = await tx.controlTestPlan.create({
        data: {
          controlId: input.controlId,
          testType: input.testType,
          procedure: input.procedure,
          sampleSize: input.sampleSize,
          frequency: input.frequency,
          testerId: input.testerId ?? null,
          testerRoleKey: input.testerRoleKey ?? null,
          reviewerId: input.reviewerId ?? null,
          reviewerRoleKey: input.reviewerRoleKey ?? null,
          nextDueAt: input.nextDueAt ? dueDate(input.nextDueAt) : null,
          leadDays: input.leadDays ?? 30,
          active: input.active ?? true,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'ControlTestPlan',
          entityId: p.id,
          userId: actor.id,
          summary: {
            after: { controlId: p.controlId, testType: p.testType, frequency: p.frequency },
          },
          meta,
        },
        tx,
      );
      return p;
    });
    return (await this.planDtos([await this.planRow(plan.id)]))[0];
  }

  private async planRow(id: string) {
    const p = await this.prisma.controlTestPlan.findFirst({
      where: { id, deletedAt: null },
      include: planInclude,
    });
    if (!p) throw notFound('Test plan');
    return p;
  }

  async updatePlan(id: string, input: UpdateTestPlanInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.planRow(id);
    await this.assertUsers([input.testerId, input.reviewerId]);
    const testerId = input.testerId === undefined ? before.testerId : input.testerId;
    const reviewerId = input.reviewerId === undefined ? before.reviewerId : input.reviewerId;
    if (testerId && testerId === reviewerId) throw badRequest('TESTER_IS_REVIEWER');
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.controlTestPlan.update({
        where: { id },
        data: {
          testType: input.testType,
          procedure: input.procedure,
          sampleSize: input.sampleSize,
          frequency: input.frequency,
          testerId: input.testerId,
          testerRoleKey: input.testerRoleKey,
          reviewerId: input.reviewerId,
          reviewerRoleKey: input.reviewerRoleKey,
          nextDueAt:
            input.nextDueAt === undefined
              ? undefined
              : input.nextDueAt
                ? dueDate(input.nextDueAt)
                : null,
          leadDays: input.leadDays,
          active: input.active,
          updatedById: actor.id,
        },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'ControlTestPlan',
          entityId: id,
          userId: actor.id,
          summary: {
            before: {
              frequency: before.frequency,
              active: before.active,
              nextDueAt: before.nextDueAt,
            },
            after: { frequency: after.frequency, active: after.active, nextDueAt: after.nextDueAt },
          },
          meta,
        },
        tx,
      );
    });
    return (await this.planDtos([await this.planRow(id)]))[0];
  }

  async removePlan(id: string, actor: AuthUser, meta: RequestMeta) {
    await this.planRow(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.controlTestPlan.update({
        where: { id },
        data: { deletedAt: new Date(), active: false },
      });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'ControlTestPlan',
          entityId: id,
          userId: actor.id,
          summary: {},
          meta,
        },
        tx,
      );
    });
  }

  // ---------- Tests ----------

  /** A test created by hand (from a plan or ad hoc for a control). */
  async create(input: CreateControlTestInput, actor: AuthUser, meta: RequestMeta) {
    const plan = input.planId ? await this.planRow(input.planId) : null;
    const controlId = plan?.controlId ?? input.controlId!;
    await this.assertControl(controlId);
    await this.assertUsers([input.testerId, input.reviewerId]);
    const pick = <T>(v: T | undefined, fallback: T) => (v === undefined ? fallback : v);
    const testerId = pick(input.testerId, plan?.testerId ?? null);
    const reviewerId = pick(input.reviewerId, plan?.reviewerId ?? null);
    if (testerId && testerId === reviewerId) throw badRequest('TESTER_IS_REVIEWER');
    const id = await this.createTest(
      {
        planId: plan?.id ?? null,
        controlId,
        testType: input.testType ?? (plan?.testType as TestType) ?? 'OPERATING',
        dueAt: dueDate(input.dueAt),
        period: input.dueAt.slice(0, 10),
        origin: 'MANUAL',
        procedure: input.procedure ?? (plan?.procedure as { en: string; ar: string }[]) ?? [],
        sampleSize: input.sampleSize ?? plan?.sampleSize ?? 1,
        testerId,
        testerRoleKey: pick(input.testerRoleKey, plan?.testerRoleKey ?? null),
        reviewerId,
        reviewerRoleKey: pick(input.reviewerRoleKey, plan?.reviewerRoleKey ?? null),
      },
      actor.id,
      meta,
    );
    return this.get(id, actor);
  }

  /** Creates a test, records it and tells the tester(s). */
  async createTest(
    data: {
      planId: string | null;
      controlId: string;
      testType: TestType;
      dueAt: Date;
      period: string;
      origin: 'SCHEDULED' | 'MANUAL';
      procedure: { en: string; ar: string }[];
      sampleSize: number;
      testerId: string | null;
      testerRoleKey: string | null;
      reviewerId: string | null;
      reviewerRoleKey: string | null;
    },
    actorId: string | null,
    meta?: RequestMeta,
  ) {
    const samples: TestSample[] = Array.from({ length: data.sampleSize }, (_, i) => ({
      ref: `#${i + 1}`,
      steps: data.procedure.map(() => null),
      result: null,
      note: '',
    }));
    const t = await this.prisma.$transaction(async (tx) => {
      const row = await tx.controlTest.create({
        data: {
          ...data,
          procedure: data.procedure,
          samples: samples as unknown as Prisma.InputJsonValue,
          createdById: actorId,
        },
      });
      await this.events.add(
        tx,
        ENTITY,
        row.id,
        'CREATED',
        { status: { from: null, to: 'PLANNED' } },
        '',
        actorId,
      );
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'ControlTest',
          entityId: row.id,
          userId: actorId,
          summary: { after: { controlId: row.controlId, period: row.period, origin: row.origin } },
          meta,
        },
        tx,
      );
      return row;
    });
    await this.notify(
      t.id,
      'assigned',
      await this.assignees.userIds(this.tester(t), PERMISSIONS.CONTROLS_TEST),
      actorId,
    );
    return t.id;
  }

  private async row(id: string): Promise<TestRow> {
    const t = await this.prisma.controlTest.findFirst({
      where: { id, deletedAt: null, control: { object: { deletedAt: null } } },
      include: testInclude,
    });
    if (!t) throw notFound('Control test');
    return t;
  }

  async get(id: string, user: AuthUser): Promise<ControlTestDetailDto> {
    const t = await this.row(id);
    if (!this.canRead(t, user)) throw notFound('Control test');
    const [dto] = await this.toDtos([t], user);
    return {
      ...dto,
      files: await this.files.list('CONTROL_TEST', [id]),
      events: await this.events.list(ENTITY, id),
    };
  }

  async list(q: ControlTestListQuery, user: AuthUser): Promise<Paginated<ControlTestDto>> {
    const now = new Date();
    const where: Prisma.ControlTestWhereInput = {
      deletedAt: null,
      controlId: q.controlId,
      conclusion: q.conclusion,
      control: {
        object: {
          deletedAt: null,
          ...(q.q
            ? {
                OR: [
                  { code: { contains: q.q, mode: 'insensitive' } },
                  { nameEn: { contains: q.q, mode: 'insensitive' } },
                  { nameAr: { contains: q.q, mode: 'insensitive' } },
                ],
              }
            : {}),
          ...(q.processId ? { links: { some: { processId: q.processId } } } : {}),
        },
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      },
      ...(q.overdue !== undefined
        ? q.overdue
          ? { status: { in: [...OPEN_TEST_STATUSES] }, dueAt: { lt: now } }
          : { NOT: { status: { in: [...OPEN_TEST_STATUSES] }, dueAt: { lt: now } } }
        : {}),
      ...(q.open !== undefined
        ? {
            status: q.open
              ? { in: [...OPEN_TEST_STATUSES, 'SUBMITTED'] }
              : { in: ['REVIEWED', 'CLOSED'] },
          }
        : {}),
    };
    if (q.status) where.status = q.status;
    let rows = await this.prisma.controlTest.findMany({ where, include: testInclude });
    if (q.mine) rows = rows.filter((r) => this.mayExecute(r, user) || this.mayReview(r, user));
    const dir = q.order === 'desc' ? -1 : 1;
    const key = (r: TestRow) =>
      q.sort === 'status'
        ? r.status
        : q.sort === 'conclusion'
          ? (r.conclusion ?? '')
          : q.sort === 'control'
            ? (r.control.object.code ?? r.control.object.nameEn)
            : r.dueAt.toISOString();
    rows.sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }) * dir);
    const start = (q.page - 1) * q.pageSize;
    return {
      items: await this.toDtos(rows.slice(start, start + q.pageSize), user, now),
      total: rows.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Tests waiting for the user: to execute, and submitted ones to review (My tasks). */
  async myTasks(user: AuthUser) {
    if (
      !user.permissions.has(PERMISSIONS.CONTROLS_TEST) &&
      !user.permissions.has(PERMISSIONS.CONTROLS_REVIEW)
    )
      return { testsToExecute: [], testsToReview: [] };
    const rows = await this.prisma.controlTest.findMany({
      where: {
        deletedAt: null,
        status: { in: [...OPEN_TEST_STATUSES, 'SUBMITTED'] },
        control: { object: { deletedAt: null } },
      },
      include: testInclude,
      orderBy: { dueAt: 'asc' },
    });
    // Editors see every open test in the registers; My tasks lists only what is assigned to them.
    const assigned = (a: { userId: string | null; roleKey: string | null }) =>
      a.userId || a.roleKey ? isAssignee(a, user) : this.manages(user);
    const exec = rows.filter((r) => this.mayExecute(r, user) && assigned(this.tester(r)));
    const review = rows.filter((r) => this.mayReview(r, user) && assigned(this.reviewer(r)));
    return {
      testsToExecute: await this.toDtos(exec, user),
      testsToReview: await this.toDtos(review, user),
    };
  }

  private async transition(
    t: TestRow,
    to: ControlTestStatus,
    data: Prisma.ControlTestUpdateInput,
    actor: AuthUser,
    comment: string,
    meta: RequestMeta,
    action: 'UPDATE' | 'SUBMIT' | 'APPROVE' | 'REQUEST_CHANGES' | 'ASSESS' = 'UPDATE',
    extra?: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.controlTest.updateMany({
        where: { id: t.id, status: t.status },
        data: { ...(data as Prisma.ControlTestUpdateManyMutationInput), status: to },
      });
      if (!res.count) throw conflict('INVALID_TRANSITION', 'The test changed in the meantime');
      if (t.status !== to)
        await this.events.add(
          tx,
          ENTITY,
          t.id,
          'STATUS',
          { status: { from: t.status, to } },
          comment,
          actor.id,
        );
      await extra?.(tx);
      await this.audit.log(
        {
          action,
          entityType: 'ControlTest',
          entityId: t.id,
          userId: actor.id,
          summary: { status: { from: t.status, to }, ...(comment ? { comment } : {}) },
          meta,
        },
        tx,
      );
    });
  }

  async start(id: string, actor: AuthUser, meta: RequestMeta) {
    const t = await this.row(id);
    if (!this.mayExecute(t, actor)) throw forbidden('You are not the tester of this test');
    if (t.status !== 'PLANNED') throw conflict('INVALID_TRANSITION');
    await this.transition(
      t,
      'IN_PROGRESS',
      { startedAt: new Date(), executedById: actor.id },
      actor,
      '',
      meta,
    );
    return this.get(id, actor);
  }

  /** Saves samples, conclusion and comment (a returned test goes back to In progress). */
  async saveResults(id: string, input: TestResultsInput, actor: AuthUser, meta: RequestMeta) {
    const t = await this.row(id);
    if (!this.mayExecute(t, actor)) throw forbidden('You are not the tester of this test');
    const procedureSteps = (t.procedure as unknown[]).length;
    const samples = input.samples.map((s) => ({
      ...s,
      steps: Array.from({ length: procedureSteps }, (_, i) => s.steps[i] ?? null),
    }));
    await this.transition(
      t,
      'IN_PROGRESS',
      {
        samples: samples as unknown as Prisma.InputJsonValue,
        conclusion: input.conclusion,
        testerComment: input.testerComment,
        executedById: actor.id,
        startedAt: t.startedAt ?? new Date(),
      },
      actor,
      '',
      meta,
    );
    return this.get(id, actor);
  }

  async submit(id: string, actor: AuthUser, meta: RequestMeta) {
    const t = await this.row(id);
    if (!this.mayExecute(t, actor) || t.status === 'PLANNED')
      throw forbidden('Start the test and record its results first');
    const problems = testProblems({
      samples: t.samples as unknown as TestSample[],
      conclusion: t.conclusion as TestConclusion | null,
    });
    if (problems.length)
      throw badRequest('TEST_INCOMPLETE', 'The test is incomplete', { problems });
    if (t.reviewerId === actor.id) throw badRequest('TESTER_IS_REVIEWER');
    await this.transition(
      t,
      'SUBMITTED',
      { submittedAt: new Date(), executedById: actor.id },
      actor,
      '',
      meta,
      'SUBMIT',
    );
    const reviewers = (
      await this.assignees.userIds(this.reviewer(t), PERMISSIONS.CONTROLS_REVIEW)
    ).filter((u) => u !== actor.id);
    await this.notify(id, 'submitted', reviewers, actor.id);
    return this.get(id, actor);
  }

  /** Reviewer signs off (the conclusion becomes the control's operating effectiveness) or returns. */
  async review(id: string, input: TestReviewInput, actor: AuthUser, meta: RequestMeta) {
    const t = await this.row(id);
    if (t.status !== 'SUBMITTED') throw conflict('INVALID_TRANSITION');
    if (t.executedById === actor.id)
      throw forbidden('Nobody may review a test they executed (four-eyes)');
    if (!this.mayReview(t, actor)) throw forbidden('You are not the reviewer of this test');
    if (input.decision === 'RETURN') {
      await this.transition(
        t,
        'RETURNED',
        { reviewComment: input.comment, reviewedById: actor.id },
        actor,
        input.comment,
        meta,
        'REQUEST_CHANGES',
      );
      await this.notify(id, 'returned', [t.executedById], actor.id, input.comment);
      return this.get(id, actor);
    }
    const effectiveness = CONCLUSION_EFFECTIVENESS[t.conclusion as TestConclusion];
    const now = new Date();
    await this.transition(
      t,
      'REVIEWED',
      { reviewComment: input.comment, reviewedById: actor.id, reviewedAt: now },
      actor,
      input.comment,
      meta,
      'APPROVE',
      async (tx) => {
        const before = t.control.operatingEffectiveness;
        await tx.control.update({
          where: { objectId: t.controlId },
          data: { operatingEffectiveness: effectiveness, lastTestedAt: now },
        });
        await tx.grcActivity.create({
          data: {
            objectId: t.controlId,
            kind: 'ASSESSMENT',
            changes: { operatingEffectiveness: { from: before, to: effectiveness } },
            comment: `${t.period}: ${t.conclusion}${input.comment ? ` — ${input.comment}` : ''}`,
            createdById: actor.id,
          },
        });
        await this.audit.log(
          {
            action: 'ASSESS',
            entityType: 'Control',
            entityId: t.controlId,
            userId: actor.id,
            summary: {
              changes: { operatingEffectiveness: { from: before, to: effectiveness } },
              testId: t.id,
            },
            meta,
          },
          tx,
        );
      },
    );
    await this.notify(
      id,
      'reviewed',
      [t.executedById, t.control.object.owner?.id ?? null],
      actor.id,
    );
    return this.get(id, actor);
  }

  async close(id: string, actor: AuthUser, meta: RequestMeta) {
    const t = await this.row(id);
    if (t.status !== 'REVIEWED') throw conflict('INVALID_TRANSITION');
    if (!this.manages(actor) && t.reviewedById !== actor.id) throw forbidden();
    await this.transition(t, 'CLOSED', { closedAt: new Date() }, actor, '', meta);
    return this.get(id, actor);
  }

  /** Removes a test that was not started (Risk & Compliance editors). */
  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const t = await this.row(id);
    if (t.status !== 'PLANNED') throw conflict('TEST_STARTED', 'Only planned tests can be removed');
    await this.prisma.$transaction(async (tx) => {
      await tx.controlTest.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log(
        {
          action: 'DELETE',
          entityType: 'ControlTest',
          entityId: id,
          userId: actor.id,
          summary: { period: t.period },
          meta,
        },
        tx,
      );
    });
  }

  async comment(id: string, body: string, actor: AuthUser, meta: RequestMeta) {
    const t = await this.row(id);
    if (!this.canRead(t, actor)) throw notFound('Control test');
    await this.prisma.$transaction(async (tx) => {
      const e = await this.events.add(tx, ENTITY, id, 'COMMENT', {}, body, actor.id);
      await this.audit.log(
        {
          action: 'CREATE',
          entityType: 'ControlTest',
          entityId: id,
          userId: actor.id,
          summary: { comment: e.id },
          meta,
        },
        tx,
      );
    });
    return this.events.list(ENTITY, id);
  }

  async upload(
    id: string,
    file: Express.Multer.File | undefined,
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const t = await this.row(id);
    if (!this.mayExecute(t, actor))
      throw forbidden('Evidence is added by the tester while the test is open');
    return this.files.upload('CONTROL_TEST', id, file, actor, meta, ENTITY);
  }

  // ---------- Notifications and the scheduler ----------

  private async notify(
    id: string,
    kind: 'assigned' | 'due' | 'overdue' | 'submitted' | 'returned' | 'reviewed',
    userIds: (string | null)[],
    actorId: string | null,
    comment?: string,
    dedupeKey?: string,
  ) {
    const t = await this.prisma.controlTest.findUniqueOrThrow({
      where: { id },
      include: { control: { include: { object: true } } },
    });
    return this.notifications.notify({
      userIds,
      type: 'CONTROL_TEST',
      actorId,
      params: {
        kind,
        code: t.control.object.code ?? '',
        titleEn: t.control.object.nameEn,
        titleAr: t.control.object.nameAr,
        period: t.period,
        due: t.dueAt.toISOString(),
        ...(t.conclusion ? { conclusion: t.conclusion } : {}),
        ...(comment ? { comment } : {}),
      },
      link: testLink(id),
      dedupeKey,
    });
  }

  /**
   * Scheduled work: creates the tests of active plans whose next due date is within their lead
   * time (and moves the plan to the next period), and reminds testers before and after the due date.
   */
  async runScheduler(now: Date, reminderDaysBefore: number) {
    let created = 0;
    const plans = await this.prisma.controlTestPlan.findMany({
      where: {
        active: true,
        deletedAt: null,
        frequency: { not: 'AD_HOC' },
        nextDueAt: { not: null },
        control: { status: 'ACTIVE', object: { deletedAt: null } },
      },
    });
    for (const p of plans) {
      let due = p.nextDueAt!;
      // At most a year of catch-up per run.
      for (let i = 0; i < 12 && due.getTime() - p.leadDays * 86_400_000 <= now.getTime(); i++) {
        const months = TEST_FREQUENCY_MONTHS[p.frequency as Exclude<TestFrequency, 'AD_HOC'>];
        const exists = await this.prisma.controlTest.count({
          where: { planId: p.id, dueAt: due, deletedAt: null },
        });
        if (!exists) {
          await this.createTest(
            {
              planId: p.id,
              controlId: p.controlId,
              testType: p.testType as TestType,
              dueAt: due,
              period: testPeriod(p.frequency as TestFrequency, due),
              origin: 'SCHEDULED',
              procedure: p.procedure as { en: string; ar: string }[],
              sampleSize: p.sampleSize,
              testerId: p.testerId,
              testerRoleKey: p.testerRoleKey,
              reviewerId: p.reviewerId,
              reviewerRoleKey: p.reviewerRoleKey,
            },
            null,
          );
          created++;
        }
        due = addMonths(due, months);
        await this.prisma.controlTestPlan.update({ where: { id: p.id }, data: { nextDueAt: due } });
      }
    }

    let reminders = 0;
    const window = new Date(now.getTime() + reminderDaysBefore * 86_400_000);
    const open = await this.prisma.controlTest.findMany({
      where: {
        deletedAt: null,
        status: { in: [...OPEN_TEST_STATUSES] },
        dueAt: { lte: window },
        control: { object: { deletedAt: null } },
      },
    });
    for (const t of open) {
      const overdue = t.dueAt <= now;
      if (overdue ? t.overdueNotifiedAt : t.dueNotifiedAt) continue;
      const users = t.executedById
        ? [t.executedById]
        : await this.assignees.userIds(this.tester(t), PERMISSIONS.CONTROLS_TEST);
      const kind = overdue ? 'overdue' : 'due';
      reminders += await this.notify(
        t.id,
        kind,
        users,
        null,
        undefined,
        `CONTROL_TEST:${kind}:${t.id}:${t.dueAt.toISOString().slice(0, 10)}`,
      );
      await this.prisma.controlTest.update({
        where: { id: t.id },
        data: overdue ? { overdueNotifiedAt: now } : { dueNotifiedAt: now },
      });
    }
    return { created, reminders };
  }
}
