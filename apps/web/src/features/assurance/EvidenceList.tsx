import { App, Button, List, Popconfirm, Space, Typography, Upload } from 'antd';
import { DeleteOutlined, PaperClipOutlined, UploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { AssuranceFileDto } from '@processhub/shared';
import { useDeleteAssuranceFile } from '@/api/assurance';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';

/** Evidence files of an assurance record: download, upload and remove while allowed. */
export function EvidenceList({
  files,
  canAdd,
  onUpload,
  uploading,
  testId = 'evidence',
}: {
  files: AssuranceFileDto[];
  canAdd: boolean;
  onUpload?: (file: File) => Promise<unknown>;
  uploading?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const remove = useDeleteAssuranceFile();
  return (
    <div data-testid={testId}>
      <List
        size="small"
        locale={{ emptyText: t('assurance:evidence.none') }}
        dataSource={files}
        renderItem={(f) => (
          <List.Item
            extra={
              canAdd && (
                <Popconfirm
                  title={t('assurance:evidence.removeConfirm')}
                  onConfirm={() =>
                    remove.mutate(f.id, { onError: (e) => message.error(errorMessage(e)) })
                  }
                >
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              )
            }
          >
            <Space direction="vertical" size={0}>
              <a href={f.url} download={f.fileName}>
                <PaperClipOutlined /> {f.fileName}
              </a>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {f.createdBy ? loc(f.createdBy) || f.createdBy.email : '—'} ·{' '}
                {formatDate(f.createdAt)} · {Math.ceil(f.size / 1024)} KB
              </Typography.Text>
            </Space>
          </List.Item>
        )}
      />
      {canAdd && onUpload && (
        <Upload
          showUploadList={false}
          customRequest={({ file, onSuccess, onError }) => {
            onUpload(file as File).then(
              (r) => {
                message.success(t('assurance:evidence.uploaded'));
                onSuccess?.(r);
              },
              (e: Error) => {
                message.error(errorMessage(e));
                onError?.(e);
              },
            );
          }}
        >
          <Button icon={<UploadOutlined />} loading={uploading} style={{ marginBlockStart: 8 }}>
            {t('assurance:evidence.add')}
          </Button>
        </Upload>
      )}
    </div>
  );
}
