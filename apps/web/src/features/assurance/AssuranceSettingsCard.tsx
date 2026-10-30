import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Card,
  ColorPicker,
  Input,
  InputNumber,
  Radio,
  Space,
  Table,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { AssuranceSettings } from '@processhub/shared';
import { useAssuranceSettings, useSaveAssuranceSettings } from '@/api/assurance';
import { useErrorMessage } from '@/components/i18n-helpers';

/** Settings → Risk & Compliance → Issues: severity scale, reminders, escalation. */
export function AssuranceSettingsCard() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const query = useAssuranceSettings();
  const save = useSaveAssuranceSettings();
  const [value, setValue] = useState<AssuranceSettings | null>(null);
  useEffect(() => {
    if (query.data) setValue(query.data);
  }, [query.data]);
  if (!value) return null;
  const patch = (p: Partial<AssuranceSettings>) => setValue((v) => (v ? { ...v, ...p } : v));
  const setSeverity = (i: number, p: Partial<AssuranceSettings['severities'][number]>) =>
    patch({ severities: value.severities.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  return (
    <Card
      title={t('assurance:settings.title')}
      style={{ marginBlockStart: 16 }}
      extra={
        <Button
          type="primary"
          loading={save.isPending}
          onClick={() =>
            save.mutate(value, {
              onSuccess: () => message.success(t('assurance:settings.saved')),
              onError: (e) => message.error(errorMessage(e)),
            })
          }
        >
          {t('save')}
        </Button>
      }
    >
      <Typography.Paragraph strong>{t('assurance:settings.severities')}</Typography.Paragraph>
      <Table
        size="small"
        pagination={false}
        rowKey={(_, i) => String(i)}
        dataSource={value.severities}
        columns={[
          {
            title: t('assurance:settings.key'),
            render: (_, s, i) => (
              <Input
                size="small"
                dir="ltr"
                value={s.key}
                onChange={(e) => setSeverity(i, { key: e.target.value.toUpperCase() })}
              />
            ),
          },
          {
            title: t('assurance:settings.nameEn'),
            render: (_, s, i) => (
              <Input
                size="small"
                dir="ltr"
                value={s.nameEn}
                onChange={(e) => setSeverity(i, { nameEn: e.target.value })}
              />
            ),
          },
          {
            title: t('assurance:settings.nameAr'),
            render: (_, s, i) => (
              <Input
                size="small"
                dir="rtl"
                value={s.nameAr}
                onChange={(e) => setSeverity(i, { nameAr: e.target.value })}
              />
            ),
          },
          {
            title: t('assurance:settings.colour'),
            render: (_, s, i) => (
              <ColorPicker
                size="small"
                value={s.colour}
                onChange={(c) => setSeverity(i, { colour: c.toHexString() })}
              />
            ),
          },
          {
            key: 'del',
            render: (_, _s, i) => (
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                disabled={value.severities.length <= 2}
                onClick={() => patch({ severities: value.severities.filter((_x, j) => j !== i) })}
              />
            ),
          },
        ]}
      />
      <Button
        size="small"
        icon={<PlusOutlined />}
        style={{ marginBlock: 8 }}
        disabled={value.severities.length >= 6}
        onClick={() =>
          patch({
            severities: [
              ...value.severities,
              {
                key: `LEVEL_${value.severities.length + 1}`,
                nameEn: '',
                nameAr: '',
                colour: '#8c8c8c',
              },
            ],
          })
        }
      >
        {t('assurance:settings.addSeverity')}
      </Button>
      <Space direction="vertical" style={{ width: '100%', marginBlockStart: 8 }}>
        <Space wrap>
          {t('assurance:settings.reminderDays')}
          <InputNumber
            min={0}
            max={90}
            value={value.reminderDaysBefore}
            onChange={(n) => patch({ reminderDaysBefore: n ?? 0 })}
          />
        </Space>
        <Space wrap>
          {t('assurance:settings.escalationDays')}
          <InputNumber
            min={0}
            max={180}
            value={value.escalationDays}
            onChange={(n) => patch({ escalationDays: n ?? 0 })}
          />
        </Space>
        <Radio.Group
          value={value.escalateTo}
          onChange={(e) => patch({ escalateTo: e.target.value })}
        >
          <Space direction="vertical">
            {(['MANAGER', 'RISK_OFFICER', 'BOTH'] as const).map((k) => (
              <Radio key={k} value={k}>
                {t(`assurance:settings.escalateTo.${k}`)}
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      </Space>
    </Card>
  );
}
