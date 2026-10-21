import type { ProcessStructure } from '../../src/ai/bpmn/process-structure';

const n = (
  id: string,
  type: ProcessStructure['nodes'][number]['type'],
  nameEn: string,
  nameAr: string,
  lane: string,
  extra: Partial<ProcessStructure['nodes'][number]> = {},
): ProcessStructure['nodes'][number] => ({
  id,
  type,
  eventDefinition: 'none',
  nameEn,
  nameAr,
  lane,
  descriptionEn: '',
  descriptionAr: '',
  systemEn: '',
  systemAr: '',
  ...extra,
});
const f = (from: string, to: string, nameEn = '', nameAr = '') => ({ from, to, nameEn, nameAr });

/** Employee onboarding with HR, IT and the line manager: lanes, a decision, a loop and a system. */
export const ONBOARDING: ProcessStructure = {
  nameEn: 'Employee Onboarding',
  nameAr: 'تهيئة الموظف الجديد',
  descriptionEn: 'From signed offer to a productive first week.',
  descriptionAr: 'من العرض الموقّع إلى أسبوع أول منتج.',
  explanation: 'Three lanes (HR, IT, Line Manager) with an equipment check and a loop.',
  lanes: [
    { id: 'Lane_HR', nameEn: 'HR Officer', nameAr: 'موظف الموارد البشرية' },
    { id: 'Lane_IT', nameEn: 'IT Support', nameAr: 'الدعم الفني' },
    { id: 'Lane_LM', nameEn: 'Line Manager', nameAr: 'المدير المباشر' },
  ],
  nodes: [
    n('Start', 'startEvent', 'Offer signed', 'تم توقيع العرض', 'Lane_HR'),
    n('Task_Record', 'userTask', 'Create employee record', 'إنشاء سجل الموظف', 'Lane_HR', {
      systemEn: 'SAP HR',
      systemAr: 'ساب للموارد البشرية',
    }),
    n('Task_Accounts', 'serviceTask', 'Create user accounts', 'إنشاء حسابات المستخدم', 'Lane_IT'),
    n('Task_Laptop', 'manualTask', 'Prepare laptop', 'تجهيز الحاسوب المحمول', 'Lane_IT'),
    n('Gw_Ready', 'exclusiveGateway', 'Equipment ready?', 'هل المعدات جاهزة؟', 'Lane_IT'),
    n('Task_Plan', 'userTask', 'Prepare first-week plan', 'إعداد خطة الأسبوع الأول', 'Lane_LM'),
    n('Task_Welcome', 'task', 'Welcome the new employee', 'استقبال الموظف الجديد', 'Lane_LM'),
    n('End', 'endEvent', 'Employee onboarded', 'اكتملت التهيئة', 'Lane_LM'),
  ],
  flows: [
    f('Start', 'Task_Record'),
    f('Task_Record', 'Task_Accounts'),
    f('Task_Accounts', 'Task_Laptop'),
    f('Task_Laptop', 'Gw_Ready'),
    f('Gw_Ready', 'Task_Plan', 'Yes', 'نعم'),
    f('Gw_Ready', 'Task_Laptop', 'No', 'لا'),
    f('Task_Plan', 'Task_Welcome'),
    f('Task_Welcome', 'End'),
  ],
};

/** Malformed outputs the validation must catch (each is a fixture of a real failure mode). */
export const MALFORMED = {
  notJson: '{"nameEn": "Employee Onboarding", "nodes": [',
  wrongShape: { process: 'Employee onboarding', steps: ['Create account', 'Prepare laptop'] },
  noEndEvent: {
    ...ONBOARDING,
    nodes: ONBOARDING.nodes.filter((x) => x.type !== 'endEvent'),
    flows: ONBOARDING.flows.filter((x) => x.to !== 'End'),
  },
  danglingFlow: { ...ONBOARDING, flows: [...ONBOARDING.flows, f('Task_Plan', 'Task_Missing')] },
  unreachable: {
    ...ONBOARDING,
    nodes: [...ONBOARDING.nodes, n('Task_Orphan', 'task', 'Orphan', 'يتيم', 'Lane_HR')],
    flows: [...ONBOARDING.flows, f('Task_Orphan', 'End')],
  },
  scriptId: {
    ...ONBOARDING,
    nodes: ONBOARDING.nodes.map((x) =>
      x.id === 'Task_Record' ? { ...x, id: '"><script>alert(1)</script>' } : x,
    ),
  },
};

/** A refinement of ONBOARDING: a finance approval step added after "Create user accounts". */
export const ONBOARDING_REFINED: ProcessStructure = {
  ...ONBOARDING,
  explanation: 'Added an approval by the finance manager after "Create user accounts".',
  lanes: [
    ...ONBOARDING.lanes,
    { id: 'Lane_FIN', nameEn: 'Finance Manager', nameAr: 'المدير المالي' },
  ],
  nodes: [
    ...ONBOARDING.nodes,
    n(
      'Task_FinApprove',
      'userTask',
      'Approve equipment budget',
      'اعتماد ميزانية المعدات',
      'Lane_FIN',
    ),
  ],
  flows: ONBOARDING.flows
    .filter((x) => !(x.from === 'Task_Accounts' && x.to === 'Task_Laptop'))
    .concat([f('Task_Accounts', 'Task_FinApprove'), f('Task_FinApprove', 'Task_Laptop')]),
};
