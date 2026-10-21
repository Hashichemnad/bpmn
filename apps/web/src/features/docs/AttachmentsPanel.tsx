import { App, Button, Card, Empty, List, Popconfirm, Space, Typography } from 'antd';
import { DeleteOutlined, FileImageOutlined, PaperClipOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAttachments, useDeleteAttachment } from '@/api/docs';
import { useErrorMessage, useFormatNumber } from '@/components/i18n-helpers';

function formatBytes(n: number, fmt: (n: number) => string) {
  if (n < 1024) return `${fmt(n)} B`;
  if (n < 1024 * 1024) return `${fmt(Math.round(n / 102.4) / 10)} KB`;
  return `${fmt(Math.round(n / 104857.6) / 10)} MB`;
}

export function AttachmentsPanel({ pageId, canEdit }: { pageId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const fmt = useFormatNumber();
  const list = useAttachments(pageId);
  const remove = useDeleteAttachment(pageId);

  return (
    <Card
      size="small"
      title={
        <Space>
          <PaperClipOutlined />
          {t('docs:attachments.title')}
        </Space>
      }
      loading={list.isLoading}
    >
      {!list.data?.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('docs:attachments.none')} />
      ) : (
        <List
          size="small"
          dataSource={list.data}
          renderItem={(a) => (
            <List.Item
              actions={
                canEdit
                  ? [
                      <Popconfirm
                        key="del"
                        title={t('docs:attachments.removeTitle', { name: a.fileName })}
                        description={t('docs:attachments.removeText')}
                        okText={t('delete')}
                        okButtonProps={{ danger: true }}
                        cancelText={t('cancel')}
                        onConfirm={() =>
                          remove.mutateAsync(a.id).catch((err) => message.error(errorMessage(err)))
                        }
                      >
                        <Button
                          size="small"
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={t('delete')}
                        />
                      </Popconfirm>,
                    ]
                  : []
              }
            >
              <Space size={6} style={{ minInlineSize: 0 }}>
                {a.isImage ? (
                  <FileImageOutlined className="ph-muted" />
                ) : (
                  <PaperClipOutlined className="ph-muted" />
                )}
                <a href={a.url} target="_blank" rel="noopener noreferrer">
                  <Typography.Text ellipsis style={{ maxInlineSize: 180 }}>
                    {a.fileName}
                  </Typography.Text>
                </a>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {formatBytes(a.size, fmt)}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}
