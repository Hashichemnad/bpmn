/** BPMN models of the demo data (bilingual labels). */
import { buildBpmn, type DiagramFlow, type DiagramNode } from './bpmn-builder';

/**
 * Purchase Requisition. Version 2 adds a budget check before the review and renames
 * the review step — a good example for the visual compare.
 */
export function requisitionXml(withBudgetCheck = false): string {
  const shift = withBudgetCheck ? 160 : 0;
  const nodes: DiagramNode[] = [
    {
      id: 'Start_1',
      type: 'startEvent',
      en: 'Need identified',
      ar: 'تحديد الاحتياج',
      x: 160,
      y: 182,
    },
    {
      id: 'Task_Create',
      type: 'userTask',
      en: 'Create purchase requisition',
      ar: 'إنشاء طلب الشراء',
      descEn:
        'The requester fills in the requisition form in the ERP: items, quantities, estimated cost and cost centre.',
      descAr:
        'يعبئ مقدم الطلب نموذج طلب الشراء في نظام تخطيط الموارد: الأصناف والكميات والتكلفة التقديرية ومركز التكلفة.',
      x: 250,
      y: 160,
    },
    ...(withBudgetCheck
      ? [
          {
            id: 'Task_Budget',
            type: 'serviceTask' as const,
            en: 'Check available budget',
            ar: 'التحقق من توفر الميزانية',
            descEn: 'The ERP checks the remaining budget of the cost centre automatically.',
            descAr: 'يتحقق النظام تلقائياً من الميزانية المتبقية لمركز التكلفة.',
            x: 410,
            y: 160,
          },
        ]
      : []),
    {
      id: 'Task_Approve',
      type: 'userTask',
      en: withBudgetCheck ? 'Approve requisition' : 'Review requisition',
      ar: withBudgetCheck ? 'اعتماد الطلب' : 'مراجعة الطلب',
      descEn:
        'The department manager checks the need and the budget and approves or rejects the requisition within two working days.',
      descAr: 'يتحقق مدير الإدارة من الحاجة والميزانية ثم يعتمد الطلب أو يرفضه خلال يومي عمل.',
      x: 410 + shift,
      y: 160,
    },
    {
      id: 'Gateway_Approved',
      type: 'exclusiveGateway',
      en: 'Approved?',
      ar: 'معتمد؟',
      x: 570 + shift,
      y: 175,
    },
    {
      id: 'Task_PO',
      type: 'serviceTask',
      en: 'Create purchase order',
      ar: 'إنشاء أمر الشراء',
      descEn: 'Procurement selects the supplier and issues the purchase order.',
      descAr: 'تختار إدارة المشتريات المورد وتصدر أمر الشراء.',
      x: 680 + shift,
      y: 160,
    },
    {
      id: 'End_Done',
      type: 'endEvent',
      en: 'Order placed',
      ar: 'تم إصدار الأمر',
      x: 842 + shift,
      y: 182,
    },
    {
      id: 'Task_Notify',
      type: 'task',
      en: 'Notify requester',
      ar: 'إشعار مقدم الطلب',
      x: 680 + shift,
      y: 300,
    },
    {
      id: 'End_Rejected',
      type: 'endEvent',
      en: 'Request rejected',
      ar: 'تم رفض الطلب',
      x: 842 + shift,
      y: 322,
    },
  ];
  const flows: DiagramFlow[] = [
    { id: 'Flow_1', from: 'Start_1', to: 'Task_Create' },
    ...(withBudgetCheck
      ? [
          { id: 'Flow_2', from: 'Task_Create', to: 'Task_Budget' },
          { id: 'Flow_8', from: 'Task_Budget', to: 'Task_Approve' },
        ]
      : [{ id: 'Flow_2', from: 'Task_Create', to: 'Task_Approve' }]),
    { id: 'Flow_3', from: 'Task_Approve', to: 'Gateway_Approved' },
    { id: 'Flow_4', from: 'Gateway_Approved', to: 'Task_PO', en: 'Yes', ar: 'نعم' },
    { id: 'Flow_5', from: 'Task_PO', to: 'End_Done' },
    { id: 'Flow_6', from: 'Gateway_Approved', to: 'Task_Notify', en: 'No', ar: 'لا' },
    { id: 'Flow_7', from: 'Task_Notify', to: 'End_Rejected' },
  ];
  return buildBpmn('PurchaseRequisition', nodes, flows);
}

/** Customer Onboarding, with a call activity drilling down into C.01.01. */
export function onboardingXml(verifyProcessId: string): string {
  return buildBpmn(
    'CustomerOnboarding',
    [
      {
        id: 'Start_1',
        type: 'startEvent',
        en: 'Application received',
        ar: 'استلام الطلب',
        x: 160,
        y: 182,
      },
      {
        id: 'Task_Register',
        type: 'userTask',
        en: 'Register application',
        ar: 'تسجيل الطلب',
        descEn:
          'The agent registers the application in the CRM and checks that all documents are attached.',
        descAr: 'يسجل الموظف الطلب في نظام إدارة علاقات العملاء ويتأكد من إرفاق جميع المستندات.',
        x: 250,
        y: 160,
      },
      {
        id: 'Call_Verify',
        type: 'callActivity',
        en: 'Verify customer identity',
        ar: 'التحقق من هوية العميل',
        x: 410,
        y: 160,
        linkedProcessId: verifyProcessId,
      },
      {
        id: 'Task_Open',
        type: 'serviceTask',
        en: 'Open account',
        ar: 'فتح الحساب',
        x: 570,
        y: 160,
      },
      {
        id: 'Task_Welcome',
        type: 'task',
        en: 'Send welcome pack',
        ar: 'إرسال حزمة الترحيب',
        x: 730,
        y: 160,
      },
      { id: 'End_1', type: 'endEvent', en: 'Customer active', ar: 'العميل نشط', x: 892, y: 182 },
    ],
    [
      { id: 'Flow_1', from: 'Start_1', to: 'Task_Register' },
      { id: 'Flow_2', from: 'Task_Register', to: 'Call_Verify' },
      { id: 'Flow_3', from: 'Call_Verify', to: 'Task_Open' },
      { id: 'Flow_4', from: 'Task_Open', to: 'Task_Welcome' },
      { id: 'Flow_5', from: 'Task_Welcome', to: 'End_1' },
    ],
  );
}

export interface LinearStep {
  id: string;
  type?: 'task' | 'userTask' | 'serviceTask' | 'callActivity';
  en: string;
  ar: string;
  descEn?: string;
  descAr?: string;
  linkedProcessId?: string;
}

/** A simple left-to-right process: start → steps → end (used for further demo processes). */
export function linearXml(
  key: string,
  start: { en: string; ar: string },
  steps: LinearStep[],
  end: { en: string; ar: string },
): string {
  const nodes: DiagramNode[] = [
    { id: 'Start_1', type: 'startEvent', ...start, x: 160, y: 182 },
    ...steps.map((s, i) => ({ ...s, type: s.type ?? 'userTask', x: 250 + i * 160, y: 160 })),
    { id: 'End_1', type: 'endEvent', ...end, x: 250 + steps.length * 160 + 2, y: 182 },
  ];
  const ids = nodes.map((n) => n.id);
  const flows: DiagramFlow[] = ids
    .slice(1)
    .map((id, i) => ({ id: `Flow_${i + 1}`, from: ids[i], to: id }));
  return buildBpmn(key, nodes, flows);
}
