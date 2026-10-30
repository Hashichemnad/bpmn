import { useEffect } from 'react';
import {
  App,
  Col,
  DatePicker,
  Divider,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Switch,
  TreeSelect,
  Typography,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import {
  CONTROL_EFFECTIVENESS,
  CONTROL_FREQUENCIES,
  CONTROL_NATURES,
  CONTROL_TYPES,
  GRC_STATUSES,
  REQUIREMENT_LEVELS,
  RISK_RESPONSES,
  type ControlDto,
  type GrcItemDto,
  type GrcObjectType,
  type RequirementDto,
  type RiskDto,
} from '@processhub/shared';
import { useSaveGrcItem } from '@/api/grc';
import { useObjects } from '@/api/hooks';
import { BilingualFields } from '@/components/BilingualFields';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { UserSelect } from '@/features/governance/UserSelect';
import { useLocale } from '@/app/LocaleProvider';
import { GrcItemSelect } from './GrcItemSelect';
import { useGrcAccess, useGrcConfig } from './grc-helpers';

type Values = Record<string, unknown> & {
  nextReviewAt?: Dayjs | null;
  effectiveDate?: Dayjs | null;
};

const ids = (refs: { id: string }[] | undefined) => (refs ?? []).map((r) => r.id);

/** Initial form values of an item (or defaults for a new one). */
function initial(
  type: GrcObjectType,
  item: GrcItemDto | undefined,
  preset: Partial<Values>,
): Values {
  const date = (v: string | null | undefined) => (v ? dayjs(v) : null);
  if (!item)
    return type === 'RISK'
      ? {
          inherentLikelihood: 3,
          inherentImpact: 3,
          response: 'MITIGATE',
          status: 'ACTIVE',
          ...preset,
        }
      : type === 'CONTROL'
        ? {
            controlType: 'PREVENTIVE',
            nature: 'MANUAL',
            frequency: 'PER_TRANSACTION',
            keyControl: false,
            effectiveness: 'NOT_ASSESSED',
            status: 'ACTIVE',
            ...preset,
          }
        : { level: 'SOURCE', status: 'ACTIVE', ...preset };
  const common = {
    code: item.code,
    nameEn: item.nameEn,
    nameAr: item.nameAr,
    descriptionEn: item.descriptionEn,
    descriptionAr: item.descriptionAr,
    ownerId: item.owner?.id ?? null,
    departmentId: item.department?.id ?? null,
    status: item.status,
    nextReviewAt: date(item.nextReviewAt),
  };
  if (item.type === 'RISK') {
    const r = item as RiskDto;
    return {
      ...common,
      category: r.category,
      causeEn: r.causeEn,
      causeAr: r.causeAr,
      consequenceEn: r.consequenceEn,
      consequenceAr: r.consequenceAr,
      inherentLikelihood: r.inherentLikelihood,
      inherentImpact: r.inherentImpact,
      residualLikelihood: r.residualLikelihood,
      residualImpact: r.residualImpact,
      response: r.response,
      controlIds: ids(r.controls),
    };
  }
  if (item.type === 'CONTROL') {
    const c = item as ControlDto;
    return {
      ...common,
      controlType: c.controlType,
      nature: c.nature,
      frequency: c.frequency,
      keyControl: c.keyControl,
      systemId: c.system?.id ?? null,
      effectiveness: c.effectiveness,
      riskIds: ids(c.risks),
      requirementIds: ids(c.requirements),
    };
  }
  const q = item as RequirementDto;
  return {
    ...common,
    level: q.level,
    parentId: q.parent?.id ?? null,
    sourceRef: q.sourceRef,
    url: q.url,
    effectiveDate: date(q.effectiveDate),
    controlIds: ids(q.controls),
  };
}

/**
 * Create / edit form of a risk, control or requirement in both languages. Proposers (no
 * `grc.edit`) create drafts and cannot set status, effectiveness or requirement mappings.
 */
export function GrcFormModal({
  type,
  item,
  open,
  onClose,
  onSaved,
  preset = {},
}: {
  type: GrcObjectType;
  item?: GrcItemDto;
  open: boolean;
  onClose: () => void;
  onSaved?: (saved: GrcItemDto) => void;
  /** Values for a new item (e.g. created from the modeler). */
  preset?: Partial<Values>;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const loc = useLocalized();
  const { locale } = useLocale();
  const [form] = Form.useForm<Values>();
  const save = useSaveGrcItem(type);
  const access = useGrcAccess();
  const config = useGrcConfig();
  const departments = useDepartmentTreeData();
  const systems = useObjects(
    { type: 'SYSTEM', pageSize: 100, sort: 'nameEn' },
    open && type === 'CONTROL',
  );
  const editor = access.canEdit;
  const level = Form.useWatch('level', form);

  useEffect(() => {
    if (open) form.setFieldsValue(initial(type, item, preset) as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item, type]);

  const submit = async () => {
    const v = await form.validateFields();
    const body: Record<string, unknown> = { ...v };
    for (const k of ['nextReviewAt', 'effectiveDate'] as const) {
      if (k in v) body[k] = v[k] ? (v[k] as Dayjs).format('YYYY-MM-DD') : null;
    }
    if (!editor) {
      delete body.status;
      delete body.effectiveness;
      delete body.requirementIds;
      if (type !== 'RISK') delete body.riskIds;
    }
    if (type === 'RISK' && !body.controlIds) delete body.controlIds;
    save.mutate(
      { id: item?.id, body: body as never },
      {
        onSuccess: (res) => {
          message.success(
            'pendingChange' in res && res.pendingChange
              ? t('assurance:changes.submitted')
              : t('grc:detail.saved'),
          );
          onSaved?.(res.item);
          onClose();
        },
        onError: (err) => message.error(errorMessage(err)),
      },
    );
  };

  const options = (list: readonly string[], ns: string) =>
    list.map((v) => ({ value: v, label: t(`grc:${ns}.${v}`) }));
  const levelOptions = [1, 2, 3, 4, 5].map((n) => ({
    value: n,
    label: `${n} · ${locale === 'ar' ? config.likelihoodLabels[n - 1].ar : config.likelihoodLabels[n - 1].en}`,
  }));
  const impactOptions = [1, 2, 3, 4, 5].map((n) => ({
    value: n,
    label: `${n} · ${locale === 'ar' ? config.impactLabels[n - 1].ar : config.impactLabels[n - 1].en}`,
  }));
  const titleKey = item ? 'edit' : editor ? 'new' : 'propose';

  return (
    <Modal
      open={open}
      title={t(`grc:register.${type}.${titleKey}`)}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={t('save')}
      confirmLoading={save.isPending}
      width={860}
      destroyOnHidden
      forceRender
    >
      {!editor && !item && (
        <Typography.Paragraph type="secondary">{t('grc:detail.proposal')}</Typography.Paragraph>
      )}
      <Form form={form} layout="vertical" requiredMark="optional" data-testid="grc-form">
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="code" label={t('grc:fields.code')} rules={[{ max: 50 }]}>
              <Input dir="ltr" maxLength={50} />
            </Form.Item>
          </Col>
          {type === 'RISK' && (
            <Col xs={24} md={8}>
              <Form.Item
                name="category"
                label={t('grc:fields.category')}
                rules={[{ required: true }]}
              >
                <Select
                  options={config.categories.map((c) => ({
                    value: c.key,
                    label: locale === 'ar' ? c.nameAr : c.nameEn,
                  }))}
                />
              </Form.Item>
            </Col>
          )}
          {type === 'REQUIREMENT' && (
            <Col xs={24} md={8}>
              <Form.Item name="level" label={t('grc:fields.level')}>
                <Select options={options(REQUIREMENT_LEVELS, 'level')} />
              </Form.Item>
            </Col>
          )}
          {editor && (
            <Col xs={24} md={8}>
              <Form.Item name="status" label={t('grc:fields.status')}>
                <Select options={options(GRC_STATUSES, 'status')} />
              </Form.Item>
            </Col>
          )}
        </Row>
        <BilingualFields
          description
          descriptionLabels={
            type === 'REQUIREMENT'
              ? { en: t('grc:fields.textEn'), ar: t('grc:fields.textAr') }
              : undefined
          }
        />
        {type === 'RISK' && (
          <>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item name="causeEn" label={t('grc:fields.causeEn')}>
                  <Input.TextArea dir="ltr" lang="en" rows={2} maxLength={3000} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="causeAr" label={t('grc:fields.causeAr')}>
                  <Input.TextArea dir="rtl" lang="ar" rows={2} maxLength={3000} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="consequenceEn" label={t('grc:fields.consequenceEn')}>
                  <Input.TextArea dir="ltr" lang="en" rows={2} maxLength={3000} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="consequenceAr" label={t('grc:fields.consequenceAr')}>
                  <Input.TextArea dir="rtl" lang="ar" rows={2} maxLength={3000} />
                </Form.Item>
              </Col>
            </Row>
            <Divider orientation="left" plain>
              {t('grc:fields.rating')}
            </Divider>
            <Row gutter={16}>
              <Col xs={12} md={6}>
                <Form.Item
                  name="inherentLikelihood"
                  label={`${t('grc:fields.inherent')} — ${t('grc:fields.likelihood')}`}
                  rules={[{ required: true }]}
                >
                  <Select options={levelOptions} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item
                  name="inherentImpact"
                  label={`${t('grc:fields.inherent')} — ${t('grc:fields.impact')}`}
                  rules={[{ required: true }]}
                >
                  <Select options={impactOptions} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item
                  name="residualLikelihood"
                  label={`${t('grc:fields.residual')} — ${t('grc:fields.likelihood')}`}
                  tooltip={t('grc:fields.residualHint')}
                  dependencies={['residualImpact']}
                  rules={[
                    ({ getFieldValue }) => ({
                      validator: (_, v) =>
                        ((v ?? null) === null) ===
                        ((getFieldValue('residualImpact') ?? null) === null)
                          ? Promise.resolve()
                          : Promise.reject(new Error(t('grc:excel.issue.RESIDUAL_PAIR'))),
                    }),
                  ]}
                >
                  <Select allowClear options={levelOptions} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item
                  name="residualImpact"
                  label={`${t('grc:fields.residual')} — ${t('grc:fields.impact')}`}
                  dependencies={['residualLikelihood']}
                >
                  <Select allowClear options={impactOptions} />
                </Form.Item>
              </Col>
              <Col xs={24} md={8}>
                <Form.Item name="response" label={t('grc:fields.response')}>
                  <Select options={options(RISK_RESPONSES, 'response')} />
                </Form.Item>
              </Col>
              <Col xs={24} md={16}>
                <Form.Item name="controlIds" label={t('grc:detail.mitigatedBy')}>
                  <GrcItemSelect
                    type="CONTROL"
                    known={(item as RiskDto | undefined)?.controls}
                    filter={editor ? undefined : { status: 'DRAFT' }}
                  />
                </Form.Item>
              </Col>
            </Row>
          </>
        )}
        {type === 'CONTROL' && (
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="controlType" label={t('grc:fields.controlType')}>
                <Select options={options(CONTROL_TYPES, 'controlType')} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="nature" label={t('grc:fields.nature')}>
                <Select options={options(CONTROL_NATURES, 'nature')} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="frequency" label={t('grc:fields.frequency')}>
                <Select options={options(CONTROL_FREQUENCIES, 'frequency')} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="systemId" label={t('grc:fields.system')}>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={(systems.data?.items ?? []).map((s) => ({ value: s.id, label: loc(s) }))}
                />
              </Form.Item>
            </Col>
            {editor && (
              <Col xs={24} md={8}>
                <Form.Item name="effectiveness" label={t('grc:fields.effectiveness')}>
                  <Select options={options(CONTROL_EFFECTIVENESS, 'effectiveness')} />
                </Form.Item>
              </Col>
            )}
            <Col xs={24} md={8}>
              <Form.Item
                name="keyControl"
                label={t('grc:fields.keyControl')}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="riskIds" label={t('grc:detail.mitigates')}>
                <GrcItemSelect
                  type="RISK"
                  known={(item as ControlDto | undefined)?.risks}
                  filter={editor ? undefined : { status: 'DRAFT' }}
                />
              </Form.Item>
            </Col>
            {editor && (
              <Col xs={24} md={12}>
                <Form.Item name="requirementIds" label={t('grc:detail.satisfies')}>
                  <GrcItemSelect
                    type="REQUIREMENT"
                    known={(item as ControlDto | undefined)?.requirements}
                  />
                </Form.Item>
              </Col>
            )}
          </Row>
        )}
        {type === 'REQUIREMENT' && (
          <Row gutter={16}>
            {level !== 'SOURCE' && (
              <Col xs={24} md={12}>
                <Form.Item
                  name="parentId"
                  label={t('grc:fields.parent')}
                  rules={[{ required: true }]}
                >
                  <GrcItemSelect
                    type="REQUIREMENT"
                    multiple={false}
                    exclude={item?.id}
                    known={
                      (item as RequirementDto | undefined)?.parent
                        ? [(item as RequirementDto).parent!]
                        : []
                    }
                  />
                </Form.Item>
              </Col>
            )}
            <Col xs={24} md={12}>
              <Form.Item name="sourceRef" label={t('grc:fields.sourceRef')}>
                <Input maxLength={300} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="url"
                label={t('grc:fields.url')}
                rules={[
                  { pattern: /^https?:\/\/\S+$/i, message: t('grc:excel.issue.INVALID_URL') },
                ]}
              >
                <Input dir="ltr" maxLength={1000} placeholder="https://" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="effectiveDate" label={t('grc:fields.effectiveDate')}>
                <DatePicker style={{ inlineSize: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="controlIds" label={t('grc:detail.satisfiedBy')}>
                <GrcItemSelect
                  type="CONTROL"
                  known={(item as RequirementDto | undefined)?.controls}
                />
              </Form.Item>
            </Col>
          </Row>
        )}
        <Divider plain />
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="ownerId" label={t('grc:fields.owner')}>
              <UserSelect allowClear known={item?.owner ? [item.owner] : []} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="departmentId" label={t('grc:fields.department')}>
              <TreeSelect
                allowClear
                treeData={departments}
                treeDefaultExpandAll
                showSearch
                treeNodeFilterProp="title"
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="nextReviewAt" label={t('grc:fields.nextReview')}>
              <DatePicker style={{ inlineSize: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        {item && type !== 'REQUIREMENT' && (
          <Form.Item
            name="comment"
            label={t('grc:fields.comment')}
            extra={t('grc:fields.commentHint')}
          >
            <Input.TextArea rows={2} maxLength={2000} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
