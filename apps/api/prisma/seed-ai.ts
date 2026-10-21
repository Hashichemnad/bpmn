import type { Prisma, PrismaClient } from '@prisma/client';
import { SETTING_KEYS, addMonths, type AiSuggestions } from '@processhub/shared';
import { AI_DEFAULTS } from '../src/ai/ai-defaults';
import { htmlToText, sanitizeRichText } from '../src/docs/rich-text';
import { createPublication } from '../src/governance/publication';

/** One sample prompt per feature, shown as suggestion chips (the guided demo, docs/AI-DEMO.md). */
export const DEMO_SUGGESTIONS: AiSuggestions = {
  GENERATE_PROCESS: [
    {
      en: 'Build a process for employee onboarding with HR, IT and the line manager',
      ar: 'أنشئ عملية لتهيئة الموظف الجديد بمشاركة الموارد البشرية وتقنية المعلومات والمدير المباشر',
    },
  ],
  REFINE_PROCESS: [
    {
      en: 'Add an approval step by the finance manager after step 3',
      ar: 'أضف خطوة اعتماد من المدير المالي بعد الخطوة 3',
    },
  ],
  GENERATE_DOC: [
    {
      en: 'Write it for new employees: clear responsibilities and the IT systems used',
      ar: 'اكتبه للموظفين الجدد: مسؤوليات واضحة والأنظمة المستخدمة',
    },
  ],
  ANALYSE: [
    {
      en: 'Focus on approval controls and segregation of duties',
      ar: 'ركّز على ضوابط الاعتماد والفصل بين المهام',
    },
  ],
  SUMMARISE: [
    {
      en: 'Summarise in three bullet points for a new employee',
      ar: 'لخّص في ثلاث نقاط لموظف جديد',
    },
  ],
  PORTAL_QA: [
    { en: 'How do I request a new laptop?', ar: 'كيف أطلب حاسوبًا محمولًا جديدًا؟' },
    { en: 'Who approves a purchase requisition?', ar: 'من يعتمد طلب الشراء؟' },
  ],
};

/**
 * Demo installation: AI settings with the suggestion chips. The assistant stays disabled until
 * a Super Admin enters an API key (Settings → AI). Never overwrites existing settings.
 */
export async function seedAiDemo(prisma: PrismaClient): Promise<void> {
  if (await prisma.setting.findUnique({ where: { key: SETTING_KEYS.AI } })) return;
  await prisma.setting.create({
    data: {
      key: SETTING_KEYS.AI,
      value: { ...AI_DEFAULTS, suggestions: DEMO_SUGGESTIONS } as unknown as Prisma.InputJsonValue,
    },
  });
  console.log('AI assistant: demo suggestions added (disabled until an API key is entered).');
}

const EQUIPMENT_EN = `<h2>Purpose</h2><p>How employees request a new laptop, monitor, phone or other IT equipment, and how requests are approved.</p>
<h2>How to request a new laptop</h2><ol><li>Open the <strong>IT Service Desk</strong> portal and choose <em>New request → Hardware</em>.</li><li>Select the equipment (standard laptop, developer laptop, monitor, phone) and give a short business reason.</li><li>Your <strong>line manager</strong> approves the request in the service desk. Requests above the standard catalogue also need approval from the <strong>IT manager</strong>.</li><li>IT Support prepares the device, installs the standard software and contacts you to hand it over (usually within 5 working days).</li><li>Sign the asset handover form; the device is registered to you in the asset register.</li></ol>
<div data-type="callout" data-callout="info"><p>Replacing a broken or stolen device: report it first as an incident in the IT Service Desk; IT decides whether it is repaired or replaced.</p></div>
<h2>Returning equipment</h2><p>When you leave or receive a replacement, return the old device to IT Support. Data is wiped according to the Information Security Policy.</p>`;

const EQUIPMENT_AR = `<h2>الغرض</h2><p>كيف يطلب الموظفون حاسوبًا محمولًا جديدًا أو شاشة أو هاتفًا أو غيرها من أجهزة تقنية المعلومات، وكيف تُعتمد الطلبات.</p>
<h2>كيفية طلب حاسوب محمول جديد</h2><ol><li>افتح بوابة <strong>مكتب خدمات تقنية المعلومات</strong> واختر <em>طلب جديد ← أجهزة</em>.</li><li>اختر الجهاز (حاسوب قياسي، حاسوب للمطورين، شاشة، هاتف) واذكر سببًا موجزًا للعمل.</li><li>يعتمد <strong>المدير المباشر</strong> الطلب في مكتب الخدمات. وتحتاج الطلبات خارج الكتالوج القياسي أيضًا إلى اعتماد <strong>مدير تقنية المعلومات</strong>.</li><li>يجهّز الدعم الفني الجهاز ويثبّت البرامج القياسية ويتواصل معك لتسليمه (عادة خلال 5 أيام عمل).</li><li>وقّع نموذج استلام الأصل؛ ويُسجَّل الجهاز باسمك في سجل الأصول.</li></ol>
<div data-type="callout" data-callout="info"><p>استبدال جهاز معطل أو مسروق: أبلغ عنه أولًا كحادث في مكتب خدمات تقنية المعلومات، ويقرر الفريق إصلاحه أو استبداله.</p></div>
<h2>إعادة الأجهزة</h2><p>عند مغادرتك أو استلام جهاز بديل، أعد الجهاز القديم إلى الدعم الفني. تُمسح البيانات وفق سياسة أمن المعلومات.</p>`;

/**
 * Demo installation: a published IT page that answers the portal assistant's sample question
 * ("How do I request a new laptop?"). Skipped when the IT space is missing or the page exists.
 */
export async function seedAiDemoContent(
  prisma: PrismaClient,
  adminId: string | null,
): Promise<void> {
  const space = await prisma.space.findFirst({ where: { key: 'ITP', deletedAt: null } });
  const reviewer = await prisma.user.findFirst({ where: { email: { startsWith: 'reviewer@' } } });
  if (!space || !reviewer || !adminId) return;
  const titleEn = 'Requesting IT Equipment';
  if (await prisma.page.findFirst({ where: { spaceId: space.id, titleEn } })) return;
  const content = {
    titleEn,
    titleAr: 'طلب أجهزة تقنية المعلومات',
    contentEn: sanitizeRichText(EQUIPMENT_EN.replace(/\n/g, '')),
    contentAr: sanitizeRichText(EQUIPMENT_AR.replace(/\n/g, '')),
    dirEn: 'ltr',
    dirAr: 'rtl',
  };
  const sortOrder = await prisma.page.count({ where: { spaceId: space.id, parentId: null } });
  const now = new Date();
  const page = await prisma.page.create({
    data: {
      spaceId: space.id,
      sortOrder,
      ...content,
      textEn: htmlToText(content.contentEn),
      textAr: htmlToText(content.contentAr),
      version: 1,
      status: 'PUBLISHED',
      createdById: adminId,
      updatedById: adminId,
    },
  });
  await prisma.pageVersion.create({
    data: {
      pageId: page.id,
      versionNumber: 1,
      ...content,
      changeNote: 'Created',
      label: 'v1.0',
      createdById: adminId,
    },
  });
  const review = await prisma.review.create({
    data: {
      entityType: 'PAGE',
      entityId: page.id,
      versionNumber: 1,
      status: 'APPROVED',
      workflowNameEn: 'Policy review (any one reviewer)',
      workflowNameAr: 'مراجعة السياسات (أي مراجع)',
      steps: [
        {
          nameEn: 'Review',
          nameAr: 'مراجعة',
          rule: 'ANY',
          assigneeIds: [reviewer.id],
          approvedBySubmitter: false,
        },
      ] as unknown as Prisma.InputJsonValue,
      submittedById: adminId,
      completedAt: now,
      tasks: {
        create: [{ stepIndex: 0, assigneeId: reviewer.id, status: 'APPROVED', decidedAt: now }],
      },
    },
  });
  await prisma.$transaction((tx) =>
    createPublication(tx, {
      type: 'PAGE',
      id: page.id,
      reviewId: review.id,
      actorId: adminId,
      label: 'v1.0',
      nextReviewAt: addMonths(now, 12),
    }),
  );
  console.log(
    'AI assistant: published the demo page "Requesting IT Equipment" for the portal assistant.',
  );
}
