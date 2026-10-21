import { useEffect } from 'react';
import { App, Button, Col, Form, Input, Modal, Row, Space, Typography } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ObjectType, RepoObjectDto } from '@processhub/shared';
import { useSaveObject } from '@/api/hooks';
import { BilingualFields } from '@/components/BilingualFields';
import { useErrorMessage } from '@/components/i18n-helpers';

interface Props {
  open: boolean;
  type: ObjectType;
  object?: RepoObjectDto;
  onClose: (saved?: RepoObjectDto) => void;
}

type AttrRow = { key: string; value: string };

export function ObjectFormModal({ open, type, object, onClose }: Props) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const save = useSaveObject();
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (object) {
      form.setFieldsValue({
        ...object,
        attributes: Object.entries(object.attributes).map(([key, value]) => ({ key, value: String(value) })),
      });
    } else {
      form.setFieldsValue({ attributes: [] });
    }
  }, [open, object, form]);

  const submit = async () => {
    const values = await form.validateFields();
    const attributes = Object.fromEntries(
      ((values.attributes ?? []) as AttrRow[]).filter((a) => a?.key?.trim()).map((a) => [a.key.trim(), a.value ?? '']),
    );
    const body = { ...values, attributes, code: values.code || null, ...(object ? {} : { type }) };
    try {
      const saved = await save.mutateAsync({ id: object?.id, body });
      message.success(t('saved'));
      onClose(saved);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <Modal
      title={object ? t(`objects:edit.${type}`) : t(`objects:new.${type}`)}
      open={open}
      onCancel={() => onClose()}
      onOk={() => void submit()}
      okText={t('save')}
      cancelText={t('cancel')}
      confirmLoading={save.isPending}
      width={720}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="code" label={t('fields.code')}>
          <Input dir="ltr" maxLength={50} style={{ maxWidth: 220 }} />
        </Form.Item>
        <BilingualFields description />
        <Typography.Text strong>{t('objects:attributes')}</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t(`objects:attributesHint.${type}`, { defaultValue: t('objects:attributesHint.default') })}
        </Typography.Paragraph>
        <Form.List name="attributes">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Row key={field.key} gutter={8} align="middle">
                  <Col span={10}>
                    <Form.Item name={[field.name, 'key']} rules={[{ max: 100 }]}>
                      <Input placeholder={t('objects:attributeName')} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name={[field.name, 'value']} rules={[{ max: 2000 }]}>
                      <Input placeholder={t('objects:attributeValue')} />
                    </Form.Item>
                  </Col>
                  <Col span={2}>
                    <Form.Item>
                      <Button type="text" icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} aria-label={t('delete')} />
                    </Form.Item>
                  </Col>
                </Row>
              ))}
              <Space>
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ key: '', value: '' })} disabled={fields.length >= 50}>
                  {t('objects:addAttribute')}
                </Button>
              </Space>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}
