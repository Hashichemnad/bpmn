import { useState } from 'react';
import { Checkbox, Form, Modal, Radio, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Locale, ReportSource } from '@processhub/shared';
import { useLocale } from '@/app/LocaleProvider';
import { useLocalized } from '@/components/i18n-helpers';
import { useReports } from './useReports';

export type ReportKind = 'handbook' | 'raci';

interface Props {
  kind: ReportKind;
  process: { id: string; code: string; nameEn: string; nameAr: string };
  /** The process has sub-processes (the handbook can include the branch). */
  hasChildren: boolean;
  /** Portal: published content only, no choice of version. */
  publishedOnly?: boolean;
  onClose: () => void;
}

/** Options of a report download: language, version (workspace) and sub-processes (handbook). */
export function ReportDialog({ kind, process, hasChildren, publishedOnly, onClose }: Props) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const loc = useLocalized();
  const reports = useReports();
  const [form] = Form.useForm<{
    locale: Locale;
    source: ReportSource;
    includeChildren: boolean;
    includeRisks: boolean;
  }>();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    const source = publishedOnly ? 'published' : v.source;
    const ok =
      kind === 'handbook'
        ? await reports.handbook({
            processId: process.id,
            includeChildren: !!v.includeChildren,
            includeRisks: !!v.includeRisks,
            source,
            locale: v.locale,
          })
        : await reports.raci(process.id, v.locale, source);
    setSubmitting(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open
      title={t(`processes:reports.${kind}Title`, { name: `${process.code} ${loc(process)}` })}
      okText={t('processes:reports.download')}
      cancelText={t('cancel')}
      confirmLoading={submitting}
      onOk={() => void submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        {t(`processes:reports.${kind}Hint`)}
      </Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ locale, source: 'working', includeChildren: false }}
      >
        <Form.Item name="locale" label={t('processes:reports.language')}>
          <Radio.Group>
            <Radio value="en">English</Radio>
            <Radio value="ar">العربية</Radio>
          </Radio.Group>
        </Form.Item>
        {!publishedOnly && (
          <Form.Item
            name="source"
            label={t('processes:reports.source')}
            extra={t('processes:reports.sourceHint')}
          >
            <Radio.Group>
              <Radio value="working">{t('processes:reports.working')}</Radio>
              <Radio value="published">{t('processes:reports.published')}</Radio>
            </Radio.Group>
          </Form.Item>
        )}
        {kind === 'handbook' && hasChildren && (
          <Form.Item name="includeChildren" valuePropName="checked">
            <Checkbox>{t('processes:reports.includeChildren')}</Checkbox>
          </Form.Item>
        )}
        {kind === 'handbook' && (
          <Form.Item name="includeRisks" valuePropName="checked">
            <Checkbox>{t('processes:reports.includeRisks')}</Checkbox>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
