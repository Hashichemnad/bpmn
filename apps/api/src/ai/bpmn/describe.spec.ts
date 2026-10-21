import { ONBOARDING, ONBOARDING_REFINED } from '../../../test/fixtures/ai-structures';
import { describeProcess, diffStructures, flowOrder } from './describe';
import { diffLines } from '../text-diff';

describe('process outline and diffs', () => {
  it('orders steps along the flow and lists decisions with their branches', () => {
    expect(flowOrder(ONBOARDING).map((n) => n.id)).toEqual([
      'Start',
      'Task_Record',
      'Task_Accounts',
      'Task_Laptop',
      'Gw_Ready',
      'Task_Plan',
      'Task_Welcome',
      'End',
    ]);
    const text = describeProcess(ONBOARDING, {
      Task_Record: [{ type: 'SYSTEM', nameEn: 'SAP HR', nameAr: 'ساب', relation: 'SUPPORTS' }],
    });
    expect(text).toContain('Lanes (roles): HR Officer / موظف الموارد البشرية');
    expect(text).toContain(
      'Step 1 [Task_Record] Create employee record / إنشاء سجل الموظف — performed by HR Officer',
    );
    expect(text).toContain('linked: system SAP HR / ساب (SUPPORTS)');
    expect(text).toContain('→ Yes / نعم: Prepare first-week plan');
    expect(text).toContain('→ No / لا: Prepare laptop');
  });

  it('lists structural changes between two versions', () => {
    const changes = diffStructures(ONBOARDING, ONBOARDING_REFINED);
    expect(changes).toEqual(
      expect.arrayContaining([
        'Lane added: Finance Manager / المدير المالي',
        'Added userTask: Approve equipment budget / اعتماد ميزانية المعدات (lane Finance Manager / المدير المالي)',
        expect.stringMatching(/^Removed connection: Create user accounts .* → Prepare laptop/),
      ]),
    );
    expect(diffStructures(ONBOARDING, ONBOARDING)).toEqual([]);
    const renamed = {
      ...ONBOARDING,
      nodes: ONBOARDING.nodes.map((n) => (n.id === 'End' ? { ...n, nameEn: 'Done' } : n)),
    };
    expect(diffStructures(ONBOARDING, renamed)).toEqual([
      'Renamed: Employee onboarded / اكتملت التهيئة → Done / اكتملت التهيئة',
    ]);
  });

  it('diffs text line by line', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual(['- b', '+ x']);
    expect(diffLines('', 'a')).toEqual(['+ a']);
    expect(diffLines('same', 'same')).toEqual([]);
  });
});
