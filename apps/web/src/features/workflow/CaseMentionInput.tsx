import { useRef, useState } from 'react';
import { Mentions } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { COMMENT_MAX_CHARS } from '@processhub/shared';
import { fromStoredBody, toStoredBody } from '@/features/comments/mention-body';
import { searchWorkflowUsers } from '@/api/workflow';
import { useLocalized } from '@/components/i18n-helpers';

/**
 * Comment box of a request with @mentions (people without the workspace can comment on their own
 * requests too, so the lookup uses the workflow user search). Only people who can see the request
 * are notified (checked on the server).
 */
export function CaseMentionInput({ onChange }: { onChange: (body: string) => void }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const start = useRef(fromStoredBody(''));
  const [text, setText] = useState(start.current.text);
  const picked = useRef(start.current.picked);
  const [q, setQ] = useState('');
  const users = useQuery({
    queryKey: ['workflow', 'mention', q],
    queryFn: () => searchWorkflowUsers(q),
    enabled: q.length >= 2,
  });
  return (
    <Mentions
      autoSize={{ minRows: 2, maxRows: 6 }}
      value={text}
      maxLength={COMMENT_MAX_CHARS}
      placeholder={t('workflow:case.commentPlaceholder')}
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
        return { key: u.id, value: name, label: `${name} · ${u.email}` };
      })}
      split=" "
      data-testid="case-comment"
    />
  );
}
