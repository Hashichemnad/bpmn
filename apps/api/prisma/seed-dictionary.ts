/**
 * Modeler design B2 demo data: a small bilingual dictionary (approved terms with synonyms and one
 * proposal), so the label autocomplete works on a demo installation. Runs once (no terms yet).
 */
import type { PrismaClient } from '@prisma/client';

const TERMS = [
  {
    nameEn: 'Program request',
    nameAr: 'طلب برنامج',
    descriptionEn: 'A formal request to start a new program or initiative.',
    descriptionAr: 'طلب رسمي لبدء برنامج أو مبادرة جديدة.',
    synonymsEn: ['Initiative request', 'Project request'],
    synonymsAr: ['طلب مبادرة', 'طلب مشروع'],
    category: 'Programs',
  },
  {
    nameEn: 'Feasibility study',
    nameAr: 'دراسة الجدوى',
    descriptionEn: 'Analysis of the cost, benefit and risk of a proposal.',
    descriptionAr: 'تحليل تكلفة المقترح وفوائده ومخاطره.',
    synonymsEn: ['Business case'],
    synonymsAr: ['دراسة جدوى'],
    category: 'Programs',
  },
  {
    nameEn: 'Budget approval',
    nameAr: 'اعتماد الميزانية',
    descriptionEn: 'Confirmation by Finance that funds are available.',
    descriptionAr: 'تأكيد الإدارة المالية توفر الاعتمادات.',
    synonymsEn: ['Funding approval'],
    synonymsAr: ['الموافقة على التمويل'],
    category: 'Finance',
  },
  {
    nameEn: 'Purchase requisition',
    nameAr: 'طلب شراء',
    descriptionEn: 'Internal request to buy goods or services.',
    descriptionAr: 'طلب داخلي لشراء سلع أو خدمات.',
    synonymsEn: ['PR', 'Purchase request'],
    synonymsAr: ['طلب مشتريات'],
    category: 'Procurement',
  },
  {
    nameEn: 'Customer onboarding',
    nameAr: 'تهيئة العميل',
    descriptionEn: 'Steps to register and activate a new customer.',
    descriptionAr: 'خطوات تسجيل عميل جديد وتفعيله.',
    synonymsEn: ['Client onboarding'],
    synonymsAr: ['تسجيل العميل'],
    category: 'Customers',
  },
];

export async function seedDictionaryDemo(prisma: PrismaClient, adminId: string | null) {
  if ((await prisma.repoObject.count({ where: { type: 'TERM' } })) > 0) return;
  const owner = await prisma.user.findFirst({ where: { email: { startsWith: 'owner@' } } });
  const modeler = await prisma.user.findFirst({ where: { email: { startsWith: 'modeler@' } } });
  const approver = owner?.id ?? adminId;
  for (const t of TERMS)
    await prisma.repoObject.create({
      data: {
        type: 'TERM',
        ...t,
        status: 'APPROVED',
        ownerId: owner?.id ?? null,
        approvedAt: new Date(),
        approvedById: approver,
        createdById: approver,
        updatedById: approver,
      },
    });
  await prisma.repoObject.create({
    data: {
      type: 'TERM',
      nameEn: 'Steering committee',
      nameAr: 'اللجنة التوجيهية',
      descriptionEn: 'Senior group that decides on program priorities.',
      descriptionAr: 'مجموعة قيادية تقرر أولويات البرامج.',
      synonymsEn: ['Program board'],
      category: 'Governance',
      status: 'DRAFT',
      createdById: modeler?.id ?? adminId,
      updatedById: modeler?.id ?? adminId,
    },
  });
  console.log(`Seeded dictionary demo: ${TERMS.length} approved terms and 1 proposal.`);
}
