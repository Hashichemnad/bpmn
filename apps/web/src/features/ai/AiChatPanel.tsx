import { useRef, useState } from 'react';
import { Alert, Button, Empty, Flex, Input, Modal, Space, Typography } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { AiGeneratedProcessDto, AiSuggestedLinkDto } from '@processhub/shared';
import { BpmnCompare } from '@/features/versions/BpmnCompare';
import { detectLocale } from '@/features/modeler/labels';
import { useAiRun } from './useAi';
import { AiError, AiIcon, AiNotice, AiSuggestionChips, AiWorking } from './AiParts';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  /** Assistant turns that carry a proposal. */
  proposal?: AiGeneratedProcessDto;
  status?: 'pending' | 'accepted' | 'rejected';
}

interface Props {
  processId: string;
  /** Current diagram (with unsaved changes). */
  getXml: () => Promise<string>;
  /** Applies an accepted proposal (replaces and saves the diagram, adds the links). */
  onAccept: (result: AiGeneratedProcessDto, links: AiSuggestedLinkDto[]) => Promise<void>;
}

/**
 * Feature 2: chat with the assistant about the open diagram. Every answer is a proposal that is
 * reviewed in a visual compare (current vs proposed) and accepted or rejected.
 */
export function AiChatPanel({ processId, getXml, onAccept }: Props) {
  const { t } = useTranslation();
  const ai = useAiRun<AiGeneratedProcessDto>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [review, setReview] = useState<{ index: number; currentXml: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const send = async (text = input) => {
    const instruction = text.trim();
    if (instruction.length < 3 || ai.running) return;
    const history = messages
      .filter((m) => m.text)
      .slice(-10)
      .map((m) => ({ role: m.role, text: m.text }));
    setMessages((ms) => [...ms, { role: 'user', text: instruction }]);
    setInput('');
    const res = await ai.run('/ai/refine-process', {
      processId,
      bpmnXml: await getXml(),
      instruction,
      language: detectLocale(instruction),
      history,
    });
    if (res)
      setMessages((ms) => [
        ...ms,
        { role: 'assistant', text: res.explanation, proposal: res, status: 'pending' },
      ]);
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
  };

  const setStatus = (index: number, status: Message['status']) =>
    setMessages((ms) => ms.map((m, i) => (i === index ? { ...m, status } : m)));

  const openReview = async (index: number) => setReview({ index, currentXml: await getXml() });

  const accept = async () => {
    if (!review) return;
    const p = messages[review.index].proposal!;
    setApplying(true);
    try {
      await onAccept(p, p.suggestedLinks);
      // Older proposals were made for the previous diagram.
      setMessages((ms) =>
        ms.map((m, i) =>
          i === review.index
            ? { ...m, status: 'accepted' }
            : m.status === 'pending'
              ? { ...m, status: 'rejected' }
              : m,
        ),
      );
      setReview(null);
    } finally {
      setApplying(false);
    }
  };

  const proposal = review ? messages[review.index].proposal! : null;
  return (
    <div className="ph-ai-chat">
      <div className="ph-ai-chat-log" aria-live="polite">
        {messages.length === 0 && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('ai:chat.empty')} />
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ph-ai-msg ph-ai-msg-${m.role}`}>
            {m.role === 'assistant' && <AiIcon />}
            <div className="ph-ai-msg-body">
              <Typography.Paragraph dir="auto" style={{ marginBottom: m.proposal ? 6 : 0 }}>
                {m.text}
              </Typography.Paragraph>
              {m.proposal && (
                <Space wrap size={6}>
                  {m.status === 'pending' && (
                    <>
                      <Button size="small" type="primary" onClick={() => void openReview(i)}>
                        {t('ai:chat.review')}
                      </Button>
                      <Button size="small" onClick={() => setStatus(i, 'rejected')}>
                        {t('ai:chat.reject')}
                      </Button>
                    </>
                  )}
                  {m.status === 'accepted' && (
                    <Typography.Text type="success">{t('ai:chat.accepted')}</Typography.Text>
                  )}
                  {m.status === 'rejected' && (
                    <Typography.Text type="secondary">{t('ai:chat.rejected')}</Typography.Text>
                  )}
                </Space>
              )}
            </div>
          </div>
        ))}
        {ai.running && (
          <AiWorking chars={ai.chars} label={t('ai:chat.working')} onCancel={ai.cancel} />
        )}
        <AiError
          error={ai.error}
          onRetry={() => void send(messages[messages.length - 1]?.text ?? '')}
        />
        <div ref={endRef} />
      </div>
      <AiSuggestionChips feature="REFINE_PROCESS" onPick={(s) => void send(s)} />
      <Flex gap={6} align="end">
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoSize={{ minRows: 2, maxRows: 5 }}
          maxLength={4000}
          dir="auto"
          placeholder={t('ai:chat.placeholder')}
          aria-label={t('ai:chat.placeholder')}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={() => void send()}
          disabled={input.trim().length < 3 || ai.running}
          aria-label={t('ai:chat.send')}
        />
      </Flex>
      <AiNotice />
      <Modal
        open={!!review}
        onCancel={() => setReview(null)}
        width="min(1400px, 97vw)"
        destroyOnHidden
        title={
          <Space>
            <AiIcon />
            {t('ai:chat.reviewTitle')}
          </Space>
        }
        footer={
          <Space>
            <Button
              onClick={() => {
                setStatus(review!.index, 'rejected');
                setReview(null);
              }}
            >
              {t('ai:chat.reject')}
            </Button>
            <Button type="primary" loading={applying} onClick={() => void accept()}>
              {t('ai:chat.accept')}
            </Button>
          </Space>
        }
      >
        {proposal && review && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              icon={<AiIcon />}
              message={<span dir="auto">{proposal.explanation}</span>}
            />
            {proposal.dropped > 0 && (
              <Alert
                type="warning"
                showIcon
                message={t('ai:chat.dropped', { count: proposal.dropped })}
              />
            )}
            <Typography.Text type="secondary">{t('ai:chat.layoutHint')}</Typography.Text>
            <BpmnCompare
              oldXml={review.currentXml}
              newXml={proposal.bpmnXml}
              oldTitle={t('ai:chat.current')}
              newTitle={t('ai:chat.proposed')}
            />
          </Space>
        )}
      </Modal>
    </div>
  );
}
