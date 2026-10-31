import { useEffect } from 'react';
import { App, Button, Card, Form, InputNumber, Select, Space, TimePicker, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import { WORK_WEEKS, type WorkflowSettings } from '@processhub/shared';
import { useSaveWorkflowSettings, useWorkflowSettings } from '@/api/workflow';
import { PageHeader } from '@/components/PageHeader';
import { useErrorMessage } from '@/components/i18n-helpers';

interface Values {
  week: WorkflowSettings['calendar']['week'];
  hours: [Dayjs, Dayjs];
  timeZone: string;
  reminderHours: number;
  escalation: WorkflowSettings['escalation'];
  escalationDelayHours: number;
  escalationRepeatHours: number;
}

/**
 * Settings → Workflow execution (workflow.admin): the central working week and hours used for due
 * times and SLAs (public holidays come from the central list of Process mining), reminders and
 * escalation (D-150).
 */
export function WorkflowSettingsPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const settings = useWorkflowSettings();
  const save = useSaveWorkflowSettings();
  const [form] = Form.useForm<Values>();
  useEffect(() => {
    const s = settings.data;
    if (s)
      form.setFieldsValue({
        week: s.calendar.week,
        hours: [dayjs(s.calendar.start, 'HH:mm'), dayjs(s.calendar.end, 'HH:mm')],
        timeZone: s.calendar.timeZone,
        reminderHours: Math.round((s.reminderMinutesBefore / 60) * 100) / 100,
        escalation: s.escalation,
        escalationDelayHours: Math.round((s.escalationDelayMinutes / 60) * 100) / 100,
        escalationRepeatHours: s.escalationRepeatHours,
      });
  }, [settings.data, form]);
  const submit = async () => {
    const v = await form.validateFields();
    try {
      await save.mutateAsync({
        calendar: {
          week: v.week,
          start: v.hours[0].format('HH:mm'),
          end: v.hours[1].format('HH:mm'),
          timeZone: v.timeZone,
        },
        reminderMinutesBefore: Math.round(v.reminderHours * 60),
        escalation: v.escalation,
        escalationDelayMinutes: Math.round((v.escalationDelayHours ?? 0) * 60),
        escalationRepeatHours: v.escalationRepeatHours,
      });
      message.success(t('workflow:settings.saved'));
    } catch (e) {
      message.error(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader title={t('workflow:settings.title')} subtitle={t('workflow:settings.subtitle')} />
      <Card loading={settings.isLoading} style={{ maxWidth: 720 }}>
        <Form form={form} layout="vertical">
          <Form.Item name="week" label={t('workflow:settings.week')}>
            <Select
              options={WORK_WEEKS.map((w) => ({
                value: w,
                label: t(`workflow:settings.weeks.${w}`),
              }))}
            />
          </Form.Item>
          <Form.Item name="hours" label={t('workflow:settings.hours')} rules={[{ required: true }]}>
            <TimePicker.RangePicker format="HH:mm" minuteStep={15} />
          </Form.Item>
          <Form.Item name="timeZone" label={t('workflow:settings.timeZone')}>
            <Select
              showSearch
              options={[
                'Asia/Dubai',
                'Asia/Riyadh',
                'Asia/Qatar',
                'Asia/Kuwait',
                'Asia/Bahrain',
                'Asia/Muscat',
                'Africa/Cairo',
                'Europe/London',
                'UTC',
              ].map((z) => ({ value: z, label: z }))}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            {t('workflow:settings.holidaysHint')}
          </Typography.Paragraph>
          <Form.Item
            name="reminderHours"
            label={t('workflow:settings.reminder')}
            extra={t('workflow:settings.reminderHint')}
          >
            <InputNumber
              min={0}
              max={168}
              step={0.5}
              addonAfter={t('workflow:settings.workingHours')}
            />
          </Form.Item>
          <Form.Item name="escalation" label={t('workflow:settings.escalation')}>
            <Select
              options={(['NONE', 'MANAGER', 'OWNER', 'BOTH'] as const).map((x) => ({
                value: x,
                label: t(`workflow:escalation.${x}`),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="escalationDelayHours"
            label={t('workflow:settings.escalationDelay')}
            extra={t('workflow:settings.escalationDelayHint')}
          >
            <InputNumber
              min={0}
              max={168}
              step={0.5}
              addonAfter={t('workflow:settings.workingHours')}
            />
          </Form.Item>
          <Form.Item
            name="escalationRepeatHours"
            label={t('workflow:settings.repeat')}
            extra={t('workflow:settings.repeatHint')}
          >
            <InputNumber min={0} max={720} addonAfter={t('workflow:settings.workingHours')} />
          </Form.Item>
          <Space>
            <Button type="primary" onClick={() => void submit()} loading={save.isPending}>
              {t('save')}
            </Button>
          </Space>
        </Form>
      </Card>
    </>
  );
}
