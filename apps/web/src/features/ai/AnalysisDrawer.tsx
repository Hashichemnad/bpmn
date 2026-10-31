import { useEffect, useState } from 'react';
import { Button, Drawer, Empty, Input, List, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { AiAnalysisDto, BpmnIssue } from '@processhub/shared';
import { useLocale } from '@/app/LocaleProvider';
import { useAiRun } from './useAi';
import { AiError, AiIcon, AiNotice, AiSuggestionChips, AiWorking } from './AiParts';
import { activateProps } from '@/components/a11y';

const SEVERITY_COLOR = { HIGH: 'red', MEDIUM: 'orange', LOW: 'blue' } as const;

interface Props {
  open: boolean;
  processId: string;
  /** Current diagram (unsaved changes included). */
  getXml: () => Promise<string>;
  /** Validation warnings shown in the modeler, explained in plain language. */
  issues: BpmnIssue[];
  /** Name of an element for the prompt and the lists. */
  nameOf: (id: string) => string;
  onFocusElement: (id: string) => void;
  onClose: () => void;
}

/** Feature 5: findings (missing steps, responsibilities, bottlenecks, risks, controls). */
export function AnalysisDrawer({
  open,
  processId,
  getXml,
  issues,
  nameOf,
  onFocusElement,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const ai = useAiRun<AiAnalysisDto>();
  const [focus, setFocus] = useState('');

  const run = async (f = focus) =>
    ai.run('/ai/analyse', {
      processId,
      bpmnXml: await getXml(),
      language: locale,
      warnings: issues
        .filter((i) => i.severity === 'warning' || i.code === 'UNNAMED_ACTIVITY')
        .slice(0, 50)
        .map((i) => ({
          code: i.code,
          ...(i.elementId
            ? { elementId: i.elementId, elementName: nameOf(i.elementId).slice(0, 300) }
            : {}),
        })),
      ...(f.trim() ? { focus: f.trim() } : {}),
    });

  useEffect(() => {
    if (open && !ai.result && !ai.running) void run('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const elementTag = (id: string) => (
    <Tag key={id} className="ph-ai-element" {...activateProps(() => onFocusElement(id))}>
      {nameOf(id) || id}
    </Tag>
  );
  const r = ai.result;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="min(520px, 100vw)"
      title={
        <Space>
          <AiIcon />
          {t('ai:analyse.title')}
        </Space>
      }
      mask={false}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder={t('ai:analyse.focus')}
            dir="auto"
            maxLength={500}
            onPressEnter={() => void run()}
            aria-label={t('ai:analyse.focus')}
          />
          <Button onClick={() => void run()} disabled={ai.running}>
            {t('ai:analyse.run')}
          </Button>
        </Space.Compact>
        <AiSuggestionChips
          feature="ANALYSE"
          onPick={(s) => {
            setFocus(s);
            void run(s);
          }}
        />
        {ai.running && (
          <AiWorking chars={ai.chars} label={t('ai:analyse.working')} onCancel={ai.cancel} />
        )}
        <AiError error={ai.error} onRetry={() => void run()} />
        {r && (
          <>
            <Typography.Paragraph dir="auto" className="ph-ai-summary">
              {r.summary}
            </Typography.Paragraph>
            <Typography.Title level={5}>
              {t('ai:analyse.findings', { count: r.findings.length })}
            </Typography.Title>
            {r.findings.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('ai:analyse.none')} />
            ) : (
              <List
                dataSource={r.findings}
                renderItem={(f) => (
                  <List.Item className="ph-ai-finding">
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Space wrap size={4}>
                        <Tag color={SEVERITY_COLOR[f.severity]}>
                          {t(`ai:analyse.severity.${f.severity}`)}
                        </Tag>
                        <Tag>{t(`ai:analyse.kind.${f.kind}`)}</Tag>
                      </Space>
                      <Typography.Text strong dir="auto">
                        {f.title}
                      </Typography.Text>
                      <Typography.Text dir="auto">{f.explanation}</Typography.Text>
                      {f.suggestion && (
                        <Typography.Text type="secondary" dir="auto">
                          → {f.suggestion}
                        </Typography.Text>
                      )}
                      {f.elementIds.length > 0 && <div>{f.elementIds.map(elementTag)}</div>}
                    </Space>
                  </List.Item>
                )}
              />
            )}
            {r.warnings.length > 0 && (
              <>
                <Typography.Title level={5}>{t('ai:analyse.warnings')}</Typography.Title>
                <List
                  size="small"
                  dataSource={r.warnings}
                  renderItem={(w) => (
                    <List.Item>
                      <Space direction="vertical" size={2}>
                        <Space wrap size={4}>
                          <Tag color="orange">
                            {t(`modeler:rules.${w.code}`, { defaultValue: w.code })}
                          </Tag>
                          {w.elementId && elementTag(w.elementId)}
                        </Space>
                        <Typography.Text dir="auto">{w.explanation}</Typography.Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </>
            )}
          </>
        )}
        <AiNotice />
      </Space>
    </Drawer>
  );
}
