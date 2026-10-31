import { useEffect } from 'react';
import { Alert, App, Button, Card, DatePicker, Form } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useOutOfOffice, useSaveOutOfOffice } from '@/api/workflow';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { UserPicker } from './WorkflowForm';

/** Profile: out of office — new workflow tasks go to a substitute during the period (step 2). */
export function OutOfOfficeCard() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const ooo = useOutOfOffice();
  const save = useSaveOutOfOffice();
  const [form] = Form.useForm<{ period?: [Dayjs, Dayjs]; substituteId: string | null }>();
  useEffect(() => {
    if (ooo.data)
      form.setFieldsValue({
        period:
          ooo.data.from && ooo.data.to ? [dayjs(ooo.data.from), dayjs(ooo.data.to)] : undefined,
        substituteId: ooo.data.substituteId,
      });
  }, [ooo.data, form]);
  const submit = async (clear = false) => {
    const v = clear ? { period: undefined, substituteId: null } : await form.validateFields();
    try {
      await save.mutateAsync({
        from: v.period ? v.period[0].format('YYYY-MM-DD') : null,
        to: v.period ? v.period[1].format('YYYY-MM-DD') : null,
        substituteId: v.period ? v.substituteId : null,
      });
      if (clear) form.resetFields();
      message.success(t('workflow:ooo.saved'));
    } catch (e) {
      message.error(errorMessage(e));
    }
  };
  const d = ooo.data;
  return (
    <Card title={t('workflow:ooo.title')} data-testid="ooo-card">
      {d?.active && d.substitute && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBlockEnd: 12 }}
          message={t('workflow:ooo.active', {
            name: loc(d.substitute) || d.substitute.email,
            to: formatDate(d.to, false),
          })}
        />
      )}
      <Form form={form} layout="vertical">
        <Form.Item name="period" label={t('workflow:ooo.period')} extra={t('workflow:ooo.hint')}>
          <DatePicker.RangePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
        </Form.Item>
        <Form.Item
          name="substituteId"
          label={t('workflow:ooo.substitute')}
          rules={[
            ({ getFieldValue }) => ({
              validator: (_, v) =>
                getFieldValue('period') && !v
                  ? Promise.reject(new Error(t('workflow:ooo.substituteRequired')))
                  : Promise.resolve(),
            }),
          ]}
        >
          <UserPicker />
        </Form.Item>
        <Button type="primary" onClick={() => void submit()} loading={save.isPending}>
          {t('save')}
        </Button>{' '}
        {d?.from && <Button onClick={() => void submit(true)}>{t('workflow:ooo.clear')}</Button>}
      </Form>
    </Card>
  );
}
