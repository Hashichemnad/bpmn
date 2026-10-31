import type { INestApplicationContext } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  SYSTEM_ROLES,
  addDays,
  readDecisionTables,
  readWorkflowModel,
  type Locale,
  type Permission,
  type SystemRoleKey,
} from '@processhub/shared';
import { hashPassword } from '../src/auth/argon';
import { createPublication } from '../src/governance/publication';
import type { AuthUser } from '../src/common/auth-user';
import { BUDGET_DMN, leaveRequestXml, pmsProgramRequestXml } from './workflow-demo';

/**
 * Workflow execution demo (Phase 5.2, demo installations only, once): PMS-01 Program / Initiative
 * Request & Approval and HR-01 Leave request — published, executable, deployed — with five demo users
 * for the approval chain and a handful of cases in different states, driven through the real services
 * (engine, assignment, live event log) and back-dated over the last weeks.
 */

const WF_USERS = [
  {
    key: 'section',
    nameEn: 'Salem Al Mansoori (Section Manager)',
    nameAr: 'سالم المنصوري (رئيس قسم)',
    role: 'REVIEWER',
    department: 'PRC',
  },
  {
    key: 'pmo',
    nameEn: 'Noura Al Hashimi (PMO)',
    nameAr: 'نورة الهاشمي (مكتب المشاريع)',
    role: 'REVIEWER',
    department: 'EXE',
  },
  {
    key: 'finance',
    nameEn: 'Fatima Al Zaabi (Budget)',
    nameAr: 'فاطمة الزعابي (الميزانية)',
    role: 'REVIEWER',
    department: 'FIN',
  },
  {
    key: 'dgo',
    nameEn: 'Khalid Al Suwaidi (DG Office)',
    nameAr: 'خالد السويدي (مكتب المدير العام)',
    role: 'REVIEWER',
    department: 'EXE',
  },
  {
    key: 'hr',
    nameEn: 'Mariam Al Ali (HR)',
    nameAr: 'مريم العلي (الموارد البشرية)',
    role: 'REVIEWER',
    department: 'HR',
  },
] as const satisfies readonly {
  key: string;
  nameEn: string;
  nameAr: string;
  role: SystemRoleKey;
  department: string;
}[];

type Users = Record<(typeof WF_USERS)[number]['key'] | 'viewer' | 'owner' | 'performance', string>;

async function ensureUsers(prisma: PrismaClient): Promise<Users | null> {
  const password = process.env.SEED_DEMO_PASSWORD || 'Demo-Password1';
  const domain = process.env.SEED_DEMO_EMAIL_DOMAIN || 'processhub.local';
  const ids: Partial<Users> = {};
  let hash: string | null = null;
  for (const u of WF_USERS) {
    const email = `${u.key}@${domain}`;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      ids[u.key] = existing.id;
      continue;
    }
    hash ??= await hashPassword(password);
    const [role, dept] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { key: u.role } }),
      prisma.department.findFirst({ where: { code: u.department } }),
    ]);
    const user = await prisma.user.create({
      data: {
        email,
        nameEn: u.nameEn,
        nameAr: u.nameAr,
        passwordHash: hash,
        departmentId: dept?.id ?? null,
        roles: { create: [{ roleId: role.id }] },
      },
    });
    ids[u.key] = user.id;
  }
  for (const key of ['viewer', 'owner', 'performance'] as const) {
    const u = await prisma.user.findUnique({ where: { email: `${key}@${domain}` } });
    if (!u) return null;
    ids[key] = u.id;
  }
  return ids as Users;
}

async function authUser(prisma: PrismaClient, id: string): Promise<AuthUser> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id },
    include: { roles: { include: { role: true } } },
  });
  const roles = u.roles.map((r) => r.role.key as SystemRoleKey);
  const permissions = new Set<Permission>(
    roles.flatMap((r) =>
      r === 'SUPER_ADMIN' ? ALL_PERMISSIONS : (SYSTEM_ROLES[r]?.permissions ?? []),
    ),
  );
  return {
    id: u.id,
    email: u.email,
    nameEn: u.nameEn,
    nameAr: u.nameAr,
    locale: (u.locale as Locale) ?? 'en',
    departmentId: u.departmentId,
    roles,
    permissions,
    hasPassword: true,
    ssoLinked: false,
    mfaEnabled: false,
  };
}

/** Approved review + publication of version 1 (as the governance demo does). */
async function publish(
  prisma: PrismaClient,
  type: 'PROCESS' | 'DIAGRAM',
  id: string,
  ownerId: string,
  publishedAt: Date,
) {
  const steps = [
    {
      nameEn: 'Owner approval',
      nameAr: 'اعتماد المالك',
      rule: 'ANY',
      assigneeIds: [ownerId],
      approvedBySubmitter: false,
    },
  ];
  const r = await prisma.review.create({
    data: {
      entityType: type,
      entityId: id,
      versionNumber: 1,
      status: 'APPROVED',
      workflowNameEn: 'Standard approval',
      workflowNameAr: 'الاعتماد القياسي',
      steps: steps as unknown as Prisma.InputJsonValue,
      currentStep: 0,
      submittedById: ownerId,
      submittedAt: addDays(publishedAt, -2),
      dueAt: addDays(publishedAt, 3),
      completedAt: addDays(publishedAt, -1),
      tasks: {
        create: [
          {
            stepIndex: 0,
            assigneeId: ownerId,
            status: 'APPROVED',
            decidedAt: addDays(publishedAt, -1),
          },
        ],
      },
    },
  });
  await prisma.$transaction((tx) =>
    createPublication(tx, {
      type,
      id: id,
      reviewId: r.id,
      actorId: ownerId,
      label: 'v1.0',
      publishedAt,
      nextReviewAt: addDays(publishedAt, 365),
    }),
  );
}

async function createProcess(
  prisma: PrismaClient,
  data: {
    code: string;
    nameEn: string;
    nameAr: string;
    descriptionEn: string;
    descriptionAr: string;
    category: 'CORE' | 'SUPPORT';
    departmentId: string | null;
    ownerId: string;
    xml: string;
  },
  publishedAt: Date,
) {
  const p = await prisma.process.create({
    data: {
      code: data.code,
      nameEn: data.nameEn,
      nameAr: data.nameAr,
      descriptionEn: data.descriptionEn,
      descriptionAr: data.descriptionAr,
      category: data.category,
      level: 1,
      sortOrder: 90,
      ownerId: data.ownerId,
      departmentId: data.departmentId,
      status: 'PUBLISHED',
      createdById: data.ownerId,
      updatedById: data.ownerId,
    },
  });
  await prisma.processModel.create({
    data: { processId: p.id, bpmnXml: data.xml, createdById: data.ownerId },
  });
  await prisma.processVersion.create({
    data: {
      processId: p.id,
      versionNumber: 1,
      bpmnXml: data.xml,
      changeNote: 'Executable version',
      label: 'v1.0',
      createdById: data.ownerId,
    },
  });
  await publish(prisma, 'PROCESS', p.id, data.ownerId, publishedAt);
  return p;
}

async function role(prisma: PrismaClient, nameEn: string, nameAr: string, userIds: string[]) {
  let r = await prisma.repoObject.findFirst({ where: { type: 'ROLE', nameEn, deletedAt: null } });
  r ??= await prisma.repoObject.create({
    data: {
      type: 'ROLE',
      nameEn,
      nameAr,
      descriptionEn: 'Workflow demo role',
      descriptionAr: 'دور تجريبي لسير العمل',
    },
  });
  for (const userId of userIds)
    await prisma.userJobRole.upsert({
      where: { userId_repoObjectId: { userId, repoObjectId: r.id } },
      create: { userId, repoObjectId: r.id },
      update: {},
    });
  return r.id;
}

export async function seedWorkflowDemo(
  prisma: PrismaClient,
  adminId: string | null,
  openApp: () => Promise<INestApplicationContext>,
): Promise<void> {
  if ((await prisma.workflowProcessConfig.count()) > 0) return;
  const users = await ensureUsers(prisma);
  if (!users) return;
  const dep = async (code: string) =>
    (await prisma.department.findFirst({ where: { code } }))?.id ?? null;
  const [prc, exe, fin] = await Promise.all([dep('PRC'), dep('EXE'), dep('FIN')]);
  // Department heads: the "requester's manager" rule.
  if (prc) await prisma.department.update({ where: { id: prc }, data: { managerId: users.owner } });
  if (exe) await prisma.department.update({ where: { id: exe }, data: { managerId: users.dgo } });
  if (fin)
    await prisma.department.update({ where: { id: fin }, data: { managerId: users.finance } });
  const hrDep = await dep('HR');
  if (hrDep)
    await prisma.department.update({ where: { id: hrDep }, data: { managerId: users.hr } });

  const now = new Date();
  const published = addDays(now, -45);
  const ids = {
    sectionManagerRoleId: await role(prisma, 'Section Manager', 'رئيس قسم', [users.section]),
    pmoRoleId: await role(prisma, 'PMO Officer', 'موظف مكتب إدارة المشاريع', [
      users.pmo,
      users.performance,
    ]),
    financeRoleId: await role(prisma, 'Budget Approver', 'معتمد الميزانية', [users.finance]),
    dgoRoleId: await role(prisma, 'Director General Office', 'مكتب المدير العام', [users.dgo]),
    dmnDiagramId: '',
  };
  const hrRoleId = await role(prisma, 'HR Officer', 'موظف الموارد البشرية', [users.hr]);

  // DMN decision (published) used by the business rule task.
  const dmnCount = await prisma.diagram.count({ where: { type: 'DMN' } });
  const dmn = await prisma.diagram.create({
    data: {
      type: 'DMN',
      code: `DMN-${String(dmnCount + 1).padStart(3, '0')}`,
      nameEn: 'Program budget approval',
      nameAr: 'اعتماد ميزانية البرنامج',
      descriptionEn:
        'Programs with an estimated budget of AED 100,000 or more need a separate budget approval.',
      descriptionAr:
        'تحتاج البرامج ذات الميزانية التقديرية 100,000 درهم فأكثر إلى موافقة مستقلة على الميزانية.',
      ownerId: users.owner,
      departmentId: fin,
      status: 'PUBLISHED',
      content: BUDGET_DMN,
      createdById: users.owner,
    },
  });
  await prisma.diagramVersion.create({
    data: {
      diagramId: dmn.id,
      versionNumber: 1,
      content: BUDGET_DMN,
      changeNote: 'Budget threshold AED 100,000',
      label: 'v1.0',
      createdById: users.owner,
    },
  });
  await publish(prisma, 'DIAGRAM', dmn.id, users.owner, published);
  ids.dmnDiagramId = dmn.id;

  const pms = await createProcess(
    prisma,
    {
      code: 'PMS-01',
      nameEn: 'Program / Initiative Request & Approval',
      nameAr: 'طلب برنامج / مبادرة واعتماده',
      descriptionEn:
        'Request a new program or initiative: section manager, department manager, budget approval for AED 100,000 or more, PMO review and DG Office approval; the approval letter is generated automatically.',
      descriptionAr:
        'طلب برنامج أو مبادرة جديدة: رئيس القسم ومدير الإدارة واعتماد الميزانية لمبلغ 100,000 درهم فأكثر ومراجعة مكتب المشاريع وموافقة مكتب المدير العام؛ ويُنشأ خطاب الموافقة تلقائياً.',
      category: 'CORE',
      departmentId: exe,
      ownerId: users.owner,
      xml: pmsProgramRequestXml(ids),
    },
    published,
  );
  const leave = await createProcess(
    prisma,
    {
      code: 'HR-01',
      nameEn: 'Leave request',
      nameAr: 'طلب إجازة',
      descriptionEn:
        'Request annual, sick or unpaid leave; your manager approves, HR reviews leave of more than 10 working days.',
      descriptionAr:
        'اطلب إجازة سنوية أو مرضية أو بدون راتب؛ يوافق مديرك وتراجع الموارد البشرية الإجازات الأطول من 10 أيام عمل.',
      category: 'SUPPORT',
      departmentId: hrDep,
      ownerId: users.hr,
      xml: leaveRequestXml(hrRoleId),
    },
    published,
  );

  // Executable + deployed (like WorkflowConfigService.deploy, without the HTTP layer).
  const deploy = async (
    processId: string,
    prefix: string,
    xml: string,
    decisions: Record<string, string>,
  ) => {
    await prisma.workflowProcessConfig.create({
      data: {
        processId,
        enabled: true,
        casePrefix: prefix,
        eventLog: true,
        createdById: adminId,
        updatedById: adminId,
      },
    });
    const def = await prisma.workflowDefinition.create({
      data: {
        processId,
        versionNumber: 1,
        versionLabel: 'v1.0',
        bpmnXml: xml,
        model: readWorkflowModel(xml) as unknown as Prisma.InputJsonValue,
        decisions,
        deployedById: adminId,
        deployedAt: addDays(published, 1),
      },
    });
    await prisma.workflowProcessConfig.update({
      where: { processId },
      data: { activeDefinitionId: def.id },
    });
  };
  const pmsXml = pmsProgramRequestXml(ids);
  if (!readDecisionTables(BUDGET_DMN).length) throw new Error('DMN demo broken');
  await deploy(pms.id, 'PMS', pmsXml, { [`${dmn.id}:BudgetApproval`]: BUDGET_DMN });
  await deploy(leave.id, 'LEAVE', leaveRequestXml(hrRoleId), {});

  // Demo cases through the real services.
  const app = await openApp();
  try {
    const { WorkflowCasesService } = await import('../src/workflow/workflow-cases.service');
    const { WorkflowTasksService } = await import('../src/workflow/workflow-tasks.service');
    const { WorkflowEventLogService } = await import('../src/workflow/workflow-event-log.service');
    const cases = app.get(WorkflowCasesService);
    const tasks = app.get(WorkflowTasksService);
    const eventLog = app.get(WorkflowEventLogService);
    await eventLog.ensureLog(pms.id, adminId);
    await eventLog.ensureLog(leave.id, adminId);
    const as = (id: string) => authUser(prisma, id);
    const viewer = await as(users.viewer);
    const meta = { ip: null, userAgent: 'seed' };
    const act = async (
      caseId: string,
      userId: string,
      decision: 'APPROVE' | 'REJECT' | 'RETURN' | null,
      data: Record<string, unknown> = {},
      comment = '',
    ) => {
      const u = await as(userId);
      const open = await prisma.workflowTask.findFirst({
        where: {
          caseId,
          status: 'OPEN',
          OR: [{ assigneeId: userId }, { candidates: { some: { userId } } }],
        },
      });
      if (!open) throw new Error(`No open task for ${u.email} in ${caseId}`);
      await tasks.complete(open.id, { data, decision, comment, version: open.version }, u, meta);
    };
    const pmsStart = (
      programName: string,
      programType: string,
      estimatedBudget: number,
      justification: string,
    ) =>
      cases.start(
        pms.id,
        { programName, programType, estimatedBudget, requestingDepartment: prc, justification },
        [],
        viewer,
        meta,
      );

    const shifts: { id: string; days: number }[] = [];
    // 1. Completed: all approvals incl. the budget approval (≥ AED 100,000).
    const c1 = await pmsStart(
      'Smart permits portal',
      'digital',
      250000,
      'Citizens apply for permits online; processing time from 10 to 3 days.',
    );
    await act(c1.id, users.section, 'APPROVE', {
      sectionNotes: 'Aligned with the digital strategy.',
    });
    await act(c1.id, users.owner, 'APPROVE', { departmentNotes: 'Approved for this year.' });
    await act(c1.id, users.finance, 'APPROVE', { budgetNotes: 'Budget line 4-120 confirmed.' });
    await act(c1.id, users.pmo, 'APPROVE', { pmoNotes: 'Registered as initiative INI-2026-07.' });
    await act(c1.id, users.dgo, 'APPROVE', {}, 'Approved.');
    shifts.push({ id: c1.id, days: 30 });
    // 2. Below AED 100,000: waiting for the PMO group (unclaimed).
    const c2 = await pmsStart(
      'Records digitisation',
      'digital',
      60000,
      'Scan and index 40,000 paper files.',
    );
    await act(c2.id, users.section, 'APPROVE');
    await act(c2.id, users.owner, 'APPROVE');
    shifts.push({ id: c2.id, days: 6 });
    // 3. Returned for correction to the requester.
    const c3 = await pmsStart(
      'Staff wellbeing programme',
      'non-digital',
      40000,
      'Quarterly wellbeing sessions.',
    );
    await act(
      c3.id,
      users.section,
      'RETURN',
      {},
      'Please add the expected participation and a cost breakdown.',
    );
    shifts.push({ id: c3.id, days: 4 });
    // 4. Waiting for the budget approval — overdue.
    const c4 = await pmsStart(
      'Enterprise data platform',
      'digital',
      480000,
      'Single data platform for reporting and AI use cases.',
    );
    await act(c4.id, users.section, 'APPROVE');
    await act(c4.id, users.owner, 'APPROVE');
    shifts.push({ id: c4.id, days: 12 });
    // 5. Rejected by the department manager.
    const c5 = await pmsStart(
      'Event sponsorship',
      'non-digital',
      90000,
      'Sponsor the regional innovation forum.',
    );
    await act(c5.id, users.section, 'APPROVE');
    await act(c5.id, users.owner, 'REJECT', {}, 'Not in this year’s priorities.');
    shifts.push({ id: c5.id, days: 20 });
    // Leave requests: one completed (short), one waiting for the manager.
    const l1 = await cases.start(
      leave.id,
      {
        leaveType: 'annual',
        firstDay: addDays(now, -10).toISOString().slice(0, 10),
        days: 3,
        reason: 'Family visit',
      },
      [],
      viewer,
      meta,
    );
    await act(l1.id, users.owner, 'APPROVE');
    shifts.push({ id: l1.id, days: 14 });
    const l2 = await cases.start(
      leave.id,
      {
        leaveType: 'annual',
        firstDay: addDays(now, 20).toISOString().slice(0, 10),
        days: 12,
        reason: 'Summer holiday',
      },
      [],
      viewer,
      meta,
    );
    shifts.push({ id: l2.id, days: 1 });

    // Back-date each case (dates, timeline, tasks, live event log) so the dashboard has a history.
    for (const s of shifts) {
      const ms = s.days * 86_400_000;
      const back = (d: Date | null) => (d ? new Date(d.getTime() - ms) : d);
      const c = await prisma.workflowCase.findUniqueOrThrow({ where: { id: s.id } });
      await prisma.workflowCase.update({
        where: { id: s.id },
        data: { startedAt: back(c.startedAt)!, completedAt: back(c.completedAt) },
      });
      // Spread the steps: each later event is a little later than the previous one.
      const events = await prisma.workflowEvent.findMany({
        where: { caseId: s.id },
        orderBy: { at: 'asc' },
      });
      let i = 0;
      for (const e of events)
        await prisma.workflowEvent.update({
          where: { id: e.id },
          data: { at: new Date(back(e.at)!.getTime() + i++ * 3 * 3600_000) },
        });
      const tks = await prisma.workflowTask.findMany({
        where: { caseId: s.id },
        orderBy: { createdAt: 'asc' },
      });
      let j = 0;
      for (const t of tks) {
        const created = new Date(back(t.createdAt)!.getTime() + j * 5 * 3600_000);
        const done = t.completedAt ? new Date(created.getTime() + (8 + j * 7) * 3600_000) : null;
        await prisma.workflowTask.update({
          where: { id: t.id },
          data: {
            createdAt: created,
            completedAt: done,
            ...(t.dueAt ? { dueAt: new Date(created.getTime() + 2 * 86_400_000) } : {}),
          },
        });
        j++;
      }
      if (c.completedAt) {
        const last = tks.filter((t) => t.completedAt).at(-1);
        const end = last
          ? new Date(
              back(last.createdAt)!.getTime() + (tks.length - 1) * 5 * 3600_000 + 30 * 3600_000,
            )
          : back(c.completedAt);
        await prisma.workflowCase.update({ where: { id: s.id }, data: { completedAt: end } });
      }
      const log = await prisma.miningEvent.findMany({
        where: { caseId: c.number },
        orderBy: { endAt: 'asc' },
      });
      let k = 0;
      for (const ev of log) {
        const end = new Date(back(ev.endAt)!.getTime() + k * 5 * 3600_000 + 8 * 3600_000);
        await prisma.miningEvent.update({
          where: { id: ev.id },
          data: {
            endAt: end,
            startAt: ev.startAt ? new Date(end.getTime() - (6 + k) * 3600_000) : null,
          },
        });
        k++;
      }
    }
    // Reminder / escalation jobs follow the shifted due dates.
    for (const t of await prisma.workflowTask.findMany({
      where: { status: 'OPEN', dueAt: { not: null } },
    }))
      await prisma.workflowJob.updateMany({
        where: { caseId: t.caseId, tokenId: t.tokenId, kind: 'ESCALATE', status: 'PENDING' },
        data: { dueAt: t.dueAt! },
      });
    for (const log of await prisma.eventLog.findMany({ where: { source: 'WORKFLOW' } })) {
      const range = await prisma.miningEvent.aggregate({
        where: { logId: log.id },
        _min: { startAt: true, endAt: true },
        _max: { endAt: true },
      });
      await prisma.eventLog.update({
        where: { id: log.id },
        data: { periodStart: range._min.startAt ?? range._min.endAt, periodEnd: range._max.endAt },
      });
      await eventLog.recount(log.id);
    }
    console.log('Seeded workflow execution demo: PMS-01 and HR-01 executable with 7 demo cases.');
  } finally {
    await app.close();
  }
}
