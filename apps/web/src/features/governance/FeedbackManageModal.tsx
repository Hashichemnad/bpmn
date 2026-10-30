import { App, Form, Input, Modal, Radio, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { FEEDBACK_STATUSES, type FeedbackDto, type FeedbackStatus } from '@processhub/shared';
import { useUpdateFeedback } from '@/api/governance';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { RaiseIssueButton } from '@/features/assurance/RaiseIssueButton';

/** The owner sets the status of portal feedback and answers the sender. */
export function FeedbackManageModal({
  feedback,
  onClose,
}: {
  feedback: FeedbackDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const update = useUpdateFeedback();
  const [form] = Form.useForm<{ status: FeedbackStatus; reply: string }>();
  const submit = async () => {
    const v = await form.validateFields();
    try {
      await update.mutateAsync({
        id: feedback.id,
        body: { status: v.status, reply: v.reply ?? '' },
      });
      message.success(t('saved'));
      onClose();
    } catch (err) {
      message.error(errorMessage(err));
    }
  };
  return (
    <Modal
      open
      title={t('governance:feedback.manageTitle')}
      okText={t('save')}
      cancelText={t('cancel')}
      onCancel={onClose}
      onOk={() => void submit()}
      confirmLoading={update.isPending}
    >
      <Typography.Paragraph type="secondary" style={{ marginBlockEnd: 4 }}>
        {t(`governance:feedback.kind.${feedback.kind}`)} ·{' '}
        {loc(feedback.createdBy) || feedback.createdBy?.email || '—'} ·{' '}
        {formatDate(feedback.createdAt)}
      </Typography.Paragraph>
      <Typography.Paragraph
        className="ph-comment-body"
        style={{ background: '#f8fafc', padding: 10, borderRadius: 6 }}
      >
        {feedback.message}
      </Typography.Paragraph>
      <div style={{ marginBlockEnd: 12 }}>
        <RaiseIssueButton
          size="small"
          prefill={{
            sourceType: 'FEEDBACK',
            sourceId: feedback.id,
            severity: 'LOW',
            titleEn: feedback.message.slice(0, 120),
            titleAr: feedback.message.slice(0, 120),
            descriptionEn: feedback.message,
          }}
        />
      </div>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ status: feedback.status, reply: feedback.reply ?? '' }}
      >
        <Form.Item name="status" label={t('fields.status')}>
          <Radio.Group
            optionType="button"
            options={FEEDBACK_STATUSES.map((s) => ({
              value: s,
              label: t(`governance:feedback.status.${s}`),
            }))}
          />
        </Form.Item>
        <Form.Item
          name="reply"
          label={t('governance:feedback.reply')}
          extra={t('governance:feedback.replyHint')}
        >
          <Input.TextArea rows={4} maxLength={3000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
