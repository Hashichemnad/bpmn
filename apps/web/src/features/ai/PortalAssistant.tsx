import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Drawer, Empty, Flex, Input, List, Space, Tag, Typography } from 'antd';
import { FileTextOutlined, PartitionOutlined, SendOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { AiAnswerDto } from '@processhub/shared';
import { useLocale } from '@/app/LocaleProvider';
import { useLocalized } from '@/components/i18n-helpers';
import { portalItemLink } from '@/features/portal/portal-links';
import { useAi, useAiRun } from './useAi';
import { AiError, AiIcon, AiNotice, AiSuggestionChips, AiWorking } from './AiParts';
import { AiText } from './AiText';
import { AssistantContext } from './portal-assistant-context';

interface Turn {
  question: string;
  answer?: AiAnswerDto;
}

const NOT_FOUND = '[[NOT_FOUND]]';

/**
 * Feature 7: the Knowledge Portal assistant. Answers come only from published content the user
 * may see, with links to the processes and pages used (numbered like the citations).
 */
export function PortalAssistantProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const loc = useLocalized();
  const { available } = useAi();
  const ai = useAiRun<AiAnswerDto>();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (question.length < 3) return;
      const history = turns
        .filter((x) => x.answer?.answer)
        .slice(-4)
        .flatMap((x) => [
          { role: 'user' as const, text: x.question },
          { role: 'assistant' as const, text: x.answer!.answer },
        ]);
      setTurns((ts) => [...ts, { question }]);
      setInput('');
      const res = await ai.run('/ai/portal/ask', { question, language: locale, history });
      setTurns((ts) =>
        ts.map((x, i) => (i === ts.length - 1 ? { ...x, answer: res ?? undefined } : x)),
      );
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
    },
    [ai, locale, turns],
  );

  const ask = useCallback(
    (question?: string) => {
      setOpen(true);
      if (question) void send(question);
    },
    [send],
  );

  const last = turns.length - 1;
  return (
    <AssistantContext.Provider value={available ? { ask } : null}>
      {children}
      {available && (
        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          width="min(480px, 100vw)"
          title={
            <Space>
              <AiIcon />
              {t('ai:portal.title')}
            </Space>
          }
        >
          <div className="ph-ai-chat">
            <div className="ph-ai-chat-log ph-ai-portal-log" aria-live="polite">
              {turns.length === 0 && (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('ai:portal.empty')} />
              )}
              {turns.map((turn, i) => {
                const streaming = i === last && ai.running;
                const text = (turn.answer?.answer ?? (streaming ? ai.text : ''))
                  .replace(NOT_FOUND, '')
                  .trim();
                return (
                  <div key={i}>
                    <div className="ph-ai-msg ph-ai-msg-user">
                      <div className="ph-ai-msg-body" dir="auto">
                        {turn.question}
                      </div>
                    </div>
                    <div className="ph-ai-msg ph-ai-msg-assistant">
                      <AiIcon />
                      <div className="ph-ai-msg-body">
                        {streaming && !text && <AiWorking label={t('ai:portal.searching')} />}
                        {turn.answer && !turn.answer.answered ? (
                          <Alert
                            type="info"
                            showIcon
                            message={t('ai:portal.notFound')}
                            description={text || undefined}
                          />
                        ) : (
                          text && <AiText text={text} />
                        )}
                        {!!turn.answer?.sources.length && (
                          <List
                            size="small"
                            header={
                              <Typography.Text type="secondary">
                                {t('ai:portal.sources')}
                              </Typography.Text>
                            }
                            dataSource={turn.answer.sources}
                            renderItem={(s) => (
                              <List.Item>
                                <Link to={portalItemLink(s)} onClick={() => setOpen(false)}>
                                  <Space size={6}>
                                    <Tag>{s.ref}</Tag>
                                    {s.type === 'PROCESS' ? (
                                      <PartitionOutlined />
                                    ) : (
                                      <FileTextOutlined />
                                    )}
                                    <span>
                                      {s.code ? `${s.code} ` : ''}
                                      {loc(s, 'title')}
                                    </span>
                                    {s.versionLabel && <Tag color="green">{s.versionLabel}</Tag>}
                                  </Space>
                                </Link>
                              </List.Item>
                            )}
                          />
                        )}
                        {i === last && (
                          <AiError error={ai.error} onRetry={() => void send(turn.question)} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            <AiSuggestionChips feature="PORTAL_QA" onPick={(s) => void send(s)} />
            <Flex gap={6} align="end">
              <Input.TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                autoSize={{ minRows: 1, maxRows: 4 }}
                maxLength={1000}
                dir="auto"
                placeholder={t('ai:portal.placeholder')}
                aria-label={t('ai:portal.placeholder')}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={() => void send(input)}
                disabled={input.trim().length < 3 || ai.running}
                aria-label={t('ai:chat.send')}
              />
            </Flex>
            <Typography.Paragraph type="secondary" className="ph-ai-notice">
              {t('ai:portal.onlyPublished')}
            </Typography.Paragraph>
            <AiNotice />
          </div>
        </Drawer>
      )}
    </AssistantContext.Provider>
  );
}
