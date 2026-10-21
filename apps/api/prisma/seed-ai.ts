import type { Prisma, PrismaClient } from '@prisma/client';
import { SETTING_KEYS, type AiSuggestions } from '@processhub/shared';
import { AI_DEFAULTS } from '../src/ai/ai-defaults';

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
