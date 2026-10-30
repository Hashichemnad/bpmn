import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, App, Button, Empty, Flex, List, Segmented, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, LinkOutlined, PlusOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  PROCESS_ELEMENT_ID,
  summariseSteps,
  type GrcObjectType,
  type ProcessGrcDto,
} from '@processhub/shared';
import { grcKeys, useProcessGrc } from '@/api/grc';
import { useCreateLink, useDeleteLink } from '@/api/hooks';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { GrcFormModal } from './GrcFormModal';
import { GrcItemSelect } from './GrcItemSelect';
import { grcItemPath, useGrcAccess } from './grc-helpers';
import { EffectivenessTag, GrcStatusTag, RatingTag } from './grc-tags';

type Item = ProcessGrcDto['items'][number];

/**
 * Side panel tab "Risks & Controls" of a step (or of the whole process when nothing is selected):
 * linked risks with their residual rating, controls with their effectiveness, requirements; link
 * existing items, propose a new draft risk or control linked to the step, unlink.
 */
export function GrcStepPanel({
  processId,
  elementId,
  elementName,
  canEditModel,
  locked = false,
}: {
  processId: string;
  /** Selected element, or null for the process as a whole. */
  elementId: string | null;
  elementName: string;
  canEditModel: boolean;
  /** In review or archived: links cannot change. */
  locked?: boolean;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const access = useGrcAccess();
  const grc = useProcessGrc(processId);
  const createLink = useCreateLink(processId);
  const deleteLink = useDeleteLink(processId);
  const [type, setType] = useState<GrcObjectType>(elementId ? 'RISK' : 'REQUIREMENT');
  const [pick, setPick] = useState<string | null>(null);
  const [creating, setCreating] = useState<GrcObjectType | null>(null);
  const target = elementId ?? PROCESS_ELEMENT_ID;
  const canLink = !locked && (access.canEdit || (canEditModel && access.canPropose));

  const items = useMemo(
    () => (grc.data?.items ?? []).filter((i) => i.bpmnElementId === target),
    [grc.data, target],
  );
  const summary = useMemo(
    () => summariseSteps(grc.data?.items ?? []).get(target),
    [grc.data, target],
  );
  const refresh = () => qc.invalidateQueries({ queryKey: grcKeys.process(processId) });

  const link = (repoObjectId: string) =>
    createLink.mutate(
      { bpmnElementId: target, repoObjectId },
      {
        onSuccess: () => {
          setPick(null);
          void refresh();
        },
        onError: (err) => message.error(errorMessage(err)),
      },
    );
  const unlink = (linkId: string) =>
    deleteLink.mutate(linkId, {
      onSuccess: () => void refresh(),
      onError: (err) => message.error(errorMessage(err)),
    });

  const section = (kind: GrcObjectType, extra: (i: Item) => React.ReactNode) => {
    const list = items.filter((i) => i.type === kind);
    return (
      <div className="ph-panel-section" data-testid={`grc-step-${kind}`}>
        <Typography.Text strong>{t(`grc:register.${kind}.title`)}</Typography.Text>
        {list.length === 0 ? (
          <Typography.Paragraph type="secondary" style={{ marginBlock: 4 }}>
            {t('grc:detail.noneLinked')}
          </Typography.Paragraph>
        ) : (
          <List
            size="small"
            dataSource={list}
            renderItem={(i) => (
              <List.Item
                actions={
                  canLink
                    ? [
                        <Button
                          key="unlink"
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label={t('delete')}
                          title={t('delete')}
                          onClick={() => unlink(i.linkId)}
                        />,
                      ]
                    : undefined
                }
              >
                <Space direction="vertical" size={2} style={{ minInlineSize: 0 }}>
                  <Link to={grcItemPath(i.type, i.id)}>
                    {i.code && <span dir="ltr">{i.code} · </span>}
                    {loc(i)}
                  </Link>
                  <Space size={4} wrap>
                    {extra(i)}
                    {i.status !== 'ACTIVE' && <GrcStatusTag status={i.status} />}
                  </Space>
                </Space>
              </List.Item>
            )}
          />
        )}
      </div>
    );
  };

  if (!access.canRead) return null;
  return (
    <div className="ph-grc-panel" data-testid="grc-step-panel">
      <Typography.Paragraph type="secondary" style={{ marginBlockEnd: 8 }}>
        {elementId ? elementName : t('grc:detail.wholeProcess')}
      </Typography.Paragraph>
      {summary?.alert && (
        <Alert
          type="error"
          showIcon
          style={{ marginBlockEnd: 8 }}
          message={t('modeler:badges.ALERT', {
            count: items.filter((i) => i.rating?.alert && !i.effectivelyControlled).length,
          })}
        />
      )}
      {!items.length && !grc.isLoading && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('grc:detail.noneLinked')} />
      )}
      {items.length > 0 && (
        <>
          {section('RISK', (i) =>
            i.rating ? (
              <RatingTag score={i.rating.residualScore} band={i.rating.residualBand} />
            ) : null,
          )}
          {section('CONTROL', (i) => (
            <>
              {i.keyControl && <Tag color="purple">{t('grc:fields.keyControl')}</Tag>}
              {i.effectiveness && <EffectivenessTag value={i.effectiveness} />}
            </>
          ))}
          {section('REQUIREMENT', () => null)}
        </>
      )}
      {canLink && (
        <div className="ph-panel-section">
          <Typography.Text strong>
            <LinkOutlined /> {t('grc:panel.linkExisting')}
          </Typography.Text>
          <Segmented
            block
            size="small"
            style={{ marginBlock: 8 }}
            value={type}
            onChange={(v) => {
              setType(v as GrcObjectType);
              setPick(null);
            }}
            options={(['RISK', 'CONTROL', 'REQUIREMENT'] as const).map((k) => ({
              value: k,
              label: t(`grc:types.${k}`),
            }))}
          />
          <Flex gap={8}>
            <GrcItemSelect
              key={type}
              type={type}
              multiple={false}
              value={pick}
              onChange={(v) => setPick((v as string | null) ?? null)}
            />
            <Button
              type="primary"
              disabled={!pick}
              loading={createLink.isPending}
              onClick={() => pick && link(pick)}
            >
              {t('grc:panel.link')}
            </Button>
          </Flex>
          {elementId && (
            <Flex gap={8} wrap="wrap" style={{ marginBlockStart: 8 }}>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setCreating('RISK')}>
                {t(`grc:register.RISK.${access.canEdit ? 'new' : 'propose'}`)}
              </Button>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setCreating('CONTROL')}>
                {t(`grc:register.CONTROL.${access.canEdit ? 'new' : 'propose'}`)}
              </Button>
            </Flex>
          )}
        </div>
      )}
      {creating && (
        <GrcFormModal
          type={creating}
          open
          preset={access.canEdit ? {} : { status: 'DRAFT' }}
          onClose={() => setCreating(null)}
          onSaved={(saved) => link(saved.id)}
        />
      )}
    </div>
  );
}
