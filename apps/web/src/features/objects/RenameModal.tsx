import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Row,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ArrowRightOutlined, EyeOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { RenameProcessDto, RepoObjectDto } from '@processhub/shared';
import { useRenameObject, useRenamePreview } from '@/api/dictionary';
import { StatusTag } from '@/components/tags';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';

interface Props {
  object: Pick<RepoObjectDto, 'id' | 'type' | 'nameEn' | 'nameAr'>;
  /** New names to start with (e.g. typed in the edit form); default: the current names. */
  initial?: { nameEn: string; nameAr: string };
  onClose: (renamed?: RepoObjectDto) => void;
}

/**
 * Rename a term, role or IT system and update every linked diagram label (D-083): shows which
 * processes and labels change, which are skipped and why, then creates one version per process.
 */
export function RenameModal({ object, initial, onClose }: Props) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const preview = useRenamePreview();
  const rename = useRenameObject();
  const [form] = Form.useForm<{ nameEn: string; nameAr: string; changeNote?: string }>();
  const [updateLabels, setUpdateLabels] = useState(true);
  const [result, setResult] = useState<RenameProcessDto[] | null>(null);

  const runPreview = async () => {
    const { nameEn, nameAr } = form.getFieldsValue();
    if (!nameEn?.trim() && !nameAr?.trim()) return;
    preview.mutate(
      { id: object.id, body: { nameEn: nameEn?.trim(), nameAr: nameAr?.trim() } },
      { onError: (err) => message.error(errorMessage(err)) },
    );
  };

  useEffect(() => {
    form.setFieldsValue(initial ?? { nameEn: object.nameEn, nameAr: object.nameAr });
    if (initial) void runPreview();
    // Run once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    const v = await form.validateFields();
    try {
      const res = await rename.mutateAsync({
        id: object.id,
        body: {
          nameEn: v.nameEn?.trim(),
          nameAr: v.nameAr?.trim(),
          updateLabels,
          changeNote: v.changeNote?.trim() || undefined,
        },
      });
      const updated = res.processes.filter((p) => p.versionNumber).length;
      const skipped = res.processes.length - updated;
      message.success(
        `${t('objects:rename.done', { count: updated })}${
          skipped ? ` ${t('objects:rename.doneSkipped', { count: skipped })}` : ''
        }`,
      );
      if (skipped) setResult(res.processes);
      else onClose(res.object);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const rows = result ?? preview.data?.processes ?? null;
  const labelCount = (rows ?? []).reduce((n, p) => n + p.elements.length, 0);
  const skippedCount = (rows ?? []).filter((p) => !p.canUpdate).length;

  return (
    <Modal
      open
      width={860}
      title={t('objects:rename.title', { name: loc(object) })}
      onCancel={() => onClose()}
      footer={
        result ? (
          <Button type="primary" onClick={() => onClose()}>
            {t('close')}
          </Button>
        ) : undefined
      }
      onOk={() => void submit()}
      okText={t('objects:rename.run')}
      cancelText={t('cancel')}
      confirmLoading={rename.isPending}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">{t('objects:rename.intro')}</Typography.Paragraph>
      {initial && <Alert type="info" showIcon message={t('objects:rename.nameChanged')} />}
      <Form form={form} layout="vertical" requiredMark="optional" style={{ marginTop: 12 }}>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="nameEn" label={t('fields.nameEn')} rules={[{ max: 200 }]}>
              <Input dir="ltr" lang="en" disabled={!!result} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="nameAr"
              label={t('fields.nameAr')}
              dependencies={['nameEn']}
              rules={[
                { max: 200 },
                ({ getFieldValue }) => ({
                  validator: (_, v: string) =>
                    v?.trim() || getFieldValue('nameEn')?.trim()
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('validation.nameRequired'))),
                }),
              ]}
            >
              <Input dir="rtl" lang="ar" disabled={!!result} />
            </Form.Item>
          </Col>
        </Row>
        <Flex gap={16} wrap="wrap" align="center" style={{ marginBlockEnd: 12 }}>
          <Checkbox
            checked={updateLabels}
            disabled={!!result}
            onChange={(e) => setUpdateLabels(e.target.checked)}
          >
            {t('objects:rename.updateLabels')}
          </Checkbox>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('objects:rename.updateLabelsHint')}
          </Typography.Text>
          <Button
            icon={<EyeOutlined />}
            loading={preview.isPending}
            disabled={!!result}
            onClick={() => void runPreview()}
          >
            {t('objects:rename.preview')}
          </Button>
        </Flex>
        {updateLabels && (
          <Form.Item
            name="changeNote"
            label={t('objects:rename.changeNote')}
            extra={t('objects:rename.changeNoteHint')}
          >
            <Input maxLength={1000} disabled={!!result} />
          </Form.Item>
        )}
      </Form>
      {rows &&
        (rows.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('objects:rename.previewEmpty')}
          />
        ) : (
          <>
            <Typography.Text type="secondary">
              {t('objects:rename.summary', {
                processes: rows.length,
                labels: labelCount,
                skipped: skippedCount,
              })}
            </Typography.Text>
            <Table<RenameProcessDto>
              size="small"
              rowKey={(p) => p.process.id}
              dataSource={rows}
              pagination={{ pageSize: 8, hideOnSinglePage: true }}
              style={{ marginTop: 8 }}
              columns={[
                {
                  title: t('objects:process'),
                  key: 'process',
                  render: (_, p) => (
                    <Flex vertical gap={2}>
                      <Link to={`/processes/${p.process.id}`} target="_blank">
                        <span dir="ltr" className="ph-tree-code">
                          {p.process.code}
                        </span>{' '}
                        {loc(p.process)}
                      </Link>
                      <span>
                        <StatusTag status={p.process.status} />
                      </span>
                    </Flex>
                  ),
                },
                {
                  title: t('objects:rename.labels', { count: labelCount }),
                  key: 'labels',
                  render: (_, p) => (
                    <ul className="ph-rename-labels">
                      {p.elements.map((e) => (
                        <li key={e.elementId}>
                          <Typography.Text delete type="secondary">
                            {loc(e.before)}
                          </Typography.Text>{' '}
                          <ArrowRightOutlined className="ph-flip-rtl" /> {loc(e.after)}
                        </li>
                      ))}
                    </ul>
                  ),
                },
                {
                  title: '',
                  key: 'result',
                  width: 200,
                  render: (_, p) =>
                    p.versionNumber ? (
                      <Tag color="green">v{p.versionNumber}</Tag>
                    ) : !p.canUpdate ? (
                      <Tag>
                        {t('objects:rename.skipped')}: {t(`objects:rename.reasons.${p.reason}`)}
                      </Tag>
                    ) : p.newDraft ? (
                      <Tag color="orange">{t('objects:rename.newDraft')}</Tag>
                    ) : (
                      <Tag color="blue">{t('objects:rename.willUpdate')}</Tag>
                    ),
                },
              ]}
            />
          </>
        ))}
    </Modal>
  );
}
