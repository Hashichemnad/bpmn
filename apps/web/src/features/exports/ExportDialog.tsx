import { useState } from 'react';
import { App, Checkbox, Form, Modal, Radio, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  PERMISSIONS,
  type HtmlExportScope,
  type Locale,
  type PptxExportScope,
} from '@processhub/shared';
import { apiDownload } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/app/LocaleProvider';
import { useErrorMessage } from '@/components/i18n-helpers';
import { downloadBlob } from '@/features/modeler/export';

export type ExportRequest =
  | { format: 'html'; scope: HtmlExportScope; id: string; title: string; hasChildren?: boolean }
  | { format: 'pptx'; scope: PptxExportScope; id?: string; title: string };

interface Props {
  request: ExportRequest | null;
  /** Portal pages: published content only, no choice of version. */
  publishedOnly?: boolean;
  onClose: () => void;
}

/**
 * Options and download of the Phase 4.4 exports: offline website (HTML, ZIP) and PowerPoint. Drafts
 * are offered to users with workspace access only (the server checks again and watermarks them).
 */
export function ExportDialog({ request, publishedOnly, onClose }: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { locale } = useLocale();
  const errorMessage = useErrorMessage();
  const { can } = useAuth();
  const [form] = Form.useForm<{ locale: Locale; drafts: boolean; children: boolean }>();
  const [busy, setBusy] = useState(false);
  const draftsAllowed =
    !publishedOnly &&
    !!request &&
    (request.scope === 'SPACE' ? can(PERMISSIONS.DOCS_READ) : can(PERMISSIONS.PROCESSES_READ)) &&
    request.scope !== 'KPI_SUMMARY' &&
    request.scope !== 'RISK_SUMMARY';

  const submit = async () => {
    if (!request) return;
    const v = await form.validateFields();
    setBusy(true);
    const key = `export-${Date.now()}`;
    message.loading({ content: t('integrations:export.preparing'), key, duration: 0 });
    try {
      const body =
        request.format === 'html'
          ? {
              scope: request.scope === 'PROCESS' && v.children ? 'BRANCH' : request.scope,
              id: request.id,
              drafts: !!v.drafts,
            }
          : { scope: request.scope, id: request.id, locale: v.locale, drafts: !!v.drafts };
      const file = await apiDownload(
        `/exports/${request.format}`,
        { method: 'POST', body },
        request.format === 'html' ? 'export.zip' : 'export.pptx',
      );
      downloadBlob(file.blob, file.fileName);
      message.success({ content: t('integrations:export.done'), key });
      onClose();
    } catch (err) {
      message.error({ content: errorMessage(err), key });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!request}
      destroyOnHidden
      title={
        request?.format === 'html'
          ? t('integrations:export.htmlTitle')
          : t('integrations:export.pptxTitle')
      }
      okText={t('integrations:export.download')}
      confirmLoading={busy}
      onOk={() => void submit()}
      onCancel={onClose}
    >
      <Typography.Paragraph type="secondary">
        {request?.format === 'html'
          ? t('integrations:export.htmlHint')
          : t('integrations:export.pptxHint')}
      </Typography.Paragraph>
      <Typography.Paragraph strong>{request?.title}</Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ locale, drafts: false, children: false }}
      >
        {request?.format === 'pptx' && (
          <Form.Item name="locale" label={t('integrations:export.language')}>
            <Radio.Group>
              <Radio value="en">English</Radio>
              <Radio value="ar">العربية</Radio>
            </Radio.Group>
          </Form.Item>
        )}
        {request?.format === 'html' && request.scope === 'PROCESS' && request.hasChildren && (
          <Form.Item name="children" valuePropName="checked">
            <Checkbox>{t('integrations:export.includeChildren')}</Checkbox>
          </Form.Item>
        )}
        {draftsAllowed && (
          <Form.Item name="drafts" label={t('integrations:export.version')}>
            <Radio.Group>
              <Radio value={false}>{t('integrations:export.published')}</Radio>
              <Radio value={true}>{t('integrations:export.drafts')}</Radio>
            </Radio.Group>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
