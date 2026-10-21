import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Card, Col, Form, Input, Modal, Row, Select, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { buildTree, type PageSummaryDto, type TreeNode } from '@processhub/shared';
import { useCreatePage, usePageTree, useTemplates } from '@/api/docs';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { LoadingState } from '@/components/states';

interface Values {
  titleEn: string;
  titleAr: string;
  parentId: string | null;
}

/** New page: bilingual title, parent and a template (SOP, Policy, …). */
export function CreatePageModal({
  spaceId,
  parentId,
  onClose,
}: {
  spaceId: string;
  parentId?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const loc = useLocalized();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const templates = useTemplates();
  const tree = usePageTree(spaceId);
  const create = useCreatePage(spaceId);
  const [form] = Form.useForm<Values>();
  const [templateId, setTemplateId] = useState<string | null>(null);

  useEffect(() => {
    form.setFieldsValue({ parentId: parentId ?? null });
  }, [form, parentId]);
  useEffect(() => {
    if (!templateId && templates.data?.length) {
      setTemplateId(templates.data.find((tpl) => tpl.key === 'BLANK')?.id ?? templates.data[0].id);
    }
  }, [templates.data, templateId]);

  const parentOptions: { value: string; label: string }[] = [];
  const walk = (nodes: TreeNode<PageSummaryDto>[], depth: number) => {
    for (const n of nodes) {
      parentOptions.push({
        value: n.id,
        label: `${'— '.repeat(depth)}${loc(n, 'title') || t('docs:untitled')}`,
      });
      walk(n.children, depth + 1);
    }
  };
  walk(buildTree(tree.data ?? []), 0);

  const submit = async () => {
    const v = await form.validateFields();
    try {
      const page = await create.mutateAsync({
        titleEn: v.titleEn?.trim() ?? '',
        titleAr: v.titleAr?.trim() ?? '',
        parentId: v.parentId ?? null,
        templateId,
      });
      message.success(t('docs:pages.created'));
      onClose();
      navigate(`/docs/${spaceId}/pages/${page.id}/edit`);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const oneTitle = ({ getFieldValue }: { getFieldValue: (n: string) => string | undefined }) => ({
    validator() {
      return getFieldValue('titleEn')?.trim() || getFieldValue('titleAr')?.trim()
        ? Promise.resolve()
        : Promise.reject(new Error(t('docs:pages.titleRequired')));
    },
  });

  return (
    <Modal
      open
      title={t('docs:pages.new')}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={t('docs:pages.create')}
      cancelText={t('cancel')}
      confirmLoading={create.isPending}
      width={820}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item
              name="titleEn"
              label={t('docs:pages.titleEn')}
              dependencies={['titleAr']}
              rules={[oneTitle]}
            >
              <Input dir="ltr" lang="en" maxLength={300} autoFocus />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="titleAr"
              label={t('docs:pages.titleAr')}
              dependencies={['titleEn']}
              rules={[oneTitle]}
            >
              <Input dir="rtl" lang="ar" maxLength={300} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="parentId" label={t('docs:pages.parent')}>
          <Select
            allowClear
            placeholder={t('docs:pages.topLevel')}
            options={parentOptions}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>
      </Form>
      <Typography.Text strong>{t('docs:templates.choose')}</Typography.Text>
      {templates.isLoading ? (
        <LoadingState />
      ) : (
        <Row
          gutter={[12, 12]}
          style={{ marginTop: 8 }}
          role="radiogroup"
          aria-label={t('docs:templates.choose')}
        >
          {(templates.data ?? []).map((tpl) => (
            <Col xs={24} sm={12} md={8} key={tpl.id}>
              <Card
                size="small"
                hoverable
                role="radio"
                aria-checked={templateId === tpl.id}
                tabIndex={0}
                className={`ph-template-card${templateId === tpl.id ? ' ph-template-card-selected' : ''}`}
                onClick={() => setTemplateId(tpl.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setTemplateId(tpl.id)}
              >
                <Typography.Text strong>{loc(tpl)}</Typography.Text>
                <Typography.Paragraph
                  type="secondary"
                  ellipsis={{ rows: 2 }}
                  style={{ margin: 0, fontSize: 12 }}
                >
                  {loc(tpl, 'description')}
                </Typography.Paragraph>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </Modal>
  );
}
