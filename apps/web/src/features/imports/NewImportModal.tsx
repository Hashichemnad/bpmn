import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Form, Input, Modal, Typography, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { useTranslation } from 'react-i18next';
import { IMPORT_KIND_INFO, type ImportKind, type ImportOptions } from '@processhub/shared';
import { useCreateImport } from '@/api/imports';
import { useErrorMessage } from '@/components/i18n-helpers';
import { ImportOptionFields } from './ImportOptionFields';

/** Step 1 of a batch: files and options; the parse job starts right away. */
export function NewImportModal({ kind, onClose }: { kind: ImportKind; onClose: () => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const create = useCreateImport();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [form] = Form.useForm<ImportOptions & { note?: string }>();
  const info = IMPORT_KIND_INFO[kind];
  const accept = info.extensions.map((e) => `.${e}`).join(',');

  const submit = async () => {
    const { note, ...options } = await form.validateFields();
    if (!files.length) {
      message.error(t('imports:new.noFiles'));
      return;
    }
    create.mutate(
      {
        kind,
        files: files.map((f) => f.originFileObj as File),
        options: Object.fromEntries(
          Object.entries(options).filter(([, v]) => v !== undefined),
        ) as ImportOptions,
        note,
      },
      {
        onSuccess: (b) => {
          onClose();
          navigate(`/admin/imports/${b.id}`);
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  };

  return (
    <Modal
      open
      width={640}
      title={t('imports:new.title', { kind: t(`imports:kind.${kind}`) })}
      okText={t('imports:new.upload')}
      okButtonProps={{ 'data-testid': 'import-upload' } as never}
      confirmLoading={create.isPending}
      onCancel={onClose}
      onOk={() => void submit()}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">{t(`imports:kindHelp.${kind}`)}</Typography.Paragraph>
      <Upload.Dragger
        multiple={info.multiple}
        accept={accept}
        fileList={files}
        beforeUpload={() => false}
        onChange={({ fileList }) => setFiles(info.multiple ? fileList : fileList.slice(-1))}
        data-testid="import-files"
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">{t('imports:new.drop')}</p>
        <p className="ant-upload-hint">
          {t('imports:new.accepted', { list: info.extensions.map((e) => `.${e}`).join(', ') })}
        </p>
      </Upload.Dragger>
      <Form form={form} layout="vertical" style={{ marginBlockStart: 16 }}>
        <ImportOptionFields info={info} />
        <Form.Item name="note" label={t('imports:new.note')}>
          <Input maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
