import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Flex,
  Input,
  List,
  Row,
  Space,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, LinkOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  PROCESS_ELEMENT_ID,
  type ControlDto,
  type GrcActivityDto,
  type GrcObjectType,
  type GrcRef,
  type GrcStepLinkDto,
  type RequirementDto,
  type RiskDto,
} from '@processhub/shared';
import { useAddGrcComment, useDeleteGrcItem, useGrcItem, useGrcTimeline } from '@/api/grc';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { GrcFormModal } from './GrcFormModal';
import { RiskMatrix } from './RiskMatrix';
import { GRC_ROUTES, grcItemPath, stepHref, useCategoryName, useGrcAccess } from './grc-helpers';
import { EffectivenessTag, GrcStatusTag, OverdueTag, RatingTag } from './grc-tags';

function RefList({
  type,
  items,
  extra,
}: {
  type: GrcObjectType;
  items: GrcRef[];
  extra?: (r: GrcRef) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  if (!items.length)
    return <Typography.Text type="secondary">{t('grc:detail.noneLinked')}</Typography.Text>;
  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(r) => (
        <List.Item extra={extra?.(r)}>
          <Space size={6} wrap>
            {r.code && (
              <Typography.Text type="secondary" dir="ltr">
                {r.code}
              </Typography.Text>
            )}
            <Link to={grcItemPath(type, r.id)}>{loc(r)}</Link>
            {r.status !== 'ACTIVE' && <GrcStatusTag status={r.status} />}
          </Space>
        </List.Item>
      )}
    />
  );
}

/** Assessment history and comments, newest first. */
export function GrcTimeline({ id, canComment }: { id: string; canComment: boolean }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const timeline = useGrcTimeline(id);
  const add = useAddGrcComment(id);
  const [text, setText] = useState('');

  const value = (field: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return '—';
    if (field === 'status') return t(`grc:status.${String(v)}`);
    if (field === 'effectiveness') return t(`grc:effectiveness.${String(v)}`);
    return String(v);
  };
  const fieldName = (f: string) =>
    ({
      inherentLikelihood: `${t('grc:fields.inherent')} — ${t('grc:fields.likelihood')}`,
      inherentImpact: `${t('grc:fields.inherent')} — ${t('grc:fields.impact')}`,
      residualLikelihood: `${t('grc:fields.residual')} — ${t('grc:fields.likelihood')}`,
      residualImpact: `${t('grc:fields.residual')} — ${t('grc:fields.impact')}`,
      effectiveness: t('grc:fields.effectiveness'),
      status: t('grc:fields.status'),
    })[f] ?? f;
  const colour: Record<GrcActivityDto['kind'], string> = {
    CREATED: 'blue',
    ASSESSMENT: 'orange',
    STATUS: 'purple',
    COMMENT: 'gray',
  };

  return (
    <Card title={t('grc:detail.timeline')} data-testid="grc-timeline">
      {canComment && (
        <Flex gap={8} style={{ marginBlockEnd: 16 }}>
          <Input.TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('grc:detail.commentPlaceholder')}
            autoSize={{ minRows: 1, maxRows: 4 }}
            maxLength={4000}
          />
          <Button
            type="primary"
            disabled={!text.trim()}
            loading={add.isPending}
            onClick={() =>
              add.mutate(text.trim(), {
                onSuccess: () => setText(''),
                onError: (err) => message.error(errorMessage(err)),
              })
            }
          >
            {t('grc:detail.addComment')}
          </Button>
        </Flex>
      )}
      {!timeline.data?.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('grc:detail.noActivity')} />
      ) : (
        <Timeline
          className="ph-grc-timeline"
          items={timeline.data.map((a) => ({
            color: colour[a.kind],
            children: (
              <div>
                <Space size={6} wrap>
                  <Typography.Text strong>{t(`grc:activity.${a.kind}`)}</Typography.Text>
                  <Typography.Text type="secondary">
                    {a.author ? loc(a.author) || a.author.email : '—'} · {formatDate(a.createdAt)}
                  </Typography.Text>
                </Space>
                {Object.entries(a.changes)
                  .filter(([, c]) => a.kind !== 'CREATED' || c.to !== null)
                  .map(([f, c]) => (
                    <div key={f} className="ph-grc-change">
                      {fieldName(f)}:{' '}
                      {a.kind !== 'CREATED' && (
                        <>
                          <span>{value(f, c.from)}</span> <span aria-hidden>→</span>{' '}
                        </>
                      )}
                      <strong>{value(f, c.to)}</strong>
                    </div>
                  ))}
                {a.comment && (
                  <Typography.Paragraph style={{ marginBlock: 4, whiteSpace: 'pre-wrap' }}>
                    {a.comment}
                  </Typography.Paragraph>
                )}
              </div>
            ),
          }))}
        />
      )}
    </Card>
  );
}

export function GrcStepsCard({ steps }: { steps: GrcStepLinkDto[] }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  return (
    <Card title={t('grc:detail.linkedSteps')} data-testid="grc-steps">
      {!steps.length ? (
        <Typography.Text type="secondary">{t('grc:detail.noSteps')}</Typography.Text>
      ) : (
        <List
          size="small"
          dataSource={steps}
          renderItem={(s) => (
            <List.Item
              extra={
                <Link to={stepHref(s)}>
                  <LinkOutlined /> {t('grc:detail.openInModeler')}
                </Link>
              }
            >
              <Space direction="vertical" size={0}>
                <Typography.Text>
                  {s.bpmnElementId === PROCESS_ELEMENT_ID
                    ? t('grc:detail.wholeProcess')
                    : (s.element && loc(s.element)) || s.bpmnElementId}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  <span dir="ltr">{s.process.code}</span> {loc(s.process)}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}

/** Detail page of a risk, control or requirement. */
export function GrcDetailPage({ type }: { type: GrcObjectType }) {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const errorMessage = useErrorMessage();
  const access = useGrcAccess();
  const categoryName = useCategoryName();
  const detail = useGrcItem(type, id);
  const remove = useDeleteGrcItem(type);
  const [editing, setEditing] = useState(false);

  if (detail.isLoading) return <LoadingState />;
  if (detail.isError || !detail.data)
    return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  const { item, steps } = detail.data;
  const person = (u: typeof item.owner) => (u ? loc(u) || u.email : '—');

  const confirmDelete = () =>
    modal.confirm({
      title: t('grc:detail.deleteConfirm', { name: loc(item) }),
      okButtonProps: { danger: true },
      okText: t('delete'),
      onOk: () =>
        remove.mutateAsync(item.id).then(
          () => {
            message.success(t('grc:detail.deleted'));
            navigate(GRC_ROUTES[type]);
          },
          (err) => message.error(errorMessage(err)),
        ),
    });

  const common = [
    { key: 'owner', label: t('grc:fields.owner'), children: person(item.owner) },
    {
      key: 'dept',
      label: t('grc:fields.department'),
      children: item.department ? loc(item.department) : '—',
    },
    {
      key: 'review',
      label: t('grc:fields.nextReview'),
      children: (
        <Space size={4}>
          {formatDate(item.nextReviewAt, false)}
          {item.overdue && <OverdueTag />}
        </Space>
      ),
    },
  ];

  let specific: { key: string; label: string; children: React.ReactNode }[] = [];
  let relations: React.ReactNode = null;
  let side: React.ReactNode = null;
  if (item.type === 'RISK') {
    const r = item as RiskDto;
    specific = [
      { key: 'cat', label: t('grc:fields.category'), children: categoryName(r.category) },
      { key: 'resp', label: t('grc:fields.response'), children: t(`grc:response.${r.response}`) },
      {
        key: 'inh',
        label: t('grc:fields.inherentRating'),
        children: (
          <Space wrap>
            <RatingTag score={r.rating.inherentScore} band={r.rating.inherentBand} />
            <Typography.Text type="secondary">
              {t('grc:fields.likelihood')} {r.inherentLikelihood} × {t('grc:fields.impact')}{' '}
              {r.inherentImpact}
            </Typography.Text>
          </Space>
        ),
      },
      {
        key: 'res',
        label: t('grc:fields.residualRating'),
        children: (
          <Space wrap>
            <RatingTag score={r.rating.residualScore} band={r.rating.residualBand} />
            {r.residualLikelihood ? (
              <Typography.Text type="secondary">
                {t('grc:fields.likelihood')} {r.residualLikelihood} × {t('grc:fields.impact')}{' '}
                {r.residualImpact}
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary">{t('grc:fields.residualHint')}</Typography.Text>
            )}
          </Space>
        ),
      },
      { key: 'cause', label: t('grc:fields.cause'), children: loc(r, 'cause') || '—' },
      { key: 'cons', label: t('grc:fields.consequence'), children: loc(r, 'consequence') || '—' },
    ];
    relations = (
      <Card
        title={t('grc:detail.mitigatedBy')}
        extra={
          <Tag color={r.effectivelyControlled ? 'green' : 'red'}>
            {t(
              r.effectivelyControlled
                ? 'grc:detail.effectivelyControlled'
                : 'grc:detail.notControlled',
            )}
          </Tag>
        }
      >
        <RefList
          type="CONTROL"
          items={r.controls}
          extra={(c) => {
            const ctl = r.controls.find((x) => x.id === c.id)!;
            return (
              <Space size={4}>
                {ctl.keyControl && <Tag color="purple">{t('grc:fields.keyControl')}</Tag>}
                <EffectivenessTag value={ctl.effectiveness} />
              </Space>
            );
          }}
        />
      </Card>
    );
    const cells = (l: number, i: number) => {
      const m = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 0));
      m[l - 1][i - 1] = 1;
      return m;
    };
    side = (
      <div className="ph-grc-matrices">
        <RiskMatrix
          title={t('grc:matrix.inherent')}
          cells={cells(r.inherentLikelihood, r.inherentImpact)}
        />
        <RiskMatrix
          title={t('grc:matrix.residual')}
          cells={cells(
            r.residualLikelihood ?? r.inherentLikelihood,
            r.residualImpact ?? r.inherentImpact,
          )}
        />
      </div>
    );
  } else if (item.type === 'CONTROL') {
    const c = item as ControlDto;
    specific = [
      {
        key: 'type',
        label: t('grc:fields.controlType'),
        children: t(`grc:controlType.${c.controlType}`),
      },
      { key: 'nature', label: t('grc:fields.nature'), children: t(`grc:nature.${c.nature}`) },
      {
        key: 'freq',
        label: t('grc:fields.frequency'),
        children: t(`grc:frequency.${c.frequency}`),
      },
      {
        key: 'key',
        label: t('grc:fields.keyControl'),
        children: c.keyControl ? t('grc:yes') : t('grc:no'),
      },
      {
        key: 'sys',
        label: t('grc:fields.system'),
        children: c.system ? (
          <Link to={`/library/objects/${c.system.id}`}>{loc(c.system)}</Link>
        ) : (
          '—'
        ),
      },
      {
        key: 'eff',
        label: t('grc:fields.effectiveness'),
        children: <EffectivenessTag value={c.effectiveness} />,
      },
      {
        key: 'assessed',
        label: t('grc:fields.lastAssessed'),
        children: formatDate(c.lastAssessedAt, false),
      },
    ];
    relations = (
      <>
        <Card title={t('grc:detail.mitigates')} style={{ marginBlockEnd: 16 }}>
          <RefList
            type="RISK"
            items={c.risks}
            extra={(r) => {
              const risk = c.risks.find((x) => x.id === r.id)!;
              return (
                <RatingTag score={risk.rating.residualScore} band={risk.rating.residualBand} />
              );
            }}
          />
        </Card>
        <Card title={t('grc:detail.satisfies')}>
          <RefList type="REQUIREMENT" items={c.requirements} />
        </Card>
      </>
    );
  } else {
    const q = item as RequirementDto;
    specific = [
      { key: 'level', label: t('grc:fields.level'), children: t(`grc:level.${q.level}`) },
      {
        key: 'parent',
        label: t('grc:fields.parent'),
        children: q.parent ? (
          <Link to={grcItemPath('REQUIREMENT', q.parent.id)}>{loc(q.parent)}</Link>
        ) : (
          '—'
        ),
      },
      { key: 'src', label: t('grc:fields.sourceRef'), children: q.sourceRef || '—' },
      {
        key: 'url',
        label: t('grc:fields.url'),
        children: q.url ? (
          <a href={q.url} target="_blank" rel="noopener noreferrer" dir="ltr">
            {q.url}
          </a>
        ) : (
          '—'
        ),
      },
      {
        key: 'eff',
        label: t('grc:fields.effectiveDate'),
        children: formatDate(q.effectiveDate, false),
      },
    ];
    relations = (
      <>
        <Card title={t('grc:detail.satisfiedBy')} style={{ marginBlockEnd: 16 }}>
          <RefList
            type="CONTROL"
            items={q.controls}
            extra={(c) => (
              <EffectivenessTag value={q.controls.find((x) => x.id === c.id)!.effectiveness} />
            )}
          />
        </Card>
        {q.childCount > 0 && (
          <Card title={t('grc:detail.children')}>
            <Link to={`${GRC_ROUTES.REQUIREMENT}?parentId=${q.id}`}>{q.childCount}</Link>
          </Card>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('nav.grcGroup') },
          { title: t(`grc:register.${type}.title`), to: GRC_ROUTES[type] },
          { title: loc(item) },
        ]}
        title={loc(item)}
        subtitle={
          <Space size={6} wrap>
            <Tag>{t(`grc:types.${type}`)}</Tag>
            <GrcStatusTag status={item.status} />
            {item.code && <span dir="ltr">{item.code}</span>}
          </Space>
        }
        extra={
          <Flex gap={8} wrap="wrap">
            {access.canChange(item) && (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {t('edit')}
              </Button>
            )}
            {access.canDelete(item) && (
              <Button danger icon={<DeleteOutlined />} onClick={confirmDelete}>
                {t('delete')}
              </Button>
            )}
          </Flex>
        }
      />
      {item.status === 'DRAFT' && (
        <Typography.Paragraph type="warning">{t('grc:detail.proposal')}</Typography.Paragraph>
      )}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card style={{ marginBlockEnd: 16 }}>
            {loc(item, 'description') && (
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                {loc(item, 'description')}
              </Typography.Paragraph>
            )}
            <Descriptions
              column={{ xs: 1, sm: 1, md: 1, lg: 1, xl: 2, xxl: 2 }}
              size="small"
              items={[...specific, ...common]}
            />
          </Card>
          {side && <Card style={{ marginBlockEnd: 16 }}>{side}</Card>}
          <GrcTimeline id={item.id} canComment={access.canComment} />
        </Col>
        <Col xs={24} lg={10}>
          <div style={{ marginBlockEnd: 16 }}>{relations}</div>
          <GrcStepsCard steps={steps} />
        </Col>
      </Row>
      {editing && <GrcFormModal type={type} item={item} open onClose={() => setEditing(false)} />}
    </>
  );
}
