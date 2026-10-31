import type { Prisma, PrismaClient } from '@prisma/client';
import {
  epcToBpmn,
  generateOrgChart,
  generateSipoc,
  generateValueChain,
  stringifyDiagramContent,
  type DiagramType,
  type GraphContent,
  type OrgSourceDto,
} from '@processhub/shared';
import { createPublication, type StepSnapshot } from '../src/governance/publication';
import { structureToBpmn } from '../src/ai/bpmn/structure-to-bpmn';
import type { ProcessStructure } from '../src/ai/bpmn/process-structure';
import { linearXml } from './demo-diagrams';
import { APPROVAL_AUTHORITY_DMN } from './demo-dmn';

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Demo EPC: purchase request (ARIS-style), converted to BPMN by the seed as well. */
function purchaseEpc(buyerRoleId: string | null, erpId: string | null): GraphContent {
  const node = (
    id: string,
    kind: string,
    en: string,
    ar: string,
    x: number,
    y: number,
    extra = {},
  ) => ({
    id,
    kind,
    x,
    y,
    width: ['xor', 'and', 'or'].includes(kind) ? 40 : 150,
    height: ['xor', 'and', 'or'].includes(kind) ? 40 : 60,
    nameEn: en,
    nameAr: ar,
    ...extra,
  });
  const flow = (s: string, t: string, kind = 'flow') => ({
    id: `Flow_${s}_${t}`,
    kind,
    sourceId: s,
    targetId: t,
    waypoints: [],
    nameEn: '',
    nameAr: '',
  });
  return {
    schema: 1,
    type: 'EPC',
    nodes: [
      node('Ev_Raised', 'event', 'Purchase request raised', 'تم رفع طلب الشراء', 300, 40),
      node('Fn_Check', 'function', 'Check purchase request', 'مراجعة طلب الشراء', 300, 140),
      node(
        'Org_Buyer',
        'orgUnit',
        'Procurement Officer',
        'موظف المشتريات',
        520,
        140,
        buyerRoleId ? { objectId: buyerRoleId } : {},
      ),
      node(
        'Sys_Erp',
        'system',
        'ERP',
        'نظام تخطيط الموارد',
        520,
        230,
        erpId ? { objectId: erpId } : {},
      ),
      node('Xor_Decision', 'xor', '', '', 355, 250),
      node('Ev_Approved', 'event', 'Request approved', 'تمت الموافقة على الطلب', 160, 330),
      node('Ev_Rejected', 'event', 'Request rejected', 'تم رفض الطلب', 440, 330),
      node('Fn_Order', 'function', 'Issue purchase order', 'إصدار أمر الشراء', 160, 430),
      node('Ev_Ordered', 'event', 'Purchase order issued', 'تم إصدار أمر الشراء', 160, 530),
    ],
    edges: [
      flow('Ev_Raised', 'Fn_Check'),
      flow('Org_Buyer', 'Fn_Check', 'assignment'),
      flow('Fn_Check', 'Sys_Erp', 'assignment'),
      flow('Fn_Check', 'Xor_Decision'),
      flow('Xor_Decision', 'Ev_Approved'),
      flow('Xor_Decision', 'Ev_Rejected'),
      flow('Ev_Approved', 'Fn_Order'),
      flow('Fn_Order', 'Ev_Ordered'),
    ],
  };
}

/**
 * Demo diagrams (D-126; demo installations only, once): a value chain generated from the process
 * house and linked to the demo processes (published, the portal's start page), an organisation
 * chart generated from the demo departments (published), the "approval authority" decision table
 * linked to a business rule task of a new demo process (published), an EPC with its BPMN
 * conversion and a SIPOC of the purchase requisition.
 */
export async function seedDiagramsDemo(
  prisma: PrismaClient,
  adminId: string | null,
): Promise<void> {
  if ((await prisma.diagram.count()) > 0) return;
  const user = (prefix: string) =>
    prisma.user.findFirst({ where: { email: { startsWith: prefix } }, select: { id: true } });
  const [modeler, owner, reviewer] = await Promise.all([
    user('modeler@'),
    user('owner@'),
    user('reviewer@'),
  ]);
  const author = modeler?.id ?? adminId;
  const ownerId = owner?.id ?? adminId;
  const now = new Date();
  const workflow = await prisma.workflow.findFirst({
    where: { isTemplate: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  const processes = await prisma.process.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameAr: true,
      category: true,
      parentId: true,
      level: true,
      sortOrder: true,
      departmentId: true,
    },
  });
  const byCode = new Map(processes.map((p) => [p.code, p]));
  const obj = (type: 'ROLE' | 'SYSTEM', code: string) =>
    prisma.repoObject.findFirst({ where: { type, code, deletedAt: null }, select: { id: true } });
  const [buyer, erp] = await Promise.all([obj('ROLE', 'R-03'), obj('SYSTEM', 'SYS-01')]);

  let n = 0;
  const create = async (
    type: DiagramType,
    code: string,
    names: { nameEn: string; nameAr: string; descriptionEn?: string; descriptionAr?: string },
    content: string,
    processId: string | null,
  ) => {
    n++;
    const d = await prisma.diagram.create({
      data: {
        type,
        code,
        ...names,
        processId,
        ownerId,
        content,
        contentUpdatedById: author,
        createdById: author,
        updatedById: author,
        versions: {
          create: {
            versionNumber: 1,
            content,
            changeNote: 'Initial version',
            createdById: author,
            createdAt: addDays(now, -10),
          },
        },
      },
    });
    return d.id;
  };
  /** Approved by the reviewer and the owner, then published (like the governance demo). */
  const publish = async (id: string) => {
    const steps: StepSnapshot[] = [
      {
        nameEn: 'Quality review',
        nameAr: 'مراجعة الجودة',
        rule: 'ANY',
        assigneeIds: [reviewer?.id ?? adminId!],
        approvedBySubmitter: false,
      },
      {
        nameEn: 'Owner approval',
        nameAr: 'اعتماد المالك',
        rule: 'ANY',
        assigneeIds: [ownerId!],
        approvedBySubmitter: false,
      },
    ];
    const submittedAt = addDays(now, -6);
    const r = await prisma.review.create({
      data: {
        entityType: 'DIAGRAM',
        entityId: id,
        versionNumber: 1,
        status: 'APPROVED',
        workflowId: workflow?.id ?? null,
        workflowNameEn: workflow?.nameEn ?? 'Standard approval',
        workflowNameAr: workflow?.nameAr ?? 'الاعتماد القياسي',
        steps: steps as unknown as Prisma.InputJsonValue,
        currentStep: 1,
        submittedById: author,
        submittedAt,
        dueAt: addDays(submittedAt, 5),
        completedAt: addDays(submittedAt, 2),
        tasks: {
          create: steps.map((s, i) => ({
            stepIndex: i,
            assigneeId: s.assigneeIds[0],
            status: 'APPROVED' as const,
            decidedAt: addDays(submittedAt, i + 1),
          })),
        },
      },
    });
    const publishedAt = addDays(now, -3);
    await prisma.$transaction((tx) =>
      createPublication(tx, {
        type: 'DIAGRAM',
        id,
        reviewId: r.id,
        actorId: ownerId,
        label: 'v1.0',
        publishedAt,
        nextReviewAt: addDays(publishedAt, 365),
      }),
    );
    await prisma.diagram.update({ where: { id }, data: { status: 'PUBLISHED' } });
  };

  // Value chain from the process house (level 1 and 2), published, portal start page.
  const vc = await create(
    'VALUE_CHAIN',
    'VC-001',
    {
      nameEn: 'Enterprise value chain',
      nameAr: 'سلسلة القيمة المؤسسية',
      descriptionEn:
        'Management, core and support processes; click an element to open its process.',
      descriptionAr: 'العمليات الإدارية والرئيسية والمساندة؛ انقر على عنصر لفتح عمليته.',
    },
    stringifyDiagramContent(generateValueChain(processes, { includeLevel2: true })),
    null,
  );
  await publish(vc);
  const portal = await prisma.setting.findUnique({ where: { key: 'portal' } });
  await prisma.setting.upsert({
    where: { key: 'portal' },
    create: { key: 'portal', value: { startDiagramId: vc } },
    update: {
      value: { ...((portal?.value as Record<string, unknown>) ?? {}), startDiagramId: vc },
    },
  });

  // Organisation chart from departments, positions and people.
  const [departments, roles, holders] = await Promise.all([
    prisma.department.findMany({
      where: { deletedAt: null },
      select: { id: true, nameEn: true, nameAr: true, parentId: true },
    }),
    prisma.repoObject.findMany({
      where: { type: 'ROLE', deletedAt: null },
      select: { id: true, nameEn: true, nameAr: true, attributes: true },
    }),
    prisma.userJobRole.findMany({
      select: {
        repoObjectId: true,
        user: { select: { id: true, nameEn: true, nameAr: true, departmentId: true } },
      },
    }),
  ]);
  const source: OrgSourceDto = {
    departments,
    roles: roles.map((r) => {
      const dep = (r.attributes as Record<string, unknown>)?.departmentId;
      return {
        id: r.id,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        departmentIds:
          typeof dep === 'string'
            ? [dep]
            : [
                ...new Set(
                  holders
                    .filter((h) => h.repoObjectId === r.id && h.user.departmentId)
                    .map((h) => h.user.departmentId!),
                ),
              ],
      };
    }),
    people: [
      ...new Map(
        holders.map((h) => [
          h.user.id,
          {
            ...h.user,
            roleIds: holders.filter((x) => x.user.id === h.user.id).map((x) => x.repoObjectId),
          },
        ]),
      ).values(),
    ],
  };
  const org = await create(
    'ORG_CHART',
    'ORG-001',
    { nameEn: 'Organisation chart', nameAr: 'الهيكل التنظيمي' },
    stringifyDiagramContent(generateOrgChart(source, { includePersons: true })),
    null,
  );
  await publish(org);

  // Decision table, linked to the business rule task of a new demo process.
  const dmn = await create(
    'DMN',
    'DMN-001',
    {
      nameEn: 'Approval authority by amount',
      nameAr: 'صلاحية الاعتماد حسب المبلغ',
      descriptionEn: 'Who approves a purchase, by amount and category.',
      descriptionAr: 'من يعتمد عملية الشراء حسب المبلغ والفئة.',
    },
    APPROVAL_AUTHORITY_DMN,
    byCode.get('S.01')?.id ?? null,
  );
  await publish(dmn);
  const s01 = byCode.get('S.01');
  if (s01 && !byCode.has('S.01.02')) {
    const approval = await prisma.process.create({
      data: {
        code: 'S.01.02',
        nameEn: 'Purchase approval',
        nameAr: 'اعتماد الشراء',
        descriptionEn:
          'Finds the approver of a purchase with the approval authority table and gets the approval.',
        descriptionAr: 'يحدد جهة اعتماد الشراء بجدول صلاحيات الاعتماد ويحصل على الاعتماد.',
        category: s01.category,
        parentId: s01.id,
        level: s01.level + 1,
        sortOrder: 2,
        ownerId,
        departmentId: s01.departmentId,
        createdById: author,
        updatedById: author,
      },
    });
    const xml = linearXml(
      'PurchaseApproval',
      { en: 'Purchase request ready', ar: 'طلب الشراء جاهز' },
      [
        {
          id: 'Task_DetermineApprover',
          type: 'businessRuleTask',
          en: 'Determine approver',
          ar: 'تحديد جهة الاعتماد',
          decisionRef: dmn,
          decisionId: 'Decision_ApprovalAuthority',
          descEn: 'The approval authority table gives the approver for the amount and category.',
          descAr: 'يحدد جدول صلاحيات الاعتماد جهة الاعتماد حسب المبلغ والفئة.',
        },
        { id: 'Task_Approve', en: 'Approve purchase', ar: 'اعتماد الشراء' },
      ],
      { en: 'Purchase approved', ar: 'تم اعتماد الشراء' },
    );
    await prisma.processModel.create({
      data: { processId: approval.id, bpmnXml: xml, createdById: author, updatedById: author },
    });
    await prisma.processVersion.create({
      data: {
        processId: approval.id,
        versionNumber: 1,
        bpmnXml: xml,
        changeNote: 'Initial version',
        createdById: author,
      },
    });
  }

  // EPC and its conversion to a draft BPMN process.
  const epcContent = purchaseEpc(buyer?.id ?? null, erp?.id ?? null);
  const epcId = await create(
    'EPC',
    'EPC-001',
    {
      nameEn: 'Purchase request (EPC)',
      nameAr: 'طلب الشراء (EPC)',
      descriptionEn: 'ARIS-style chain of the purchase request.',
      descriptionAr: 'سلسلة طلب الشراء بأسلوب ARIS.',
    },
    stringifyDiagramContent(epcContent),
    byCode.get('S.01')?.id ?? null,
  );
  if (s01 && !byCode.has('S.01.03')) {
    const conversion = epcToBpmn(epcContent, {
      nameEn: 'Purchase request (from EPC)',
      nameAr: 'طلب الشراء (من EPC)',
    });
    const preserve = new Map([...conversion.laneRoles].map(([lane, roleId]) => [lane, { roleId }]));
    const xml = structureToBpmn(conversion.structure as ProcessStructure, {
      key: 'epc001',
      preserve,
    });
    const converted = await prisma.process.create({
      data: {
        code: 'S.01.03',
        nameEn: 'Purchase request (from EPC)',
        nameAr: 'طلب الشراء (من EPC)',
        descriptionEn: `Converted from ${'EPC-001'}.`,
        descriptionAr: 'محوّلة من EPC-001.',
        category: s01.category,
        parentId: s01.id,
        level: s01.level + 1,
        sortOrder: 3,
        ownerId,
        departmentId: s01.departmentId,
        createdById: author,
        updatedById: author,
      },
    });
    await prisma.processModel.create({
      data: { processId: converted.id, bpmnXml: xml, createdById: author, updatedById: author },
    });
    for (const l of conversion.objectLinks)
      await prisma.objectLink.create({
        data: {
          processId: converted.id,
          bpmnElementId: l.elementId,
          repoObjectId: l.objectId,
          relation: l.kind === 'SYSTEM' ? 'SUPPORTS' : 'INPUT',
          createdById: author,
        },
      });
    for (const [lane, roleId] of conversion.laneRoles)
      await prisma.objectLink.create({
        data: {
          processId: converted.id,
          bpmnElementId: lane,
          repoObjectId: roleId,
          relation: 'PERFORMS',
          createdById: author,
        },
      });
  }
  void epcId;

  // SIPOC of the purchase requisition (generated from its model).
  const requisition = byCode.get('S.01.01');
  const model = requisition
    ? await prisma.processModel.findUnique({
        where: { processId: requisition.id },
        select: { bpmnXml: true },
      })
    : null;
  if (requisition && model) {
    const sipoc = generateSipoc(model.bpmnXml, requisition.id);
    if (!sipoc.columns.customers.length)
      sipoc.columns.customers.push({
        id: 'C_Requester',
        nameEn: 'Requesting department',
        nameAr: 'الإدارة الطالبة',
      });
    if (!sipoc.columns.inputs.length)
      sipoc.columns.inputs.push({ id: 'I_Need', nameEn: 'Purchase need', nameAr: 'احتياج الشراء' });
    if (!sipoc.columns.outputs.length)
      sipoc.columns.outputs.push({ id: 'O_PO', nameEn: 'Purchase order', nameAr: 'أمر الشراء' });
    await create(
      'SIPOC',
      'SIPOC-001',
      { nameEn: 'SIPOC — Purchase requisition', nameAr: 'SIPOC — طلب الشراء' },
      stringifyDiagramContent(sipoc),
      requisition.id,
    );
  }
  console.log(
    `Seeded ${n} demo diagrams (value chain, organisation chart, DMN, EPC, SIPOC) and 2 related processes.`,
  );
}
