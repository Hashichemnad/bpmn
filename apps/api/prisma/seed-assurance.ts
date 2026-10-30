import type { Prisma, PrismaClient } from '@prisma/client';
import {
  CONCLUSION_EFFECTIVENESS,
  SETTING_KEYS,
  resolveGrcSettings,
  testPeriod,
  type QuestionnaireDefinition,
} from '@processhub/shared';

/**
 * Assurance demo data (Phase 4.2, demo installations only; runs once, after the GRC demo):
 * control test plans with one failed test → an issue with actions, an overdue and a planned test,
 * an audit engagement with two findings (one agreed → issue, one waiting for the response),
 * and a risk & control self-assessment campaign with two answers proposing new ratings.
 */
export async function seedAssuranceDemo(
  prisma: PrismaClient,
  adminId: string | null,
): Promise<void> {
  if ((await prisma.controlTestPlan.count()) > 0 || (await prisma.control.count()) === 0) return;
  const day = 86_400_000;
  const at = (n: number) => new Date(Date.now() + n * day);
  const dateOnly = (n: number) => new Date(`${at(n).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const user = async (prefix: string) =>
    (await prisma.user.findFirst({ where: { email: { startsWith: `${prefix}@` } } }))?.id ?? null;
  const [officer, owner, modeler, reviewer, auditor, internalAudit] = await Promise.all([
    user('risk'),
    user('owner'),
    user('modeler'),
    user('reviewer'),
    user('auditor'),
    user('audit'),
  ]);
  const actor = officer ?? adminId;
  const obj = async (code: string) =>
    (await prisma.repoObject.findFirst({ where: { code, deletedAt: null } }))?.id ?? null;
  const [ctl01, ctl02, ctl04, rsk01, rsk02, gpl12] = await Promise.all(
    ['CTL-01', 'CTL-02', 'CTL-04', 'RSK-01', 'RSK-02', 'GPL-12'].map(obj),
  );
  const purchasing = await prisma.process.findFirst({
    where: { code: 'S.01.01', deletedAt: null },
  });
  if (!ctl01 || !ctl02 || !rsk01 || !purchasing) return;

  // ----- Control testing -----
  const quotationSteps = [
    {
      en: 'Select purchase orders above SAR 50,000 from the ERP report.',
      ar: 'اختر أوامر الشراء التي تتجاوز 50,000 ريال من تقرير النظام.',
    },
    {
      en: 'Check that three written quotations are attached.',
      ar: 'تحقق من إرفاق ثلاثة عروض أسعار مكتوبة.',
    },
    {
      en: 'Check that the lowest compliant offer was chosen or the choice is justified.',
      ar: 'تحقق من اختيار أقل عرض مطابق أو تبرير الاختيار.',
    },
  ];
  const plan1 = await prisma.controlTestPlan.create({
    data: {
      controlId: ctl01,
      testType: 'OPERATING',
      procedure: quotationSteps,
      sampleSize: 5,
      frequency: 'QUARTERLY',
      testerId: owner,
      reviewerRoleKey: 'RISK_OFFICER',
      nextDueAt: dateOnly(75),
      leadDays: 30,
      createdById: actor,
      updatedById: actor,
    },
  });
  const plan2 = await prisma.controlTestPlan.create({
    data: {
      controlId: ctl02,
      testType: 'OPERATING',
      procedure: [
        {
          en: 'Re-perform the approval routing for the sampled requisitions.',
          ar: 'أعد تنفيذ توجيه الاعتماد للطلبات المختارة.',
        },
        {
          en: 'Compare the approver limit with the amount.',
          ar: 'قارن حد صلاحية المعتمد بالمبلغ.',
        },
      ],
      sampleSize: 2,
      frequency: 'SEMI_ANNUAL',
      testerId: officer,
      reviewerId: internalAudit,
      nextDueAt: dateOnly(170),
      createdById: actor,
      updatedById: actor,
    },
  });
  const samples = ['PO-4471', 'PO-4502', 'PO-4518', 'PO-4590', 'PO-4633'].map((ref, i) => ({
    ref,
    steps: i === 2 ? ['PASS', 'FAIL', 'NA'] : ['PASS', 'PASS', 'PASS'],
    result: i === 2 ? 'FAIL' : 'PASS',
    note: i === 2 ? 'Only one quotation on file; no waiver.' : '',
  }));
  const failedDue = dateOnly(-20);
  const failed = await prisma.controlTest.create({
    data: {
      planId: plan1.id,
      controlId: ctl01,
      testType: 'OPERATING',
      period: testPeriod('QUARTERLY', failedDue),
      dueAt: failedDue,
      status: 'REVIEWED',
      origin: 'SCHEDULED',
      procedure: quotationSteps,
      sampleSize: 5,
      testerId: owner,
      reviewerRoleKey: 'RISK_OFFICER',
      samples: samples as unknown as Prisma.InputJsonValue,
      conclusion: 'NOT_EFFECTIVE',
      testerComment:
        'PO-4518 (SAR 92,000) was issued with a single quotation and no approved waiver.',
      reviewComment: 'Agreed — raise an issue for the buyer team.',
      executedById: owner,
      reviewedById: officer,
      startedAt: at(-28),
      submittedAt: at(-22),
      reviewedAt: at(-21),
      createdById: actor,
    },
  });
  await prisma.control.update({
    where: { objectId: ctl01 },
    data: { operatingEffectiveness: CONCLUSION_EFFECTIVENESS.NOT_EFFECTIVE, lastTestedAt: at(-21) },
  });
  await prisma.grcActivity.create({
    data: {
      objectId: ctl01,
      kind: 'ASSESSMENT',
      changes: { operatingEffectiveness: { from: 'NOT_ASSESSED', to: 'NOT_EFFECTIVE' } },
      comment: `${failed.period}: NOT_EFFECTIVE`,
      createdById: officer,
      createdAt: at(-21),
    },
  });
  await prisma.assuranceEvent.createMany({
    data: [
      {
        entityType: 'ControlTest',
        entityId: failed.id,
        kind: 'CREATED',
        changes: { status: { from: null, to: 'PLANNED' } },
        createdAt: at(-35),
      },
      {
        entityType: 'ControlTest',
        entityId: failed.id,
        kind: 'STATUS',
        changes: { status: { from: 'IN_PROGRESS', to: 'SUBMITTED' } },
        createdById: owner,
        createdAt: at(-22),
      },
      {
        entityType: 'ControlTest',
        entityId: failed.id,
        kind: 'STATUS',
        changes: { status: { from: 'SUBMITTED', to: 'REVIEWED' } },
        comment: 'Agreed — raise an issue for the buyer team.',
        createdById: officer,
        createdAt: at(-21),
      },
    ],
  });
  const emptySamples = (n: number, steps: number) =>
    Array.from({ length: n }, (_, i) => ({
      ref: `#${i + 1}`,
      steps: Array(steps).fill(null),
      result: null,
      note: '',
    }));
  await prisma.controlTest.create({
    data: {
      planId: plan2.id,
      controlId: ctl02,
      testType: 'OPERATING',
      period: testPeriod('SEMI_ANNUAL', dateOnly(20)),
      dueAt: dateOnly(20),
      origin: 'SCHEDULED',
      procedure: plan2.procedure as Prisma.InputJsonValue,
      sampleSize: 2,
      testerId: officer,
      reviewerId: internalAudit,
      samples: emptySamples(2, 2) as unknown as Prisma.InputJsonValue,
      createdById: actor,
    },
  });
  if (ctl04)
    await prisma.controlTest.create({
      data: {
        controlId: ctl04,
        testType: 'DESIGN',
        period: dateOnly(-10).toISOString().slice(0, 10),
        dueAt: dateOnly(-10),
        origin: 'MANUAL',
        procedure: [
          {
            en: 'Walk through the control with the process owner.',
            ar: 'راجع الضابط مع مالك العملية.',
          },
        ],
        sampleSize: 1,
        testerId: owner,
        reviewerRoleKey: 'RISK_OFFICER',
        samples: emptySamples(1, 1) as unknown as Prisma.InputJsonValue,
        createdById: actor,
      },
    });

  // ----- Issues -----
  const issue1 = await prisma.issue.create({
    data: {
      code: 'ISS-0001',
      titleEn: 'Purchase orders issued without three quotations',
      titleAr: 'إصدار أوامر شراء دون ثلاثة عروض أسعار',
      descriptionEn:
        'The quarterly test of CTL-01 found a purchase order of SAR 92,000 with a single quotation and no waiver.',
      descriptionAr:
        'وجد الاختبار الربعي للضابط CTL-01 أمر شراء بقيمة 92,000 ريال بعرض سعر واحد ودون استثناء معتمد.',
      sourceType: 'CONTROL_TEST',
      sourceId: failed.id,
      severity: 'HIGH',
      status: 'IN_PROGRESS',
      ownerId: owner,
      dueAt: dateOnly(40),
      processId: purchasing.id,
      bpmnElementId: 'Task_Create',
      riskId: rsk01,
      controlId: ctl01,
      requirementId: gpl12,
      departmentId: purchasing.departmentId,
      createdAt: at(-20),
      createdById: officer,
      updatedById: officer,
      actions: {
        create: [
          {
            titleEn: 'Block PO release above SAR 50,000 without three quotations in the ERP',
            titleAr: 'منع إصدار أوامر الشراء فوق 50,000 ريال دون ثلاثة عروض في النظام',
            ownerId: modeler,
            dueAt: dateOnly(30),
            progress: 40,
            sortOrder: 0,
            createdById: owner,
          },
          {
            titleEn: 'Brief the buyer team on the quotation rule',
            titleAr: 'توعية فريق المشتريات بقاعدة عروض الأسعار',
            ownerId: owner,
            dueAt: dateOnly(-5),
            progress: 100,
            completedAt: at(-6),
            sortOrder: 1,
            createdById: owner,
          },
        ],
      },
    },
  });
  await prisma.assuranceEvent.createMany({
    data: [
      {
        entityType: 'Issue',
        entityId: issue1.id,
        kind: 'CREATED',
        changes: { status: { from: null, to: 'OPEN' } },
        createdById: officer,
        createdAt: at(-20),
      },
      {
        entityType: 'Issue',
        entityId: issue1.id,
        kind: 'UPDATED',
        changes: { progress: { from: 0, to: 100 } },
        comment: 'Brief the buyer team on the quotation rule',
        createdById: owner,
        createdAt: at(-6),
      },
    ],
  });

  // ----- Audit engagement -----
  const year = new Date().getUTCFullYear();
  const engagement = await prisma.auditEngagement.create({
    data: {
      code: `AUD-${year}-01`,
      year,
      titleEn: 'Procurement and purchase approvals',
      titleAr: 'المشتريات واعتماد طلبات الشراء',
      objectiveEn:
        'Assess whether purchases follow the Government Procurement Law and the approval limits.',
      objectiveAr: 'تقييم التزام المشتريات بنظام المشتريات الحكومية وحدود الصلاحيات.',
      scopeEn: 'Purchase requisitions and orders of the last two quarters.',
      scopeAr: 'طلبات وأوامر الشراء خلال الربعين الأخيرين.',
      status: 'REPORTING',
      leadId: internalAudit,
      teamIds: [internalAudit, auditor].filter((v): v is string => !!v),
      plannedStart: dateOnly(-45),
      plannedEnd: dateOnly(-10),
      actualStart: at(-44),
      actualEnd: at(-8),
      processIds: [purchasing.id],
      riskIds: [rsk01, rsk02].filter((v): v is string => !!v),
      controlIds: [ctl01, ctl02].filter((v): v is string => !!v),
      requirementIds: gpl12 ? [gpl12] : [],
      summaryEn:
        'Purchase approvals work as designed; the three-quotation rule is not applied consistently.',
      summaryAr: 'تعمل اعتمادات الشراء كما صُممت؛ لا تُطبق قاعدة العروض الثلاثة بشكل منتظم.',
      createdById: internalAudit,
      updatedById: internalAudit,
      items: {
        create: [
          {
            sortOrder: 0,
            titleEn: 'CTL-01 Three quotations above the threshold',
            titleAr: 'CTL-01 ثلاثة عروض أسعار فوق الحد',
            procedure: quotationSteps,
            controlId: ctl01,
            status: 'DONE',
            result: 'EXCEPTION',
            notes: '2 of 25 sampled orders without three quotations.',
            assigneeId: internalAudit,
          },
          {
            sortOrder: 1,
            titleEn: 'Approval limits match the delegation of authority',
            titleAr: 'تطابق حدود الصلاحيات مع مصفوفة التفويض',
            procedure: [],
            controlId: ctl02,
            status: 'DONE',
            result: 'SATISFACTORY',
            notes: 'Limits in the ERP match the approved matrix.',
            assigneeId: internalAudit,
          },
        ],
      },
    },
  });
  const findings = [
    {
      code: 'F-01',
      titleEn: 'Three-quotation rule not applied consistently',
      titleAr: 'عدم تطبيق قاعدة العروض الثلاثة بانتظام',
      rating: 'HIGH',
      conditionEn:
        '2 of 25 purchase orders above SAR 50,000 had fewer than three quotations and no approved waiver.',
      conditionAr: 'لدى 2 من 25 أمر شراء فوق 50,000 ريال أقل من ثلاثة عروض ودون استثناء معتمد.',
      criteriaEn: 'Government Procurement Law, Art. 12.',
      criteriaAr: 'نظام المشتريات الحكومية، المادة 12.',
      causeEn: 'The ERP does not check the number of attached quotations.',
      causeAr: 'لا يتحقق النظام من عدد العروض المرفقة.',
      effectEn: 'Higher prices and non-compliance with the procurement law.',
      effectAr: 'أسعار أعلى وعدم الالتزام بنظام المشتريات.',
      recommendationEn:
        'Add a system check before a purchase order above the threshold is released.',
      recommendationAr: 'إضافة تحقق آلي قبل إصدار أمر شراء يتجاوز الحد.',
      responseStatus: 'ACCEPTED',
      agreedActionEn: 'Configure the ERP to require three quotations above SAR 50,000.',
      agreedActionAr: 'ضبط النظام لطلب ثلاثة عروض فوق 50,000 ريال.',
      targetDate: dateOnly(60),
    },
    {
      code: 'F-02',
      titleEn: 'Quotation evaluation not documented',
      titleAr: 'عدم توثيق تقييم العروض',
      rating: 'MEDIUM',
      conditionEn: 'For 4 of 25 orders the reason for choosing the supplier is not recorded.',
      conditionAr: 'لم يُسجل سبب اختيار المورد في 4 من 25 أمرًا.',
      criteriaEn: 'Internal purchasing policy, section 5.',
      criteriaAr: 'سياسة المشتريات الداخلية، القسم 5.',
      causeEn: 'No field for the evaluation in the purchase order form.',
      causeAr: 'لا يوجد حقل للتقييم في نموذج أمر الشراء.',
      effectEn: 'Supplier choices cannot be justified to auditors.',
      effectAr: 'لا يمكن تبرير اختيار الموردين للمدققين.',
      recommendationEn: 'Add a mandatory evaluation note to the purchase order.',
      recommendationAr: 'إضافة ملاحظة تقييم إلزامية إلى أمر الشراء.',
      responseStatus: 'PENDING',
    },
  ];
  for (const f of findings) {
    const row = await prisma.auditFinding.create({
      data: {
        engagementId: engagement.id,
        ...f,
        requirementId: gpl12,
        processId: purchasing.id,
        bpmnElementId: 'Task_Create',
        riskId: rsk01,
        controlId: ctl01,
        responseOwnerId: owner,
        ...(f.responseStatus === 'ACCEPTED' ? { respondedAt: at(-3), respondedById: owner } : {}),
        createdById: internalAudit,
        updatedById: internalAudit,
      },
    });
    if (f.responseStatus === 'ACCEPTED') {
      const issue = await prisma.issue.create({
        data: {
          code: 'ISS-0002',
          titleEn: `${engagement.code} ${f.code}: ${f.titleEn}`,
          titleAr: `${engagement.code} ${f.code}: ${f.titleAr}`,
          descriptionEn: `${f.conditionEn}\n\n${f.recommendationEn}`,
          descriptionAr: `${f.conditionAr}\n\n${f.recommendationAr}`,
          sourceType: 'AUDIT_FINDING',
          sourceId: row.id,
          severity: f.rating,
          status: 'OPEN',
          ownerId: owner,
          dueAt: f.targetDate,
          processId: purchasing.id,
          bpmnElementId: 'Task_Create',
          riskId: rsk01,
          controlId: ctl01,
          requirementId: gpl12,
          createdAt: at(-3),
          createdById: owner,
          updatedById: owner,
          actions: {
            create: [
              {
                titleEn: f.agreedActionEn!,
                titleAr: f.agreedActionAr!,
                ownerId: owner,
                dueAt: f.targetDate,
                sortOrder: 0,
                createdById: owner,
              },
            ],
          },
        },
      });
      await prisma.auditFinding.update({ where: { id: row.id }, data: { issueId: issue.id } });
    }
  }
  await prisma.assuranceEvent.createMany({
    data: [
      {
        entityType: 'AuditEngagement',
        entityId: engagement.id,
        kind: 'CREATED',
        changes: { status: { from: null, to: 'PLANNED' } },
        createdById: internalAudit,
        createdAt: at(-50),
      },
      {
        entityType: 'AuditEngagement',
        entityId: engagement.id,
        kind: 'STATUS',
        changes: { status: { from: 'PLANNED', to: 'FIELDWORK' } },
        createdById: internalAudit,
        createdAt: at(-44),
      },
      {
        entityType: 'AuditEngagement',
        entityId: engagement.id,
        kind: 'STATUS',
        changes: { status: { from: 'FIELDWORK', to: 'REPORTING' } },
        createdById: internalAudit,
        createdAt: at(-8),
      },
    ],
  });

  // ----- Risk & control self-assessment campaign -----
  const definition: QuestionnaireDefinition = {
    sections: [
      {
        id: 'risks',
        titleEn: 'Purchasing risks',
        titleAr: 'مخاطر المشتريات',
        questions: [
          {
            id: 'split',
            type: 'RATING',
            textEn:
              'How likely is it today that purchase orders are split to avoid tendering? (1 rare – 5 almost certain)',
            textAr: 'ما مدى احتمال تجزئة أوامر الشراء اليوم لتفادي المنافسة؟ (1 نادر – 5 شبه مؤكد)',
            required: true,
            weight: 0,
            options: [],
            link: { objectId: rsk01, field: 'LIKELIHOOD' },
          },
          {
            id: 'quotes',
            type: 'SINGLE',
            textEn: 'Does the three-quotation control work in your team?',
            textAr: 'هل يعمل ضابط العروض الثلاثة في فريقك؟',
            required: true,
            weight: 2,
            options: [
              { id: 'EFFECTIVE', en: 'Yes, always', ar: 'نعم، دائمًا', score: 2 },
              { id: 'PARTLY', en: 'Mostly', ar: 'غالبًا', score: 1 },
              { id: 'NOT_EFFECTIVE', en: 'No', ar: 'لا', score: 0 },
            ],
            link: { objectId: ctl01, field: 'EFFECTIVENESS' },
          },
          {
            id: 'policy',
            type: 'YES_NO_NA',
            textEn: 'Has your team read the purchasing policy this year?',
            textAr: 'هل اطلع فريقك على سياسة المشتريات هذا العام؟',
            required: true,
            weight: 1,
            options: [],
          },
          {
            id: 'why',
            type: 'TEXT',
            textEn: 'What prevents it?',
            textAr: 'ما الذي يمنع ذلك؟',
            required: true,
            weight: 0,
            options: [],
            showIf: { questionId: 'policy', equals: ['NO'] },
          },
        ],
      },
    ],
  };
  const questionnaire = await prisma.questionnaire.create({
    data: {
      titleEn: 'Purchasing risk & control self-assessment',
      titleAr: 'التقييم الذاتي لمخاطر وضوابط المشتريات',
      descriptionEn:
        'Please rate the purchasing risks and controls as they work in your team today.',
      descriptionAr: 'يرجى تقييم مخاطر وضوابط المشتريات كما تعمل في فريقك اليوم.',
      purpose: 'RCSA',
      status: 'ACTIVE',
      definition: definition as unknown as Prisma.InputJsonValue,
      createdById: actor,
      updatedById: actor,
    },
  });
  const campaign = await prisma.surveyCampaign.create({
    data: {
      questionnaireId: questionnaire.id,
      titleEn: `Purchasing RCSA ${year}`,
      titleAr: `التقييم الذاتي للمشتريات ${year}`,
      descriptionEn: questionnaire.descriptionEn,
      descriptionAr: questionnaire.descriptionAr,
      purpose: 'RCSA',
      definition: definition as unknown as Prisma.InputJsonValue,
      status: 'OPEN',
      audience: {
        userIds: [owner, modeler, reviewer].filter(Boolean),
        roleKeys: [],
        departmentIds: [],
      },
      startAt: dateOnly(-7),
      endAt: dateOnly(14),
      launchedAt: at(-7),
      departmentId: purchasing.departmentId,
      createdById: actor,
      updatedById: actor,
    },
  });
  const answers: [string | null, Record<string, unknown>, number, number][] = [
    [owner, { split: 3, quotes: 'PARTLY', policy: 'YES' }, 3, 5],
    [
      reviewer,
      {
        split: 2,
        quotes: 'NOT_EFFECTIVE',
        policy: 'NO',
        why: 'New staff joined after the last briefing.',
      },
      0,
      5,
    ],
  ];
  for (const [userId, a, score, max] of answers) {
    if (!userId) continue;
    const r = await prisma.surveyResponse.create({
      data: {
        campaignId: campaign.id,
        userId,
        status: 'SUBMITTED',
        answers: a as Prisma.InputJsonValue,
        score,
        maxScore: max,
        openedAt: at(-6),
        submittedAt: at(-5),
      },
    });
    await prisma.surveyProposal.createMany({
      data: [
        {
          campaignId: campaign.id,
          responseId: r.id,
          questionId: 'split',
          objectId: rsk01,
          field: 'LIKELIHOOD',
          value: String(a.split),
        },
        {
          campaignId: campaign.id,
          responseId: r.id,
          questionId: 'quotes',
          objectId: ctl01,
          field: 'EFFECTIVENESS',
          value: String(a.quotes),
        },
      ],
    });
  }
  if (modeler)
    await prisma.surveyResponse.create({
      data: { campaignId: campaign.id, userId: modeler, status: 'OPENED', openedAt: at(-2) },
    });

  console.log(
    'Seeded assurance demo data: 2 test plans, 3 tests, 2 issues, 1 audit engagement with 2 findings, 1 RCSA campaign.',
  );
}

/** Name of the ready-made workflow for changes of active risks and controls (D-106). */
export const GRC_CHANGE_WORKFLOW_NAME_EN = 'GRC change approval';
const SEEDED_KEY = 'grc.changeWorkflowSeeded';

/**
 * Base seed (every installation, D-106): a one-step workflow "GRC change approval" (any Risk &
 * Compliance Officer) preselected in Settings → Risk & Compliance. Change approval itself stays
 * off. Created once: if an administrator deletes it, it is not created again.
 */
export async function ensureGrcChangeWorkflow(prisma: PrismaClient, adminId: string | null) {
  if (await prisma.setting.findUnique({ where: { key: SEEDED_KEY } })) return;
  const workflow = await prisma.workflow.create({
    data: {
      nameEn: GRC_CHANGE_WORKFLOW_NAME_EN,
      nameAr: 'اعتماد تعديلات المخاطر والامتثال',
      descriptionEn:
        'Changes of active risks and controls: one approval by any Risk & Compliance Officer.',
      descriptionAr: 'تعديلات المخاطر والضوابط النشطة: اعتماد واحد من أي مسؤول مخاطر وامتثال.',
      steps: [
        {
          nameEn: 'Risk & Compliance Officer',
          nameAr: 'مسؤول المخاطر والامتثال',
          rule: 'ANY',
          assignees: [{ type: 'ROLE', roleKey: 'RISK_OFFICER' }],
        },
      ],
      createdById: adminId,
      updatedById: adminId,
    },
  });
  const grc = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.GRC } });
  const value = resolveGrcSettings(grc?.value);
  if (!value.changeApproval.workflowId) {
    const next = { ...value, changeApproval: { ...value.changeApproval, workflowId: workflow.id } };
    await prisma.setting.upsert({
      where: { key: SETTING_KEYS.GRC },
      create: { key: SETTING_KEYS.GRC, value: next },
      update: { value: next },
    });
  }
  await prisma.setting.create({ data: { key: SEEDED_KEY, value: { workflowId: workflow.id } } });
  console.log(`Created the workflow "${GRC_CHANGE_WORKFLOW_NAME_EN}" (change approval stays off).`);
}
