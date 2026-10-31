import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
  type FormInstance,
} from 'antd';
import { PaperClipOutlined, UploadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fieldLabel, type FormField, type FormSchema, type UserRef } from '@processhub/shared';
import { useLocale } from '@/app/LocaleProvider';
import { useErrorMessage, useFormatDate } from '@/components/i18n-helpers';
import {
  searchWorkflowUsers,
  uploadWorkflowFile,
  useWorkflowDepartments,
  workflowFileUrl,
} from '@/api/workflow';
import { useUserNames } from './form-utils';

const help = (f: FormField, locale: string) =>
  (locale === 'ar' ? f.helpAr || f.helpEn : f.helpEn || f.helpAr) || undefined;
const optionLabel = (o: FormField['options'][number], locale: string) =>
  (locale === 'ar' ? o.labelAr || o.labelEn : o.labelEn || o.labelAr) || o.value;
const name = (u: UserRef | undefined, locale: string) =>
  u ? (locale === 'ar' ? u.nameAr || u.nameEn : u.nameEn || u.nameAr) || u.email : '';

export function UserPicker({
  value,
  onChange,
  disabled,
}: {
  value?: string;
  onChange?: (v: string | null) => void;
  disabled?: boolean;
}) {
  const { locale } = useLocale();
  const [q, setQ] = useState('');
  const found = useQuery({
    queryKey: ['workflow', 'user-search', q],
    queryFn: () => searchWorkflowUsers(q),
    enabled: q.trim().length >= 2,
  });
  const current = useUserNames(value ? [value] : []);
  const options = useMemo(() => {
    const all = new Map<string, UserRef>();
    for (const u of [...(current.data ?? []), ...(found.data ?? [])]) all.set(u.id, u);
    return [...all.values()].map((u) => ({
      value: u.id,
      label: `${name(u, locale)} · ${u.email}`,
    }));
  }, [current.data, found.data, locale]);
  return (
    <Select
      showSearch
      allowClear
      disabled={disabled}
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? null)}
      onSearch={setQ}
      filterOption={false}
      options={options}
      loading={found.isFetching}
      style={{ width: '100%' }}
    />
  );
}

function FileField({
  value,
  onChange,
  caseId,
  taskId,
  names,
}: {
  value?: string[];
  onChange?: (v: string[]) => void;
  caseId?: string;
  taskId?: string;
  names: Record<string, string>;
}) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [local, setLocal] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const ids = value ?? [];
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {ids.map((id) => (
        <Space key={id}>
          <PaperClipOutlined />
          <a href={workflowFileUrl(id)}>{local[id] ?? names[id] ?? id}</a>
          <Button
            size="small"
            type="link"
            danger
            onClick={() => onChange?.(ids.filter((x) => x !== id))}
          >
            {t('workflow:form.removeFile')}
          </Button>
        </Space>
      ))}
      <Upload
        showUploadList={false}
        customRequest={async ({ file, onSuccess, onError }) => {
          try {
            setError(null);
            const f = await uploadWorkflowFile(file as File, { caseId, taskId });
            setLocal((m) => ({ ...m, [f.id]: f.name }));
            onChange?.([...ids, f.id]);
            onSuccess?.(f);
          } catch (e) {
            setError(errorMessage(e));
            onError?.(e as Error);
          }
        }}
      >
        <Button icon={<UploadOutlined />} size="small">
          {t('workflow:form.addFile')}
        </Button>
      </Upload>
      {error && <Typography.Text type="danger">{error}</Typography.Text>}
    </Space>
  );
}

export interface WorkflowFormProps {
  schema: FormSchema;
  form: FormInstance;
  /** Values shown in read-only fields (case data). */
  context?: Record<string, unknown>;
  caseId?: string;
  taskId?: string;
  fileNames?: Record<string, string>;
  disabled?: boolean;
  /** Preview in the form editor: no uploads, no remote lookups needed. */
  preview?: boolean;
}

/**
 * A workflow form (D-146) rendered with Ant Design from the shared schema: bilingual labels and help,
 * RTL through the ConfigProvider, the same rules the server checks (required, limits, options).
 */
export function WorkflowForm({
  schema,
  form,
  context = {},
  caseId,
  taskId,
  fileNames = {},
  disabled,
  preview,
}: WorkflowFormProps) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const departments = useWorkflowDepartments();
  const [, setTick] = useState(0);
  useEffect(() => setTick((x) => x + 1), [locale]);
  const depOptions = (departments.data ?? []).map((d) => ({
    value: d.id,
    label: (locale === 'ar' ? d.nameAr || d.nameEn : d.nameEn || d.nameAr) || d.id,
  }));
  return (
    <Form form={form} layout="vertical" disabled={disabled} requiredMark>
      {schema.fields.map((f) => {
        const label = fieldLabel(f, locale);
        if (f.type === 'info')
          return (
            <Alert
              key={f.key}
              type="info"
              showIcon
              style={{ marginBlockEnd: 16 }}
              message={label}
              description={help(f, locale)}
            />
          );
        if (f.readOnly)
          return (
            <Form.Item key={f.key} label={label} help={help(f, locale)}>
              <ReadOnlyValue field={f} value={context[f.key]} fileNames={fileNames} />
            </Form.Item>
          );
        const rules = [
          ...(f.required && f.type !== 'boolean'
            ? [{ required: true, message: t('workflow:form.required') }]
            : []),
          ...(f.required && f.type === 'boolean'
            ? [
                {
                  validator: (_: unknown, v: unknown) =>
                    v === true
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('workflow:form.required'))),
                },
              ]
            : []),
          ...(f.type === 'text' || f.type === 'textarea'
            ? [
                {
                  max: f.maxLength ?? (f.type === 'text' ? 500 : 10000),
                  message: t('workflow:form.tooLong'),
                },
              ]
            : []),
        ];
        const common = { name: f.key, label, help: help(f, locale), rules, key: f.key };
        switch (f.type) {
          case 'text':
            return (
              <Form.Item {...common}>
                <Input maxLength={f.maxLength ?? 500} />
              </Form.Item>
            );
          case 'textarea':
            return (
              <Form.Item {...common}>
                <Input.TextArea rows={4} maxLength={f.maxLength ?? 10000} showCount />
              </Form.Item>
            );
          case 'number':
          case 'amount':
            return (
              <Form.Item {...common}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={f.min ?? undefined}
                  max={f.max ?? undefined}
                  addonAfter={f.type === 'amount' ? f.currency : undefined}
                  formatter={(v) =>
                    v === undefined || v === null
                      ? ''
                      : `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
                  }
                  parser={(v) => (v ? Number(v.replace(/,/g, '')) : (null as unknown as number))}
                />
              </Form.Item>
            );
          case 'date':
            return (
              <Form.Item {...common}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            );
          case 'boolean':
            return (
              <Form.Item {...common} label={undefined} valuePropName="checked">
                <Checkbox>{label}</Checkbox>
              </Form.Item>
            );
          case 'select':
            return (
              <Form.Item {...common}>
                <Select
                  allowClear
                  options={f.options.map((o) => ({
                    value: o.value,
                    label: optionLabel(o, locale),
                  }))}
                />
              </Form.Item>
            );
          case 'multiselect':
            return (
              <Form.Item {...common}>
                <Select
                  mode="multiple"
                  allowClear
                  options={f.options.map((o) => ({
                    value: o.value,
                    label: optionLabel(o, locale),
                  }))}
                />
              </Form.Item>
            );
          case 'radio':
            return (
              <Form.Item {...common}>
                <Radio.Group
                  options={f.options.map((o) => ({
                    value: o.value,
                    label: optionLabel(o, locale),
                  }))}
                />
              </Form.Item>
            );
          case 'user':
            return (
              <Form.Item {...common}>
                <UserPicker />
              </Form.Item>
            );
          case 'department':
            return (
              <Form.Item {...common}>
                <Select showSearch allowClear optionFilterProp="label" options={depOptions} />
              </Form.Item>
            );
          case 'file':
            return (
              <Form.Item {...common}>
                {preview ? (
                  <Button icon={<UploadOutlined />} size="small" disabled>
                    {t('workflow:form.addFile')}
                  </Button>
                ) : (
                  <FileField caseId={caseId} taskId={taskId} names={fileNames} />
                )}
              </Form.Item>
            );
        }
      })}
    </Form>
  );
}

function ReadOnlyValue({
  field: f,
  value,
  fileNames,
}: {
  field: FormField;
  value: unknown;
  fileNames: Record<string, string>;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const formatDate = useFormatDate();
  const departments = useWorkflowDepartments();
  const users = useUserNames(f.type === 'user' && typeof value === 'string' ? [value] : []);
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && !value.length)
  )
    return <Typography.Text type="secondary">—</Typography.Text>;
  switch (f.type) {
    case 'boolean':
      return <span>{value ? t('workflow:form.yes') : t('workflow:form.no')}</span>;
    case 'number':
    case 'amount':
      return (
        <span>
          {new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-GB', {
            maximumFractionDigits: 2,
          }).format(Number(value))}
          {f.type === 'amount' ? ` ${f.currency}` : ''}
        </span>
      );
    case 'date':
      return <span>{formatDate(String(value), false)}</span>;
    case 'select':
    case 'radio': {
      const o = f.options.find((x) => x.value === value);
      return <span>{o ? optionLabel(o, locale) : String(value)}</span>;
    }
    case 'multiselect':
      return (
        <Space wrap>
          {(value as string[]).map((v) => {
            const o = f.options.find((x) => x.value === v);
            return <Tag key={v}>{o ? optionLabel(o, locale) : v}</Tag>;
          })}
        </Space>
      );
    case 'user':
      return <span>{name(users.data?.[0], locale) || String(value)}</span>;
    case 'department': {
      const d = departments.data?.find((x) => x.id === value);
      return (
        <span>
          {d ? (locale === 'ar' ? d.nameAr || d.nameEn : d.nameEn || d.nameAr) : String(value)}
        </span>
      );
    }
    case 'file':
      return (
        <Space direction="vertical">
          {(value as string[]).map((id) => (
            <a key={id} href={workflowFileUrl(id)}>
              <PaperClipOutlined /> {fileNames[id] ?? id}
            </a>
          ))}
        </Space>
      );
    default:
      return <span style={{ whiteSpace: 'pre-wrap' }}>{String(value)}</span>;
  }
}

/** Submitted data of a step, read-only (case page, task context). */
export function FormValues({
  schema,
  values,
  fileNames = {},
}: {
  schema: FormSchema;
  values: Record<string, unknown>;
  fileNames?: Record<string, string>;
}) {
  const { locale } = useLocale();
  const fields = schema.fields.filter((f) => f.type !== 'info');
  if (!fields.length) return null;
  return (
    <Descriptions size="small" column={1} bordered>
      {fields.map((f) => (
        <Descriptions.Item key={f.key} label={fieldLabel(f, locale)}>
          <ReadOnlyValue field={f} value={values[f.key]} fileNames={fileNames} />
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}
