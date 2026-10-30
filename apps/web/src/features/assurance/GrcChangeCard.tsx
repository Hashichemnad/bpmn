import { useState } from 'react';
import { App, Alert, Button, Card, Flex, Input, Space, Steps, Table, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { GrcChangeDto, GrcChangeFieldDto } from '@processhub/shared';
import { useDecideGrcChange, useWithdrawGrcChange } from '@/api/assurance';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { useCategoryName } from '@/features/grc/grc-helpers';

const ENUM_FIELDS: Record<string, string> = {
  status: 'status',
  response: 'response',
  controlType: 'controlType',
  nature: 'nature',
  frequency: 'frequency',
  effectiveness: 'effectiveness',
};

/** Renders one before / after value of a proposed change. */
function useChangeValue() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const categoryName = useCategoryName();
  const formatDate = useFormatDate();
  return (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (Array.isArray(v)) return v.map((x) => show(x)).join(', ') || '—';
    return show(v);
    function show(x: unknown): string {
      if (x && typeof x === 'object' && 'en' in x) {
        const l = x as { en: string; ar: string };
        return loc({ nameEn: l.en, nameAr: l.ar });
      }
      if (typeof x === 'boolean') return t(x ? 'assurance:yes' : 'assurance:no');
      if (ENUM_FIELDS[field]) return t(`grc:${ENUM_FIELDS[field]}.${String(x)}`);
      if (field === 'category') return categoryName(String(x));
      if (field === 'nextReviewAt') return formatDate(String(x), false);
      return String(x);
    }
  };
}

/** Before / after table of a proposed change. */
export function ChangeFieldsTable({ fields }: { fields: GrcChangeFieldDto[] }) {
  const { t } = useTranslation();
  const value = useChangeValue();
  return (
    <Table
      size="small"
      pagination={false}
      rowKey="field"
      dataSource={fields}
      data-testid="change-fields"
      columns={[
        {
          title: t('assurance:changes.field'),
          dataIndex: 'field',
          render: (f: string) => t(`assurance:changes.fields.${f}`, { defaultValue: f }),
        },
        {
          title: t('assurance:changes.before'),
          render: (_, f) => (
            <Typography.Text delete type="secondary">
              {value(f.field, f.from)}
            </Typography.Text>
          ),
        },
        {
          title: t('assurance:changes.after'),
          render: (_, f) => <Typography.Text strong>{value(f.field, f.to)}</Typography.Text>,
        },
      ]}
    />
  );
}

/** A change of an active risk or control waiting for approval: before / after, steps, decision. */
export function GrcChangeCard({ change }: { change: GrcChangeDto }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const decide = useDecideGrcChange();
  const withdraw = useWithdrawGrcChange();
  const [comment, setComment] = useState('');
  const person = (u: GrcChangeDto['submittedBy']) => (u ? loc(u) || u.email : '—');
  const onError = (err: unknown) => message.error(errorMessage(err));

  return (
    <Card
      data-testid="grc-change"
      style={{ marginBlockEnd: 16, borderColor: '#faad14' }}
      title={
        <Space wrap>
          {t('assurance:changes.pendingTitle')}
          <Tag color="gold">{t(`assurance:changes.status.${change.status}`)}</Tag>
        </Space>
      }
      extra={
        change.canWithdraw && (
          <Button
            size="small"
            loading={withdraw.isPending}
            onClick={() =>
              withdraw.mutate(change.id, {
                onSuccess: () => message.success(t('assurance:changes.withdrawn')),
                onError,
              })
            }
          >
            {t('assurance:changes.withdraw')}
          </Button>
        )
      }
    >
      <Alert type="info" showIcon message={t('assurance:changes.inForce')} />
      <Typography.Paragraph type="secondary" style={{ marginBlock: 12 }}>
        {t('assurance:changes.submittedBy', {
          name: person(change.submittedBy),
          date: formatDate(change.submittedAt),
        })}
        {change.comment && ` — ${change.comment}`}
      </Typography.Paragraph>
      <ChangeFieldsTable fields={change.fields} />
      <Steps
        size="small"
        style={{ marginBlock: 16 }}
        current={change.currentStep}
        items={change.steps.map((s) => ({
          title: loc(s),
          description: s.tasks
            .map(
              (x) =>
                `${x.assignee ? loc(x.assignee) || x.assignee.email : '—'}: ${t(`assurance:changes.task.${x.status}`)}`,
            )
            .join(' · '),
        }))}
      />
      {change.canDecide && (
        <Flex gap={8} wrap="wrap">
          <Input.TextArea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('assurance:changes.commentPlaceholder')}
            autoSize={{ minRows: 1, maxRows: 4 }}
            maxLength={2000}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Button
            type="primary"
            data-testid="change-approve"
            loading={decide.isPending}
            onClick={() =>
              decide.mutate(
                { id: change.id, body: { decision: 'APPROVE', comment: comment || undefined } },
                { onSuccess: () => message.success(t('assurance:changes.approved')), onError },
              )
            }
          >
            {t('assurance:changes.approve')}
          </Button>
          <Button
            danger
            loading={decide.isPending}
            onClick={() =>
              decide.mutate(
                { id: change.id, body: { decision: 'REJECT', comment: comment || undefined } },
                { onSuccess: () => message.success(t('assurance:changes.rejected')), onError },
              )
            }
          >
            {t('assurance:changes.reject')}
          </Button>
        </Flex>
      )}
    </Card>
  );
}
