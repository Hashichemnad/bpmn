import { useEffect } from 'react';
import { App, Form } from 'antd';
import { useTranslation } from 'react-i18next';
import type { AiTranslationDto, Locale } from '@processhub/shared';
import { useErrorMessage } from '@/components/i18n-helpers';
import { useAiRun } from './useAi';
import { AiButton } from './AiParts';

const PAIRS = [
  ['nameEn', 'nameAr'],
  ['descriptionEn', 'descriptionAr'],
] as const;

/**
 * Fills the empty language of a bilingual form (name / description) from the other one. The
 * translation lands in the form fields; nothing is saved until the user saves the form.
 */
export function TranslateFieldsButton({ description }: { description: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const form = Form.useFormInstance();
  const ai = useAiRun<AiTranslationDto>();
  const values = Form.useWatch([], form) as Record<string, string | undefined> | undefined;
  const pairs = PAIRS.slice(0, description ? 2 : 1);
  const filled = (k: string) => !!values?.[k]?.trim();
  // Translate towards the language that has empty fields while the other has text.
  const target: Locale | null = pairs.some(([en, ar]) => filled(en) && !filled(ar))
    ? 'ar'
    : pairs.some(([en, ar]) => filled(ar) && !filled(en))
      ? 'en'
      : null;

  const run = async () => {
    if (!target) return;
    const fields = pairs
      .map(([en, ar]) => (target === 'ar' ? [en, ar] : [ar, en]))
      .filter(([src, dst]) => filled(src) && !filled(dst))
      .map(([src]) => ({ key: src, text: values![src]! }));
    const res = await ai.run('/ai/translate', { kind: 'fields', target, fields });
    if (!res?.fields) return;
    const patch: Record<string, string> = {};
    for (const [src, text] of Object.entries(res.fields)) {
      const pair = PAIRS.find((p) => p.includes(src as never))!;
      const dst = pair[0] === src ? pair[1] : pair[0];
      if (text) patch[dst] = text;
    }
    form.setFieldsValue(patch);
    message.success(t('ai:translate.fieldsFilled'));
  };

  useEffect(() => {
    if (ai.error) message.error(errorMessage(ai.error));
  }, [ai.error, message, errorMessage]);

  return (
    <AiButton
      size="small"
      type="text"
      disabled={!target}
      loading={ai.running}
      onClick={() => void run()}
    >
      {target ? t(`ai:translate.fieldsTo.${target}`) : t('ai:translate.fields')}
    </AiButton>
  );
}
