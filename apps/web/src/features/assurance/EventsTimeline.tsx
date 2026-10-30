import { useState } from 'react';
import { Button, Card, Empty, Flex, Input, Timeline, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { AssuranceEventDto } from '@processhub/shared';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';

const COLOUR: Record<AssuranceEventDto['kind'], string> = {
  CREATED: 'blue',
  STATUS: 'purple',
  UPDATED: 'orange',
  COMMENT: 'gray',
  FILE: 'green',
};

/** History and comments of an assurance record, newest first. */
export function EventsTimeline({
  events,
  onComment,
  commenting,
  statusNs,
}: {
  events: AssuranceEventDto[];
  onComment?: (body: string) => Promise<unknown>;
  commenting?: boolean;
  /** Translation prefix of status values, e.g. "assurance:tests.status". */
  statusNs: string;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const [text, setText] = useState('');
  const describe = (e: AssuranceEventDto) => {
    const s = e.changes.status;
    if (e.kind === 'STATUS' && s)
      return t('assurance:events.status', {
        from: s.from ? t(`${statusNs}.${String(s.from)}`) : '—',
        to: t(`${statusNs}.${String(s.to)}`),
      });
    if (e.kind === 'FILE')
      return t('assurance:events.file', { name: String(e.changes.file?.to ?? '') });
    return t(`assurance:events.${e.kind}`);
  };
  return (
    <Card title={t('assurance:events.title')} data-testid="assurance-events">
      {onComment && (
        <Flex gap={8} style={{ marginBlockEnd: 16 }}>
          <Input.TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('assurance:events.commentPlaceholder')}
            autoSize={{ minRows: 1, maxRows: 4 }}
            maxLength={4000}
          />
          <Button
            type="primary"
            disabled={!text.trim()}
            loading={commenting}
            onClick={() => void onComment(text.trim()).then(() => setText(''))}
          >
            {t('assurance:events.add')}
          </Button>
        </Flex>
      )}
      {!events.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Timeline
          items={events.map((e) => ({
            color: COLOUR[e.kind],
            children: (
              <>
                <Typography.Text strong>{describe(e)}</Typography.Text>
                {e.comment && (
                  <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBlock: 4 }}>
                    {e.comment}
                  </Typography.Paragraph>
                )}
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                  {e.author ? loc(e.author) || e.author.email : t('assurance:system')} ·{' '}
                  {formatDate(e.createdAt)}
                </Typography.Text>
              </>
            ),
          }))}
        />
      )}
    </Card>
  );
}
