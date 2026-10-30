/**
 * Phase 3 demo data: demo users for each role, approval workflows and content in every
 * lifecycle state (draft, in review, approved, published, archived, changes requested), with
 * comments, notifications, an overdue review, portal settings and feedback.
 * Runs only on a demo installation (no workflows yet and the demo processes present).
 */
import { type Prisma, type PrismaClient } from '@prisma/client';
import {
  SETTING_KEYS,
  addDays,
  addMonths,
  mentionToken,
  type ContentType,
  type SystemRoleKey,
} from '@processhub/shared';
import { hashPassword } from '../src/auth/argon';
import { createPublication, type StepSnapshot } from '../src/governance/publication';
import { linearXml } from './demo-diagrams';

const DEMO_USERS: {
  key: 'viewer' | 'reviewer' | 'owner' | 'modeler' | 'auditor' | 'risk';
  role: SystemRoleKey;
  nameEn: string;
  nameAr: string;
  department: string;
}[] = [
  {
    key: 'viewer',
    role: 'VIEWER',
    nameEn: 'Noura Viewer',
    nameAr: 'نورة المشاهدة',
    department: 'PRC',
  },
  {
    key: 'reviewer',
    role: 'REVIEWER',
    nameEn: 'Rami Reviewer',
    nameAr: 'رامي المراجع',
    department: 'RSK',
  },
  {
    key: 'owner',
    role: 'PROCESS_OWNER',
    nameEn: 'Omar Owner',
    nameAr: 'عمر المالك',
    department: 'PRC',
  },
  {
    key: 'modeler',
    role: 'MODELER',
    nameEn: 'Maha Modeler',
    nameAr: 'مها المصممة',
    department: 'IT',
  },
  {
    key: 'auditor',
    role: 'AUDITOR',
    nameEn: 'Adel Auditor',
    nameAr: 'عادل المدقق',
    department: 'RSK',
  },
  {
    key: 'risk',
    role: 'RISK_OFFICER',
    nameEn: 'Rana Risk Officer',
    nameAr: 'رنا مسؤولة المخاطر',
    department: 'RSK',
  },
];

export type DemoUsers = Record<(typeof DEMO_USERS)[number]['key'], string>;

/** Demo users (one per role) with the password from SEED_DEMO_PASSWORD; never overwritten. */
export async function ensureDemoUsers(prisma: PrismaClient): Promise<DemoUsers | null> {
  const password = process.env.SEED_DEMO_PASSWORD || 'Demo-Password1';
  const domain = process.env.SEED_DEMO_EMAIL_DOMAIN || 'processhub.local';
  const hash = await hashPassword(password);
  const ids: Partial<DemoUsers> = {};
  let created = 0;
  for (const u of DEMO_USERS) {
    const email = `${u.key}@${domain}`;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      ids[u.key] = existing.id;
      continue;
    }
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
    await prisma.auditLog.create({
      data: {
        action: 'CREATE',
        entityType: 'User',
        entityId: user.id,
        summary: { seed: true, email },
      },
    });
    ids[u.key] = user.id;
    created++;
  }
  if (created)
    console.log(
      `Created ${created} demo users (${DEMO_USERS.map((u) => `${u.key}@${domain}`).join(', ')}).`,
    );
  return ids as DemoUsers;
}

/** SMTP settings for a local mail catcher (Mailpit in Docker Compose), when configured. */
export async function ensureDemoEmailSettings(prisma: PrismaClient): Promise<void> {
  const host = process.env.SEED_SMTP_HOST;
  if (!host || (await prisma.setting.findUnique({ where: { key: SETTING_KEYS.EMAIL } }))) return;
  await prisma.setting.create({
    data: {
      key: SETTING_KEYS.EMAIL,
      value: {
        enabled: true,
        host,
        port: Number(process.env.SEED_SMTP_PORT || 1025),
        secure: false,
        username: '',
        passwordSealed: null,
        fromAddress: process.env.SEED_SMTP_FROM || 'processhub@processhub.local',
        fromName: 'ProcessHub',
      },
    },
  });
  console.log(`Email settings point to ${host} (local mail catcher).`);
}

const days = (n: number) => addDays(new Date(), n);

export async function seedGovernanceDemo(
  prisma: PrismaClient,
  adminId: string | null,
): Promise<void> {
  const users = await ensureDemoUsers(prisma);
  if (!users || !adminId) return;
  if ((await prisma.workflow.count()) > 0) {
    console.log('Workflows exist — skipping governance demo data.');
    return;
  }
  const proc = async (code: string) =>
    prisma.process.findFirst({ where: { code, deletedAt: null } });
  const codes = [
    'S.01',
    'S.01.01',
    'S.02',
    'C.01',
    'C.01.01',
    'C.02',
    'C.03',
    'M.01',
    'M.02',
  ] as const;
  const p = Object.fromEntries(
    await Promise.all(codes.map(async (c) => [c, await proc(c)] as const)),
  );
  const pageByTitle = async (titleEn: string) =>
    prisma.page.findFirst({ where: { titleEn, deletedAt: null } });
  const titles = {
    manual: 'Quality Manual',
    docControl: 'Document Control Procedure',
    requisition: 'Purchase Requisition Procedure',
    onboarding: 'Customer Onboarding Work Instruction',
    security: 'Information Security Policy',
    acceptable: 'Acceptable Use Policy',
    serviceDesk: 'IT Service Desk Guide',
  };
  const pg = Object.fromEntries(
    await Promise.all(
      Object.entries(titles).map(async ([k, t]) => [k, await pageByTitle(t)] as const),
    ),
  );
  if (Object.values(p).some((x) => !x) || Object.values(pg).some((x) => !x)) {
    console.log('Demo processes or pages not found — skipping governance demo data.');
    return;
  }
  const P = p as Record<(typeof codes)[number], NonNullable<Awaited<ReturnType<typeof proc>>>>;
  const G = pg as Record<keyof typeof titles, NonNullable<Awaited<ReturnType<typeof pageByTitle>>>>;
  const [qm, itp] = await Promise.all([
    prisma.space.findUniqueOrThrow({ where: { key: 'QM' } }),
    prisma.space.findUniqueOrThrow({ where: { key: 'ITP' } }),
  ]);

  // ----- Workflows and settings -----
  const standard = await prisma.workflow.create({
    data: {
      nameEn: 'Standard approval (two steps)',
      nameAr: 'الاعتماد القياسي (مرحلتان)',
      descriptionEn: 'Quality review by any reviewer, then approval by the process owner.',
      descriptionAr: 'مراجعة الجودة من أي مراجع، ثم اعتماد مالك العملية.',
      steps: [
        {
          nameEn: 'Quality review',
          nameAr: 'مراجعة الجودة',
          rule: 'ANY',
          assignees: [{ type: 'ROLE', roleKey: 'REVIEWER' }],
        },
        {
          nameEn: 'Owner approval',
          nameAr: 'اعتماد المالك',
          rule: 'ANY',
          assignees: [{ type: 'OWNER' }],
        },
      ],
      createdById: adminId,
      updatedById: adminId,
    },
  });
  const docReview = await prisma.workflow.create({
    data: {
      nameEn: 'Policy review (any one reviewer)',
      nameAr: 'مراجعة السياسات (أي مراجع)',
      descriptionEn: 'One approval from any reviewer is enough.',
      descriptionAr: 'تكفي موافقة واحدة من أي مراجع.',
      steps: [
        {
          nameEn: 'Review',
          nameAr: 'مراجعة',
          rule: 'ANY',
          assignees: [
            { type: 'ROLE', roleKey: 'REVIEWER' },
            { type: 'USER', userId: adminId },
          ],
        },
      ],
      createdById: adminId,
      updatedById: adminId,
    },
  });
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.GOVERNANCE },
    create: {
      key: SETTING_KEYS.GOVERNANCE,
      value: {
        reviewIntervalMonths: 12,
        reminderDays: 30,
        reviewDueDays: 5,
        defaultWorkflowId: standard.id,
        categoryWorkflows: { MANAGEMENT: null, CORE: null, SUPPORT: null },
      },
    },
    update: {},
  });
  await prisma.space.update({ where: { id: qm.id }, data: { workflowId: standard.id } });
  await prisma.space.update({ where: { id: itp.id }, data: { workflowId: docReview.id } });

  // ----- Owners -----
  for (const code of [
    'S.01',
    'S.01.01',
    'S.02',
    'C.01',
    'C.01.01',
    'C.02',
    'C.03',
    'M.01',
  ] as const) {
    await prisma.process.update({ where: { id: P[code].id }, data: { ownerId: users.owner } });
    P[code].ownerId = users.owner;
  }
  await prisma.page.update({ where: { id: G.requisition.id }, data: { ownerId: users.owner } });
  G.requisition.ownerId = users.owner;
  const requester = await prisma.repoObject.findFirst({ where: { code: 'R-01', type: 'ROLE' } });
  if (requester) {
    await prisma.userJobRole.createMany({
      data: [{ userId: users.viewer, repoObjectId: requester.id }],
      skipDuplicates: true,
    });
  }

  // ----- Models for processes that have none -----
  const ensureModel = async (code: (typeof codes)[number], xml: string, at: Date) => {
    const id = P[code].id;
    if (await prisma.processVersion.count({ where: { processId: id } })) return;
    await prisma.processModel.create({
      data: { processId: id, bpmnXml: xml, createdById: users.modeler, updatedById: users.modeler },
    });
    await prisma.processVersion.create({
      data: {
        processId: id,
        versionNumber: 1,
        bpmnXml: xml,
        changeNote: 'Initial version',
        createdAt: at,
        createdById: users.modeler,
      },
    });
  };
  await ensureModel(
    'S.01',
    linearXml(
      'ProcureToPay',
      { en: 'Need for goods or services', ar: 'الحاجة إلى سلع أو خدمات' },
      [
        {
          id: 'Call_Requisition',
          type: 'callActivity',
          en: 'Purchase requisition',
          ar: 'طلب الشراء',
          linkedProcessId: P['S.01.01'].id,
          descEn: 'See the sub-process S.01.01.',
          descAr: 'انظر العملية الفرعية S.01.01.',
        },
        {
          id: 'Task_Receive',
          en: 'Receive goods',
          ar: 'استلام البضائع',
          descEn: 'The warehouse checks the delivery against the purchase order.',
          descAr: 'يتحقق المستودع من التوريد مقابل أمر الشراء.',
        },
        {
          id: 'Task_Invoice',
          en: 'Match invoice',
          ar: 'مطابقة الفاتورة',
          descEn: 'Three-way match of order, receipt and invoice.',
          descAr: 'مطابقة ثلاثية بين أمر الشراء والاستلام والفاتورة.',
        },
        { id: 'Task_Pay', type: 'serviceTask', en: 'Pay supplier', ar: 'الدفع للمورد' },
      ],
      { en: 'Supplier paid', ar: 'تم الدفع للمورد' },
    ),
    days(-120),
  );
  await ensureModel(
    'C.01.01',
    linearXml(
      'IdentityVerification',
      { en: 'Verification requested', ar: 'طلب التحقق' },
      [
        {
          id: 'Task_Docs',
          en: 'Check identity documents',
          ar: 'فحص وثائق الهوية',
          descEn: 'Compare the ID with the application and check its validity.',
          descAr: 'مطابقة الهوية مع الطلب والتحقق من صلاحيتها.',
        },
        {
          id: 'Task_Screen',
          type: 'serviceTask',
          en: 'Screen against watch lists',
          ar: 'الفحص مقابل قوائم المراقبة',
        },
        { id: 'Task_Decide', en: 'Record KYC decision', ar: 'تسجيل قرار اعرف عميلك' },
      ],
      { en: 'Customer verified', ar: 'تم التحقق من العميل' },
    ),
    days(-100),
  );
  const simple = (key: string, en: string, ar: string) =>
    linearXml(
      key,
      { en: 'Start', ar: 'البداية' },
      [
        { id: 'Task_1', en: `Prepare ${en.toLowerCase()}`, ar: `إعداد ${ar}` },
        { id: 'Task_2', en: `Review ${en.toLowerCase()}`, ar: `مراجعة ${ar}` },
        { id: 'Task_3', en: 'Communicate results', ar: 'إبلاغ النتائج' },
      ],
      { en: 'Done', ar: 'تم' },
    );
  await ensureModel('C.02', simple('OrderToCash', 'Order', 'الطلب'), days(-20));
  await ensureModel('C.03', simple('ServiceDelivery', 'Service plan', 'خطة الخدمة'), days(-30));
  await ensureModel(
    'M.01',
    simple('StrategicPlanning', 'Strategic plan', 'الخطة الاستراتيجية'),
    days(-420),
  );
  await ensureModel(
    'M.02',
    simple('Performance', 'Performance report', 'تقرير الأداء'),
    days(-300),
  );
  await ensureModel('S.02', simple('HireToRetire', 'Job requisition', 'طلب التوظيف'), days(-15));

  // ----- Reviews and publications -----
  const stepsFor = (ownerId: string | null, workflow: 'standard' | 'doc'): StepSnapshot[] =>
    workflow === 'doc'
      ? [
          {
            nameEn: 'Review',
            nameAr: 'مراجعة',
            rule: 'ANY',
            assigneeIds: [users.reviewer, adminId],
            approvedBySubmitter: false,
          },
        ]
      : [
          {
            nameEn: 'Quality review',
            nameAr: 'مراجعة الجودة',
            rule: 'ANY',
            assigneeIds: [users.reviewer],
            approvedBySubmitter: false,
          },
          {
            nameEn: 'Owner approval',
            nameAr: 'اعتماد المالك',
            rule: 'ANY',
            assigneeIds: [ownerId ?? adminId],
            approvedBySubmitter: false,
          },
        ];

  interface ReviewDef {
    type: ContentType;
    id: string;
    ownerId: string | null;
    version: number;
    workflow?: 'standard' | 'doc';
    /** Decisions per step: approved steps, then the open / final one. */
    decided: number;
    outcome: 'IN_PROGRESS' | 'APPROVED' | 'CHANGES_REQUESTED';
    submittedAt: Date;
    dueAt?: Date;
    comment?: string;
    note?: string;
  }
  const review = async (d: ReviewDef) => {
    const wf = d.workflow ?? 'standard';
    const steps = stepsFor(d.ownerId, wf);
    const w = wf === 'doc' ? docReview : standard;
    const completedAt = d.outcome === 'IN_PROGRESS' ? null : addDays(d.submittedAt, d.decided + 1);
    const r = await prisma.review.create({
      data: {
        entityType: d.type,
        entityId: d.id,
        versionNumber: d.version,
        status: d.outcome,
        workflowId: w.id,
        workflowNameEn: w.nameEn,
        workflowNameAr: w.nameAr,
        steps: steps as unknown as Prisma.InputJsonValue,
        currentStep: Math.min(d.decided, steps.length - 1),
        note: d.note ?? '',
        submittedById: users.modeler,
        submittedAt: d.submittedAt,
        dueAt: d.dueAt ?? addDays(d.submittedAt, 5),
        completedAt,
      },
    });
    for (let i = 0; i <= Math.min(d.decided, steps.length - 1); i++) {
      const done = i < d.decided;
      const last = i === d.decided;
      const status =
        done || (d.outcome === 'APPROVED' && last)
          ? 'APPROVED'
          : d.outcome === 'CHANGES_REQUESTED' && last
            ? 'CHANGES_REQUESTED'
            : 'PENDING';
      for (const assigneeId of steps[i].assigneeIds) {
        const decider = assigneeId === steps[i].assigneeIds[0];
        await prisma.reviewTask.create({
          data: {
            reviewId: r.id,
            stepIndex: i,
            assigneeId,
            status: status === 'PENDING' ? 'PENDING' : decider ? status : 'SKIPPED',
            comment: status === 'CHANGES_REQUESTED' && decider ? (d.comment ?? null) : null,
            decidedAt: status !== 'PENDING' && decider ? addDays(d.submittedAt, i + 1) : null,
            createdAt: addDays(d.submittedAt, i),
          },
        });
      }
    }
    return r;
  };

  const setStatus = (
    type: ContentType,
    id: string,
    status: Prisma.ProcessUpdateInput['status'] & string,
  ) =>
    type === 'PROCESS'
      ? prisma.process.update({ where: { id }, data: { status } })
      : prisma.page.update({ where: { id }, data: { status } });

  const publish = async (
    type: ContentType,
    id: string,
    ownerId: string | null,
    version: number,
    publishedAt: Date,
    opts: { workflow?: 'standard' | 'doc'; label?: string; nextReviewAt?: Date } = {},
  ) => {
    const r = await review({
      type,
      id,
      ownerId,
      version,
      workflow: opts.workflow,
      decided: opts.workflow === 'doc' ? 0 : 1,
      outcome: 'APPROVED',
      submittedAt: addDays(publishedAt, -4),
    });
    await prisma.$transaction((tx) =>
      createPublication(tx, {
        type,
        id,
        reviewId: r.id,
        actorId: ownerId ?? adminId,
        label: opts.label,
        publishedAt,
        nextReviewAt: opts.nextReviewAt ?? addMonths(publishedAt, 12),
      }),
    );
    await setStatus(type, id, 'PUBLISHED');
    return r;
  };

  // Processes
  await publish('PROCESS', P['S.01'].id, users.owner, 1, days(-90), { label: 'v1.0' });
  await publish('PROCESS', P['C.01'].id, users.owner, 1, days(-80), { label: 'v1.0' });
  await publish('PROCESS', P['C.01.01'].id, users.owner, 1, days(-80), { label: 'v1.0' });
  // Purchase Requisition: v1 is published, v2 (budget check) is in review — compare v1 → v2.
  await publish('PROCESS', P['S.01.01'].id, users.owner, 1, days(-200));
  const reqReview = await review({
    type: 'PROCESS',
    id: P['S.01.01'].id,
    ownerId: users.owner,
    version: 2,
    decided: 0,
    outcome: 'IN_PROGRESS',
    submittedAt: days(-1),
    note: 'Adds the automatic budget check requested by Finance.',
  });
  await setStatus('PROCESS', P['S.01.01'].id, 'IN_REVIEW');
  // Order to Cash: step 1 approved, owner approval pending and overdue.
  const otcReview = await review({
    type: 'PROCESS',
    id: P['C.02'].id,
    ownerId: users.owner,
    version: 1,
    decided: 1,
    outcome: 'IN_PROGRESS',
    submittedAt: days(-9),
    dueAt: days(-4),
  });
  // The overdue reminder below was already sent.
  await prisma.review.update({
    where: { id: otcReview.id },
    data: { overdueNotifiedAt: days(-3) },
  });
  await setStatus('PROCESS', P['C.02'].id, 'IN_REVIEW');
  // Service Delivery: approved, waiting to be published.
  await review({
    type: 'PROCESS',
    id: P['C.03'].id,
    ownerId: users.owner,
    version: 1,
    decided: 1,
    outcome: 'APPROVED',
    submittedAt: days(-6),
  });
  await setStatus('PROCESS', P['C.03'].id, 'APPROVED');
  // Strategic Planning: published 13 months ago — the periodic review is overdue.
  await publish('PROCESS', P['M.01'].id, users.owner, 1, days(-400), {
    label: 'v1.0',
    nextReviewAt: days(-35),
  });
  // Performance Management: published, then archived.
  await publish('PROCESS', P['M.02'].id, adminId, 1, days(-280));
  await prisma.publication.updateMany({
    where: { entityId: P['M.02'].id, current: true },
    data: { current: false, endedAt: days(-10) },
  });
  await setStatus('PROCESS', P['M.02'].id, 'ARCHIVED');
  // Hire to Retire: changes requested.
  await review({
    type: 'PROCESS',
    id: P['S.02'].id,
    ownerId: users.owner,
    version: 1,
    decided: 0,
    outcome: 'CHANGES_REQUESTED',
    submittedAt: days(-3),
    comment: 'Please add the probation review step and link the HR system.',
  });

  // Pages
  const pageVersion = async (id: string) =>
    (await prisma.page.findUniqueOrThrow({ where: { id } })).version;
  await publish('PAGE', G.manual.id, adminId, await pageVersion(G.manual.id), days(-150), {
    label: 'Issue 3',
  });
  await publish(
    'PAGE',
    G.requisition.id,
    users.owner,
    await pageVersion(G.requisition.id),
    days(-60),
  );
  await publish('PAGE', G.onboarding.id, adminId, await pageVersion(G.onboarding.id), days(-75));
  await publish('PAGE', G.security.id, adminId, await pageVersion(G.security.id), days(-340), {
    workflow: 'doc',
    label: '2025',
    nextReviewAt: days(20),
  });
  await publish('PAGE', G.serviceDesk.id, adminId, await pageVersion(G.serviceDesk.id), days(-45), {
    workflow: 'doc',
  });
  const docReviewRow = await review({
    type: 'PAGE',
    id: G.docControl.id,
    ownerId: adminId,
    version: await pageVersion(G.docControl.id),
    decided: 0,
    outcome: 'IN_PROGRESS',
    submittedAt: days(-2),
  });
  await setStatus('PAGE', G.docControl.id, 'IN_REVIEW');
  await review({
    type: 'PAGE',
    id: G.acceptable.id,
    ownerId: adminId,
    version: await pageVersion(G.acceptable.id),
    workflow: 'doc',
    decided: 0,
    outcome: 'APPROVED',
    submittedAt: days(-5),
  });
  await setStatus('PAGE', G.acceptable.id, 'APPROVED');

  // ----- Comments -----
  const ownerName = 'Omar Owner';
  const root = await prisma.comment.create({
    data: {
      entityType: 'PROCESS',
      entityId: P['S.01.01'].id,
      bpmnElementId: 'Task_Approve',
      body: `${mentionToken(ownerName, users.owner)} should the approval limits be part of this step? Requests above 50,000 need the CFO.`,
      mentionIds: [users.owner],
      createdById: users.reviewer,
      createdAt: days(-1),
    },
  });
  await prisma.comment.create({
    data: {
      entityType: 'PROCESS',
      entityId: P['S.01.01'].id,
      parentId: root.id,
      bpmnElementId: 'Task_Approve',
      body: 'Good point — I will add the limits to the step description.',
      createdById: users.owner,
      createdAt: days(0),
    },
  });
  await prisma.comment.create({
    data: {
      entityType: 'PROCESS',
      entityId: P['S.01.01'].id,
      body: 'The budget check was added as Finance asked in the last review.',
      createdById: users.modeler,
      createdAt: days(-2),
      resolvedAt: days(-1),
      resolvedById: users.owner,
    },
  });
  await prisma.comment.create({
    data: {
      entityType: 'PAGE',
      entityId: G.docControl.id,
      body: 'Section 4 should mention the retention period for obsolete documents.',
      createdById: users.reviewer,
      createdAt: days(-1),
    },
  });

  // ----- Feedback from the portal -----
  await prisma.feedback.create({
    data: {
      entityType: 'PROCESS',
      entityId: P['S.01.01'].id,
      kind: 'IMPROVEMENT',
      message: 'Please show the approval limits in the process — I never know who has to approve.',
      assigneeId: users.owner,
      createdById: users.viewer,
      createdAt: days(-3),
    },
  });
  await prisma.feedback.create({
    data: {
      entityType: 'PAGE',
      entityId: G.security.id,
      kind: 'OUTDATED',
      message: 'The password section still mentions changing passwords every 90 days.',
      status: 'DONE',
      reply: 'Thanks — the 2026 revision removes forced rotation. It is published next month.',
      repliedAt: days(-5),
      repliedById: adminId,
      assigneeId: adminId,
      createdById: users.viewer,
      createdAt: days(-12),
    },
  });

  // ----- Notifications (as the workflow would have created them) -----
  const item = (x: {
    nameEn?: string;
    nameAr?: string;
    titleEn?: string;
    titleAr?: string;
    code?: string;
  }) => ({
    titleEn: x.nameEn ?? x.titleEn ?? '',
    titleAr: x.nameAr ?? x.titleAr ?? '',
    ...(x.code ? { code: x.code } : {}),
  });
  const actor = (nameEn: string, nameAr: string) => ({ actorEn: nameEn, actorAr: nameAr });
  const modelerActor = actor('Maha Modeler', 'مها المصممة');
  const n = (
    userId: string,
    type: string,
    entityType: ContentType,
    entityId: string,
    params: Record<string, string | number>,
    link: string,
    createdAt: Date,
    actorId: string | null,
    read = false,
    // Same keys as the reminder scheduler, so it does not send these again.
    dedupeKey: string | null = null,
  ) =>
    prisma.notification.create({
      data: {
        userId,
        type,
        entityType,
        entityId,
        params,
        link,
        createdAt,
        actorId,
        readAt: read ? createdAt : null,
        dedupeKey,
      },
    });
  const reqLink = `/processes/${P['S.01.01'].id}`;
  await n(
    users.reviewer,
    'REVIEW_REQUESTED',
    'PROCESS',
    P['S.01.01'].id,
    {
      ...item(P['S.01.01']),
      ...modelerActor,
      version: 2,
      stepEn: 'Quality review',
      stepAr: 'مراجعة الجودة',
    },
    `/reviews/${reqReview.id}`,
    days(-1),
    users.modeler,
  );
  await n(
    users.reviewer,
    'REVIEW_REQUESTED',
    'PAGE',
    G.docControl.id,
    {
      ...item(G.docControl),
      ...modelerActor,
      version: G.docControl.version,
      stepEn: 'Quality review',
      stepAr: 'مراجعة الجودة',
    },
    `/reviews/${docReviewRow.id}`,
    days(-2),
    users.modeler,
  );
  await n(
    users.owner,
    'REVIEW_REQUESTED',
    'PROCESS',
    P['C.02'].id,
    {
      ...item(P['C.02']),
      ...actor('Rami Reviewer', 'رامي المراجع'),
      version: 1,
      stepEn: 'Owner approval',
      stepAr: 'اعتماد المالك',
    },
    `/reviews/${otcReview.id}`,
    days(-8),
    users.reviewer,
    true,
  );
  await n(
    users.owner,
    'REVIEW_OVERDUE',
    'PROCESS',
    P['C.02'].id,
    { ...item(P['C.02']), due: days(-4).toISOString(), kind: 'task', version: 1 },
    `/reviews/${otcReview.id}`,
    days(-3),
    null,
    false,
    `REVIEW_OVERDUE:review:${otcReview.id}`,
  );
  await n(
    users.owner,
    'MENTIONED',
    'PROCESS',
    P['S.01.01'].id,
    {
      ...item(P['S.01.01']),
      ...actor('Rami Reviewer', 'رامي المراجع'),
      comment: `@${ownerName} should the approval limits be part of this step? Requests above 50,000 need the CFO.`,
    },
    `${reqLink}?tab=comments&element=Task_Approve`,
    days(-1),
    users.reviewer,
  );
  await n(
    users.owner,
    'REVIEW_OVERDUE',
    'PROCESS',
    P['M.01'].id,
    { ...item(P['M.01']), due: days(-35).toISOString(), kind: 'periodic' },
    `/processes/${P['M.01'].id}`,
    days(-34),
    null,
    false,
    `REVIEW_OVERDUE:PROCESS:${P['M.01'].id}:${days(-35).toISOString().slice(0, 10)}`,
  );
  await n(
    users.owner,
    'FEEDBACK_RECEIVED',
    'PROCESS',
    P['S.01.01'].id,
    {
      ...item(P['S.01.01']),
      ...actor('Noura Viewer', 'نورة المشاهدة'),
      kind: 'IMPROVEMENT',
      comment: 'Please show the approval limits in the process — I never know who has to approve.',
    },
    '/tasks?tab=feedback',
    days(-3),
    users.viewer,
  );
  await n(
    users.owner,
    'APPROVED',
    'PROCESS',
    P['C.03'].id,
    { ...item(P['C.03']), version: 1 },
    `/processes/${P['C.03'].id}`,
    days(-4),
    users.owner,
  );
  await n(
    users.modeler,
    'CHANGES_REQUESTED',
    'PROCESS',
    P['S.02'].id,
    {
      ...item(P['S.02']),
      ...actor('Rami Reviewer', 'رامي المراجع'),
      version: 1,
      comment: 'Please add the probation review step and link the HR system.',
    },
    `/processes/${P['S.02'].id}`,
    days(-2),
    users.reviewer,
  );
  await n(
    users.viewer,
    'FEEDBACK_UPDATED',
    'PAGE',
    G.security.id,
    {
      ...item(G.security),
      status: 'DONE',
      reply: 'Thanks — the 2026 revision removes forced rotation. It is published next month.',
    },
    '/portal/feedback',
    days(-5),
    adminId,
  );

  // ----- Portal -----
  await prisma.setting.upsert({
    where: { key: SETTING_KEYS.PORTAL },
    create: {
      key: SETTING_KEYS.PORTAL,
      value: {
        nameEn: 'Knowledge Portal',
        nameAr: 'بوابة المعرفة',
        taglineEn:
          'How we work — official processes, procedures and policies, always the approved version.',
        taglineAr: 'كيف نعمل — العمليات والإجراءات والسياسات الرسمية، دائماً بالإصدار المعتمد.',
        access: { mode: 'ALL', departmentIds: [], roleKeys: [] },
        quickLinks: [
          {
            titleEn: 'IT service desk',
            titleAr: 'مكتب خدمات تقنية المعلومات',
            url: `/portal/pages/${G.serviceDesk.id}`,
          },
          {
            titleEn: 'Information security',
            titleAr: 'أمن المعلومات',
            url: `/portal/pages/${G.security.id}`,
          },
          {
            titleEn: 'HR intranet',
            titleAr: 'بوابة الموارد البشرية',
            url: 'https://intranet.example.com/hr',
          },
        ],
        featured: [
          { entityType: 'PROCESS', entityId: P['S.01'].id },
          { entityType: 'PROCESS', entityId: P['C.01'].id },
          { entityType: 'PAGE', entityId: G.security.id },
        ],
      },
    },
    update: {},
  });

  console.log(
    'Seeded governance demo: 2 workflows, items in every lifecycle state, comments, notifications, feedback and portal settings.',
  );
}
