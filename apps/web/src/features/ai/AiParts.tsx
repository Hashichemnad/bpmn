import type { ReactNode } from 'react';
import { Alert, Button, Dropdown, Flex, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import type { ButtonProps, MenuProps } from 'antd';
import { useTranslation } from 'react-i18next';
import type { AiSuggestionFeature } from '@processhub/shared';
import { useLocalized, useErrorMessage, useFormatNumber } from '@/components/i18n-helpers';
import { useAi } from './useAi';

/** The sparkle used by every AI entry point. */
export const AiIcon = () => (
  <span className="ph-ai-icon" aria-hidden>
    ✨
  </span>
);

/**
 * The consistent "✨ AI" button. Renders nothing when the assistant is not available to the
 * user (disabled in Settings, role not allowed). With `menu` it opens a dropdown of actions.
 */
export function AiButton({
  children,
  menu,
  ...props
}: Omit<ButtonProps, 'icon'> & { menu?: MenuProps['items'] }) {
  const { t } = useTranslation();
  const { available } = useAi();
  if (!available) return null;
  const button = (
    <Button {...props} icon={<AiIcon />} className={`ph-ai-button ${props.className ?? ''}`}>
      {children ?? t('ai:button')}
    </Button>
  );
  return menu ? (
    <Dropdown trigger={['click']} menu={{ items: menu }}>
      {button}
    </Dropdown>
  ) : (
    button
  );
}

/** "AI-generated — review before publishing" until a person edits or approves the content. */
export function AiBadge() {
  const { t } = useTranslation();
  return (
    <Tooltip title={t('ai:badge.hint')}>
      <Tag className="ph-ai-badge" icon={<AiIcon />}>
        {t('ai:badge.label')}
      </Tag>
    </Tooltip>
  );
}

/** The organisation's data notice and the user's remaining requests today. */
export function AiNotice() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const num = useFormatNumber();
  const { status } = useAi();
  if (!status?.available) return null;
  const notice = loc(status, 'notice');
  return (
    <Typography.Paragraph type="secondary" className="ph-ai-notice">
      {notice}
      {status.dailyLimit > 0 && (
        <>
          {notice ? ' · ' : ''}
          {t('ai:usage.today', { used: num(status.usedToday), limit: num(status.dailyLimit) })}
        </>
      )}
    </Typography.Paragraph>
  );
}

/** Sample prompts for a feature (configured in Settings → AI; seeded for the demo). */
export function AiSuggestionChips({
  feature,
  onPick,
}: {
  feature: AiSuggestionFeature;
  onPick: (text: string) => void;
}) {
  const { t } = useTranslation();
  const { status } = useAi();
  const loc = useLocalized();
  const items = (status?.suggestions[feature] ?? [])
    .map((s) => loc({ textEn: s.en, textAr: s.ar }, 'text'))
    .filter(Boolean);
  if (!items.length) return null;
  return (
    <Flex wrap gap={6} align="center" className="ph-ai-chips">
      <Typography.Text type="secondary">{t('ai:tryExample')}</Typography.Text>
      {items.map((text) => (
        <Tag.CheckableTag
          key={text}
          checked={false}
          onChange={() => onPick(text)}
          className="ph-ai-chip"
        >
          {text}
        </Tag.CheckableTag>
      ))}
    </Flex>
  );
}

/** Progress while the assistant works: streamed characters for structured output, cancel. */
export function AiWorking({
  chars,
  label,
  onCancel,
  children,
}: {
  chars?: number;
  label?: string;
  onCancel?: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const num = useFormatNumber();
  return (
    <div className="ph-ai-working" role="status" aria-live="polite">
      <Space align="center">
        <Spin size="small" />
        <Typography.Text>
          {label ?? t('ai:working')}
          {chars ? ` · ${t('ai:received', { chars: num(chars) })}` : ''}
        </Typography.Text>
        {onCancel && (
          <Button size="small" type="link" onClick={onCancel}>
            {t('cancel')}
          </Button>
        )}
      </Space>
      {children}
    </div>
  );
}

/** Translated AI error (limit reached, disabled, provider error, invalid output, …). */
export function AiError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  if (!error) return null;
  return (
    <Alert
      type="error"
      showIcon
      message={errorMessage(error)}
      action={
        onRetry && (
          <Button size="small" onClick={onRetry}>
            {t('ai:retry')}
          </Button>
        )
      }
    />
  );
}
