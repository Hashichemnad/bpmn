import { useEffect } from 'react';
import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import {
  SYSTEM_ROLE_KEYS,
  TEST_FREQUENCIES,
  TEST_TYPES,
  sampleSizeFor,
  testFrequencyFor,
  type ControlDto,
  type TestPlanDto,
} from '@processhub/shared';
import { useSaveTestPlan } from '@/api/assurance';
import { useErrorMessage } from '@/components/i18n-helpers';
import { UserSelect } from '@/features/governance/UserSelect';

interface Values {
  testType: string;
  procedure: { en: string; ar: string }[];
  sampleSize: number;
  frequency: string;
  testerId?: string | null;
  testerRoleKey?: string | null;
  reviewerId?: string | null;
  reviewerRoleKey?: string | null;
  nextDueAt?: Dayjs | null;
  leadDays: number;
  active: boolean;
}

/** Create or edit a test plan; frequency and sample size are suggested from the control. */
export function TestPlanModal({
  control,
  plan,
  onClose,
}: {
  control: ControlDto;
  plan?: TestPlanDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const save = useSaveTestPlan();
  const [form] = Form.useForm<Values>();

  useEffect(() => {
    form.setFieldsValue(
      plan
        ? {
            testType: plan.testType,
            procedure: plan.procedure,
            sampleSize: plan.sampleSize,
            frequency: plan.frequency,
            testerId: plan.tester.user?.id ?? null,
            testerRoleKey: plan.tester.roleKey,
            reviewerId: plan.reviewer.user?.id ?? null,
            reviewerRoleKey: plan.reviewer.roleKey,
            nextDueAt: plan.nextDueAt ? dayjs(plan.nextDueAt) : null,
            leadDays: plan.leadDays,
            active: plan.active,
          }
        : {
            testType: 'OPERATING',
            procedure: [{ en: '', ar: '' }],
            sampleSize: sampleSizeFor(control.frequency),
            frequency: testFrequencyFor(control.frequency),
            nextDueAt: dayjs().add(1, 'month').endOf('month'),
            leadDays: 30,
            active: true,
          },
    );
  }, [form, plan, control]);

  const roleOptions = SYSTEM_ROLE_KEYS.filter((r) => r !== 'VIEWER').map((r) => ({
    value: r,
    label: t(`admin:roles.${r}`),
  }));

  const submit = (v: Values) => {
    const body = {
      ...v,
      procedure: v.procedure.filter((s) => s.en || s.ar),
      testerId: v.testerId ?? null,
      testerRoleKey: v.testerRoleKey ?? null,
      reviewerId: v.reviewerId ?? null,
      reviewerRoleKey: v.reviewerRoleKey ?? null,
      nextDueAt: v.nextDueAt ? v.nextDueAt.format('YYYY-MM-DD') : null,
    };
    save.mutate(
      { id: plan?.id, body: (plan ? body : { ...body, controlId: control.id }) as never },
      {
        onSuccess: () => {
          message.success(t('assurance:plans.saved'));
          onClose();
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  };

  return (
    <Modal
      open
      width={760}
      title={t(plan ? 'assurance:plans.edit' : 'assurance:plans.new')}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={t('save')}
      confirmLoading={save.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={submit} data-testid="test-plan-form">
        <Space wrap size={16}>
          <Form.Item name="testType" label={t('assurance:tests.type')} rules={[{ required: true }]}>
            <Select
              style={{ width: 220 }}
              options={TEST_TYPES.map((v) => ({
                value: v,
                label: t(`assurance:tests.types.${v}`),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="frequency"
            label={t('assurance:plans.frequency')}
            extra={t('assurance:plans.frequencyHint', {
              value: t(`grc:frequency.${control.frequency}`),
            })}
          >
            <Select
              style={{ width: 200 }}
              options={TEST_FREQUENCIES.map((v) => ({
                value: v,
                label: t(`assurance:plans.frequencies.${v}`),
              }))}
            />
          </Form.Item>
          <Form.Item name="sampleSize" label={t('assurance:tests.sampleSize')}>
            <InputNumber min={1} max={100} />
          </Form.Item>
        </Space>
        <Form.Item label={t('assurance:tests.procedure')}>
          <Form.List name="procedure">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f, i) => (
                  <Space key={f.key} align="start" style={{ display: 'flex' }}>
                    <span style={{ paddingBlockStart: 5 }}>{i + 1}.</span>
                    <Form.Item name={[f.name, 'en']} style={{ flex: 1, marginBlockEnd: 8 }}>
                      <Input.TextArea
                        autoSize
                        placeholder={t('assurance:plans.stepEn')}
                        dir="ltr"
                        style={{ width: 300 }}
                      />
                    </Form.Item>
                    <Form.Item name={[f.name, 'ar']} style={{ flex: 1, marginBlockEnd: 8 }}>
                      <Input.TextArea
                        autoSize
                        placeholder={t('assurance:plans.stepAr')}
                        dir="rtl"
                        style={{ width: 300 }}
                      />
                    </Form.Item>
                    <Button type="text" icon={<DeleteOutlined />} onClick={() => remove(f.name)} />
                  </Space>
                ))}
                <Button icon={<PlusOutlined />} onClick={() => add({ en: '', ar: '' })}>
                  {t('assurance:plans.addStep')}
                </Button>
              </>
            )}
          </Form.List>
        </Form.Item>
        <Space wrap size={16}>
          <Form.Item name="testerId" label={t('assurance:tests.tester')}>
            <UserSelect
              allowClear
              style={{ width: 240 }}
              known={plan?.tester.user ? [plan.tester.user] : []}
            />
          </Form.Item>
          <Form.Item name="testerRoleKey" label={t('assurance:plans.orRole')}>
            <Select allowClear style={{ width: 200 }} options={roleOptions} />
          </Form.Item>
        </Space>
        <Space wrap size={16}>
          <Form.Item name="reviewerId" label={t('assurance:tests.reviewer')}>
            <UserSelect
              allowClear
              style={{ width: 240 }}
              known={plan?.reviewer.user ? [plan.reviewer.user] : []}
            />
          </Form.Item>
          <Form.Item name="reviewerRoleKey" label={t('assurance:plans.orRole')}>
            <Select allowClear style={{ width: 200 }} options={roleOptions} />
          </Form.Item>
        </Space>
        <Space wrap size={16}>
          <Form.Item name="nextDueAt" label={t('assurance:plans.nextDue')}>
            <DatePicker />
          </Form.Item>
          <Form.Item name="leadDays" label={t('assurance:plans.leadDays')}>
            <InputNumber min={0} max={180} />
          </Form.Item>
          <Form.Item name="active" label={t('assurance:plans.active')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}
