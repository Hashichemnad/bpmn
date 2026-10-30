import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  TreeSelect,
  Typography,
} from 'antd';
import { useTranslation } from 'react-i18next';
import type { Dayjs } from 'dayjs';
import type {
  AuditFindingDto,
  AuditWorkItemDto,
  CreateFindingInput,
  FindingResponseInput,
} from '@processhub/shared';
import { useAssuranceSettings } from '@/api/assurance';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { UserSelect } from '@/features/governance/UserSelect';
import { GrcItemSelect } from '@/features/grc/GrcItemSelect';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';
import { IssueStatusTag, ResponseTag, SeverityTag } from './assurance-tags';

const TEXT_FIELDS = ['condition', 'criteria', 'cause', 'effect', 'recommendation'] as const;
const one = (v: string[] | string | null) => (Array.isArray(v) ? (v[0] ?? null) : v);

/** Create / edit a finding: rating, condition, criteria, cause, effect, recommendation, trace. */
export function FindingFormModal({
  finding,
  items,
  onSave,
  saving,
  onClose,
}: {
  finding?: AuditFindingDto;
  items: AuditWorkItemDto[];
  onSave: (body: CreateFindingInput) => void;
  saving: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const settings = useAssuranceSettings();
  const processes = useProcessTreeOptions('');
  const [form] = Form.useForm<CreateFindingInput>();
  useEffect(() => {
    if (finding)
      form.setFieldsValue({
        ...finding,
        processId: finding.process?.id ?? null,
        riskId: finding.risk?.id ?? null,
        controlId: finding.control?.id ?? null,
        requirementId: finding.requirement?.id ?? null,
        responseOwnerId: finding.responseOwner?.id ?? null,
      } as never);
    else form.setFieldsValue({ rating: 'MEDIUM' });
  }, [form, finding]);
  const known = (r: AuditFindingDto['risk'], type: 'RISK' | 'CONTROL' | 'REQUIREMENT') =>
    r ? [{ ...r, type, status: 'ACTIVE' as const }] : [];
  return (
    <Modal
      open
      width={860}
      title={t(finding ? 'assurance:audits.editFinding' : 'assurance:audits.addFinding')}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={t('save')}
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={onSave} data-testid="finding-form">
        <Space wrap size={16} style={{ width: '100%' }}>
          <Form.Item name="titleEn" label={t('assurance:issues.titleEn')} style={{ width: 380 }}>
            <Input dir="ltr" />
          </Form.Item>
          <Form.Item name="titleAr" label={t('assurance:issues.titleAr')} style={{ width: 380 }}>
            <Input dir="rtl" />
          </Form.Item>
          <Form.Item
            name="rating"
            label={t('assurance:audits.rating')}
            rules={[{ required: true }]}
          >
            <Select
              style={{ width: 180 }}
              options={(settings.data?.severities ?? []).map((s) => ({
                value: s.key,
                label: loc(s),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="responseOwnerId"
            label={t('assurance:audits.responseOwner')}
            style={{ width: 300 }}
          >
            <UserSelect allowClear known={finding?.responseOwner ? [finding.responseOwner] : []} />
          </Form.Item>
        </Space>
        {TEXT_FIELDS.map((f) => (
          <Space key={f} wrap size={16} style={{ width: '100%' }}>
            <Form.Item
              name={`${f}En`}
              label={`${t(`assurance:audits.${f}`)} (EN)`}
              style={{ width: 380 }}
            >
              <Input.TextArea dir="ltr" autoSize={{ minRows: 2 }} />
            </Form.Item>
            <Form.Item
              name={`${f}Ar`}
              label={`${t(`assurance:audits.${f}`)} (AR)`}
              style={{ width: 380 }}
            >
              <Input.TextArea dir="rtl" autoSize={{ minRows: 2 }} />
            </Form.Item>
          </Space>
        ))}
        <Typography.Title level={5}>{t('assurance:audits.trace')}</Typography.Title>
        <Space wrap size={16} style={{ width: '100%' }}>
          <Form.Item name="processId" label={t('assurance:issues.process')} style={{ width: 380 }}>
            <TreeSelect
              allowClear
              showSearch
              treeNodeFilterProp="title"
              treeData={processes.options}
            />
          </Form.Item>
          <Form.Item
            name="bpmnElementId"
            label={t('assurance:audits.stepId')}
            style={{ width: 200 }}
            extra={t('assurance:audits.stepIdHint')}
          >
            <Input dir="ltr" />
          </Form.Item>
          <Form.Item
            name="workItemId"
            label={t('assurance:audits.workItem')}
            style={{ width: 300 }}
          >
            <Select
              allowClear
              options={items.map((i) => ({ value: i.id, label: loc(i, 'title') }))}
            />
          </Form.Item>
        </Space>
        <Space wrap size={16}>
          <Form.Item
            name="riskId"
            label={t('grc:types.RISK')}
            getValueFromEvent={one}
            style={{ width: 240 }}
          >
            <GrcItemSelect
              type="RISK"
              multiple={false}
              known={known(finding?.risk ?? null, 'RISK')}
            />
          </Form.Item>
          <Form.Item
            name="controlId"
            label={t('grc:types.CONTROL')}
            getValueFromEvent={one}
            style={{ width: 240 }}
          >
            <GrcItemSelect
              type="CONTROL"
              multiple={false}
              known={known(finding?.control ?? null, 'CONTROL')}
            />
          </Form.Item>
          <Form.Item
            name="requirementId"
            label={t('assurance:audits.criteriaRequirement')}
            getValueFromEvent={one}
            style={{ width: 240 }}
          >
            <GrcItemSelect
              type="REQUIREMENT"
              multiple={false}
              known={known(finding?.requirement ?? null, 'REQUIREMENT')}
            />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}

/** Management response: agree with an action and target date (creates an issue) or disagree. */
export function ResponseModal({
  finding,
  onSave,
  saving,
  onClose,
}: {
  finding: AuditFindingDto;
  onSave: (body: FindingResponseInput) => void;
  saving: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<FindingResponseInput & { target?: Dayjs | null }>();
  const [status, setStatus] = useState<'ACCEPTED' | 'DISAGREED'>('ACCEPTED');
  return (
    <Modal
      open
      title={t('assurance:audits.respond')}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        data-testid="response-form"
        initialValues={{ status: 'ACCEPTED' }}
        onFinish={(v) => {
          const { target, ...rest } = v;
          onSave({
            ...rest,
            comment: rest.comment ?? '',
            targetDate: target ? target.format('YYYY-MM-DD') : null,
          });
        }}
      >
        <Form.Item name="status">
          <Radio.Group
            onChange={(e) => setStatus(e.target.value)}
            optionType="button"
            options={[
              { value: 'ACCEPTED', label: t('assurance:audits.agree') },
              { value: 'DISAGREED', label: t('assurance:audits.disagree') },
            ]}
          />
        </Form.Item>
        {status === 'ACCEPTED' && (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBlockEnd: 12 }}
              message={t('assurance:audits.agreeHint')}
            />
            <Form.Item name="agreedActionEn" label={`${t('assurance:audits.agreedAction')} (EN)`}>
              <Input.TextArea dir="ltr" autoSize={{ minRows: 2 }} />
            </Form.Item>
            <Form.Item name="agreedActionAr" label={`${t('assurance:audits.agreedAction')} (AR)`}>
              <Input.TextArea dir="rtl" autoSize={{ minRows: 2 }} />
            </Form.Item>
            <Form.Item
              name="target"
              label={t('assurance:audits.targetDate')}
              rules={[{ required: true }]}
            >
              <DatePicker />
            </Form.Item>
            <Form.Item
              name="ownerId"
              label={t('assurance:audits.actionOwner')}
              extra={t('assurance:audits.actionOwnerHint')}
            >
              <UserSelect allowClear known={finding.responseOwner ? [finding.responseOwner] : []} />
            </Form.Item>
          </>
        )}
        <Form.Item
          name="comment"
          label={t('assurance:audits.responseComment')}
          rules={status === 'DISAGREED' ? [{ required: true }] : []}
        >
          <Input.TextArea autoSize={{ minRows: 2 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** A finding with its root-cause trace and the management response. */
export function FindingCard({
  finding: f,
  onEdit,
  onRespond,
  highlight,
  links = true,
}: {
  finding: AuditFindingDto;
  onEdit?: () => void;
  onRespond?: () => void;
  highlight?: boolean;
  links?: boolean;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const ref = (
    path: string,
    r: { id: string; code: string | null; nameEn: string; nameAr: string } | null,
  ) =>
    r ? (
      links ? (
        <Link to={`${path}/${r.id}`}>{[r.code, loc(r)].filter(Boolean).join(' ')}</Link>
      ) : (
        [r.code, loc(r)].filter(Boolean).join(' ')
      )
    ) : (
      '—'
    );
  return (
    <Card
      id={`finding-${f.id}`}
      data-testid={`finding-${f.code}`}
      size="small"
      style={{ marginBlockEnd: 12, borderColor: highlight ? '#1d4ed8' : undefined }}
      title={
        <Space wrap>
          <span dir="ltr">{f.code}</span>
          {loc(f, 'title')}
          <SeverityTag value={f.rating} />
          <ResponseTag value={f.responseStatus} />
        </Space>
      }
      extra={
        <Space>
          {onRespond && f.canRespond && (
            <Button
              size="small"
              type="primary"
              data-testid={`respond-${f.code}`}
              onClick={onRespond}
            >
              {t('assurance:audits.respond')}
            </Button>
          )}
          {onEdit && !f.issue && (
            <Button size="small" onClick={onEdit}>
              {t('edit')}
            </Button>
          )}
        </Space>
      }
    >
      <Descriptions
        size="small"
        column={1}
        items={[
          ...TEXT_FIELDS.map((k) => ({
            key: k,
            label: t(`assurance:audits.${k}`),
            children: <span style={{ whiteSpace: 'pre-wrap' }}>{loc(f, k) || '—'}</span>,
          })),
          {
            key: 'trace',
            label: t('assurance:audits.trace'),
            children: (
              <Space direction="vertical" size={0}>
                <span>
                  {t('assurance:issues.process')}: {ref('/processes', f.process)}
                  {f.elementLabel && ` › ${loc(f.elementLabel)}`}
                </span>
                <span>
                  {t('grc:types.RISK')}: {ref('/grc/risks', f.risk)}
                </span>
                <span>
                  {t('grc:types.CONTROL')}: {ref('/grc/controls', f.control)}
                </span>
                <span>
                  {t('grc:types.REQUIREMENT')}: {ref('/grc/requirements', f.requirement)}
                </span>
              </Space>
            ),
          },
          {
            key: 'response',
            label: t('assurance:audits.managementResponse'),
            children: (
              <Space direction="vertical" size={0}>
                <span>
                  {t('assurance:audits.responseOwner')}:{' '}
                  {f.responseOwner ? loc(f.responseOwner) || f.responseOwner.email : '—'}
                </span>
                {f.responseStatus !== 'PENDING' && (
                  <>
                    {loc(f, 'agreedAction') && (
                      <span>
                        {t('assurance:audits.agreedAction')}: {loc(f, 'agreedAction')}
                      </span>
                    )}
                    {f.targetDate && (
                      <span>
                        {t('assurance:audits.targetDate')}: {formatDate(f.targetDate, false)}
                      </span>
                    )}
                    {f.responseComment && (
                      <span>
                        {t('assurance:audits.responseComment')}: {f.responseComment}
                      </span>
                    )}
                  </>
                )}
                {f.issue && (
                  <span>
                    {t('assurance:audits.followUpIssue')}:{' '}
                    <Link to={`/grc/issues/${f.issue.id}`} dir="ltr">
                      {f.issue.code}
                    </Link>{' '}
                    <IssueStatusTag status={f.issue.status} />
                  </span>
                )}
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}
