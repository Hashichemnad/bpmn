import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Flex, Input, Modal, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { AiGeneratedProcessDto, AiSuggestedLinkDto } from '@processhub/shared';
import { useLocalized } from '@/components/i18n-helpers';
import { DiagramCanvas } from '@/features/docs/EmbeddedDiagram';
import { detectLocale } from '@/features/modeler/labels';
import { useLocale } from '@/app/LocaleProvider';
import { useAi, useAiRun } from './useAi';
import { AiError, AiIcon, AiNotice, AiSuggestionChips, AiWorking } from './AiParts';

interface Props {
  open: boolean;
  /** Existing process (modeler); omitted when creating a new process. */
  processId?: string;
  /** Model the process described by this wiki page instead of a typed description. */
  page?: { id: string; title: string };
  /** The current diagram has content that will be replaced. */
  replaces?: boolean;
  acceptLabel: string;
  onClose: () => void;
  /** Called with the preview and the links the user confirmed; the modal closes when it resolves. */
  onAccept: (result: AiGeneratedProcessDto, links: AiSuggestedLinkDto[]) => Promise<void>;
}

const groupKey = (l: AiSuggestedLinkDto) => `${l.object.id}|${l.relation}`;

/** Feature 1: describe a process, preview the generated BPMN (with lanes and links), accept. */
export function GenerateProcessModal({
  open,
  processId,
  page,
  replaces,
  acceptLabel,
  onClose,
  onAccept,
}: Props) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { available } = useAi();
  const { locale } = useLocale();
  const ai = useAiRun<AiGeneratedProcessDto>();
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState(false);
  const result = ai.result;

  useEffect(() => {
    if (!open) {
      ai.reset();
      setDescription('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setSelected(new Set((result?.suggestedLinks ?? []).map(groupKey)));
  }, [result]);

  const groups = useMemo(() => {
    const map = new Map<string, AiSuggestedLinkDto[]>();
    for (const l of result?.suggestedLinks ?? [])
      map.set(groupKey(l), [...(map.get(groupKey(l)) ?? []), l]);
    return [...map.entries()];
  }, [result]);

  const generate = () =>
    void (page
      ? ai.run('/ai/doc-to-process', {
          pageId: page.id,
          language: locale,
          ...(description.trim() ? { instructions: description.trim() } : {}),
        })
      : ai.run('/ai/generate-process', {
          description: description.trim(),
          language: detectLocale(description),
          ...(processId ? { processId } : {}),
        }));

  const accept = async () => {
    if (!result) return;
    setAccepting(true);
    try {
      await onAccept(
        result,
        result.suggestedLinks.filter((l) => selected.has(groupKey(l))),
      );
      onClose();
    } finally {
      setAccepting(false);
    }
  };

  const canGenerate = (!!page || description.trim().length >= 3) && !ai.running;
  const footer = result ? (
    <Flex justify="space-between" wrap gap={8}>
      <Button onClick={() => ai.setResult(null)}>{t('ai:generate.editPrompt')}</Button>
      <Space wrap>
        <Button onClick={generate} disabled={ai.running}>
          {t('ai:generate.regenerate')}
        </Button>
        <Button type="primary" onClick={() => void accept()} loading={accepting}>
          {acceptLabel}
        </Button>
      </Space>
    </Flex>
  ) : (
    <Space>
      <Button onClick={onClose}>{t('cancel')}</Button>
      <Button
        type="primary"
        icon={<AiIcon />}
        onClick={generate}
        disabled={!canGenerate}
        loading={ai.running}
      >
        {t('ai:generate.submit')}
      </Button>
    </Space>
  );

  return (
    <Modal
      title={
        <Space>
          <AiIcon />
          {page ? t('ai:fromPage.title') : t('ai:generate.title')}
        </Space>
      }
      open={open && available}
      onCancel={onClose}
      footer={footer}
      width={result ? 'min(1080px, 96vw)' : 'min(720px, 96vw)'}
      destroyOnHidden
      maskClosable={!ai.running}
    >
      {!result && (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {page ? t('ai:fromPage.intro', { title: page.title }) : t('ai:generate.intro')}
          </Typography.Paragraph>
          <Input.TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={page ? 2 : 6}
            maxLength={4000}
            showCount
            autoFocus
            placeholder={page ? t('ai:fromPage.placeholder') : t('ai:generate.placeholder')}
            dir="auto"
            disabled={ai.running}
            aria-label={t('ai:generate.title')}
          />
          {!page && <AiSuggestionChips feature="GENERATE_PROCESS" onPick={setDescription} />}
          {ai.running && (
            <AiWorking chars={ai.chars} label={t('ai:generate.working')} onCancel={ai.cancel} />
          )}
          <AiError error={ai.error} onRetry={generate} />
          <AiNotice />
        </Space>
      )}
      {result && (
        <div className="ph-ai-preview">
          <div className="ph-ai-preview-main">
            {replaces && (
              <Alert
                type="warning"
                showIcon
                message={t('ai:generate.replaces')}
                style={{ marginBottom: 8 }}
              />
            )}
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              {loc(result) || t('ai:generate.untitled')}
            </Typography.Title>
            <Typography.Paragraph type="secondary">
              {loc(result, 'description')}
            </Typography.Paragraph>
            <div className="ph-ai-preview-canvas">
              <DiagramCanvas xml={result.bpmnXml} className="ph-ai-canvas" />
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('ai:generate.counts', result.counts)}
            </Typography.Text>
          </div>
          <aside className="ph-ai-preview-side">
            {ai.running && (
              <AiWorking chars={ai.chars} label={t('ai:generate.working')} onCancel={ai.cancel} />
            )}
            <AiError error={ai.error} />
            <Alert
              type="info"
              showIcon
              icon={<AiIcon />}
              message={<span dir="auto">{result.explanation}</span>}
            />
            {result.warnings.length > 0 && (
              <div>
                <Typography.Text strong>{t('ai:generate.warnings')}</Typography.Text>
                <ul className="ph-ai-list">
                  {result.warnings.map((w) => (
                    <li key={w}>{t(`modeler:rules.${w}`)}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <Typography.Text strong>{t('ai:generate.links')}</Typography.Text>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 6 }}>
                {t('ai:generate.linksHint')}
              </Typography.Paragraph>
              {groups.length === 0 && (
                <Typography.Text type="secondary">{t('ai:generate.noLinks')}</Typography.Text>
              )}
              <Space direction="vertical" size={4}>
                {groups.map(([key, items]) => (
                  <Checkbox
                    key={key}
                    checked={selected.has(key)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(key);
                      else next.delete(key);
                      setSelected(next);
                    }}
                  >
                    <Tag color={items[0].relation === 'PERFORMS' ? 'blue' : 'purple'}>
                      {t(`objects:types.${items[0].object.type}`)}
                    </Tag>
                    <strong>{loc(items[0].object)}</strong>{' '}
                    <Typography.Text type="secondary">
                      {t(`ai:generate.relation.${items[0].relation}`, { count: items.length })}
                    </Typography.Text>
                  </Checkbox>
                ))}
              </Space>
            </div>
            {result.unmatched.length > 0 && (
              <div>
                <Typography.Text strong>{t('ai:generate.unmatched')}</Typography.Text>
                <Flex wrap gap={4} style={{ marginTop: 4 }}>
                  {result.unmatched.map((u) => (
                    <Tag key={`${u.type}-${u.nameEn}-${u.nameAr}`}>
                      {loc(u)} · {t(`objects:types.${u.type}`)}
                    </Tag>
                  ))}
                </Flex>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                  {t('ai:generate.unmatchedHint')}
                </Typography.Paragraph>
              </div>
            )}
            <AiNotice />
          </aside>
        </div>
      )}
    </Modal>
  );
}
