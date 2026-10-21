import { useState } from 'react';
import { Alert, App, Button, Form, Input, List, Modal, Radio, Tag, Typography } from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { FEEDBACK_KINDS, type ContentType, type FeedbackKind } from '@processhub/shared';
import { useSendFeedback } from '@/api/governance';
import { useItemFeedback } from '@/api/portal';
import { useErrorMessage, useFormatDate } from '@/components/i18n-helpers';

const STATUS_COLORS = { OPEN: 'blue', IN_PROGRESS: 'gold', DONE: 'green' } as const;

/** "Suggest an improvement / report outdated content" for a published item. */
export function FeedbackButton({ type, id }: { type: ContentType; id: string }) {
  const { t } = useTranslation();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const send = useSendFeedback();
  const mine = useItemFeedback(type, id);
  const [form] = Form.useForm<{ kind: FeedbackKind; message: string }>();
  const submit = async () => {
    const v = await form.validateFields();
    try {
      await send.mutateAsync({ entityType: type, entityId: id, kind: v.kind, message: v.message });
      message.success(t('portal:feedback.sent'));
      form.resetFields();
      setOpen(false);
      void mine.refetch();
    } catch (err) {
      message.error(errorMessage(err));
    }
  };
  return (
    <>
      <Button icon={<MessageOutlined />} onClick={() => setOpen(true)}>
        {t('portal:feedback.button')}
      </Button>
      <Modal
        open={open}
        title={t('portal:feedback.title')}
        okText={t('portal:feedback.send')}
        cancelText={t('cancel')}
        confirmLoading={send.isPending}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
      >
        <Typography.Paragraph type="secondary">{t('portal:feedback.intro')}</Typography.Paragraph>
        <Form form={form} layout="vertical" initialValues={{ kind: 'IMPROVEMENT' }}>
          <Form.Item name="kind">
            <Radio.Group
              optionType="button"
              options={FEEDBACK_KINDS.map((k) => ({
                value: k,
                label: t(`governance:feedback.kind.${k}`),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="message"
            label={t('governance:feedback.message')}
            rules={[{ required: true, whitespace: true, message: t('validation.required') }]}
          >
            <Input.TextArea rows={5} maxLength={3000} showCount autoFocus />
          </Form.Item>
        </Form>
        {!!mine.data?.length && (
          <>
            <Typography.Text strong>{t('portal:feedback.yours')}</Typography.Text>
            <List
              size="small"
              dataSource={mine.data}
              renderItem={(f) => (
                <List.Item>
                  <div style={{ inlineSize: '100%' }}>
                    <Tag color={STATUS_COLORS[f.status]}>
                      {t(`governance:feedback.status.${f.status}`)}
                    </Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDate(f.createdAt, false)}
                    </Typography.Text>
                    <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: '4px 0 0' }}>
                      {f.message}
                    </Typography.Paragraph>
                    {f.reply && (
                      <Alert type="success" style={{ marginBlockStart: 6 }} message={f.reply} />
                    )}
                  </div>
                </List.Item>
              )}
            />
          </>
        )}
      </Modal>
    </>
  );
}
