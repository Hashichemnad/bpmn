import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Drawer, Empty, List, Space, Tag, Typography } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type {
  ControlGap,
  ControlGapFindingDto,
  ControlGapsDto,
  ProcessGapsDto,
  ProcessGrcDto,
} from '@processhub/shared';
import { api } from '@/api/client';
import { grcKeys } from '@/api/grc';
import { useCreateLink } from '@/api/hooks';
import { useLocale } from '@/app/LocaleProvider';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { AiButton, AiError, AiIcon, AiWorking } from '@/features/ai/AiParts';
import { useAi, useAiRun } from '@/features/ai/useAi';
import { GrcFormModal } from './GrcFormModal';
import { useGrcAccess } from './grc-helpers';

const SEVERITY_COLOR = { HIGH: 'red', MEDIUM: 'orange', LOW: 'blue' } as const;

/**
 * Control-gap check of a process (Phase 4.1, D-095): the rule results at once; with the AI
 * assistant, explanations and proposed fixes the user accepts (link / create a control) or
 * dismisses. Nothing changes without the user's click.
 */
export function ControlGapsDrawer({
  open,
  processId,
  getXml,
  nameOf,
  onFocusElement,
  canChange,
  onClose,
}: {
  open: boolean;
  processId: string;
  getXml: () => Promise<string>;
  nameOf: (id: string) => string;
  onFocusElement: (id: string) => void;
  /** The user may link risks and controls to this process now. */
  canChange: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { locale } = useLocale();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const access = useGrcAccess();
  const { available } = useAi();
  const ai = useAiRun<ControlGapsDto>();
  const createLink = useCreateLink(processId);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState<{ index: number; f: ControlGapFindingDto } | null>(null);
  const rules = useQuery({
    queryKey: ['grc', 'gaps', processId],
    queryFn: () => api<ProcessGapsDto & ProcessGrcDto>(`/grc/processes/${processId}/gaps`),
    enabled: open,
  });
  const itemName = (id: string) => {
    const i = rules.data?.items.find((x) => x.id === id);
    return i ? `${i.code ? `${i.code} ` : ''}${loc(i)}` : id;
  };

  const runAi = async () => {
    setDismissed(new Set());
    setDone(new Set());
    await ai.run('/ai/control-gaps', { processId, bpmnXml: await getXml(), language: locale });
  };

  const accept = (index: number, f: ControlGapFindingDto) => {
    if (f.action.type === 'CREATE_CONTROL') {
      setCreating({ index, f });
      return;
    }
    if (f.action.type === 'LINK_CONTROL' && f.action.controlId && f.action.elementId)
      createLink.mutate(
        { bpmnElementId: f.action.elementId, repoObjectId: f.action.controlId },
        {
          onSuccess: () => {
            setDone((s) => new Set(s).add(index));
            void qc.invalidateQueries({ queryKey: grcKeys.process(processId) });
            void rules.refetch();
          },
          onError: (err) => message.error(errorMessage(err)),
        },
      );
  };

  const elementTag = (id: string) => (
    <Tag key={id} className="ph-ai-element" onClick={() => onFocusElement(id)} role="button">
      {nameOf(id) || id}
    </Tag>
  );
  const itemTags = (ids: string[]) =>
    ids.map((id) => (
      <Tag key={id} color="default">
        {itemName(id)}
      </Tag>
    ));
  const ruleItem = (g: ControlGap) => (
    <List.Item>
      <Space direction="vertical" size={4} style={{ inlineSize: '100%' }}>
        <Space wrap size={4}>
          <Tag color={SEVERITY_COLOR[g.severity]}>{t(`ai:analyse.severity.${g.severity}`)}</Tag>
          <Typography.Text strong>{t(`grc:gaps.kind.${g.kind}`)}</Typography.Text>
        </Space>
        <Typography.Text type="secondary">{t(`grc:gaps.hint.${g.kind}`)}</Typography.Text>
        <div>
          {g.elementIds.map(elementTag)}
          {itemTags(g.itemIds)}
        </div>
      </Space>
    </List.Item>
  );

  const r = ai.result;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="min(560px, 100vw)"
      title={t('grc:gaps.title')}
      mask={false}
      data-testid="grc-gaps-drawer"
    >
      <Space direction="vertical" size={12} style={{ inlineSize: '100%' }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {t('grc:gaps.rules', { count: rules.data?.gaps.length ?? 0 })}
        </Typography.Title>
        {rules.data && !rules.data.gaps.length ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('grc:gaps.none')} />
        ) : (
          <List loading={rules.isLoading} dataSource={rules.data?.gaps} renderItem={ruleItem} />
        )}
        {available && (
          <AiButton onClick={() => void runAi()} disabled={ai.running}>
            {t('grc:gaps.runAi')}
          </AiButton>
        )}
        {ai.running && (
          <AiWorking chars={ai.chars} label={t('grc:gaps.working')} onCancel={ai.cancel} />
        )}
        <AiError error={ai.error} onRetry={() => void runAi()} />
        {r && (
          <>
            <Typography.Paragraph dir="auto" className="ph-ai-summary">
              <AiIcon /> {r.summary}
            </Typography.Paragraph>
            <List
              dataSource={r.findings.map((f, i) => ({ f, i })).filter(({ i }) => !dismissed.has(i))}
              locale={{ emptyText: t('grc:gaps.none') }}
              renderItem={({ f, i }) => (
                <List.Item className="ph-ai-finding">
                  <Space direction="vertical" size={4} style={{ inlineSize: '100%' }}>
                    <Space wrap size={4}>
                      <Tag color={SEVERITY_COLOR[f.severity]}>
                        {t(`ai:analyse.severity.${f.severity}`)}
                      </Tag>
                      <Tag>{t(`grc:gaps.kind.${f.kind}`)}</Tag>
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
                    <div>
                      {f.elementIds.map(elementTag)}
                      {itemTags(f.itemIds)}
                    </div>
                    <Space wrap>
                      {done.has(i) ? (
                        <Tag color="green" icon={<CheckOutlined />}>
                          {t('grc:gaps.accepted')}
                        </Tag>
                      ) : (
                        <>
                          {f.action.type !== 'NONE' && canChange && (
                            <Button
                              size="small"
                              type="primary"
                              icon={<CheckOutlined />}
                              loading={createLink.isPending}
                              onClick={() => accept(i, f)}
                            >
                              {f.action.type === 'LINK_CONTROL'
                                ? t('grc:gaps.acceptLink', {
                                    name: itemName(f.action.controlId ?? '') || '',
                                    step: nameOf(f.action.elementId ?? ''),
                                  })
                                : t('grc:gaps.acceptCreate', {
                                    name: f.action.nameEn || f.action.nameAr,
                                  })}
                            </Button>
                          )}
                          <Button
                            size="small"
                            icon={<CloseOutlined />}
                            onClick={() => setDismissed((s) => new Set(s).add(i))}
                          >
                            {t('grc:gaps.dismiss')}
                          </Button>
                        </>
                      )}
                    </Space>
                  </Space>
                </List.Item>
              )}
            />
          </>
        )}
      </Space>
      {creating && (
        <GrcFormModal
          type="CONTROL"
          open
          preset={{
            nameEn: creating.f.action.nameEn,
            nameAr: creating.f.action.nameAr,
            descriptionEn: creating.f.suggestion,
            ...(access.canEdit ? {} : { status: 'DRAFT' }),
          }}
          onClose={() => setCreating(null)}
          onSaved={(saved) => {
            const index = creating.index;
            createLink.mutate(
              { bpmnElementId: creating.f.action.elementId!, repoObjectId: saved.id },
              {
                onSuccess: () => {
                  setDone((s) => new Set(s).add(index));
                  void qc.invalidateQueries({ queryKey: grcKeys.process(processId) });
                  void rules.refetch();
                },
                onError: (err) => message.error(errorMessage(err)),
              },
            );
          }}
        />
      )}
    </Drawer>
  );
}
