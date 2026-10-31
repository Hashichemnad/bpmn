import { useMemo, useState } from 'react';
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  List,
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DiffOutlined, EyeOutlined, RollbackOutlined, TagOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { DiagramDto, DiagramVersionDto } from '@processhub/shared';
import {
  fetchDiagramVersion,
  useDiagramContent,
  useDiagramVersions,
  useLabelDiagramVersion,
  useRestoreDiagramVersion,
} from '@/api/diagrams';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { EmptyState, ErrorState } from '@/components/states';
import { DiagramView } from './DiagramView';
import { DiagramCompare } from './DiagramCompare';

function VersionTags({
  v,
}: {
  v: Pick<DiagramVersionDto, 'versionNumber' | 'label' | 'restoredFrom'>;
}) {
  const { t } = useTranslation();
  return (
    <Space size={4} wrap>
      <Tag color="blue">v{v.versionNumber}</Tag>
      {v.label && (
        <Tag color="purple" icon={<TagOutlined />}>
          {v.label}
        </Tag>
      )}
      {v.restoredFrom && <Tag>{t('docs:history.restoredFrom', { number: v.restoredFrom })}</Tag>}
    </Space>
  );
}

/** Versions of a diagram: view, compare (with the previous one or the draft), label, restore. */
export function DiagramVersionsDrawer({
  diagram,
  open,
  canEdit,
  onClose,
  onRestored,
}: {
  diagram: DiagramDto;
  open: boolean;
  canEdit: boolean;
  onClose: () => void;
  onRestored?: () => void;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message, modal } = App.useApp();
  const versions = useDiagramVersions(diagram.id);
  const working = useDiagramContent(diagram.id);
  const restore = useRestoreDiagramVersion(diagram.id);
  const label = useLabelDiagramVersion(diagram.id);
  const [viewing, setViewing] = useState<(DiagramVersionDto & { content: string }) | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [compare, setCompare] = useState<{
    base: { title: string; content: string };
    next: { title: string; content: string };
  } | null>(null);
  const [labelling, setLabelling] = useState<DiagramVersionDto | null>(null);
  const [labelForm] = Form.useForm<{ label: string }>();
  const list = useMemo(() => versions.data ?? [], [versions.data]);
  const latest = list[0]?.versionNumber;

  const load = async (v: DiagramVersionDto) => {
    setLoadingId(v.id);
    try {
      return await fetchDiagramVersion(diagram.id, v.id);
    } catch (err) {
      message.error(errorMessage(err));
      return null;
    } finally {
      setLoadingId(null);
    }
  };

  const compareWith = async (older: DiagramVersionDto | null, newer: DiagramVersionDto | null) => {
    const [a, b] = await Promise.all([older ? load(older) : null, newer ? load(newer) : null]);
    const draft = working.data?.content ?? '';
    setCompare({
      base: { title: a ? `v${a.versionNumber}` : t('diagrams:draft'), content: a?.content ?? '' },
      next: {
        title: b ? `v${b.versionNumber}` : t('diagrams:draft'),
        content: b?.content ?? draft,
      },
    });
  };

  const confirmRestore = (v: DiagramVersionDto) =>
    modal.confirm({
      title: t('docs:history.restoreTitle', { number: v.versionNumber }),
      content: t('modeler:restoreText', { next: (latest ?? 0) + 1 }),
      okText: t('docs:history.restore'),
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          await restore.mutateAsync({ versionId: v.id });
          message.success(t('docs:history.restored', { number: v.versionNumber }));
          void versions.refetch();
          onRestored?.();
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });

  const saveLabel = async () => {
    const { label: value } = await labelForm.validateFields();
    try {
      await label.mutateAsync({ versionId: labelling!.id, label: value?.trim() || null });
      setLabelling(null);
      message.success(t('saved'));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <>
      <Drawer title={t('modeler:versionHistory')} open={open} onClose={onClose} width={480}>
        {versions.isError ? (
          <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
        ) : (
          <List
            loading={versions.isLoading}
            dataSource={list}
            locale={{ emptyText: <EmptyState description={t('modeler:noVersions')} /> }}
            renderItem={(v, idx) => (
              <List.Item
                actions={[
                  <Tooltip key="view" title={t('view')}>
                    <Button
                      size="small"
                      type="text"
                      icon={<EyeOutlined />}
                      loading={loadingId === v.id}
                      aria-label={t('view')}
                      onClick={() => void load(v).then((x) => x && setViewing(x))}
                    />
                  </Tooltip>,
                  ...(list[idx + 1]
                    ? [
                        <Tooltip key="cmp" title={t('docs:compare.withPrevious')}>
                          <Button
                            size="small"
                            type="text"
                            icon={<DiffOutlined />}
                            aria-label={t('docs:compare.withPrevious')}
                            onClick={() => void compareWith(list[idx + 1], v)}
                          />
                        </Tooltip>,
                      ]
                    : []),
                  ...(canEdit
                    ? [
                        <Tooltip key="label" title={t('docs:history.label')}>
                          <Button
                            size="small"
                            type="text"
                            icon={<TagOutlined />}
                            aria-label={t('docs:history.label')}
                            onClick={() => {
                              labelForm.setFieldsValue({ label: v.label ?? '' });
                              setLabelling(v);
                            }}
                          />
                        </Tooltip>,
                      ]
                    : []),
                  ...(canEdit && v.versionNumber !== latest
                    ? [
                        <Tooltip key="restore" title={t('docs:history.restore')}>
                          <Button
                            size="small"
                            type="text"
                            icon={<RollbackOutlined />}
                            aria-label={t('docs:history.restore')}
                            onClick={() => confirmRestore(v)}
                          />
                        </Tooltip>,
                      ]
                    : []),
                ]}
              >
                <List.Item.Meta
                  title={
                    <>
                      <VersionTags v={v} />
                      <div className="ph-version-note">{v.changeNote}</div>
                    </>
                  }
                  description={
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDate(v.createdAt)} · {loc(v.createdBy) || v.createdBy?.email || '—'}
                    </Typography.Text>
                  }
                />
              </List.Item>
            )}
          />
        )}
        {list.length > 0 && (
          <Button
            block
            style={{ marginTop: 12 }}
            icon={<DiffOutlined />}
            onClick={() => void compareWith(list[0], null)}
          >
            {t('docs:compare.latestVsDraft')}
          </Button>
        )}
      </Drawer>
      <Modal
        title={viewing ? <VersionTags v={viewing} /> : ''}
        open={!!viewing}
        onCancel={() => setViewing(null)}
        footer={null}
        width="min(1100px, 95vw)"
        destroyOnHidden
      >
        {viewing && (
          <>
            <Typography.Paragraph type="secondary">{viewing.changeNote}</Typography.Paragraph>
            <DiagramView type={diagram.type} content={viewing.content} height={520} />
          </>
        )}
      </Modal>
      <Modal
        title={t('diagrams:compareTitle')}
        open={!!compare}
        onCancel={() => setCompare(null)}
        footer={null}
        width="min(1400px, 96vw)"
        destroyOnHidden
      >
        {compare && (
          <DiagramCompare
            type={diagram.type}
            baseContent={compare.base.content || null}
            newContent={compare.next.content}
            baseTitle={compare.base.title}
            nextTitle={compare.next.title}
          />
        )}
      </Modal>
      <Modal
        open={!!labelling}
        title={labelling ? t('docs:history.labelTitle', { number: labelling.versionNumber }) : ''}
        onCancel={() => setLabelling(null)}
        onOk={() => void saveLabel()}
        okText={t('save')}
        cancelText={t('cancel')}
        confirmLoading={label.isPending}
        destroyOnHidden
      >
        <Form form={labelForm} layout="vertical">
          <Form.Item
            name="label"
            label={t('docs:history.labelField')}
            extra={t('docs:history.labelHint')}
            rules={[{ max: 100 }]}
          >
            <Input maxLength={100} autoFocus placeholder={t('docs:history.labelPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
