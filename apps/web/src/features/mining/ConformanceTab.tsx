import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Flex,
  Input,
  Modal,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { DeviationDto, EventLogDto, StepSuggestionDto } from '@processhub/shared';
import {
  useApplySuggestions,
  useConformance,
  useLogActivities,
  useStepSuggestions,
} from '@/api/mining';
import { useLocale } from '@/app/LocaleProvider';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatNumber } from '@/components/i18n-helpers';
import { pickLabel } from '@/features/modeler/labels';
import { useAnalysisState } from './analysis-state';
import { CaseDrawer } from './AnalysisTabs';
import { FilterBar } from './FilterBar';
import { JobProgress } from './mining-helpers';
import { usePercent } from './mining-utils';

const KIND_COLOUR = { SKIPPED: 'orange', INSERTED: 'purple', WRONG_ORDER: 'red' } as const;

/** Model vs reality for a log linked to a process: fitness, deviations, step time suggestions. */
export function ConformanceTab({ log }: { log: EventLogDto }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const fmtN = useFormatNumber();
  const pct = usePercent();
  const { filters } = useAnalysisState();
  const acts = useLogActivities(log.id);
  const q = useConformance(log.id, filters);
  const [caseId, setCaseId] = useState<string | null>(null);
  const stepName = useMemo(() => {
    const m = new Map((acts.data?.steps ?? []).map((s) => [s.id, pickLabel(s, locale) || s.id]));
    return (id: string | null) => (id ? (m.get(id) ?? id) : '—');
  }, [acts.data, locale]);
  const mapped = (acts.data?.items ?? []).filter((a) => a.elementId).length;

  if (!log.process)
    return <Alert type="info" showIcon message={t('mining:conformance.noProcess')} />;
  return (
    <Flex vertical gap={12}>
      <Card size="small">
        <Flex justify="space-between" wrap="wrap" gap={8}>
          <FilterBar logId={log.id} analysis={undefined} />
          <Link
            to={`/processes/${log.process.id}/model?view=1&colourBy=miningDeviations&log=${log.id}`}
          >
            <Button size="small" icon={<EyeOutlined />} data-testid="show-on-model">
              {t('mining:conformance.showOnModel')}
            </Button>
          </Link>
        </Flex>
      </Card>
      {mapped === 0 && (
        <Alert type="warning" showIcon message={t('mining:conformance.noMapping')} />
      )}
      {q.job && (q.job.status === 'QUEUED' || q.job.status === 'RUNNING') && (
        <Card size="small">
          <JobProgress job={q.job} canCancel={false} />
        </Card>
      )}
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <LoadingState />
      ) : (
        <>
          <Row gutter={[12, 12]} data-testid="conformance-summary">
            <Col xs={24} md={8}>
              <Card size="small">
                <Flex align="center" gap={16}>
                  <Progress
                    type="dashboard"
                    percent={Math.round(q.data.fitness * 1000) / 10}
                    size={96}
                  />
                  <Statistic title={t('mining:conformance.fitness')} value={pct(q.data.fitness)} />
                </Flex>
              </Card>
            </Col>
            <Col xs={12} md={8}>
              <Card size="small">
                <Statistic
                  title={t('mining:conformance.conforming')}
                  value={pct(q.data.conformingShare)}
                  suffix={
                    <Typography.Text type="secondary">
                      ({fmtN(q.data.conformingCases)} / {fmtN(q.data.cases)})
                    </Typography.Text>
                  }
                />
              </Card>
            </Col>
            <Col xs={12} md={8}>
              <Card size="small">
                <Statistic
                  title={t('mining:conformance.deviationTypes')}
                  value={fmtN(q.data.deviations.length)}
                />
              </Card>
            </Col>
          </Row>
          {q.data.unobserved.length > 0 && (
            <Alert
              type="info"
              showIcon
              message={t('mining:conformance.unobserved', {
                steps: q.data.unobserved.map(stepName).join(', '),
              })}
            />
          )}
          <Card size="small" title={t('mining:conformance.deviations')}>
            <Table<DeviationDto>
              size="small"
              data-testid="deviations"
              rowKey={(d) => `${d.kind}|${d.elementId}|${d.otherElementId}|${d.activity}`}
              dataSource={q.data.deviations}
              pagination={{ pageSize: 15, hideOnSinglePage: true }}
              columns={[
                {
                  title: t('mining:conformance.kind'),
                  width: 150,
                  render: (_, d) => (
                    <Tag color={KIND_COLOUR[d.kind]}>{t(`mining:conformance.kinds.${d.kind}`)}</Tag>
                  ),
                },
                {
                  title: t('mining:conformance.what'),
                  render: (_, d) =>
                    d.kind === 'WRONG_ORDER'
                      ? t('mining:conformance.wrongOrder', {
                          step: stepName(d.elementId),
                          other: stepName(d.otherElementId),
                        })
                      : d.kind === 'INSERTED'
                        ? d.elementId
                          ? t('mining:conformance.repeated', { step: stepName(d.elementId) })
                          : t('mining:conformance.inserted', { activity: d.activity })
                        : t('mining:conformance.skipped', { step: stepName(d.elementId) }),
                },
                {
                  title: t('mining:fields.cases'),
                  align: 'end',
                  width: 90,
                  render: (_, d) => fmtN(d.cases),
                },
                {
                  title: t('mining:conformance.share'),
                  width: 90,
                  render: (_, d) => pct(d.cases / Math.max(q.data!.cases, 1)),
                },
                {
                  title: t('mining:variants.examples'),
                  render: (_, d) => (
                    <Space wrap size={4}>
                      {d.exampleCases.map((c) => (
                        <Typography.Link key={c} onClick={() => setCaseId(c)}>
                          {c}
                        </Typography.Link>
                      ))}
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
          <Suggestions log={log} />
        </>
      )}
      <CaseDrawer logId={log.id} caseId={caseId} onClose={() => setCaseId(null)} />
    </Flex>
  );
}

/** Planned (model) vs measured (log) step times; accepted values become a new version (D-137). */
function Suggestions({ log }: { log: EventLogDto }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const fmtN = useFormatNumber();
  const list = useStepSuggestions(log.id);
  const apply = useApplySuggestions(log.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const items = list.data ?? [];
  const minutes = (v: number | null) =>
    v === null ? '—' : t('mining:units.minutes', { n: fmtN(v) });
  return (
    <Card
      size="small"
      title={t('mining:suggestions.title')}
      extra={
        log.process && (
          <Button
            size="small"
            type="primary"
            disabled={!selected.length}
            onClick={() => setNote(t('mining:suggestions.defaultNote', { code: log.code }))}
            data-testid="apply-suggestions"
          >
            {t('mining:suggestions.apply', { count: selected.length })}
          </Button>
        )
      }
    >
      <Typography.Paragraph type="secondary">{t('mining:suggestions.help')}</Typography.Paragraph>
      <Table<StepSuggestionDto>
        size="small"
        rowKey="elementId"
        loading={list.isLoading}
        dataSource={items}
        pagination={false}
        data-testid="step-suggestions"
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (k) => setSelected(k as string[]),
          getCheckboxProps: (s) => ({ disabled: !s.suggestDuration && !s.suggestWaiting }),
        }}
        columns={[
          {
            title: t('mining:activities.step'),
            render: (_, s) => pickLabel(s, locale) || s.elementId,
          },
          {
            title: t('mining:suggestions.observations'),
            align: 'end',
            width: 110,
            render: (_, s) => fmtN(s.observations),
          },
          {
            title: t('mining:suggestions.duration'),
            render: (_, s) => (
              <Space>
                {minutes(s.plannedDuration)} →{' '}
                <Typography.Text
                  strong={s.suggestDuration}
                  type={s.suggestDuration ? 'warning' : undefined}
                >
                  {minutes(s.measuredDuration)}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: t('mining:suggestions.waiting'),
            render: (_, s) => (
              <Space>
                {minutes(s.plannedWaiting)} →{' '}
                <Typography.Text
                  strong={s.suggestWaiting}
                  type={s.suggestWaiting ? 'warning' : undefined}
                >
                  {minutes(s.measuredWaiting)}
                </Typography.Text>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={note !== null}
        title={t('mining:suggestions.confirm')}
        okButtonProps={{ disabled: !note?.trim() }}
        confirmLoading={apply.isPending}
        onCancel={() => setNote(null)}
        onOk={() =>
          apply
            .mutateAsync({
              changeNote: note!.trim(),
              items: items
                .filter((s) => selected.includes(s.elementId))
                .map((s) => ({
                  elementId: s.elementId,
                  ...(s.suggestDuration ? { durationMinutes: s.measuredDuration } : {}),
                  ...(s.suggestWaiting ? { waitingMinutes: s.measuredWaiting } : {}),
                })),
            })
            .then(() => {
              setNote(null);
              setSelected([]);
              void message.success(t('mining:suggestions.applied'));
            })
            .catch((e: unknown) => void message.error(errorMessage(e)))
        }
      >
        <Typography.Paragraph>{t('mining:suggestions.confirmText')}</Typography.Paragraph>
        <Input.TextArea rows={2} value={note ?? ''} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </Card>
  );
}
