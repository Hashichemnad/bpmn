import type { Locale, ProcessCategory, ProcessStatus, StepType } from '@processhub/shared';

/**
 * Texts of the generated documents (handbook .docx, RACI and object reports .xlsx). Server-side
 * like the e-mail templates: the files are created on the server in the requested language.
 */
const EN = {
  handbookTitle: 'Process handbook',
  generatedOn: 'Generated on {date} by {user}',
  sourceWorking: 'Working version (may contain changes not yet approved)',
  sourcePublished: 'Published (official) version',
  contents: 'Contents',
  tocHint: 'Right-click and choose “Update field” if the table of contents is empty.',
  description: 'Description',
  noDescription: 'No description.',
  details: 'Process details',
  code: 'Code',
  category: 'Category',
  status: 'Status',
  owner: 'Owner',
  department: 'Department',
  version: 'Version',
  versionLabel: 'Version label',
  approvedAt: 'Approved on',
  approvedBy: 'Approved by',
  publishedAt: 'Published on',
  diagram: 'Process diagram',
  noDiagram: 'No diagram.',
  steps: 'Steps',
  step: 'Step',
  role: 'Role',
  system: 'IT system',
  type: 'Type',
  attributes: 'Attributes',
  processing: 'Processing',
  waiting: 'Waiting',
  sla: 'SLA',
  frequency: 'Frequency',
  perMonth: '{n} / month',
  cost: 'Cost',
  inputs: 'Inputs',
  outputs: 'Outputs',
  documents: 'Linked documents',
  noDocuments: 'No linked documents.',
  procedures: 'Procedures and instructions',
  /** Footer: "Page " n " of " m. */
  pageBefore: 'Page ',
  pageOf: ' of ',
  none: '—',
  minutes: '{n} min',
  hours: '{n} h',
  days: '{n} d',
  // RACI / object reports
  raciSheet: 'RACI',
  systemsSheet: 'IT systems',
  stepsSheet: 'Steps',
  legendSheet: 'Legend',
  raciLegend: [
    ['R', 'Responsible: performs the step (lane or “performs” link)'],
    ['A', 'Accountable: approves (performer of an approval step)'],
  ],
  process: 'Process',
  lane: 'Lane',
  objectReport: 'Where used',
  objectType: 'Object type',
  relation: 'Relation',
  element: 'Step / element',
  usedIn: 'Used in {n} steps of {p} processes',
  categories: { MANAGEMENT: 'Management', CORE: 'Core', SUPPORT: 'Support' },
  statuses: {
    DRAFT: 'Draft',
    IN_REVIEW: 'In review',
    APPROVED: 'Approved',
    PUBLISHED: 'Published',
    ARCHIVED: 'Archived',
  },
  stepTypes: {
    task: 'Task',
    approval: 'Approval',
    system: 'System step',
    notification: 'Notification',
    decision: 'Decision',
    end: 'End',
    other: 'Other',
  },
  objectTypes: {
    ROLE: 'Role',
    SYSTEM: 'IT system',
    DOCUMENT: 'Document',
    RISK: 'Risk',
    CONTROL: 'Control',
    KPI: 'KPI',
    TERM: 'Dictionary term',
  },
  relations: {
    PERFORMS: 'Performs',
    SUPPORTS: 'Supports',
    INPUT: 'Input',
    OUTPUT: 'Output',
    MITIGATES: 'Mitigates',
    MEASURES: 'Measures',
    NAMED: 'Label (dictionary)',
  },
};

type Texts = typeof EN;

const AR: Texts = {
  handbookTitle: 'دليل العمليات',
  generatedOn: 'أُنشئ في {date} بواسطة {user}',
  sourceWorking: 'نسخة العمل (قد تتضمن تغييرات لم تُعتمد بعد)',
  sourcePublished: 'النسخة المنشورة (الرسمية)',
  contents: 'المحتويات',
  tocHint: 'انقر بزر الفأرة الأيمن واختر «تحديث الحقل» إذا كان جدول المحتويات فارغًا.',
  description: 'الوصف',
  noDescription: 'لا يوجد وصف.',
  details: 'بيانات العملية',
  code: 'الرمز',
  category: 'الفئة',
  status: 'الحالة',
  owner: 'المالك',
  department: 'الإدارة',
  version: 'الإصدار',
  versionLabel: 'تسمية الإصدار',
  approvedAt: 'تاريخ الاعتماد',
  approvedBy: 'اعتمده',
  publishedAt: 'تاريخ النشر',
  diagram: 'مخطط العملية',
  noDiagram: 'لا يوجد مخطط.',
  steps: 'الخطوات',
  step: 'الخطوة',
  role: 'الدور',
  system: 'نظام تقنية المعلومات',
  type: 'النوع',
  attributes: 'الخصائص',
  processing: 'المعالجة',
  waiting: 'الانتظار',
  sla: 'مستوى الخدمة',
  frequency: 'التكرار',
  perMonth: '{n} / شهر',
  cost: 'التكلفة',
  inputs: 'المدخلات',
  outputs: 'المخرجات',
  documents: 'الوثائق المرتبطة',
  noDocuments: 'لا توجد وثائق مرتبطة.',
  procedures: 'الإجراءات والتعليمات',
  pageBefore: 'صفحة ',
  pageOf: ' من ',
  none: '—',
  minutes: '{n} د',
  hours: '{n} س',
  days: '{n} ي',
  raciSheet: 'مصفوفة المسؤوليات',
  systemsSheet: 'أنظمة تقنية المعلومات',
  stepsSheet: 'الخطوات',
  legendSheet: 'الدليل',
  raciLegend: [
    ['R', 'مسؤول التنفيذ: ينفذ الخطوة (المسار أو رابط «ينفّذ»)'],
    ['A', 'صاحب القرار: يعتمد (منفذ خطوة الاعتماد)'],
  ],
  process: 'العملية',
  lane: 'المسار',
  objectReport: 'أماكن الاستخدام',
  objectType: 'نوع العنصر',
  relation: 'العلاقة',
  element: 'الخطوة / العنصر',
  usedIn: 'مستخدم في {n} خطوة ضمن {p} عملية',
  categories: { MANAGEMENT: 'إدارية', CORE: 'رئيسية', SUPPORT: 'مساندة' },
  statuses: {
    DRAFT: 'مسودة',
    IN_REVIEW: 'قيد المراجعة',
    APPROVED: 'معتمدة',
    PUBLISHED: 'منشورة',
    ARCHIVED: 'مؤرشفة',
  },
  stepTypes: {
    task: 'مهمة',
    approval: 'اعتماد',
    system: 'خطوة آلية',
    notification: 'إشعار',
    decision: 'قرار',
    end: 'نهاية',
    other: 'أخرى',
  },
  objectTypes: {
    ROLE: 'دور',
    SYSTEM: 'نظام تقنية معلومات',
    DOCUMENT: 'وثيقة',
    RISK: 'خطر',
    CONTROL: 'ضابط',
    KPI: 'مؤشر أداء',
    TERM: 'مصطلح القاموس',
  },
  relations: {
    PERFORMS: 'ينفّذ',
    SUPPORTS: 'يدعم',
    INPUT: 'مدخل',
    OUTPUT: 'مخرج',
    MITIGATES: 'يخفف',
    MEASURES: 'يقيس',
    NAMED: 'التسمية (القاموس)',
  },
};

export function reportTexts(locale: Locale): Texts {
  return locale === 'ar' ? AR : EN;
}

/** `{name}` placeholders. */
export const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

export const categoryText = (l: Locale, c: ProcessCategory) => reportTexts(l).categories[c];
export const statusText = (l: Locale, s: ProcessStatus) => reportTexts(l).statuses[s];
export const stepTypeText = (l: Locale, s: StepType) => reportTexts(l).stepTypes[s];

/** Minutes as "1 d 2 h 30 min" in the report language. */
export function minutesText(locale: Locale, minutes: number): string {
  const t = reportTexts(locale);
  const n = (v: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en').format(v);
  const total = Math.round(minutes);
  if (!total) return fill(t.minutes, { n: n(0) });
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  return [
    d && fill(t.days, { n: n(d) }),
    h && fill(t.hours, { n: n(h) }),
    m && fill(t.minutes, { n: n(m) }),
  ]
    .filter(Boolean)
    .join(' ');
}

/** Bilingual name in the report language, falling back to the other one. */
export const pick = (l: Locale, o: { nameEn?: string; nameAr?: string } | null | undefined) =>
  o ? (l === 'ar' ? o.nameAr || o.nameEn : o.nameEn || o.nameAr) || '' : '';
