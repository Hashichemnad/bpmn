import type { FormFieldInput } from '@processhub/shared';
import { buildWorkflowBpmn, type WfFlowSpec, type WfNodeSpec } from './workflow-bpmn';

/**
 * Executable demo processes (Phase 5.2): PMS-01 Program Request approval (Section Manager → Department
 * Manager → [Budget approval when the estimated budget ≥ AED 100,000, DMN] → PMO → DGO, return for
 * correction, SLA per step, approval letter) and a simple leave request. Used by the seed and the tests.
 */

export const BUDGET_DMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/" xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/" xmlns:ph="http://processhub.io/schema/bpmn" id="Definitions_BudgetApproval" name="Program budget approval" namespace="http://processhub.local/dmn">
  <decision id="BudgetApproval" name="Budget approval required" ph:nameEn="Budget approval required" ph:nameAr="هل تلزم موافقة الميزانية">
    <decisionTable id="BudgetApprovalTable" hitPolicy="UNIQUE">
      <input id="Input_Budget" label="Estimated budget (AED)" ph:nameEn="Estimated budget (AED)" ph:nameAr="الميزانية التقديرية (درهم)">
        <inputExpression id="InputExpression_Budget" typeRef="number"><text>estimatedBudget</text></inputExpression>
      </input>
      <output id="Output_BudgetApproval" label="Budget approval" name="budgetApproval" typeRef="boolean" ph:nameEn="Budget approval" ph:nameAr="موافقة الميزانية" />
      <rule id="Rule_High"><description>AED 100,000 or more: Finance approves the budget</description><inputEntry id="Rule_High_in"><text>&gt;= 100000</text></inputEntry><outputEntry id="Rule_High_out"><text>true</text></outputEntry></rule>
      <rule id="Rule_Low"><description>Below AED 100,000: no separate budget approval</description><inputEntry id="Rule_Low_in"><text>&lt; 100000</text></inputEntry><outputEntry id="Rule_Low_out"><text>false</text></outputEntry></rule>
    </decisionTable>
  </decision>
  <dmndi:DMNDI><dmndi:DMNDiagram id="DMNDiagram_Budget"><dmndi:DMNShape id="DMNShape_Budget" dmnElementRef="BudgetApproval"><dc:Bounds height="80" width="180" x="160" y="100" /></dmndi:DMNShape></dmndi:DMNDiagram></dmndi:DMNDI>
</definitions>`;

export const PMS_START_FIELDS: FormFieldInput[] = [
  {
    key: 'programName',
    type: 'text',
    labelEn: 'Program name',
    labelAr: 'اسم البرنامج',
    required: true,
    maxLength: 200,
  },
  {
    key: 'programType',
    type: 'radio',
    labelEn: 'Program type',
    labelAr: 'نوع البرنامج',
    required: true,
    options: [
      { value: 'digital', labelEn: 'Digital', labelAr: 'رقمي' },
      { value: 'non-digital', labelEn: 'Non-digital', labelAr: 'غير رقمي' },
    ],
  },
  {
    key: 'estimatedBudget',
    type: 'amount',
    labelEn: 'Estimated budget',
    labelAr: 'الميزانية التقديرية',
    required: true,
    min: 0,
    max: 1_000_000_000,
    currency: 'AED',
    helpEn: 'AED 100,000 or more needs a separate budget approval.',
    helpAr: 'تتطلب الميزانية من 100,000 درهم فأكثر موافقة مستقلة على الميزانية.',
  },
  {
    key: 'requestingDepartment',
    type: 'department',
    labelEn: 'Requesting department',
    labelAr: 'الإدارة الطالبة',
    required: true,
  },
  {
    key: 'justification',
    type: 'textarea',
    labelEn: 'Justification',
    labelAr: 'المبررات',
    required: true,
    maxLength: 4000,
  },
];

const reviewForm = (key: string, en: string, ar: string): { fields: FormFieldInput[] } => ({
  fields: [
    {
      key: 'programName',
      type: 'text',
      labelEn: 'Program name',
      labelAr: 'اسم البرنامج',
      readOnly: true,
    },
    {
      key: 'estimatedBudget',
      type: 'amount',
      labelEn: 'Estimated budget',
      labelAr: 'الميزانية التقديرية',
      readOnly: true,
    },
    { key, type: 'textarea', labelEn: en, labelAr: ar, maxLength: 2000 },
  ],
});

export interface PmsIds {
  sectionManagerRoleId: string;
  pmoRoleId: string;
  financeRoleId: string;
  dgoRoleId: string;
  dmnDiagramId: string;
}

export function pmsProgramRequestXml(ids: PmsIds): string {
  const approve = (
    id: string,
    lane: string,
    en: string,
    ar: string,
    exec: WfNodeSpec['exec'],
    sla: number,
  ): WfNodeSpec => ({
    id,
    type: 'userTask',
    approval: true,
    lane,
    en,
    ar,
    slaMinutes: sla,
    exec,
  });
  const nodes: WfNodeSpec[] = [
    {
      id: 'Start',
      type: 'startEvent',
      lane: 'L_Requester',
      en: 'Program request submitted',
      ar: 'تقديم طلب البرنامج',
      exec: { form: { fields: PMS_START_FIELDS } },
    },
    approve(
      'SectionReview',
      'L_Section',
      'Section manager review',
      'مراجعة رئيس القسم',
      {
        assignment: { type: 'ROLE', roleId: ids.sectionManagerRoleId, department: 'INITIATOR' },
        form: reviewForm('sectionNotes', 'Section manager notes', 'ملاحظات رئيس القسم'),
      },
      960,
    ),
    approve(
      'DeptApproval',
      'L_Department',
      'Department manager approval',
      'موافقة مدير الإدارة',
      {
        assignment: { type: 'INITIATOR_MANAGER' },
        fourEyes: true,
        form: reviewForm('departmentNotes', 'Department manager notes', 'ملاحظات مدير الإدارة'),
      },
      960,
    ),
    {
      id: 'BudgetRule',
      type: 'businessRuleTask',
      lane: 'L_Department',
      en: 'Determine budget approval',
      ar: 'تحديد موافقة الميزانية',
      decisionRef: ids.dmnDiagramId,
      decisionId: 'BudgetApproval',
    },
    {
      id: 'BudgetGateway',
      type: 'exclusiveGateway',
      lane: 'L_Department',
      en: 'Budget approval needed?',
      ar: 'هل تلزم موافقة الميزانية؟',
      defaultFlow: 'F_NoBudget',
    },
    approve(
      'BudgetApprovalTask',
      'L_Finance',
      'Budget approval',
      'موافقة الميزانية',
      {
        assignment: { type: 'LANE_ROLE' },
        form: reviewForm('budgetNotes', 'Finance notes', 'ملاحظات المالية'),
      },
      1440,
    ),
    approve(
      'PmoReview',
      'L_PMO',
      'PMO review',
      'مراجعة مكتب إدارة المشاريع',
      {
        assignment: { type: 'LANE_ROLE' },
        form: reviewForm('pmoNotes', 'PMO notes', 'ملاحظات مكتب المشاريع'),
      },
      1440,
    ),
    approve(
      'DgoApproval',
      'L_DGO',
      'DGO approval',
      'موافقة المدير العام',
      { assignment: { type: 'LANE_ROLE' }, fourEyes: true },
      1440,
    ),
    {
      id: 'ApprovalLetter',
      type: 'serviceTask',
      lane: 'L_PMO',
      en: 'Generate approval letter',
      ar: 'إنشاء خطاب الموافقة',
      exec: {
        kind: 'GENERATE_DOCUMENT',
        document: {
          fileNameEn: 'Program approval letter',
          fileNameAr: 'خطاب الموافقة على البرنامج',
          titleEn: 'Program approval — {{programName}}',
          titleAr: 'الموافقة على البرنامج — {{programName}}',
          bodyEn:
            'Request {{case.number}} for the program "{{programName}}" ({{programType}}) with an estimated budget of AED {{estimatedBudget}} has been approved by the Director General.\nThe PMO will register the program and contact {{initiator.name}}.',
          bodyAr:
            'تمت موافقة المدير العام على الطلب {{case.number}} الخاص بالبرنامج «{{programName}}» ({{programType}}) بميزانية تقديرية قدرها {{estimatedBudget}} درهم.\nسيقوم مكتب إدارة المشاريع بتسجيل البرنامج والتواصل مع {{initiator.name}}.',
          includeData: true,
        },
      },
    },
    {
      id: 'NotifyApproved',
      type: 'sendTask',
      lane: 'L_PMO',
      en: 'Notify requester',
      ar: 'إشعار مقدم الطلب',
      exec: {
        notify: {
          recipients: [{ type: 'INITIATOR' }, { type: 'PROCESS_OWNER' }],
          subjectEn: 'Program approved: {{programName}}',
          subjectAr: 'تمت الموافقة على البرنامج: {{programName}}',
          bodyEn:
            'Your request {{case.number}} for "{{programName}}" was approved. The approval letter is attached to the request.',
          bodyAr:
            'تمت الموافقة على طلبك {{case.number}} الخاص بـ «{{programName}}». خطاب الموافقة مرفق بالطلب.',
        },
      },
    },
    {
      id: 'EndApproved',
      type: 'endEvent',
      lane: 'L_PMO',
      en: 'Program approved',
      ar: 'تمت الموافقة على البرنامج',
    },
    {
      id: 'CorrectRequest',
      type: 'userTask',
      lane: 'L_Requester',
      col: 1,
      en: 'Correct the request',
      ar: 'تصحيح الطلب',
      slaMinutes: 2400,
      exec: {
        assignment: { type: 'INITIATOR' },
        form: { fields: PMS_START_FIELDS.filter((f) => f.key !== 'requestingDepartment') },
      },
    },
    {
      id: 'EndRejected',
      type: 'endEvent',
      lane: 'L_Requester',
      en: 'Program rejected',
      ar: 'تم رفض البرنامج',
    },
  ];
  const outcomes = (from: string, next: string, n: number): WfFlowSpec[] => [
    {
      id: `F_${from}_ok`,
      from,
      to: next,
      en: 'Approved',
      ar: 'موافق',
      exec: { outcome: 'APPROVE' },
    },
    {
      id: `F_${from}_back`,
      from,
      to: 'CorrectRequest',
      en: 'Return for correction',
      ar: 'إعادة للتصحيح',
      exec: { outcome: 'RETURN' },
    },
    {
      id: `F_${from}_no`,
      from,
      to: 'EndRejected',
      en: n ? 'Rejected' : 'Rejected',
      ar: 'مرفوض',
      exec: { outcome: 'REJECT' },
    },
  ];
  const flows: WfFlowSpec[] = [
    { id: 'F_Start', from: 'Start', to: 'SectionReview' },
    ...outcomes('SectionReview', 'DeptApproval', 0),
    ...outcomes('DeptApproval', 'BudgetRule', 1),
    { id: 'F_Rule', from: 'BudgetRule', to: 'BudgetGateway' },
    {
      id: 'F_Budget',
      from: 'BudgetGateway',
      to: 'BudgetApprovalTask',
      en: '≥ AED 100,000',
      ar: '≥ 100,000 درهم',
      condition: 'budgetApproval = true',
    },
    {
      id: 'F_NoBudget',
      from: 'BudgetGateway',
      to: 'PmoReview',
      en: 'Below AED 100,000',
      ar: 'أقل من 100,000 درهم',
    },
    ...outcomes('BudgetApprovalTask', 'PmoReview', 2),
    ...outcomes('PmoReview', 'DgoApproval', 3),
    ...outcomes('DgoApproval', 'ApprovalLetter', 4),
    { id: 'F_Letter', from: 'ApprovalLetter', to: 'NotifyApproved' },
    { id: 'F_Notify', from: 'NotifyApproved', to: 'EndApproved' },
    { id: 'F_Corrected', from: 'CorrectRequest', to: 'SectionReview' },
  ];
  return buildWorkflowBpmn('PMS01', nodes, flows, [
    { id: 'L_Requester', en: 'Requester', ar: 'مقدم الطلب' },
    { id: 'L_Section', en: 'Section manager', ar: 'رئيس القسم', roleId: ids.sectionManagerRoleId },
    { id: 'L_Department', en: 'Department manager', ar: 'مدير الإدارة' },
    {
      id: 'L_Finance',
      en: 'Finance — budget approver',
      ar: 'المالية — معتمد الميزانية',
      roleId: ids.financeRoleId,
    },
    { id: 'L_PMO', en: 'PMO', ar: 'مكتب إدارة المشاريع', roleId: ids.pmoRoleId },
    { id: 'L_DGO', en: 'Director General Office', ar: 'مكتب المدير العام', roleId: ids.dgoRoleId },
  ]);
}

export function leaveRequestXml(hrRoleId: string): string {
  const nodes: WfNodeSpec[] = [
    {
      id: 'Start',
      type: 'startEvent',
      lane: 'L_Employee',
      en: 'Leave requested',
      ar: 'تقديم طلب الإجازة',
      exec: {
        form: {
          fields: [
            {
              key: 'leaveType',
              type: 'select',
              labelEn: 'Leave type',
              labelAr: 'نوع الإجازة',
              required: true,
              options: [
                { value: 'annual', labelEn: 'Annual leave', labelAr: 'إجازة سنوية' },
                { value: 'sick', labelEn: 'Sick leave', labelAr: 'إجازة مرضية' },
                { value: 'unpaid', labelEn: 'Unpaid leave', labelAr: 'إجازة بدون راتب' },
              ],
            },
            {
              key: 'firstDay',
              type: 'date',
              labelEn: 'First day',
              labelAr: 'اليوم الأول',
              required: true,
            },
            {
              key: 'days',
              type: 'number',
              labelEn: 'Working days',
              labelAr: 'أيام العمل',
              required: true,
              min: 1,
              max: 60,
            },
            {
              key: 'reason',
              type: 'textarea',
              labelEn: 'Reason',
              labelAr: 'السبب',
              maxLength: 1000,
            },
          ],
        },
      },
    },
    {
      id: 'ManagerApproval',
      type: 'userTask',
      approval: true,
      lane: 'L_Manager',
      en: 'Manager approval',
      ar: 'موافقة المدير',
      slaMinutes: 480,
      exec: { assignment: { type: 'INITIATOR_MANAGER' }, fourEyes: true },
    },
    {
      id: 'LongLeave',
      type: 'exclusiveGateway',
      lane: 'L_Manager',
      en: 'More than 10 days?',
      ar: 'أكثر من 10 أيام؟',
      defaultFlow: 'F_Short',
    },
    {
      id: 'HrReview',
      type: 'userTask',
      approval: true,
      lane: 'L_HR',
      en: 'HR review',
      ar: 'مراجعة الموارد البشرية',
      slaMinutes: 960,
      exec: { assignment: { type: 'LANE_ROLE' } },
    },
    {
      id: 'Record',
      type: 'serviceTask',
      lane: 'L_HR',
      en: 'Record approved leave',
      ar: 'تسجيل الإجازة المعتمدة',
      exec: {
        kind: 'SET_DATA',
        set: [
          { key: 'approvedDays', expression: 'days' },
          { key: 'leaveStatus', expression: '"approved"' },
        ],
      },
    },
    {
      id: 'NotifyEmployee',
      type: 'sendTask',
      lane: 'L_HR',
      en: 'Notify employee',
      ar: 'إشعار الموظف',
      exec: {
        notify: {
          recipients: [{ type: 'INITIATOR' }],
          subjectEn: 'Leave approved ({{approvedDays}} days)',
          subjectAr: 'تمت الموافقة على الإجازة ({{approvedDays}} أيام)',
          bodyEn:
            'Your {{leaveType}} from {{firstDay}} ({{approvedDays}} working days) was approved.',
          bodyAr:
            'تمت الموافقة على {{leaveType}} اعتباراً من {{firstDay}} ({{approvedDays}} أيام عمل).',
        },
      },
    },
    {
      id: 'EndApproved',
      type: 'endEvent',
      lane: 'L_HR',
      en: 'Leave approved',
      ar: 'تمت الموافقة على الإجازة',
    },
    {
      id: 'EndRejected',
      type: 'endEvent',
      lane: 'L_Manager',
      en: 'Leave rejected',
      ar: 'تم رفض الإجازة',
    },
  ];
  const flows: WfFlowSpec[] = [
    { id: 'F_Start', from: 'Start', to: 'ManagerApproval' },
    {
      id: 'F_MgrOk',
      from: 'ManagerApproval',
      to: 'LongLeave',
      en: 'Approved',
      ar: 'موافق',
      exec: { outcome: 'APPROVE' },
    },
    {
      id: 'F_MgrNo',
      from: 'ManagerApproval',
      to: 'EndRejected',
      en: 'Rejected',
      ar: 'مرفوض',
      exec: { outcome: 'REJECT' },
    },
    {
      id: 'F_Long',
      from: 'LongLeave',
      to: 'HrReview',
      en: 'Yes',
      ar: 'نعم',
      condition: 'days > 10',
    },
    { id: 'F_Short', from: 'LongLeave', to: 'Record', en: 'No', ar: 'لا' },
    {
      id: 'F_HrOk',
      from: 'HrReview',
      to: 'Record',
      en: 'Approved',
      ar: 'موافق',
      exec: { outcome: 'APPROVE' },
    },
    {
      id: 'F_HrNo',
      from: 'HrReview',
      to: 'EndRejected',
      en: 'Rejected',
      ar: 'مرفوض',
      exec: { outcome: 'REJECT' },
    },
    { id: 'F_Rec', from: 'Record', to: 'NotifyEmployee' },
    { id: 'F_End', from: 'NotifyEmployee', to: 'EndApproved' },
  ];
  return buildWorkflowBpmn('HR01', nodes, flows, [
    { id: 'L_Employee', en: 'Employee', ar: 'الموظف' },
    { id: 'L_Manager', en: 'Line manager', ar: 'المدير المباشر' },
    { id: 'L_HR', en: 'Human resources', ar: 'الموارد البشرية', roleId: hrRoleId },
  ]);
}
