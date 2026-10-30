/**
 * Phase 4.1 demo data (demo installations only): risks, controls and requirements of the
 * purchasing and payment processes, linked to their steps — including one high residual risk
 * without an effective control. Runs once (no risks yet).
 */
import type { PrismaClient } from '@prisma/client';
import { PROCESS_ELEMENT_ID } from '@processhub/shared';

type Status = 'DRAFT' | 'ACTIVE' | 'RETIRED';

interface DemoRequirement {
  code: string;
  parent?: string;
  level: 'SOURCE' | 'SECTION' | 'CLAUSE';
  en: string;
  ar: string;
  textEn?: string;
  textAr?: string;
  sourceRef?: string;
  url?: string;
}

const REQUIREMENTS: DemoRequirement[] = [
  {
    code: 'GPL',
    level: 'SOURCE',
    en: 'Government Procurement Law',
    ar: 'نظام المنافسات والمشتريات الحكومية',
    sourceRef: 'Royal Decree M/128',
    url: 'https://example.org/procurement-law',
  },
  {
    code: 'GPL-12',
    parent: 'GPL',
    level: 'CLAUSE',
    en: 'Art. 12 — Competitive quotations',
    ar: 'المادة 12 — عروض الأسعار التنافسية',
    textEn: 'Purchases above the threshold require at least three written quotations.',
    textAr: 'تتطلب المشتريات التي تتجاوز الحد ثلاثة عروض أسعار مكتوبة على الأقل.',
    sourceRef: 'Article 12',
  },
  {
    code: 'GPL-40',
    parent: 'GPL',
    level: 'CLAUSE',
    en: 'Art. 40 — Segregation of duties',
    ar: 'المادة 40 — الفصل بين المهام',
    textEn: 'The person who requests a purchase may not approve it.',
    textAr: 'لا يجوز لمن يطلب الشراء أن يعتمده.',
    sourceRef: 'Article 40',
  },
  {
    code: 'BUD',
    level: 'SOURCE',
    en: 'Budget Execution Rules',
    ar: 'قواعد تنفيذ الميزانية',
    sourceRef: 'Ministry of Finance circular 2024/7',
  },
  {
    code: 'BUD-3',
    parent: 'BUD',
    level: 'CLAUSE',
    en: 'Rule 3 — Commitment only against available budget',
    ar: 'القاعدة 3 — لا التزام إلا مقابل اعتماد متاح',
    textEn: 'No purchase order may be issued unless the budget line has sufficient funds.',
    textAr: 'لا يصدر أمر شراء ما لم يتوفر اعتماد كافٍ في بند الميزانية.',
    sourceRef: 'Rule 3',
  },
  {
    code: 'BUD-9',
    parent: 'BUD',
    level: 'CLAUSE',
    en: 'Rule 9 — Payment within 30 days of a matched invoice',
    ar: 'القاعدة 9 — الدفع خلال 30 يومًا من مطابقة الفاتورة',
    sourceRef: 'Rule 9',
  },
];

interface DemoControl {
  code: string;
  en: string;
  ar: string;
  descEn: string;
  descAr: string;
  type: 'PREVENTIVE' | 'DETECTIVE' | 'CORRECTIVE';
  nature: 'MANUAL' | 'AUTOMATED' | 'IT_DEPENDENT_MANUAL';
  frequency: 'PER_TRANSACTION' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'AD_HOC';
  key?: boolean;
  effectiveness: 'EFFECTIVE' | 'PARTLY' | 'NOT_EFFECTIVE' | 'NOT_ASSESSED';
  system?: string;
  requirements?: string[];
  status?: Status;
  reviewDays?: number;
}

const CONTROLS: DemoControl[] = [
  {
    code: 'CTL-01',
    en: 'Three quotations above the threshold',
    ar: 'ثلاثة عروض أسعار فوق الحد',
    descEn: 'The buyer attaches three quotations before a purchase order above SAR 50,000.',
    descAr: 'يرفق المشتري ثلاثة عروض أسعار قبل أي أمر شراء يتجاوز 50,000 ريال.',
    type: 'PREVENTIVE',
    nature: 'MANUAL',
    frequency: 'PER_TRANSACTION',
    key: true,
    effectiveness: 'EFFECTIVE',
    requirements: ['GPL-12'],
    reviewDays: 120,
  },
  {
    code: 'CTL-02',
    en: 'Approval limits in the ERP',
    ar: 'حدود الصلاحيات في نظام تخطيط الموارد',
    descEn: 'The ERP routes each requisition to an approver with a sufficient approval limit.',
    descAr: 'يوجّه النظام كل طلب إلى معتمد يملك حد صلاحية كافيًا.',
    type: 'PREVENTIVE',
    nature: 'AUTOMATED',
    frequency: 'PER_TRANSACTION',
    key: true,
    effectiveness: 'EFFECTIVE',
    system: 'SYS-01',
    reviewDays: 200,
  },
  {
    code: 'CTL-03',
    en: 'Requester cannot approve own requisition',
    ar: 'لا يعتمد مقدم الطلب طلبه',
    descEn: 'The ERP blocks approval by the user who created the requisition.',
    descAr: 'يمنع النظام اعتماد الطلب من المستخدم الذي أنشأه.',
    type: 'PREVENTIVE',
    nature: 'AUTOMATED',
    frequency: 'PER_TRANSACTION',
    key: true,
    effectiveness: 'NOT_ASSESSED',
    system: 'SYS-01',
    requirements: ['GPL-40'],
    reviewDays: -10,
  },
  {
    code: 'CTL-04',
    en: 'Budget availability check',
    ar: 'التحقق من توفر الاعتماد',
    descEn: 'Finance confirms the budget line before the requisition is approved.',
    descAr: 'تؤكد المالية بند الميزانية قبل اعتماد الطلب.',
    type: 'PREVENTIVE',
    nature: 'IT_DEPENDENT_MANUAL',
    frequency: 'PER_TRANSACTION',
    effectiveness: 'PARTLY',
    system: 'SYS-01',
    requirements: ['BUD-3'],
    reviewDays: 60,
  },
  {
    code: 'CTL-05',
    en: 'Three-way match',
    ar: 'المطابقة الثلاثية',
    descEn: 'Invoice, purchase order and goods receipt are matched before payment.',
    descAr: 'تُطابق الفاتورة وأمر الشراء وإيصال الاستلام قبل الدفع.',
    type: 'DETECTIVE',
    nature: 'AUTOMATED',
    frequency: 'PER_TRANSACTION',
    key: true,
    effectiveness: 'EFFECTIVE',
    system: 'SYS-01',
    reviewDays: 150,
  },
  {
    code: 'CTL-06',
    en: 'Duplicate invoice report',
    ar: 'تقرير الفواتير المكررة',
    descEn: 'Accounts payable reviews the weekly duplicate-invoice report.',
    descAr: 'تراجع الحسابات الدائنة تقرير الفواتير المكررة أسبوعيًا.',
    type: 'DETECTIVE',
    nature: 'IT_DEPENDENT_MANUAL',
    frequency: 'WEEKLY',
    effectiveness: 'NOT_EFFECTIVE',
    system: 'SYS-01',
    reviewDays: 30,
  },
  {
    code: 'CTL-07',
    en: 'Supplier bank detail verification',
    ar: 'التحقق من بيانات حساب المورد',
    descEn: 'Changes of supplier bank details are confirmed by phone with the supplier.',
    descAr: 'تُؤكَّد تغييرات الحساب البنكي للمورد هاتفيًا مع المورد.',
    type: 'PREVENTIVE',
    nature: 'MANUAL',
    frequency: 'AD_HOC',
    key: true,
    effectiveness: 'PARTLY',
    reviewDays: 90,
  },
  {
    code: 'CTL-08',
    en: 'Payment run approval',
    ar: 'اعتماد دفعة السداد',
    descEn: 'The finance manager approves each payment run in the banking portal.',
    descAr: 'يعتمد المدير المالي كل دفعة سداد في بوابة البنك.',
    type: 'PREVENTIVE',
    nature: 'IT_DEPENDENT_MANUAL',
    frequency: 'DAILY',
    effectiveness: 'EFFECTIVE',
    reviewDays: 180,
  },
  {
    code: 'CTL-09',
    en: 'Monthly vendor master review',
    ar: 'مراجعة شهرية لبيانات الموردين',
    descEn: 'Procurement reviews new and changed suppliers every month.',
    descAr: 'تراجع المشتريات الموردين الجدد والمعدَّلين شهريًا.',
    type: 'DETECTIVE',
    nature: 'MANUAL',
    frequency: 'MONTHLY',
    effectiveness: 'NOT_ASSESSED',
    reviewDays: 45,
  },
  {
    code: 'CTL-10',
    en: 'Late payment escalation',
    ar: 'تصعيد التأخر في السداد',
    descEn: 'Invoices older than 25 days are escalated to the finance manager.',
    descAr: 'تُصعَّد الفواتير التي تجاوزت 25 يومًا إلى المدير المالي.',
    type: 'CORRECTIVE',
    nature: 'IT_DEPENDENT_MANUAL',
    frequency: 'DAILY',
    effectiveness: 'EFFECTIVE',
    requirements: ['BUD-9'],
    reviewDays: 100,
  },
  {
    code: 'CTL-11',
    en: 'Customer identity verification',
    ar: 'التحقق من هوية العميل',
    descEn: 'Identity documents are checked against the national register.',
    descAr: 'تُطابق وثائق الهوية مع السجل الوطني.',
    type: 'PREVENTIVE',
    nature: 'IT_DEPENDENT_MANUAL',
    frequency: 'PER_TRANSACTION',
    key: true,
    effectiveness: 'EFFECTIVE',
    reviewDays: 160,
  },
  {
    code: 'CTL-12',
    en: 'Emergency purchase post-approval',
    ar: 'الاعتماد اللاحق للمشتريات الطارئة',
    descEn: 'Emergency purchases are approved by the committee within five days.',
    descAr: 'تعتمد اللجنة المشتريات الطارئة خلال خمسة أيام.',
    type: 'CORRECTIVE',
    nature: 'MANUAL',
    frequency: 'AD_HOC',
    effectiveness: 'NOT_ASSESSED',
    status: 'DRAFT',
  },
];

interface DemoRisk {
  code: string;
  en: string;
  ar: string;
  descEn: string;
  descAr: string;
  category: string;
  causeEn?: string;
  causeAr?: string;
  consequenceEn?: string;
  consequenceAr?: string;
  inherent: [number, number];
  residual?: [number, number];
  response?: 'ACCEPT' | 'AVOID' | 'MITIGATE' | 'TRANSFER';
  controls: string[];
  dept: string;
  reviewDays?: number;
  status?: Status;
}

const RISKS: DemoRisk[] = [
  {
    code: 'RSK-01',
    en: 'Split purchase orders to avoid tendering',
    ar: 'تجزئة أوامر الشراء لتفادي المنافسة',
    descEn: 'A large purchase is split into small orders below the tender threshold.',
    descAr: 'تُجزأ عملية شراء كبيرة إلى أوامر صغيرة دون حد المنافسة.',
    category: 'FRAUD',
    causeEn: 'Pressure to buy quickly; thresholds known to requesters.',
    causeAr: 'الضغط للشراء السريع؛ الحدود معروفة لمقدمي الطلبات.',
    consequenceEn: 'Breach of procurement law, higher prices.',
    consequenceAr: 'مخالفة نظام المشتريات وارتفاع الأسعار.',
    inherent: [4, 4],
    residual: [2, 3],
    controls: ['CTL-01', 'CTL-02'],
    dept: 'PRC',
    reviewDays: 90,
  },
  {
    code: 'RSK-02',
    en: 'Requester approves own requisition',
    ar: 'اعتماد مقدم الطلب لطلبه',
    descEn: 'The same person raises and approves a requisition.',
    descAr: 'يقدم الشخص نفسه الطلب ويعتمده.',
    category: 'FRAUD',
    causeEn: 'Approver delegations not maintained.',
    causeAr: 'عدم تحديث تفويضات الاعتماد.',
    consequenceEn: 'Unauthorised spending.',
    consequenceAr: 'إنفاق غير مصرح به.',
    inherent: [4, 5],
    residual: [4, 4],
    controls: ['CTL-03'],
    dept: 'PRC',
    reviewDays: -5,
  },
  {
    code: 'RSK-03',
    en: 'Commitment without available budget',
    ar: 'الالتزام دون اعتماد متاح',
    descEn: 'A purchase order is issued although the budget line is exhausted.',
    descAr: 'يصدر أمر شراء رغم استنفاد بند الميزانية.',
    category: 'FINANCIAL',
    inherent: [3, 4],
    residual: [2, 4],
    controls: ['CTL-04'],
    dept: 'FIN',
    reviewDays: 60,
  },
  {
    code: 'RSK-04',
    en: 'Duplicate invoice payment',
    ar: 'سداد فاتورة مكررة',
    descEn: 'The same supplier invoice is paid twice.',
    descAr: 'تُسدَّد فاتورة المورد نفسها مرتين.',
    category: 'FINANCIAL',
    inherent: [3, 3],
    residual: [2, 3],
    controls: ['CTL-05', 'CTL-06'],
    dept: 'FIN',
    reviewDays: 120,
  },
  {
    code: 'RSK-05',
    en: 'Payment to a fraudulent bank account',
    ar: 'السداد إلى حساب بنكي احتيالي',
    descEn: 'Supplier bank details are changed by an impostor before a payment run.',
    descAr: 'يغير منتحل بيانات الحساب البنكي للمورد قبل دفعة السداد.',
    category: 'FRAUD',
    inherent: [3, 5],
    residual: [2, 4],
    controls: ['CTL-07', 'CTL-08'],
    dept: 'FIN',
    reviewDays: 75,
  },
  {
    code: 'RSK-06',
    en: 'Late payment penalties',
    ar: 'غرامات التأخر في السداد',
    descEn: 'Suppliers are paid after the contractual term.',
    descAr: 'يُدفع للموردين بعد المدة التعاقدية.',
    category: 'COMPLIANCE',
    inherent: [3, 2],
    residual: [2, 2],
    controls: ['CTL-10'],
    dept: 'FIN',
    reviewDays: 200,
  },
  {
    code: 'RSK-07',
    en: 'Inactive suppliers used for fictitious purchases',
    ar: 'استخدام موردين غير نشطين لمشتريات وهمية',
    descEn: 'Dormant supplier records are reactivated for fictitious invoices.',
    descAr: 'تُعاد تفعيل سجلات موردين خاملين لفواتير وهمية.',
    category: 'FRAUD',
    inherent: [2, 4],
    controls: ['CTL-09'],
    dept: 'PRC',
    reviewDays: 30,
  },
  {
    code: 'RSK-08',
    en: 'ERP outage stops purchasing',
    ar: 'توقف نظام تخطيط الموارد يوقف المشتريات',
    descEn: 'Requisitions cannot be raised or approved while the ERP is down.',
    descAr: 'لا يمكن إنشاء الطلبات أو اعتمادها أثناء توقف النظام.',
    category: 'IT',
    inherent: [2, 3],
    residual: [2, 2],
    response: 'TRANSFER',
    controls: [],
    dept: 'IT',
    reviewDays: 180,
  },
  {
    code: 'RSK-09',
    en: 'Customer identity fraud at onboarding',
    ar: 'احتيال الهوية عند تسجيل العميل',
    descEn: 'An account is opened with forged identity documents.',
    descAr: 'يُفتح حساب بوثائق هوية مزورة.',
    category: 'COMPLIANCE',
    inherent: [3, 4],
    residual: [1, 4],
    controls: ['CTL-11'],
    dept: 'CS',
    reviewDays: 140,
  },
  {
    code: 'RSK-10',
    en: 'Emergency purchases bypass approval',
    ar: 'تجاوز الاعتماد في المشتريات الطارئة',
    descEn: 'Emergency purchases are made without later approval.',
    descAr: 'تتم المشتريات الطارئة دون اعتماد لاحق.',
    category: 'OPERATIONAL',
    inherent: [2, 3],
    controls: ['CTL-12'],
    dept: 'PRC',
    status: 'DRAFT',
  },
];

/** Proposals: not part of any published version. */
const DRAFTS = new Set(['RSK-10', 'CTL-12']);

/** Step links: process code → element → item codes. */
const STEP_LINKS: [string, string, string[]][] = [
  ['S.01.01', 'Task_Create', ['RSK-01', 'RSK-10', 'CTL-01']],
  ['S.01.01', 'Task_Approve', ['RSK-02', 'RSK-03', 'CTL-02', 'CTL-03', 'CTL-04']],
  ['S.01.01', 'Task_PO', ['RSK-08']],
  ['S.01.01', PROCESS_ELEMENT_ID, ['GPL-12', 'GPL-40', 'BUD-3']],
  ['S.01', 'Task_Invoice', ['RSK-04', 'CTL-05', 'CTL-06']],
  ['S.01', 'Task_Pay', ['RSK-05', 'RSK-06', 'CTL-07', 'CTL-08', 'CTL-10']],
  ['S.01', 'Call_Requisition', ['RSK-07']],
  ['S.01', PROCESS_ELEMENT_ID, ['BUD-9']],
  ['C.01.01', 'Task_Register', ['RSK-09', 'CTL-11']],
];

export async function seedGrcDemo(prisma: PrismaClient, adminId: string | null): Promise<void> {
  if ((await prisma.risk.count()) > 0) return;
  const day = 86_400_000;
  const inDays = (n?: number) => (n === undefined ? null : new Date(Date.now() + n * day));
  const dept = async (code: string) =>
    (await prisma.department.findFirst({ where: { code } }))?.id ?? null;
  const officer = await prisma.user.findFirst({ where: { email: { startsWith: 'risk@' } } });
  const owner = await prisma.user.findFirst({ where: { email: { startsWith: 'owner@' } } });
  const actor = officer?.id ?? adminId;
  const audit = { createdById: actor, updatedById: actor };
  const ids = new Map<string, string>();

  for (const r of REQUIREMENTS) {
    const o = await prisma.repoObject.create({
      data: {
        type: 'REQUIREMENT',
        code: r.code,
        nameEn: r.en,
        nameAr: r.ar,
        descriptionEn: r.textEn ?? '',
        descriptionAr: r.textAr ?? '',
        ownerId: officer?.id ?? null,
        ...audit,
        requirement: {
          create: {
            level: r.level,
            parentId: r.parent ? ids.get(r.parent) : null,
            sourceRef: r.sourceRef ?? '',
            url: r.url ?? null,
            departmentId: await dept('RSK'),
            effectiveDate: new Date('2024-01-01'),
            status: 'ACTIVE',
          },
        },
      },
    });
    ids.set(r.code, o.id);
  }

  const systems = new Map(
    (await prisma.repoObject.findMany({ where: { type: 'SYSTEM' } })).map((s) => [s.code, s.id]),
  );
  for (const c of CONTROLS) {
    const o = await prisma.repoObject.create({
      data: {
        type: 'CONTROL',
        code: c.code,
        nameEn: c.en,
        nameAr: c.ar,
        descriptionEn: c.descEn,
        descriptionAr: c.descAr,
        ownerId: owner?.id ?? null,
        ...audit,
        control: {
          create: {
            controlType: c.type,
            nature: c.nature,
            frequency: c.frequency,
            keyControl: c.key ?? false,
            systemId: c.system ? (systems.get(c.system) ?? null) : null,
            effectiveness: c.effectiveness,
            status: c.status ?? 'ACTIVE',
            departmentId: await dept(c.code === 'CTL-11' ? 'CS' : 'FIN'),
            nextReviewAt: inDays(c.reviewDays),
            lastAssessedAt: c.effectiveness === 'NOT_ASSESSED' ? null : inDays(-40),
          },
        },
        grcActivities: {
          create: {
            kind: 'CREATED',
            changes: { effectiveness: { from: null, to: c.effectiveness } },
            createdById: actor,
          },
        },
      },
    });
    ids.set(c.code, o.id);
    for (const req of c.requirements ?? [])
      await prisma.requirementControl.create({
        data: { requirementId: ids.get(req)!, controlId: o.id, createdById: actor },
      });
  }

  for (const r of RISKS) {
    const o = await prisma.repoObject.create({
      data: {
        type: 'RISK',
        code: r.code,
        nameEn: r.en,
        nameAr: r.ar,
        descriptionEn: r.descEn,
        descriptionAr: r.descAr,
        ownerId: owner?.id ?? null,
        ...audit,
        risk: {
          create: {
            category: r.category,
            causeEn: r.causeEn ?? '',
            causeAr: r.causeAr ?? '',
            consequenceEn: r.consequenceEn ?? '',
            consequenceAr: r.consequenceAr ?? '',
            departmentId: await dept(r.dept),
            inherentLikelihood: r.inherent[0],
            inherentImpact: r.inherent[1],
            residualLikelihood: r.residual?.[0] ?? null,
            residualImpact: r.residual?.[1] ?? null,
            response: r.response ?? 'MITIGATE',
            status: r.status ?? 'ACTIVE',
            nextReviewAt: inDays(r.reviewDays),
            lastAssessedAt: inDays(-40),
          },
        },
        grcActivities: {
          create: [
            {
              kind: 'CREATED',
              changes: {
                inherentLikelihood: { from: null, to: r.inherent[0] },
                inherentImpact: { from: null, to: r.inherent[1] },
              },
              createdById: actor,
              createdAt: inDays(-60)!,
            },
            ...(r.residual
              ? [
                  {
                    kind: 'ASSESSMENT' as const,
                    changes: {
                      residualLikelihood: { from: null, to: r.residual[0] },
                      residualImpact: { from: null, to: r.residual[1] },
                    },
                    comment: 'Annual risk assessment workshop',
                    createdById: actor,
                    createdAt: inDays(-40)!,
                  },
                ]
              : []),
          ],
        },
      },
    });
    ids.set(r.code, o.id);
    for (const c of r.controls)
      await prisma.riskControl.create({
        data: { riskId: o.id, controlId: ids.get(c)!, createdById: actor },
      });
  }

  // Step links; published versions get them too (they were linked before publishing).
  for (const [code, element, items] of STEP_LINKS) {
    const p = await prisma.process.findFirst({ where: { code, deletedAt: null } });
    if (!p) continue;
    const pub = await prisma.publication.findFirst({
      where: { entityType: 'PROCESS', entityId: p.id, current: true },
    });
    for (const itemCode of items) {
      const objectId = ids.get(itemCode)!;
      const relation =
        itemCode.startsWith('RSK') || itemCode.startsWith('CTL') ? 'MITIGATES' : 'REQUIRES';
      await prisma.objectLink.create({
        data: {
          processId: p.id,
          bpmnElementId: element,
          repoObjectId: objectId,
          relation,
          createdById: actor,
        },
      });
      if (pub && !DRAFTS.has(itemCode))
        await prisma.publishedLink.create({
          data: { publicationId: pub.id, bpmnElementId: element, repoObjectId: objectId, relation },
        });
    }
  }
  console.log(
    `Seeded Risk & Compliance demo data: ${RISKS.length} risks, ${CONTROLS.length} controls, ${REQUIREMENTS.length} requirements.`,
  );
}
