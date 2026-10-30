/**
 * Phase 4.3 demo data (demo installations only): the application catalogue with interfaces and
 * data objects, a three-level capability map linked to the demo processes, two strategic
 * objectives and eight KPIs with twelve months of values (some amber / red), one of them a key
 * risk indicator of a Risk & Compliance risk. Runs once (no capabilities yet).
 */
import type { PrismaClient } from '@prisma/client';
import {
  PROCESS_ELEMENT_ID,
  duePeriod,
  periodRange,
  periodStart,
  type KpiFrequency,
} from '@processhub/shared';

type Lifecycle = 'PLANNED' | 'ACTIVE' | 'PHASING_OUT' | 'RETIRED';
type AppType = 'APPLICATION' | 'PLATFORM' | 'SERVICE' | 'DATABASE' | 'EXTERNAL';

interface DemoApp {
  code: string;
  en: string;
  ar: string;
  descEn?: string;
  descAr?: string;
  type: AppType;
  vendor: string;
  version?: string;
  hosting: 'ON_PREMISE' | 'CLOUD' | 'SAAS';
  country: string;
  lifecycle: Lifecycle;
  criticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  classification: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'SECRET';
  dept: string;
  phaseOutMonths?: number;
}

/** SYS-01 – SYS-05 exist in the base demo (library IT systems); they get catalogue details. */
const APPS: DemoApp[] = [
  {
    code: 'SYS-01',
    en: 'ERP (SAP S/4HANA)',
    ar: 'نظام تخطيط موارد المؤسسة',
    type: 'APPLICATION',
    vendor: 'SAP',
    version: '2023',
    hosting: 'ON_PREMISE',
    country: 'AE',
    lifecycle: 'ACTIVE',
    criticality: 'CRITICAL',
    classification: 'CONFIDENTIAL',
    dept: 'FIN',
  },
  {
    code: 'SYS-02',
    en: 'CRM (Salesforce)',
    ar: 'نظام إدارة علاقات العملاء',
    type: 'APPLICATION',
    vendor: 'Salesforce',
    hosting: 'SAAS',
    country: 'AE',
    lifecycle: 'ACTIVE',
    criticality: 'HIGH',
    classification: 'CONFIDENTIAL',
    dept: 'IT',
  },
  {
    code: 'SYS-03',
    en: 'Email',
    ar: 'البريد الإلكتروني',
    type: 'SERVICE',
    vendor: 'Microsoft',
    hosting: 'CLOUD',
    country: 'AE',
    lifecycle: 'ACTIVE',
    criticality: 'MEDIUM',
    classification: 'INTERNAL',
    dept: 'IT',
  },
  {
    code: 'SYS-04',
    en: 'Core Banking',
    ar: 'النظام المصرفي الأساسي',
    type: 'APPLICATION',
    vendor: 'Temenos',
    version: 'R19',
    hosting: 'ON_PREMISE',
    country: 'AE',
    lifecycle: 'PHASING_OUT',
    criticality: 'CRITICAL',
    classification: 'SECRET',
    dept: 'FIN',
    phaseOutMonths: -2,
  },
  {
    code: 'SYS-05',
    en: 'Document Management',
    ar: 'نظام إدارة الوثائق',
    type: 'APPLICATION',
    vendor: 'OpenText',
    hosting: 'ON_PREMISE',
    country: 'AE',
    lifecycle: 'ACTIVE',
    criticality: 'MEDIUM',
    classification: 'INTERNAL',
    dept: 'IT',
  },
  {
    code: 'SYS-06',
    en: 'HR System (Oracle HCM)',
    ar: 'نظام الموارد البشرية',
    descEn: 'Employee records, payroll and leave.',
    descAr: 'سجلات الموظفين والرواتب والإجازات.',
    type: 'APPLICATION',
    vendor: 'Oracle',
    hosting: 'SAAS',
    country: 'AE',
    lifecycle: 'ACTIVE',
    criticality: 'HIGH',
    classification: 'CONFIDENTIAL',
    dept: 'IT',
  },
  {
    code: 'SYS-07',
    en: 'e-Procurement Portal',
    ar: 'بوابة المشتريات الإلكترونية',
    descEn: 'Supplier bids and purchase orders online.',
    descAr: 'عروض الموردين وأوامر الشراء إلكترونيًا.',
    type: 'APPLICATION',
    vendor: 'SAP Ariba',
    hosting: 'SAAS',
    country: 'AE',
    lifecycle: 'PLANNED',
    criticality: 'HIGH',
    classification: 'INTERNAL',
    dept: 'PRC',
  },
  {
    code: 'SYS-08',
    en: 'Data Warehouse',
    ar: 'مستودع البيانات',
    type: 'DATABASE',
    vendor: 'Microsoft',
    version: 'SQL Server 2022',
    hosting: 'ON_PREMISE',
    country: 'AE',
    lifecycle: 'ACTIVE',
    criticality: 'MEDIUM',
    classification: 'CONFIDENTIAL',
    dept: 'IT',
  },
  {
    code: 'SYS-09',
    en: 'Identity Provider (Entra ID)',
    ar: 'مزود الهوية',
    type: 'PLATFORM',
    vendor: 'Microsoft',
    hosting: 'CLOUD',
    country: 'AE',
    lifecycle: 'ACTIVE',
    criticality: 'CRITICAL',
    classification: 'CONFIDENTIAL',
    dept: 'IT',
  },
  {
    code: 'SYS-10',
    en: 'Payment Gateway',
    ar: 'بوابة الدفع',
    type: 'EXTERNAL',
    vendor: 'Network International',
    hosting: 'SAAS',
    country: 'AE',
    lifecycle: 'ACTIVE',
    criticality: 'HIGH',
    classification: 'SECRET',
    dept: 'FIN',
  },
  {
    code: 'SYS-11',
    en: 'Government e-Services Portal',
    ar: 'بوابة الخدمات الحكومية الإلكترونية',
    type: 'EXTERNAL',
    vendor: 'Government',
    hosting: 'CLOUD',
    country: 'AE',
    lifecycle: 'ACTIVE',
    criticality: 'MEDIUM',
    classification: 'PUBLIC',
    dept: 'IT',
  },
  {
    code: 'SYS-12',
    en: 'Legacy Finance System',
    ar: 'النظام المالي القديم',
    descEn: 'Replaced by the ERP; kept read-only for archives.',
    descAr: 'استُبدل بنظام تخطيط الموارد؛ يبقى للقراءة فقط للأرشيف.',
    type: 'APPLICATION',
    vendor: 'In-house',
    hosting: 'ON_PREMISE',
    country: 'AE',
    lifecycle: 'RETIRED',
    criticality: 'LOW',
    classification: 'CONFIDENTIAL',
    dept: 'FIN',
  },
];

const INTERFACES: [
  string,
  string,
  'API' | 'FILE' | 'DB_LINK' | 'MANUAL' | 'MESSAGE_QUEUE',
  'REAL_TIME' | 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ON_DEMAND',
  string[],
  'ONE_WAY' | 'TWO_WAY',
][] = [
  ['SYS-02', 'SYS-01', 'API', 'REAL_TIME', ['D-CUS'], 'ONE_WAY'],
  ['SYS-07', 'SYS-01', 'API', 'REAL_TIME', ['D-PO', 'D-SUP'], 'TWO_WAY'],
  ['SYS-06', 'SYS-01', 'FILE', 'DAILY', ['D-EMP'], 'ONE_WAY'],
  ['SYS-01', 'SYS-10', 'API', 'REAL_TIME', ['D-PAY'], 'ONE_WAY'],
  ['SYS-01', 'SYS-08', 'DB_LINK', 'DAILY', ['D-BUD', 'D-INV', 'D-PO'], 'ONE_WAY'],
  ['SYS-02', 'SYS-04', 'API', 'REAL_TIME', ['D-CUS'], 'TWO_WAY'],
  ['SYS-04', 'SYS-08', 'FILE', 'DAILY', ['D-PAY'], 'ONE_WAY'],
  ['SYS-11', 'SYS-02', 'API', 'REAL_TIME', ['D-CUS'], 'ONE_WAY'],
  ['SYS-09', 'SYS-06', 'API', 'REAL_TIME', ['D-EMP'], 'ONE_WAY'],
  ['SYS-12', 'SYS-08', 'MANUAL', 'MONTHLY', ['D-INV'], 'ONE_WAY'],
];

const DATA: {
  code: string;
  en: string;
  ar: string;
  defEn: string;
  defAr: string;
  cls: DemoApp['classification'];
  sor: string;
  crud: [string, string][];
}[] = [
  {
    code: 'D-BUD',
    en: 'Budget',
    ar: 'الميزانية',
    defEn: 'Approved budget lines and their available amounts.',
    defAr: 'بنود الميزانية المعتمدة والمبالغ المتاحة.',
    cls: 'CONFIDENTIAL',
    sor: 'SYS-01',
    crud: [
      ['SYS-01', 'CRUD'],
      ['SYS-08', 'R'],
    ],
  },
  {
    code: 'D-PO',
    en: 'Purchase order',
    ar: 'أمر الشراء',
    defEn: 'An order to a supplier against an approved requisition.',
    defAr: 'أمر للمورّد مقابل طلب شراء معتمد.',
    cls: 'INTERNAL',
    sor: 'SYS-01',
    crud: [
      ['SYS-01', 'CRU'],
      ['SYS-07', 'CR'],
      ['SYS-08', 'R'],
    ],
  },
  {
    code: 'D-INV',
    en: 'Invoice',
    ar: 'الفاتورة',
    defEn: 'A supplier invoice to be matched and paid.',
    defAr: 'فاتورة المورّد المطلوب مطابقتها ودفعها.',
    cls: 'INTERNAL',
    sor: 'SYS-01',
    crud: [
      ['SYS-01', 'CRUD'],
      ['SYS-12', 'R'],
      ['SYS-08', 'R'],
    ],
  },
  {
    code: 'D-SUP',
    en: 'Supplier',
    ar: 'المورّد',
    defEn: 'A registered supplier with bank details.',
    defAr: 'مورّد مسجّل مع بياناته المصرفية.',
    cls: 'CONFIDENTIAL',
    sor: 'SYS-07',
    crud: [
      ['SYS-07', 'CRU'],
      ['SYS-01', 'R'],
    ],
  },
  {
    code: 'D-EMP',
    en: 'Employee',
    ar: 'الموظف',
    defEn: 'Personal and job data of an employee.',
    defAr: 'البيانات الشخصية والوظيفية للموظف.',
    cls: 'SECRET',
    sor: 'SYS-06',
    crud: [
      ['SYS-06', 'CRUD'],
      ['SYS-01', 'R'],
      ['SYS-09', 'R'],
    ],
  },
  {
    code: 'D-CUS',
    en: 'Customer',
    ar: 'العميل',
    defEn: 'A customer with identity and contact details.',
    defAr: 'العميل وبيانات هويته والتواصل معه.',
    cls: 'CONFIDENTIAL',
    sor: 'SYS-02',
    crud: [
      ['SYS-02', 'CRUD'],
      ['SYS-04', 'RU'],
      ['SYS-11', 'C'],
    ],
  },
  {
    code: 'D-PAY',
    en: 'Payment',
    ar: 'الدفعة',
    defEn: 'A payment to a supplier or from a customer.',
    defAr: 'دفعة لمورّد أو من عميل.',
    cls: 'SECRET',
    sor: 'SYS-04',
    crud: [
      ['SYS-04', 'CRU'],
      ['SYS-01', 'CR'],
      ['SYS-10', 'C'],
    ],
  },
];

/** Capability map (code, parent, names, processes, applications). */
const CAPABILITIES: {
  code: string;
  parent?: string;
  en: string;
  ar: string;
  importance: 'LOW' | 'MEDIUM' | 'HIGH';
  processes?: string[];
  apps?: string[];
}[] = [
  { code: 'CAP-1', en: 'Strategy & Performance', ar: 'الاستراتيجية والأداء', importance: 'HIGH' },
  {
    code: 'CAP-1.1',
    parent: 'CAP-1',
    en: 'Strategic planning',
    ar: 'التخطيط الاستراتيجي',
    importance: 'HIGH',
    processes: ['M.01'],
    apps: ['SYS-08'],
  },
  {
    code: 'CAP-1.2',
    parent: 'CAP-1',
    en: 'Performance management',
    ar: 'إدارة الأداء',
    importance: 'HIGH',
    processes: ['M.02'],
    apps: ['SYS-08'],
  },
  {
    code: 'CAP-1.3',
    parent: 'CAP-1',
    en: 'Risk & compliance',
    ar: 'المخاطر والامتثال',
    importance: 'MEDIUM',
    processes: ['M.03'],
  },
  { code: 'CAP-2', en: 'Customer Services', ar: 'خدمات العملاء', importance: 'HIGH' },
  {
    code: 'CAP-2.1',
    parent: 'CAP-2',
    en: 'Customer onboarding',
    ar: 'تسجيل العملاء',
    importance: 'HIGH',
    processes: ['C.01'],
    apps: ['SYS-02', 'SYS-11'],
  },
  {
    code: 'CAP-2.1.1',
    parent: 'CAP-2.1',
    en: 'Identity verification',
    ar: 'التحقق من الهوية',
    importance: 'HIGH',
    processes: ['C.01.01'],
    apps: ['SYS-04'],
  },
  {
    code: 'CAP-2.2',
    parent: 'CAP-2',
    en: 'Billing & collection',
    ar: 'الفوترة والتحصيل',
    importance: 'MEDIUM',
    processes: ['C.02'],
    apps: ['SYS-04', 'SYS-10'],
  },
  {
    code: 'CAP-2.3',
    parent: 'CAP-2',
    en: 'Service delivery',
    ar: 'تقديم الخدمة',
    importance: 'MEDIUM',
    processes: ['C.03'],
  },
  { code: 'CAP-3', en: 'Finance & Procurement', ar: 'المالية والمشتريات', importance: 'HIGH' },
  {
    code: 'CAP-3.1',
    parent: 'CAP-3',
    en: 'Procurement',
    ar: 'المشتريات',
    importance: 'HIGH',
    processes: ['S.01'],
    apps: ['SYS-01', 'SYS-07'],
  },
  {
    code: 'CAP-3.1.1',
    parent: 'CAP-3.1',
    en: 'Requisitioning',
    ar: 'طلبات الشراء',
    importance: 'MEDIUM',
    processes: ['S.01.01'],
    apps: ['SYS-01'],
  },
  {
    code: 'CAP-3.2',
    parent: 'CAP-3',
    en: 'Payments',
    ar: 'المدفوعات',
    importance: 'HIGH',
    apps: ['SYS-01', 'SYS-10', 'SYS-12'],
  },
  {
    code: 'CAP-3.3',
    parent: 'CAP-3',
    en: 'Budgeting',
    ar: 'إعداد الميزانية',
    importance: 'MEDIUM',
    apps: ['SYS-01'],
  },
  {
    code: 'CAP-4',
    en: 'People & Technology',
    ar: 'الموارد البشرية والتقنية',
    importance: 'MEDIUM',
  },
  {
    code: 'CAP-4.1',
    parent: 'CAP-4',
    en: 'Workforce management',
    ar: 'إدارة القوى العاملة',
    importance: 'MEDIUM',
    processes: ['S.02'],
    apps: ['SYS-06', 'SYS-09'],
  },
  {
    code: 'CAP-4.2',
    parent: 'CAP-4',
    en: 'IT service management',
    ar: 'إدارة خدمات تقنية المعلومات',
    importance: 'MEDIUM',
    processes: ['S.03'],
    apps: ['SYS-03', 'SYS-05', 'SYS-09'],
  },
];

interface DemoKpi {
  code: string;
  en: string;
  ar: string;
  defEn: string;
  defAr: string;
  formulaEn: string;
  formulaAr: string;
  unit: string;
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
  frequency: KpiFrequency;
  target: number;
  red: number;
  baseline: number;
  objective: string;
  dept: string;
  links: [string, string][];
  capability?: string;
  risk?: string;
  /** Values oldest first; the last one is the last completed period (omitted: value due). */
  values: number[];
  missingLast?: boolean;
}

const KPIS: DemoKpi[] = [
  {
    code: 'KPI-01',
    en: 'Requisitions approved within 3 days',
    ar: 'طلبات الشراء المعتمدة خلال 3 أيام',
    defEn: 'Share of purchase requisitions approved within three working days.',
    defAr: 'نسبة طلبات الشراء المعتمدة خلال ثلاثة أيام عمل.',
    formulaEn: 'Requisitions approved ≤ 3 days ÷ all approved requisitions × 100',
    formulaAr: 'الطلبات المعتمدة خلال 3 أيام ÷ كل الطلبات المعتمدة × 100',
    unit: '%',
    direction: 'HIGHER_IS_BETTER',
    frequency: 'MONTHLY',
    target: 90,
    red: 75,
    baseline: 72,
    objective: 'SO-2',
    dept: 'PRC',
    links: [
      ['S.01.01', PROCESS_ELEMENT_ID],
      ['S.01.01', 'Task_Approve'],
    ],
    capability: 'CAP-3.1.1',
    values: [74, 77, 80, 83, 85, 88, 91, 92, 90, 87, 86, 84],
  },
  {
    code: 'KPI-02',
    en: 'Procurement cycle time',
    ar: 'زمن دورة الشراء',
    defEn: 'Average days from requisition to purchase order.',
    defAr: 'متوسط الأيام من طلب الشراء حتى أمر الشراء.',
    formulaEn: 'Sum of (PO date − requisition date) ÷ number of POs',
    formulaAr: 'مجموع (تاريخ أمر الشراء − تاريخ الطلب) ÷ عدد أوامر الشراء',
    unit: 'days',
    direction: 'LOWER_IS_BETTER',
    frequency: 'MONTHLY',
    target: 10,
    red: 15,
    baseline: 18,
    objective: 'SO-2',
    dept: 'PRC',
    links: [
      ['S.01', PROCESS_ELEMENT_ID],
      ['S.01.01', 'Task_PO'],
    ],
    capability: 'CAP-3.1',
    values: [17, 16, 15, 14, 13, 12, 12, 13, 14, 15, 16, 17],
  },
  {
    code: 'KPI-03',
    en: 'Invoices paid on time',
    ar: 'الفواتير المدفوعة في موعدها',
    defEn: 'Share of supplier invoices paid by the due date.',
    defAr: 'نسبة فواتير الموردين المدفوعة في تاريخ الاستحقاق.',
    formulaEn: 'Invoices paid by due date ÷ invoices paid × 100',
    formulaAr: 'الفواتير المدفوعة في موعدها ÷ الفواتير المدفوعة × 100',
    unit: '%',
    direction: 'HIGHER_IS_BETTER',
    frequency: 'MONTHLY',
    target: 95,
    red: 85,
    baseline: 88,
    objective: 'SO-2',
    dept: 'FIN',
    links: [['S.01', PROCESS_ELEMENT_ID]],
    capability: 'CAP-3.2',
    values: [89, 90, 92, 93, 94, 95, 96, 96, 97, 96, 97, 98],
  },
  {
    code: 'KPI-04',
    en: 'Customer onboarding time',
    ar: 'زمن تسجيل العميل',
    defEn: 'Average hours from registration to an open account.',
    defAr: 'متوسط الساعات من التسجيل حتى فتح الحساب.',
    formulaEn: 'Sum of onboarding hours ÷ customers onboarded',
    formulaAr: 'مجموع ساعات التسجيل ÷ عدد العملاء المسجلين',
    unit: 'h',
    direction: 'LOWER_IS_BETTER',
    frequency: 'MONTHLY',
    target: 24,
    red: 48,
    baseline: 60,
    objective: 'SO-1',
    dept: 'CS',
    links: [
      ['C.01', PROCESS_ELEMENT_ID],
      ['C.01', 'Task_Open'],
    ],
    capability: 'CAP-2.1',
    values: [58, 55, 50, 47, 44, 40, 38, 36, 33, 31, 30, 29],
  },
  {
    code: 'KPI-05',
    en: 'Customer satisfaction',
    ar: 'رضا العملاء',
    defEn: 'Average satisfaction score of the quarterly survey (1–5).',
    defAr: 'متوسط درجة الرضا في الاستبيان الربعي (1–5).',
    formulaEn: 'Average of survey answers',
    formulaAr: 'متوسط إجابات الاستبيان',
    unit: '/5',
    direction: 'HIGHER_IS_BETTER',
    frequency: 'QUARTERLY',
    target: 4.2,
    red: 3.5,
    baseline: 3.8,
    objective: 'SO-1',
    dept: 'CS',
    links: [['C.03', PROCESS_ELEMENT_ID]],
    capability: 'CAP-2.3',
    values: [3.9, 4.1, 4.3, 4.4],
  },
  {
    code: 'KPI-06',
    en: 'Digital service adoption',
    ar: 'نسبة استخدام الخدمات الرقمية',
    defEn: 'Share of service requests submitted through digital channels.',
    defAr: 'نسبة طلبات الخدمة المقدمة عبر القنوات الرقمية.',
    formulaEn: 'Digital requests ÷ all requests × 100',
    formulaAr: 'الطلبات الرقمية ÷ كل الطلبات × 100',
    unit: '%',
    direction: 'HIGHER_IS_BETTER',
    frequency: 'MONTHLY',
    target: 80,
    red: 60,
    baseline: 45,
    objective: 'SO-1',
    dept: 'IT',
    links: [['C.01', PROCESS_ELEMENT_ID]],
    capability: 'CAP-2.1',
    values: [52, 55, 58, 61, 63, 66, 68, 70, 73, 75, 78, 81],
    missingLast: true,
  },
  {
    code: 'KPI-07',
    en: 'IT incidents resolved within SLA',
    ar: 'الحوادث التقنية المحلولة ضمن اتفاقية الخدمة',
    defEn: 'Share of IT incidents resolved within the agreed service level.',
    defAr: 'نسبة الحوادث التقنية المحلولة ضمن مستوى الخدمة المتفق عليه.',
    formulaEn: 'Incidents resolved within SLA ÷ incidents resolved × 100',
    formulaAr: 'الحوادث المحلولة ضمن الاتفاقية ÷ الحوادث المحلولة × 100',
    unit: '%',
    direction: 'HIGHER_IS_BETTER',
    frequency: 'MONTHLY',
    target: 92,
    red: 85,
    baseline: 87,
    objective: 'SO-1',
    dept: 'IT',
    links: [['S.03', PROCESS_ELEMENT_ID]],
    capability: 'CAP-4.2',
    values: [90, 91, 93, 92, 90, 88, 87, 86, 85, 84, 83, 82],
  },
  {
    code: 'KPI-08',
    en: 'Budget variance',
    ar: 'انحراف الميزانية',
    defEn: 'Absolute deviation of actual spending from the budget (key risk indicator of RSK-03).',
    defAr: 'الانحراف المطلق للإنفاق الفعلي عن الميزانية (مؤشر خطر رئيسي لـ RSK-03).',
    formulaEn: '|Actual − Budget| ÷ Budget × 100',
    formulaAr: '|الفعلي − الميزانية| ÷ الميزانية × 100',
    unit: '%',
    direction: 'LOWER_IS_BETTER',
    frequency: 'MONTHLY',
    target: 5,
    red: 10,
    baseline: 9,
    objective: 'SO-2',
    dept: 'FIN',
    links: [['S.01.01', 'Task_Budget']],
    capability: 'CAP-3.3',
    risk: 'RSK-03',
    values: [9, 8.5, 8, 7, 6.5, 6, 5.5, 4.8, 5.2, 6.1, 6.8, 7.4],
  },
];

export async function seedEaKpiDemo(prisma: PrismaClient, adminId: string | null): Promise<void> {
  if ((await prisma.capability.count()) > 0) return;
  const architect = await prisma.user.findFirst({ where: { email: { startsWith: 'architect@' } } });
  const owner = await prisma.user.findFirst({ where: { email: { startsWith: 'owner@' } } });
  const actor = architect?.id ?? adminId;
  const audit = { createdById: actor, updatedById: actor };
  const dept = async (code: string) =>
    (await prisma.department.findFirst({ where: { code } }))?.id ?? null;
  const months = (n: number) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  };

  // ---------- Applications ----------
  const apps = new Map<string, string>();
  for (const a of APPS) {
    const existing = await prisma.repoObject.findFirst({
      where: { type: 'SYSTEM', code: a.code, deletedAt: null },
    });
    const o =
      existing ??
      (await prisma.repoObject.create({
        data: {
          type: 'SYSTEM',
          code: a.code,
          nameEn: a.en,
          nameAr: a.ar,
          descriptionEn: a.descEn ?? '',
          descriptionAr: a.descAr ?? '',
          ...audit,
        },
      }));
    const data = {
      appType: a.type,
      vendor: a.vendor,
      version: a.version ?? '',
      businessOwnerId: owner?.id ?? null,
      itOwnerId: architect?.id ?? null,
      departmentId: await dept(a.dept),
      hosting: a.hosting,
      hostingCountry: a.country,
      lifecycle: a.lifecycle,
      liveFrom: a.lifecycle === 'PLANNED' ? months(4) : months(-36),
      phaseOutFrom: a.phaseOutMonths !== undefined ? months(a.phaseOutMonths) : null,
      retiredAt: a.lifecycle === 'RETIRED' ? months(-6) : null,
      criticality: a.criticality,
      dataClassification: a.classification,
      licenceNotes: a.hosting === 'SAAS' ? 'Annual subscription, renewal in Q1.' : '',
      url: null,
    };
    await prisma.application.upsert({
      where: { objectId: o.id },
      create: { objectId: o.id, ...data },
      update: data,
    });
    apps.set(a.code, o.id);
  }

  // ---------- Data objects and interfaces ----------
  const data = new Map<string, string>();
  for (const d of DATA) {
    const created = await prisma.dataObject.create({
      data: {
        code: d.code,
        nameEn: d.en,
        nameAr: d.ar,
        definitionEn: d.defEn,
        definitionAr: d.defAr,
        classification: d.cls,
        systemOfRecordId: apps.get(d.sor) ?? null,
        ownerId: architect?.id ?? null,
        ...audit,
        usages: {
          create: d.crud.map(([app, f]) => ({
            applicationId: apps.get(app)!,
            canCreate: f.includes('C'),
            canRead: f.includes('R'),
            canUpdate: f.includes('U'),
            canDelete: f.includes('D'),
          })),
        },
      },
    });
    data.set(d.code, created.id);
  }
  let n = 0;
  for (const [src, tgt, technology, frequency, carried, direction] of INTERFACES) {
    n++;
    await prisma.appInterface.create({
      data: {
        code: `INT-${String(n).padStart(2, '0')}`,
        sourceId: apps.get(src)!,
        targetId: apps.get(tgt)!,
        technology,
        frequency,
        direction,
        status: src === 'SYS-07' ? 'PLANNED' : src === 'SYS-12' ? 'RETIRED' : 'ACTIVE',
        ownerId: architect?.id ?? null,
        ...audit,
        dataObjects: { create: carried.map((c) => ({ dataObjectId: data.get(c)! })) },
      },
    });
  }

  // ---------- Capability map ----------
  const processes = new Map(
    (
      await prisma.process.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true },
      })
    ).map((p) => [p.code, p.id]),
  );
  const caps = new Map<string, { id: string; level: number }>();
  let order = 0;
  for (const c of CAPABILITIES) {
    const parent = c.parent ? caps.get(c.parent) : undefined;
    const created = await prisma.capability.create({
      data: {
        code: c.code,
        nameEn: c.en,
        nameAr: c.ar,
        parentId: parent?.id ?? null,
        level: parent ? parent.level + 1 : 1,
        sortOrder: order++,
        importance: c.importance,
        ownerId: architect?.id ?? null,
        ...audit,
        processes: {
          create: (c.processes ?? [])
            .filter((p) => processes.has(p))
            .map((p) => ({ processId: processes.get(p)! })),
        },
        applications: { create: (c.apps ?? []).map((a) => ({ applicationId: apps.get(a)! })) },
      },
    });
    caps.set(c.code, { id: created.id, level: parent ? parent.level + 1 : 1 });
  }

  // ---------- Objectives and KPIs ----------
  const objectives = new Map<string, string>();
  for (const [code, en, ar] of [
    ['SO-1', 'Efficient, digital customer services', 'خدمات عملاء رقمية وفعّالة'],
    ['SO-2', 'Sound financial and procurement management', 'إدارة مالية ومشتريات رشيدة'],
  ] as const) {
    const o = await prisma.strategicObjective.create({
      data: {
        code,
        nameEn: en,
        nameAr: ar,
        sortOrder: objectives.size,
        ownerId: owner?.id ?? null,
        ...audit,
      },
    });
    objectives.set(code, o.id);
  }
  const risk = await prisma.repoObject.findFirst({ where: { type: 'RISK', code: 'RSK-03' } });
  for (const k of KPIS) {
    const o = await prisma.repoObject.create({
      data: {
        type: 'KPI',
        code: k.code,
        nameEn: k.en,
        nameAr: k.ar,
        descriptionEn: k.defEn,
        descriptionAr: k.defAr,
        ownerId: owner?.id ?? null,
        ...audit,
        kpi: {
          create: {
            formulaEn: k.formulaEn,
            formulaAr: k.formulaAr,
            unit: k.unit,
            direction: k.direction,
            frequency: k.frequency,
            target: k.target,
            redThreshold: k.red,
            baseline: k.baseline,
            departmentId: await dept(k.dept),
            dataSource: 'MANUAL',
            status: 'ACTIVE',
            objectives: { create: [{ objectiveId: objectives.get(k.objective)! }] },
            capabilities: k.capability
              ? { create: [{ capabilityId: caps.get(k.capability)!.id }] }
              : undefined,
            risks: k.risk && risk ? { create: [{ riskId: risk.id }] } : undefined,
          },
        },
      },
    });
    for (const [proc, element] of k.links)
      if (processes.has(proc))
        await prisma.objectLink.create({
          data: {
            processId: processes.get(proc)!,
            bpmnElementId: element,
            repoObjectId: o.id,
            relation: 'MEASURES',
            createdById: actor,
          },
        });
    const last = duePeriod(new Date(), k.frequency);
    const periods = periodRange(last, k.frequency, k.values.length);
    for (let i = 0; i < periods.length; i++) {
      if (k.missingLast && i === periods.length - 1) continue;
      await prisma.kpiMeasurement.create({
        data: {
          kpiId: o.id,
          period: periods[i],
          periodStart: periodStart(periods[i]),
          value: k.values[i],
          comment:
            i === periods.length - 1 && k.code === 'KPI-07'
              ? 'Two major outages; staffing gap on the service desk.'
              : '',
          source: 'MANUAL',
          createdById: owner?.id ?? actor,
          updatedById: owner?.id ?? actor,
        },
      });
    }
  }
  console.log(
    `Seeded architecture and KPI demo data: ${APPS.length} applications, ${INTERFACES.length} interfaces, ${DATA.length} data objects, ${CAPABILITIES.length} capabilities, ${KPIS.length} KPIs.`,
  );
}
