import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Drawer,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DiffOutlined, EyeOutlined, RollbackOutlined, TagOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ProcessVersionDto } from '@processhub/shared';
import { fetchVersion, useProcessModel, useVersions } from '@/api/hooks';
import { useLabelProcessVersion, useRestoreProcessVersion } from '@/api/docs';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { DiagramCanvas } from '@/features/docs/EmbeddedDiagram';
import { BpmnCompare } from '@/features/versions/BpmnCompare';

const CURRENT = 'current';

function VersionTags({ v }: { v: ProcessVersionDto }) {
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

/** XML of a version, or of the current working model (draft). */
function useXml(processId: string, id: string | null) {
  const model = useProcessModel(processId);
  const version = useQuery({
    queryKey: ['processes', processId, 'versions', id],
    queryFn: () => fetchVersion(processId, id!),
    enabled: !!id && id !== CURRENT,
    staleTime: Infinity,
  });
  if (id === CURRENT)
    return { xml: model.data?.bpmnXml ?? null, loading: model.isLoading, error: model.error };
  return { xml: version.data?.bpmnXml ?? null, loading: version.isLoading, error: version.error };
}

function CompareModal({
  processId,
  versions,
  initial,
  onClose,
}: {
  processId: string;
  versions: ProcessVersionDto[];
  initial: [string, string];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [a, setA] = useState(initial[0]);
  const [b, setB] = useState(initial[1]);
  const left = useXml(processId, a);
  const right = useXml(processId, b);
  const options = [
    { value: CURRENT, label: t('docs:compare.currentDraft') },
    ...versions.map((v) => ({ value: v.id, label: `v${v.versionNumber} — ${v.changeNote}` })),
  ];
  const name = (id: string) =>
    id === CURRENT
      ? t('docs:compare.currentDraft')
      : `v${versions.find((v) => v.id === id)?.versionNumber ?? ''}`;

  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      width="min(1400px, 97vw)"
      title={t('docs:compare.title')}
      destroyOnHidden
    >
      <Flex gap={12} wrap="wrap" align="center" style={{ marginBottom: 12 }}>
        <Select
          value={a}
          onChange={setA}
          options={options}
          style={{ minInlineSize: 260 }}
          aria-label={t('docs:compare.from')}
        />
        <span aria-hidden>→</span>
        <Select
          value={b}
          onChange={setB}
          options={options}
          style={{ minInlineSize: 260 }}
          aria-label={t('docs:compare.to')}
        />
      </Flex>
      {left.loading || right.loading ? (
        <LoadingState />
      ) : left.error || right.error ? (
        <ErrorState error={left.error ?? right.error} />
      ) : !left.xml || !right.xml ? (
        <Alert type="info" showIcon message={t('modeler:neverSaved')} />
      ) : (
        <BpmnCompare
          key={`${a}-${b}`}
          oldXml={left.xml}
          newXml={right.xml}
          oldTitle={name(a)}
          newTitle={name(b)}
        />
      )}
    </Modal>
  );
}

export function VersionsDrawer({
  processId,
  open,
  canEdit,
  onClose,
  onRestored,
}: {
  processId: string;
  open: boolean;
  canEdit: boolean;
  onClose: () => void;
  /** Called after a restore so the editor can reload the working model. */
  onRestored?: () => void;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message, modal } = App.useApp();
  const versions = useVersions(processId);
  const restore = useRestoreProcessVersion(processId);
  const label = useLabelProcessVersion(processId);
  const [viewing, setViewing] = useState<(ProcessVersionDto & { bpmnXml: string }) | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [compare, setCompare] = useState<[string, string] | null>(null);
  const [labelling, setLabelling] = useState<ProcessVersionDto | null>(null);
  const [labelForm] = Form.useForm<{ label: string }>();
  const list = useMemo(() => versions.data ?? [], [versions.data]);
  const latest = list[0]?.versionNumber;

  const view = async (v: ProcessVersionDto) => {
    setLoadingId(v.id);
    try {
      setViewing(await fetchVersion(processId, v.id));
    } catch (err) {
      message.error(errorMessage(err));
    } finally {
      setLoadingId(null);
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)));

  const compareSelected = () => {
    const [x, y] = selected
      .map((id) => list.find((v) => v.id === id)!)
      .sort((m, n) => m.versionNumber - n.versionNumber);
    setCompare([x.id, y.id]);
  };

  const confirmRestore = (v: ProcessVersionDto) =>
    modal.confirm({
      title: t('docs:history.restoreTitle', { number: v.versionNumber }),
      content: t('modeler:restoreText', { next: (latest ?? 0) + 1 }),
      okText: t('docs:history.restore'),
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          await restore.mutateAsync({ versionId: v.id, body: {} });
          message.success(t('docs:history.restored', { number: v.versionNumber }));
          onRestored?.();
        } catch (err) {
          message.error(errorMessage(err));
        }
      },
    });

  const saveLabel = async () => {
    const { label: value } = await labelForm.validateFields();
    try {
      await label.mutateAsync({ versionId: labelling!.id, body: { label: value?.trim() || null } });
      setLabelling(null);
      message.success(t('saved'));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <>
      <Drawer
        title={t('modeler:versionHistory')}
        open={open}
        onClose={onClose}
        width={480}
        extra={
          <Tooltip title={t('docs:history.selectTwo')}>
            <Button
              icon={<DiffOutlined />}
              disabled={selected.length !== 2}
              onClick={compareSelected}
            >
              {t('docs:history.compareSelected')}
            </Button>
          </Tooltip>
        }
      >
        {versions.isError ? (
          <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
        ) : (
          <List
            loading={versions.isLoading}
            dataSource={list}
            locale={{ emptyText: <EmptyState description={t('modeler:noVersions')} /> }}
            renderItem={(v, idx) => (
              <List.Item
                className={selected.includes(v.id) ? 'ph-version-selected' : undefined}
                actions={[
                  <Tooltip key="view" title={t('view')}>
                    <Button
                      size="small"
                      type="text"
                      icon={<EyeOutlined />}
                      loading={loadingId === v.id}
                      aria-label={t('view')}
                      onClick={() => void view(v)}
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
                            onClick={() => setCompare([list[idx + 1].id, v.id])}
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
                  avatar={
                    <input
                      type="checkbox"
                      checked={selected.includes(v.id)}
                      onChange={() => toggle(v.id)}
                      aria-label={t('docs:history.selectVersion', { number: v.versionNumber })}
                    />
                  }
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
            onClick={() => setCompare([list[0].id, CURRENT])}
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
            <DiagramCanvas xml={viewing.bpmnXml} className="ph-version-canvas" />
          </>
        )}
      </Modal>
      {compare && (
        <CompareModal
          processId={processId}
          versions={list}
          initial={compare}
          onClose={() => setCompare(null)}
        />
      )}
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
