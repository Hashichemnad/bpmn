import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Flex,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Tabs,
  Typography,
} from 'antd';
import { useTranslation } from 'react-i18next';
import {
  AI_DOC_TEMPLATES,
  type AiGeneratedDocDto,
  type PageDto,
  type ProcessDto,
} from '@processhub/shared';
import { api } from '@/api/client';
import { useSpaces } from '@/api/docs';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { RichTextView } from '@/features/docs/RichTextView';
import { useAiRun } from './useAi';
import { AiError, AiIcon, AiNotice, AiSuggestionChips, AiWorking } from './AiParts';

/**
 * Feature 3a: write an SOP or Work Instruction (English and Arabic) from a process, preview it,
 * then create the page in a space (linked to the process through the embedded diagram).
 */
export function GenerateDocModal({
  process,
  open,
  onClose,
}: {
  process: ProcessDto;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const spaces = useSpaces();
  const ai = useAiRun<AiGeneratedDocDto>();
  const [template, setTemplate] = useState<(typeof AI_DOC_TEMPLATES)[number]>('SOP');
  const [spaceId, setSpaceId] = useState<string | undefined>();
  const [instructions, setInstructions] = useState('');
  const [creating, setCreating] = useState(false);
  const editable = (spaces.data ?? []).filter((s) => s.canEdit);

  useEffect(() => {
    if (!open) ai.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!spaceId && editable.length) setSpaceId(editable[0].id);
  }, [editable, spaceId]);

  const generate = () =>
    void ai.run('/ai/generate-doc', {
      processId: process.id,
      template,
      ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
    });

  const create = async () => {
    const doc = ai.result;
    if (!doc || !spaceId) return;
    setCreating(true);
    try {
      const page = await api<PageDto>(`/spaces/${spaceId}/pages`, {
        method: 'POST',
        body: { titleEn: doc.titleEn, titleAr: doc.titleAr },
      });
      await api<PageDto>(`/pages/${page.id}`, {
        method: 'PUT',
        body: {
          titleEn: doc.titleEn,
          titleAr: doc.titleAr,
          contentEn: doc.contentEn,
          contentAr: doc.contentAr,
          dirEn: 'ltr',
          dirAr: 'rtl',
          changeNote: t('ai:doc.changeNote', { code: process.code }),
          baseVersion: page.version,
          aiGenerated: true,
        },
      });
      void qc.invalidateQueries({ queryKey: ['related-pages'] });
      void qc.invalidateQueries({ queryKey: ['pages'] });
      message.success(t('ai:doc.created'));
      onClose();
      navigate(`/docs/${spaceId}/pages/${page.id}`);
    } catch (err) {
      message.error(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const doc = ai.result;
  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={doc ? 'min(1000px, 96vw)' : 'min(640px, 96vw)'}
      destroyOnHidden
      maskClosable={!ai.running}
      title={
        <Space>
          <AiIcon />
          {t('ai:doc.title')}
        </Space>
      }
      footer={
        doc ? (
          <Flex justify="space-between" wrap gap={8}>
            <Button onClick={() => ai.setResult(null)}>{t('ai:generate.editPrompt')}</Button>
            <Space wrap>
              <Button onClick={generate} disabled={ai.running}>
                {t('ai:generate.regenerate')}
              </Button>
              <Button
                type="primary"
                onClick={() => void create()}
                loading={creating}
                disabled={!spaceId}
              >
                {t('ai:doc.create')}
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
              loading={ai.running}
              disabled={!spaceId}
            >
              {t('ai:generate.submit')}
            </Button>
          </Space>
        )
      }
    >
      {!doc && (
        <Form layout="vertical">
          <Typography.Paragraph type="secondary">
            {t('ai:doc.intro', { process: `${process.code} ${loc(process)}` })}
          </Typography.Paragraph>
          <Form.Item label={t('ai:doc.template')}>
            <Radio.Group
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              options={AI_DOC_TEMPLATES.map((k) => ({
                value: k,
                label: t(`ai:doc.templates.${k}`),
              }))}
            />
          </Form.Item>
          <Form.Item
            label={t('ai:doc.space')}
            help={!spaces.isLoading && !editable.length ? t('ai:doc.noSpace') : undefined}
            validateStatus={!spaces.isLoading && !editable.length ? 'warning' : undefined}
          >
            <Select
              value={spaceId}
              onChange={setSpaceId}
              loading={spaces.isLoading}
              options={editable.map((s) => ({ value: s.id, label: loc(s) }))}
            />
          </Form.Item>
          <Form.Item label={t('ai:doc.instructions')}>
            <Input.TextArea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              maxLength={4000}
              dir="auto"
            />
          </Form.Item>
          <AiSuggestionChips feature="GENERATE_DOC" onPick={setInstructions} />
        </Form>
      )}
      {ai.running && (
        <AiWorking chars={ai.chars} label={t('ai:doc.working')} onCancel={ai.cancel} />
      )}
      <AiError error={ai.error} onRetry={generate} />
      {doc && (
        <Tabs
          items={(['en', 'ar'] as const).map((l) => ({
            key: l,
            label: l === 'ar' ? 'العربية' : 'English',
            children: (
              <div className="ph-ai-page-preview" dir={l === 'ar' ? 'rtl' : 'ltr'}>
                <Typography.Title level={3}>
                  {l === 'ar' ? doc.titleAr : doc.titleEn}
                </Typography.Title>
                <RichTextView
                  html={l === 'ar' ? doc.contentAr : doc.contentEn}
                  dir={l === 'ar' ? 'rtl' : 'ltr'}
                  lang={l}
                />
              </div>
            ),
          }))}
        />
      )}
      <AiNotice />
    </Modal>
  );
}
