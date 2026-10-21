import { useEffect } from 'react';
import { Button, Modal, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { AiTranslationDto, Locale } from '@processhub/shared';
import { RichTextView } from '@/features/docs/RichTextView';
import { useAiRun } from './useAi';
import { AiError, AiIcon, AiNotice, AiWorking } from './AiParts';

interface Props {
  open: boolean;
  target: Locale;
  source: { title: string; html: string };
  onClose: () => void;
  /** Puts the reviewed translation into the editor (saved only with the page). */
  onUse: (t: { title: string; html: string }) => void;
}

/** Feature 4 in the wiki editor: translate the other language version, preview, use. */
export function TranslatePageModal({ open, target, source, onClose, onUse }: Props) {
  const { t } = useTranslation();
  const ai = useAiRun<AiTranslationDto>();
  const start = () => void ai.run('/ai/translate', { kind: 'page', target, ...source });

  useEffect(() => {
    if (open) start();
    else ai.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const res = ai.result;
  const dir = target === 'ar' ? 'rtl' : 'ltr';
  return (
    <Modal
      title={
        <Space>
          <AiIcon />
          {t(`ai:translate.pageTitle.${target}`)}
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
            disabled={!res}
            onClick={() => {
              onUse({ title: res?.title ?? '', html: res?.html ?? '' });
              onClose();
            }}
          >
            {t('ai:translate.use')}
          </Button>
        </Space>
      }
    >
      {ai.running && <AiWorking chars={ai.chars} onCancel={ai.cancel} />}
      <AiError error={ai.error} onRetry={start} />
      {res && (
        <div className="ph-ai-page-preview">
          <Typography.Title level={4} dir={dir} lang={target}>
            {res.title}
          </Typography.Title>
          <RichTextView html={res.html ?? ''} dir={dir} lang={target} />
        </div>
      )}
      <AiNotice />
    </Modal>
  );
}
