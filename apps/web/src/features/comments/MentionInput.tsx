import { useRef, useState } from 'react';
import { Mentions } from 'antd';
import { useTranslation } from 'react-i18next';
import { COMMENT_MAX_CHARS } from '@processhub/shared';
import { fromStoredBody, toStoredBody } from './mention-body';
import { useUserDirectory } from '@/api/governance';
import { useLocalized } from '@/components/i18n-helpers';

/**
 * Text area with @mention suggestions from the user directory. `onChange` receives the body
 * in storage format (`@[Name](id)` tokens).
 */
export function MentionInput({
  initial = '',
  onChange,
  placeholder,
  autoFocus,
}: {
  initial?: string;
  onChange: (body: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const start = useRef(fromStoredBody(initial));
  const [text, setText] = useState(start.current.text);
  const picked = useRef(start.current.picked);
  const [q, setQ] = useState('');
  const users = useUserDirectory(q);
  return (
    <Mentions
      autoFocus={autoFocus}
      autoSize={{ minRows: 2, maxRows: 8 }}
      value={text}
      maxLength={COMMENT_MAX_CHARS}
      placeholder={placeholder ?? t('governance:comments.placeholder')}
      onSearch={setQ}
      loading={users.isFetching}
      onChange={(v) => {
        setText(v);
        onChange(toStoredBody(v, picked.current));
      }}
      onSelect={(option) => {
        const u = users.data?.find((x) => x.id === option.key);
        if (u && option.value) picked.current.set(option.value, u.id);
      }}
      options={(users.data ?? []).map((u) => {
        const name = (loc(u) || u.email).replace(/\s+/g, ' ');
        return { key: u.id, value: name, label: `${name}${loc(u) ? ` · ${u.email}` : ''}` };
      })}
      split=" "
    />
  );
}
