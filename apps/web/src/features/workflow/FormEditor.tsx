import { useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  FORM_FIELD_TYPES,
  FORM_KEY_RE,
  RESERVED_VARIABLES,
  fieldLabel,
  formFieldSchema,
  formSchema,
  type FormField,
  type FormFieldInput,
  type FormFieldType,
  type FormSchema,
} from '@processhub/shared';
import { ConfigProvider } from 'antd';
import { LocaleOverride, useLocale } from '@/app/LocaleProvider';
import { WorkflowForm } from './WorkflowForm';
import { withAllLanguages } from '@/components/withAllLanguages';

const HAS_OPTIONS: FormFieldType[] = ['select', 'radio', 'multiselect'];

/** Field list editor of a workflow form (D-146): add, reorder, edit, preview in English and Arabic. */
function FormEditorInner({
  value,
  onChange,
  disabled,
}: {
  value: FormSchema | null;
  onChange: (v: FormSchema | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const fields = value?.fields ?? [];
  const [editing, setEditing] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const save = (list: FormField[]) =>
    onChange(list.length ? formSchema.parse({ fields: list }) : null);
  const move = (i: number, d: number) => {
    const list = [...fields];
    const [x] = list.splice(i, 1);
    list.splice(i + d, 0, x);
    save(list);
  };
  const addField = (type: FormFieldType) => {
    let n = fields.length + 1;
    while (fields.some((f) => f.key === `field${n}`)) n++;
    const f = formFieldSchema.parse({
      key: `field${n}`,
      type,
      labelEn: t(`workflow:fieldTypes.${type}`, { lng: 'en' }),
      labelAr: t(`workflow:fieldTypes.${type}`, { lng: 'ar' }),
      ...(HAS_OPTIONS.includes(type)
        ? { options: [{ value: 'option1', labelEn: 'Option 1', labelAr: 'خيار 1' }] }
        : {}),
    });
    save([...fields, f]);
    setEditing(fields.length);
  };
  return (
    <div className="ph-form-editor">
      {fields.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('workflow:formEditor.empty')} />
      ) : (
        <List
          size="small"
          bordered
          dataSource={fields}
          renderItem={(f, i) => (
            <List.Item style={{ display: 'block' }}>
              <Flex justify="space-between" align="center" gap={4}>
                <Typography.Text strong ellipsis style={{ minWidth: 0 }}>
                  {fieldLabel(f, locale)}
                </Typography.Text>
                {!disabled && (
                  <Flex gap={0} style={{ flexShrink: 0 }}>
                    <Button
                      size="small"
                      type="text"
                      icon={<ArrowUpOutlined />}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label={t('workflow:formEditor.up')}
                    />
                    <Button
                      size="small"
                      type="text"
                      icon={<ArrowDownOutlined />}
                      disabled={i === fields.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={t('workflow:formEditor.down')}
                    />
                    <Button
                      size="small"
                      type="text"
                      icon={<EditOutlined />}
                      onClick={() => setEditing(i)}
                      aria-label={t('edit')}
                    />
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => save(fields.filter((_, j) => j !== i))}
                      aria-label={t('delete')}
                    />
                  </Flex>
                )}
              </Flex>
              <Space size={4} wrap>
                <Tag>{t(`workflow:fieldTypes.${f.type}`)}</Tag>
                {f.required && <Tag color="red">{t('workflow:formEditor.required')}</Tag>}
                {f.readOnly && <Tag>{t('workflow:formEditor.readOnly')}</Tag>}
                <Typography.Text type="secondary" code dir="ltr">
                  {f.key}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      )}
      <Flex gap={8} wrap style={{ marginBlockStart: 8 }}>
        {!disabled && (
          <Select<FormFieldType>
            size="small"
            value={null as unknown as FormFieldType}
            placeholder={
              <Space size={4}>
                <PlusOutlined />
                {t('workflow:formEditor.add')}
              </Space>
            }
            style={{ minWidth: 180 }}
            onChange={(v) => addField(v)}
            options={FORM_FIELD_TYPES.map((x) => ({
              value: x,
              label: t(`workflow:fieldTypes.${x}`),
            }))}
            data-testid="add-field"
          />
        )}
        {fields.length > 0 && (
          <Button size="small" icon={<EyeOutlined />} onClick={() => setPreview(true)}>
            {t('workflow:formEditor.preview')}
          </Button>
        )}
      </Flex>
      {editing !== null && fields[editing] && (
        <FieldDrawer
          field={fields[editing]}
          others={fields.filter((_, j) => j !== editing).map((f) => f.key)}
          onClose={() => setEditing(null)}
          onSave={(f) => {
            save(fields.map((x, j) => (j === editing ? f : x)));
            setEditing(null);
          }}
        />
      )}
      {preview && value && <FormPreview schema={value} onClose={() => setPreview(false)} />}
    </div>
  );
}

function FormPreview({ schema, onClose }: { schema: FormSchema; onClose: () => void }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const [lang, setLang] = useState<'en' | 'ar'>(locale);
  const [form] = Form.useForm();
  return (
    <Modal
      open
      title={t('workflow:formEditor.preview')}
      onCancel={onClose}
      footer={null}
      width={640}
      destroyOnHidden
    >
      <Segmented
        value={lang}
        onChange={(v) => setLang(v as 'en' | 'ar')}
        options={[
          { value: 'en', label: 'English' },
          { value: 'ar', label: 'العربية' },
        ]}
        style={{ marginBlockEnd: 12 }}
      />
      <LangScope lang={lang}>
        <WorkflowForm schema={schema} form={form} preview />
      </LangScope>
    </Modal>
  );
}

/** Renders children in another content language and direction (form preview). */
function LangScope({ lang, children }: { lang: 'en' | 'ar'; children: React.ReactNode }) {
  return (
    <ConfigProvider direction={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
        <LocaleOverride locale={lang}>{children}</LocaleOverride>
      </div>
    </ConfigProvider>
  );
}

function FieldDrawer({
  field,
  others,
  onClose,
  onSave,
}: {
  field: FormField;
  others: string[];
  onClose: () => void;
  onSave: (f: FormField) => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<FormFieldInput>();
  const type = Form.useWatch('type', form) ?? field.type;
  const [error, setError] = useState<string | null>(null);
  const initial = useMemo(() => ({ ...field }), [field]);
  const submit = async () => {
    const v = await form.validateFields();
    const parsed = formFieldSchema.safeParse({
      ...v,
      options: HAS_OPTIONS.includes(v.type) ? (v.options ?? []) : [],
      min: v.min ?? null,
      max: v.max ?? null,
      maxLength: v.maxLength ?? null,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((i) => t(`workflow:formEditor.errors.${i.message}`, { defaultValue: i.message }))
          .join('; '),
      );
      return;
    }
    onSave(parsed.data);
  };
  return (
    <Drawer
      open
      title={t('workflow:formEditor.editField')}
      onClose={onClose}
      width={460}
      destroyOnHidden
      extra={
        <Button type="primary" onClick={() => void submit()} data-testid="field-save">
          {t('save')}
        </Button>
      }
    >
      <Form form={form} layout="vertical" initialValues={initial}>
        <Form.Item
          name="key"
          label={t('workflow:formEditor.key')}
          extra={t('workflow:formEditor.keyHint')}
          rules={[
            { required: true, message: t('workflow:form.required') },
            { pattern: FORM_KEY_RE, message: t('workflow:formEditor.errors.KEY') },
            {
              validator: (_, v: string) =>
                others.includes(v)
                  ? Promise.reject(new Error(t('workflow:formEditor.errors.DUPLICATE_KEY')))
                  : RESERVED_VARIABLES.includes(v)
                    ? Promise.reject(new Error(t('workflow:formEditor.errors.RESERVED_KEY')))
                    : Promise.resolve(),
            },
          ]}
        >
          <Input dir="ltr" />
        </Form.Item>
        <Form.Item name="type" label={t('workflow:formEditor.type')}>
          <Select
            options={FORM_FIELD_TYPES.map((x) => ({
              value: x,
              label: t(`workflow:fieldTypes.${x}`),
            }))}
          />
        </Form.Item>
        <Flex gap={8}>
          <Form.Item name="labelEn" label={t('workflow:formEditor.labelEn')} style={{ flex: 1 }}>
            <Input dir="ltr" maxLength={200} />
          </Form.Item>
          <Form.Item name="labelAr" label={t('workflow:formEditor.labelAr')} style={{ flex: 1 }}>
            <Input dir="rtl" maxLength={200} />
          </Form.Item>
        </Flex>
        <Flex gap={8}>
          <Form.Item name="helpEn" label={t('workflow:formEditor.helpEn')} style={{ flex: 1 }}>
            <Input.TextArea dir="ltr" rows={2} maxLength={500} />
          </Form.Item>
          <Form.Item name="helpAr" label={t('workflow:formEditor.helpAr')} style={{ flex: 1 }}>
            <Input.TextArea dir="rtl" rows={2} maxLength={500} />
          </Form.Item>
        </Flex>
        {type !== 'info' && (
          <Flex gap={16}>
            <Form.Item name="required" valuePropName="checked">
              <Checkbox>{t('workflow:formEditor.required')}</Checkbox>
            </Form.Item>
            <Form.Item name="readOnly" valuePropName="checked">
              <Checkbox>{t('workflow:formEditor.readOnlyHint')}</Checkbox>
            </Form.Item>
          </Flex>
        )}
        {(type === 'number' || type === 'amount') && (
          <Flex gap={8}>
            <Form.Item name="min" label={t('workflow:formEditor.min')} style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="max" label={t('workflow:formEditor.max')} style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
            {type === 'amount' && (
              <Form.Item
                name="currency"
                label={t('workflow:formEditor.currency')}
                style={{ width: 90 }}
              >
                <Input dir="ltr" maxLength={3} />
              </Form.Item>
            )}
          </Flex>
        )}
        {(type === 'text' || type === 'textarea') && (
          <Form.Item name="maxLength" label={t('workflow:formEditor.maxLength')}>
            <InputNumber min={1} max={10000} style={{ width: '100%' }} />
          </Form.Item>
        )}
        {HAS_OPTIONS.includes(type) && (
          <>
            <Typography.Text strong>{t('workflow:formEditor.options')}</Typography.Text>
            <Form.List name="options">
              {(items, { add, remove }) => (
                <>
                  {items.map((it) => (
                    <Flex key={it.key} gap={4} align="baseline">
                      <Form.Item
                        name={[it.name, 'value']}
                        rules={[{ required: true, message: t('workflow:form.required') }]}
                        style={{ width: 110 }}
                      >
                        <Input dir="ltr" placeholder={t('workflow:formEditor.optionValue')} />
                      </Form.Item>
                      <Form.Item name={[it.name, 'labelEn']} style={{ flex: 1 }}>
                        <Input dir="ltr" placeholder="English" />
                      </Form.Item>
                      <Form.Item name={[it.name, 'labelAr']} style={{ flex: 1 }}>
                        <Input dir="rtl" placeholder="العربية" />
                      </Form.Item>
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => remove(it.name)}
                        aria-label={t('delete')}
                      />
                    </Flex>
                  ))}
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => add({ value: '', labelEn: '', labelAr: '' })}
                  >
                    {t('workflow:formEditor.addOption')}
                  </Button>
                </>
              )}
            </Form.List>
          </>
        )}
        {error && (
          <Typography.Paragraph type="danger" style={{ marginBlockStart: 12 }}>
            {error}
          </Typography.Paragraph>
        )}
      </Form>
    </Drawer>
  );
}

/** Needs the texts of both languages (bilingual labels / printing in either language). */
export const FormEditor = withAllLanguages(FormEditorInner);
