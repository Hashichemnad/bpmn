/**
 * Idempotent seed script.
 *  - Always: syncs system roles and permissions, ensures the Super Admin from .env exists.
 *  - When SEED_DEMO_DATA=true and the repository is empty: demo departments, processes,
 *    roles & systems, and two bilingual BPMN models.
 */
import { PrismaClient, type ProcessCategory } from '@prisma/client';
import { ALL_PERMISSIONS, SETTING_KEYS, SYSTEM_ROLES, SYSTEM_ROLE_KEYS, checkPasswordPolicy } from '@processhub/shared';
import { hashPassword } from '../src/auth/argon';
import { buildBpmn } from './bpmn-builder';

const prisma = new PrismaClient();

export async function syncRolesAndPermissions(client: PrismaClient = prisma): Promise<void> {
  for (const key of ALL_PERMISSIONS) {
    await client.permission.upsert({ where: { key }, create: { key }, update: {} });
  }
  const permissions = await client.permission.findMany();
  const permId = new Map(permissions.map((p) => [p.key, p.id]));
  for (const key of SYSTEM_ROLE_KEYS) {
    const def = SYSTEM_ROLES[key];
    const role = await client.role.upsert({
      where: { key },
      create: { key, nameEn: def.nameEn, nameAr: def.nameAr, isSystem: true },
      update: { nameEn: def.nameEn, nameAr: def.nameAr },
    });
    await client.rolePermission.deleteMany({ where: { roleId: role.id } });
    await client.rolePermission.createMany({
      data: def.permissions.map((p) => ({ roleId: role.id, permissionId: permId.get(p)! })),
    });
  }
}

async function ensureSuperAdmin(): Promise<string | null> {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping Super Admin creation.');
    return null;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Super Admin ${email} already exists (password left unchanged).`);
    return existing.id;
  }
  const violations = checkPasswordPolicy(password, {
    minLength: Number(process.env.PASSWORD_MIN_LENGTH ?? 10),
    requireUpper: true,
    requireLower: true,
    requireDigit: true,
    requireSymbol: false,
  });
  if (violations.length) throw new Error(`SEED_ADMIN_PASSWORD is too weak: ${violations.join(', ')}`);
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
  const user = await prisma.user.create({
    data: {
      email,
      nameEn: process.env.SEED_ADMIN_NAME_EN || 'System Administrator',
      nameAr: process.env.SEED_ADMIN_NAME_AR || 'مدير النظام',
      locale: process.env.SEED_ADMIN_LOCALE === 'ar' ? 'ar' : 'en',
      passwordHash: await hashPassword(password),
      roles: { create: [{ roleId: role.id }] },
    },
  });
  await prisma.auditLog.create({
    data: { action: 'CREATE', entityType: 'User', entityId: user.id, summary: { seed: true, email } },
  });
  console.log(`Created Super Admin ${email}.`);
  return user.id;
}

async function ensureDefaultSettings(): Promise<void> {
  const defaults: [string, string][] = [
    [SETTING_KEYS.ORG_NAME_EN, process.env.SEED_ORG_NAME_EN || 'ProcessHub'],
    [SETTING_KEYS.ORG_NAME_AR, process.env.SEED_ORG_NAME_AR || 'بروسس هب'],
    [SETTING_KEYS.DEFAULT_LOCALE, process.env.SEED_DEFAULT_LOCALE === 'ar' ? 'ar' : 'en'],
  ];
  for (const [key, value] of defaults) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }
}

async function seedDemoData(adminId: string | null): Promise<void> {
  if ((await prisma.process.count()) > 0) {
    console.log('Repository already has processes — skipping demo data.');
    return;
  }
  const audit = { createdById: adminId, updatedById: adminId };

  // Departments
  const dept = async (code: string, nameEn: string, nameAr: string, parentId: string | null = null) =>
    (await prisma.department.create({ data: { code, nameEn, nameAr, parentId, ...audit } })).id;
  const exec = await dept('EXE', 'Executive Office', 'المكتب التنفيذي');
  const finance = await dept('FIN', 'Finance', 'المالية');
  const procurement = await dept('PRC', 'Procurement', 'المشتريات', finance);
  const hr = await dept('HR', 'Human Resources', 'الموارد البشرية');
  const it = await dept('IT', 'Information Technology', 'تقنية المعلومات');
  const cs = await dept('CS', 'Customer Services', 'خدمات العملاء');
  const risk = await dept('RSK', 'Risk & Compliance', 'المخاطر والامتثال');

  // Processes
  const order = new Map<string, number>();
  const proc = async (
    code: string,
    nameEn: string,
    nameAr: string,
    category: ProcessCategory,
    departmentId: string,
    descriptionEn: string,
    descriptionAr: string,
    parentId: string | null = null,
  ) => {
    const key = `${parentId ?? category}`;
    const sortOrder = order.get(key) ?? 0;
    order.set(key, sortOrder + 1);
    const p = await prisma.process.create({
      data: {
        code,
        nameEn,
        nameAr,
        descriptionEn,
        descriptionAr,
        category,
        departmentId,
        parentId,
        level: parentId ? 2 : 1,
        sortOrder,
        ownerId: adminId,
        ...audit,
      },
    });
    return p.id;
  };
  await proc('M.01', 'Strategic Planning', 'التخطيط الاستراتيجي', 'MANAGEMENT', exec,
    'Defines the organisation’s vision, strategic objectives and annual plans.',
    'تحديد رؤية المؤسسة وأهدافها الاستراتيجية وخططها السنوية.');
  await proc('M.02', 'Performance Management', 'إدارة الأداء', 'MANAGEMENT', exec,
    'Monitors KPIs and reviews organisational performance against targets.',
    'متابعة مؤشرات الأداء ومراجعة أداء المؤسسة مقارنة بالمستهدفات.');
  await proc('M.03', 'Risk & Compliance Management', 'إدارة المخاطر والامتثال', 'MANAGEMENT', risk,
    'Identifies, assesses and mitigates risks; ensures regulatory compliance.',
    'تحديد المخاطر وتقييمها والحد منها، وضمان الامتثال للأنظمة.');
  const onboarding = await proc('C.01', 'Customer Onboarding', 'تسجيل العملاء', 'CORE', cs,
    'From application receipt to an active customer account.',
    'من استلام الطلب حتى تفعيل حساب العميل.');
  const verify = await proc('C.01.01', 'Customer Identity Verification', 'التحقق من هوية العميل', 'CORE', risk,
    'KYC checks on new customers before account opening.',
    'إجراءات اعرف عميلك قبل فتح الحساب.', onboarding);
  await proc('C.02', 'Order to Cash', 'من الطلب إلى التحصيل', 'CORE', finance,
    'Customer orders, invoicing and collection.', 'طلبات العملاء والفوترة والتحصيل.');
  await proc('C.03', 'Service Delivery', 'تقديم الخدمة', 'CORE', cs,
    'Delivering services to customers according to agreed service levels.',
    'تقديم الخدمات للعملاء وفق مستويات الخدمة المتفق عليها.');
  const p2p = await proc('S.01', 'Procure to Pay', 'من الشراء إلى الدفع', 'SUPPORT', procurement,
    'Purchasing goods and services and paying suppliers.', 'شراء السلع والخدمات والدفع للموردين.');
  const requisition = await proc('S.01.01', 'Purchase Requisition', 'طلب الشراء', 'SUPPORT', procurement,
    'Raising and approving internal purchase requests.', 'إنشاء طلبات الشراء الداخلية واعتمادها.', p2p);
  await proc('S.02', 'Hire to Retire', 'من التوظيف إلى التقاعد', 'SUPPORT', hr,
    'Employee lifecycle from recruitment to exit.', 'دورة حياة الموظف من التوظيف حتى انتهاء الخدمة.');
  await proc('S.03', 'IT Service Management', 'إدارة خدمات تقنية المعلومات', 'SUPPORT', it,
    'Incident, request and change management for IT services.',
    'إدارة الحوادث والطلبات والتغييرات لخدمات تقنية المعلومات.');

  // Object repository: roles and IT systems
  const obj = async (type: 'ROLE' | 'SYSTEM', code: string, nameEn: string, nameAr: string, descriptionEn: string, descriptionAr: string, attributes: Record<string, string> = {}) =>
    (await prisma.repoObject.create({ data: { type, code, nameEn, nameAr, descriptionEn, descriptionAr, attributes, ...audit } })).id;
  const requester = await obj('ROLE', 'R-01', 'Requester', 'مقدم الطلب', 'Employee who raises a request.', 'الموظف الذي يقدم الطلب.');
  const manager = await obj('ROLE', 'R-02', 'Department Manager', 'مدير الإدارة', 'Approves requests for the department.', 'يعتمد طلبات الإدارة.');
  const buyer = await obj('ROLE', 'R-03', 'Procurement Officer', 'موظف المشتريات', 'Handles sourcing and purchase orders.', 'يتولى التوريد وأوامر الشراء.');
  await obj('ROLE', 'R-04', 'Finance Officer', 'موظف المالية', 'Processes invoices and payments.', 'يعالج الفواتير والمدفوعات.');
  const agent = await obj('ROLE', 'R-05', 'Customer Service Agent', 'موظف خدمة العملاء', 'First point of contact for customers.', 'نقطة الاتصال الأولى مع العملاء.');
  const compliance = await obj('ROLE', 'R-06', 'Compliance Officer', 'موظف الامتثال', 'Performs KYC and compliance checks.', 'يجري فحوصات اعرف عميلك والامتثال.');
  const erp = await obj('SYSTEM', 'SYS-01', 'ERP (SAP S/4HANA)', 'نظام تخطيط موارد المؤسسة', 'Finance, procurement and HR platform.', 'منصة المالية والمشتريات والموارد البشرية.', { vendor: 'SAP', hosting: 'On-premise' });
  const crm = await obj('SYSTEM', 'SYS-02', 'CRM (Salesforce)', 'نظام إدارة علاقات العملاء', 'Customer relationship management.', 'إدارة علاقات العملاء.', { vendor: 'Salesforce', hosting: 'Cloud' });
  const email = await obj('SYSTEM', 'SYS-03', 'Email', 'البريد الإلكتروني', 'Corporate email service.', 'خدمة البريد الإلكتروني المؤسسي.');
  const banking = await obj('SYSTEM', 'SYS-04', 'Core Banking', 'النظام المصرفي الأساسي', 'Accounts and transactions.', 'الحسابات والمعاملات.', { hosting: 'On-premise' });
  await obj('SYSTEM', 'SYS-05', 'Document Management', 'نظام إدارة الوثائق', 'Stores policies, forms and records.', 'حفظ السياسات والنماذج والسجلات.');

  // Model 1: Purchase Requisition
  const reqXml = buildBpmn('PurchaseRequisition', [
    { id: 'Start_1', type: 'startEvent', en: 'Need identified', ar: 'تحديد الاحتياج', x: 160, y: 182 },
    { id: 'Task_Create', type: 'userTask', en: 'Create purchase requisition', ar: 'إنشاء طلب الشراء', x: 250, y: 160 },
    { id: 'Task_Approve', type: 'userTask', en: 'Review requisition', ar: 'مراجعة الطلب', x: 410, y: 160 },
    { id: 'Gateway_Approved', type: 'exclusiveGateway', en: 'Approved?', ar: 'معتمد؟', x: 570, y: 175 },
    { id: 'Task_PO', type: 'serviceTask', en: 'Create purchase order', ar: 'إنشاء أمر الشراء', x: 680, y: 160 },
    { id: 'End_Done', type: 'endEvent', en: 'Order placed', ar: 'تم إصدار الأمر', x: 842, y: 182 },
    { id: 'Task_Notify', type: 'task', en: 'Notify requester', ar: 'إشعار مقدم الطلب', x: 680, y: 300 },
    { id: 'End_Rejected', type: 'endEvent', en: 'Request rejected', ar: 'تم رفض الطلب', x: 842, y: 322 },
  ], [
    { id: 'Flow_1', from: 'Start_1', to: 'Task_Create' },
    { id: 'Flow_2', from: 'Task_Create', to: 'Task_Approve' },
    { id: 'Flow_3', from: 'Task_Approve', to: 'Gateway_Approved' },
    { id: 'Flow_4', from: 'Gateway_Approved', to: 'Task_PO', en: 'Yes', ar: 'نعم' },
    { id: 'Flow_5', from: 'Task_PO', to: 'End_Done' },
    { id: 'Flow_6', from: 'Gateway_Approved', to: 'Task_Notify', en: 'No', ar: 'لا' },
    { id: 'Flow_7', from: 'Task_Notify', to: 'End_Rejected' },
  ]);

  // Model 2: Customer Onboarding (with a call activity drilling down into C.01.01)
  const onbXml = buildBpmn('CustomerOnboarding', [
    { id: 'Start_1', type: 'startEvent', en: 'Application received', ar: 'استلام الطلب', x: 160, y: 182 },
    { id: 'Task_Register', type: 'userTask', en: 'Register application', ar: 'تسجيل الطلب', x: 250, y: 160 },
    { id: 'Call_Verify', type: 'callActivity', en: 'Verify customer identity', ar: 'التحقق من هوية العميل', x: 410, y: 160, linkedProcessId: verify },
    { id: 'Task_Open', type: 'serviceTask', en: 'Open account', ar: 'فتح الحساب', x: 570, y: 160 },
    { id: 'Task_Welcome', type: 'task', en: 'Send welcome pack', ar: 'إرسال حزمة الترحيب', x: 730, y: 160 },
    { id: 'End_1', type: 'endEvent', en: 'Customer active', ar: 'العميل نشط', x: 892, y: 182 },
  ], [
    { id: 'Flow_1', from: 'Start_1', to: 'Task_Register' },
    { id: 'Flow_2', from: 'Task_Register', to: 'Call_Verify' },
    { id: 'Flow_3', from: 'Call_Verify', to: 'Task_Open' },
    { id: 'Flow_4', from: 'Task_Open', to: 'Task_Welcome' },
    { id: 'Flow_5', from: 'Task_Welcome', to: 'End_1' },
  ]);

  for (const [processId, xml] of [[requisition, reqXml], [onboarding, onbXml]] as const) {
    await prisma.processModel.create({ data: { processId, bpmnXml: xml, createdById: adminId, updatedById: adminId } });
    await prisma.processVersion.create({
      data: { processId, versionNumber: 1, bpmnXml: xml, changeNote: 'Initial version (seed)', createdById: adminId },
    });
  }

  const link = (processId: string, bpmnElementId: string, repoObjectId: string, relation: 'PERFORMS' | 'SUPPORTS') =>
    prisma.objectLink.create({ data: { processId, bpmnElementId, repoObjectId, relation, createdById: adminId } });
  await link(requisition, 'Task_Create', requester, 'PERFORMS');
  await link(requisition, 'Task_Create', erp, 'SUPPORTS');
  await link(requisition, 'Task_Approve', manager, 'PERFORMS');
  await link(requisition, 'Task_Approve', erp, 'SUPPORTS');
  await link(requisition, 'Task_PO', buyer, 'PERFORMS');
  await link(requisition, 'Task_PO', erp, 'SUPPORTS');
  await link(requisition, 'Task_Notify', email, 'SUPPORTS');
  await link(onboarding, 'Task_Register', agent, 'PERFORMS');
  await link(onboarding, 'Task_Register', crm, 'SUPPORTS');
  await link(onboarding, 'Call_Verify', compliance, 'PERFORMS');
  await link(onboarding, 'Task_Open', banking, 'SUPPORTS');
  await link(onboarding, 'Task_Welcome', agent, 'PERFORMS');
  await link(onboarding, 'Task_Welcome', email, 'SUPPORTS');

  console.log('Seeded demo departments, 11 processes, 11 objects and 2 BPMN models.');
}

async function main() {
  await syncRolesAndPermissions();
  console.log('System roles and permissions synced.');
  const adminId = await ensureSuperAdmin();
  await ensureDefaultSettings();
  if (process.env.SEED_DEMO_DATA === 'true') await seedDemoData(adminId);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
