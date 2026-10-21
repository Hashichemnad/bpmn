import { useState } from 'react';
import {
  App,
  Button,
  Card,
  Drawer,
  Form,
  Popconfirm,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { PageTemplateDto, TemplateInput } from '@processhub/shared';
import { useDeleteTemplate, useSaveTemplate, useTemplates } from '@/api/docs';
import { PageHeader } from '@/components/PageHeader';
import { BilingualFields } from '@/components/BilingualFields';
import { EmptyState, ErrorState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { RichTextEditor } from './editor/RichTextEditor';

function TemplateDrawer({
  template,
  onClose,
}: {
  template: PageTemplateDto | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const save = useSaveTemplate();
  const [form] = Form.useForm<TemplateInput>();
  const [content, setContent] = useState({
    en: template?.contentEn ?? '',
    ar: template?.contentAr ?? '',
  });

  const submit = async () => {
    const v = await form.validateFields();
    try {
      await save.mutateAsync({
        id: template?.id,
        body: { ...v, contentEn: content.en, contentAr: content.ar },
      });
      message.success(t('saved'));
      onClose();
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <Drawer
      open
      width="min(1100px, 100vw)"
      title={template ? t('docs:templates.edit') : t('docs:templates.new')}
      onClose={onClose}
      extra={
        <Button type="primary" onClick={() => void submit()} loading={save.isPending}>
          {t('save')}
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={
          template
            ? {
                nameEn: template.nameEn,
                nameAr: template.nameAr,
                descriptionEn: template.descriptionEn,
                descriptionAr: template.descriptionAr,
              }
            : {}
        }
      >
        <BilingualFields description />
      </Form>
      <Tabs
        items={(['en', 'ar'] as const).map((l) => ({
          key: l,
          label: l === 'ar' ? 'العربية' : 'English',
          children: (
            <RichTextEditor
              value={content[l]}
              dir={l === 'ar' ? 'rtl' : 'ltr'}
              lang={l}
              placeholder={t('docs:editor.placeholder')}
              onChange={(html) => setContent((c) => ({ ...c, [l]: html }))}
            />
          ),
        }))}
      />
    </Drawer>
  );
}

/** Administrators manage the bilingual page templates. */
export function TemplatesPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const templates = useTemplates();
  const remove = useDeleteTemplate();
  const [editing, setEditing] = useState<PageTemplateDto | null | undefined>(undefined);

  return (
    <>
      <PageHeader
        crumbs={[{ title: t('nav.docs'), to: '/docs' }, { title: t('docs:templates.title') }]}
        title={t('docs:templates.title')}
        subtitle={t('docs:templates.subtitle')}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>
            {t('docs:templates.new')}
          </Button>
        }
      />
      <Card>
        {templates.isError ? (
          <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />
        ) : (
          <Table
            rowKey="id"
            loading={templates.isLoading}
            dataSource={templates.data ?? []}
            pagination={false}
            locale={{ emptyText: <EmptyState description={t('docs:templates.empty')} /> }}
            columns={[
              {
                title: t('fields.name'),
                key: 'name',
                render: (_, r) => (
                  <>
                    <Space>
                      <Typography.Text strong>{loc(r)}</Typography.Text>
                      {r.isSystem && <Tag>{t('docs:templates.builtIn')}</Tag>}
                    </Space>
                    <br />
                    <Typography.Text type="secondary">{loc(r, 'description')}</Typography.Text>
                  </>
                ),
              },
              {
                title: t('fields.updatedAt'),
                key: 'updated',
                width: 200,
                render: (_, r) => formatDate(r.updatedAt),
              },
              {
                key: 'actions',
                align: 'end',
                width: 200,
                render: (_, r) => (
                  <Space>
                    <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(r)}>
                      {t('edit')}
                    </Button>
                    {!r.isSystem && (
                      <Popconfirm
                        title={t('docs:templates.deleteTitle', { name: loc(r) })}
                        okText={t('delete')}
                        okButtonProps={{ danger: true }}
                        cancelText={t('cancel')}
                        onConfirm={() =>
                          remove.mutateAsync(r.id).then(
                            () => message.success(t('deleted')),
                            (err) => message.error(errorMessage(err)),
                          )
                        }
                      >
                        <Button
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={t('delete')}
                        />
                      </Popconfirm>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>
      {editing !== undefined && (
        <TemplateDrawer template={editing} onClose={() => setEditing(undefined)} />
      )}
    </>
  );
}
