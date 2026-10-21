import { useEffect, useState } from 'react';
import { Button, Input, Modal, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { AiSummariseInput, AiSummaryDto } from '@processhub/shared';
import { useLocale } from '@/app/LocaleProvider';
import { useAiRun } from './useAi';
import { AiButton, AiError, AiIcon, AiNotice, AiSuggestionChips, AiWorking } from './AiParts';
import { AiText } from './AiText';

export type SummaryTarget = Omit<AiSummariseInput, 'language' | 'instructions'>;

/**
 * The summary itself: streamed as it is written. For a version range it explains what changed
 * (or says that nothing did). Optional instructions (audience, length) with suggestion chips.
 */
export function SummaryView({ target, auto = true }: { target: SummaryTarget; auto?: boolean }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const ai = useAiRun<AiSummaryDto>();
  const [instructions, setInstructions] = useState('');
  const changes = !!target.compare || !!target.reviewId;
  const run = (extra = instructions) =>
    void ai.run('/ai/summarise', {
      ...target,
      language: locale,
      ...(extra.trim() ? { instructions: extra.trim() } : {}),
    });

  useEffect(() => {
    if (auto) run('');
    return ai.cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(target), locale]);

  const text = ai.result?.text ?? ai.text;
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={10}>
      {ai.running && !text && (
        <AiWorking
          label={changes ? t('ai:summary.workingChanges') : t('ai:summary.working')}
          onCancel={ai.cancel}
        />
      )}
      <AiError error={ai.error} onRetry={() => run()} />
      {ai.result?.noChanges && (
        <Typography.Paragraph type="secondary">{t('ai:summary.noChanges')}</Typography.Paragraph>
      )}
      {!!text && <AiText text={text} />}
      {!ai.running && !auto && !ai.result && !ai.error && (
        <AiButton onClick={() => run()}>
          {changes ? t('ai:summary.changes') : t('ai:summary.summarise')}
        </AiButton>
      )}
      {(!!ai.result || !!ai.error) && !ai.result?.noChanges && (
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={t('ai:summary.instructions')}
            maxLength={500}
            dir="auto"
            onPressEnter={() => run()}
            aria-label={t('ai:summary.instructions')}
          />
          <Button onClick={() => run()} disabled={ai.running}>
            {t('ai:summary.again')}
          </Button>
        </Space.Compact>
      )}
      {(!!ai.result || !!ai.error) && !ai.result?.noChanges && (
        <AiSuggestionChips
          feature="SUMMARISE"
          onPick={(s) => {
            setInstructions(s);
            run(s);
          }}
        />
      )}
      <AiNotice />
    </Space>
  );
}

/** "✨ Summarise" / "✨ What changed?" button opening the summary in a dialog. */
export function SummaryButton({
  target,
  label,
  title,
  size,
}: {
  target: SummaryTarget;
  label?: string;
  title?: string;
  size?: 'small' | 'middle';
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const changes = !!target.compare || !!target.reviewId;
  return (
    <>
      <AiButton size={size} onClick={() => setOpen(true)}>
        {label ?? (changes ? t('ai:summary.changes') : t('ai:summary.summarise'))}
      </AiButton>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width="min(720px, 96vw)"
        destroyOnHidden
        title={
          <Space>
            <AiIcon />
            {title ?? (changes ? t('ai:summary.changesTitle') : t('ai:summary.title'))}
          </Space>
        }
      >
        <SummaryView target={target} />
      </Modal>
    </>
  );
}
