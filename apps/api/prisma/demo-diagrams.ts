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
