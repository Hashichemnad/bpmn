import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Input, Modal, Space, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { AiTranslationDto, Locale } from '@processhub/shared';
import { useAiRun } from './useAi';
import { AiError, AiIcon, AiNotice, AiWorking } from './AiParts';

export type LabelTranslation = NonNullable<AiTranslationDto['elements']>[number];

interface Props {
  open: boolean;
  target: Locale;
  /** Current diagram XML (may contain unsaved changes). */
  getXml: () => Promise<string>;
  onClose: () => void;
  /** Applies the reviewed translations to the diagram (as normal, undoable edits). */
  onApply: (rows: LabelTranslation[]) => void;
}

/** Feature 4 in the modeler: fill the missing language of every label, review, then apply. */
export function TranslateLabelsModal({ open, target, getXml, onClose, onApply }: Props) {
  const { t } = useTranslation();
  const ai = useAiRun<AiTranslationDto>();
  const [rows, setRows] = useState<LabelTranslation[]>([]);

  const start = async () => {
    const res = await ai.run('/ai/translate', { kind: 'bpmn', target, bpmnXml: await getXml() });
    setRows(res?.elements ?? []);
  };

  useEffect(() => {
    if (open) void start();
    else {
      ai.reset();
      setRows([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);

  const update = (id: string, patch: Partial<LabelTranslation>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const dir = target === 'ar' ? 'rtl' : 'ltr';

  return (
    <Modal
      title={
        <Space>
          <AiIcon />
          {t(`ai:translate.labelsTitle.${target}`)}
        </Space>
      }
      open={open}
      onCancel={onClose}
      width="min(900px, 96vw)"
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="primary"
            disabled={!rows.length || ai.running}
            onClick={() => {
              onApply(rows);
              onClose();
            }}
          >
            {t('ai:translate.apply', { count: rows.length })}
          </Button>
        </Space>
      }
    >
      {ai.running && <AiWorking chars={ai.chars} onCancel={ai.cancel} />}
      <AiError error={ai.error} onRetry={() => void start()} />
      {ai.result && !rows.length && <Empty description={t('ai:translate.nothingMissing')} />}
      {rows.length > 0 && (
        <>
          <Alert
            type="info"
            showIcon
            message={t('ai:translate.reviewHint')}
            style={{ marginBottom: 12 }}
          />
          <Table
            size="small"
            rowKey="id"
            dataSource={rows}
            pagination={false}
            scroll={{ y: 420 }}
            columns={[
              {
                title: t('ai:translate.source'),
                dataIndex: 'source',
                width: '35%',
                render: (v: string) => <Typography.Text dir="auto">{v}</Typography.Text>,
              },
              {
                title: t(`ai:translate.target.${target}`),
                render: (_: unknown, r: LabelTranslation) => (
                  <Space direction="vertical" style={{ width: '100%' }} size={4}>
                    {(r.name || !r.description) && (
                      <Input
                        value={r.name}
                        dir={dir}
                        lang={target}
                        onChange={(e) => update(r.id, { name: e.target.value })}
                        aria-label={t('ai:translate.label')}
                      />
                    )}
                    {r.description && (
                      <Input.TextArea
                        value={r.description}
                        dir={dir}
                        lang={target}
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        onChange={(e) => update(r.id, { description: e.target.value })}
                        aria-label={t('ai:translate.description')}
                      />
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </>
      )}
      <AiNotice />
    </Modal>
  );
}
