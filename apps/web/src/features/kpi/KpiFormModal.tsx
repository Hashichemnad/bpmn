import {
  App,
  Alert,
  Button,
  Col,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  TreeSelect,
} from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  CALCULATED_METRICS,
  KPI_DIRECTIONS,
  KPI_FREQUENCIES,
  KPI_STATUSES,
  PERMISSIONS,
  PROCESS_ELEMENT_ID,
  type GrcRef,
  type KpiDetailDto,
} from '@processhub/shared';
import { useSaveKpi } from '@/api/kpi';
import { useObjectiveTreeData } from './kpi-helpers';
import { useAuth } from '@/auth/AuthProvider';
import { BilingualFields } from '@/components/BilingualFields';
import { useErrorMessage } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { UserSelect } from '@/features/governance/UserSelect';
import { GrcItemSelect } from '@/features/grc/GrcItemSelect';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';
import { CapabilitySelect } from '@/features/ea/ea-components';

type Values = Record<string, unknown> & {
  periodTargets?: {
    period: string;
    target?: number | null;
    greenThreshold?: number | null;
    redThreshold?: number | null;
  }[];
  processIds?: string[];
};

/** Create or edit a KPI definition (Salesforce-owned fields are read-only, D-114). */
export function KpiFormModal({
  detail,
  onClose,
  onSaved,
}: {
  detail?: KpiDetailDto;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [form] = Form.useForm<Values>();
  const save = useSaveKpi();
  const departments = useDepartmentTreeData();
  const objectives = useObjectiveTreeData();
  const processes = useProcessTreeOptions('');
  const item = detail?.item;
  const locked = new Set(item?.lockedFields ?? []);
  const dataSource = Form.useWatch('dataSource', form) as string | undefined;
  const options = (group: string, values: readonly string[]) =>
    values.map((v) => ({ value: v, label: t(`kpi:${group}.${v}`) }));

  const initial: Values = item
    ? {
        ...item,
        ownerId: item.owner?.id ?? null,
        departmentId: item.department?.id ?? null,
        calculatedProcessId: item.calculatedProcess?.id ?? null,
        objectiveIds: item.objectives.map((o) => o.id),
        capabilityIds: item.capabilities.map((c) => c.id),
        riskIds: item.risks.map((r) => r.id),
        processIds: (detail?.links ?? [])
          .filter((l) => l.bpmnElementId === PROCESS_ELEMENT_ID)
          .map((l) => l.process.id),
      }
    : {
        direction: 'HIGHER_IS_BETTER',
        frequency: 'MONTHLY',
        dataSource: 'MANUAL',
        status: 'ACTIVE',
        periodTargets: [],
        processIds: [],
      };

  const submit = (v: Values) => {
    // Step links stay as they are (set in the modeler); process-level links come from the form.
    const stepLinks = (detail?.links ?? [])
      .filter((l) => l.bpmnElementId !== PROCESS_ELEMENT_ID)
      .map((l) => ({ processId: l.process.id, bpmnElementId: l.bpmnElementId }));
    const body: Record<string, unknown> = {
      code: v.code || null,
      nameEn: v.nameEn ?? '',
      nameAr: v.nameAr ?? '',
      descriptionEn: v.descriptionEn ?? '',
      descriptionAr: v.descriptionAr ?? '',
      formulaEn: v.formulaEn ?? '',
      formulaAr: v.formulaAr ?? '',
      unit: v.unit ?? '',
      direction: v.direction,
      frequency: v.frequency,
      target: v.target ?? null,
      greenThreshold: v.greenThreshold ?? null,
      redThreshold: v.redThreshold ?? null,
      baseline: v.baseline ?? null,
      baselinePeriod: v.baselinePeriod || null,
      ownerId: v.ownerId ?? null,
      departmentId: v.departmentId ?? null,
      dataSource: v.dataSource,
      status: v.status,
      calculatedMetric: v.dataSource === 'CALCULATED' ? (v.calculatedMetric ?? null) : null,
      calculatedProcessId: v.dataSource === 'CALCULATED' ? (v.calculatedProcessId ?? null) : null,
      objectiveIds: v.objectiveIds ?? [],
      capabilityIds: v.capabilityIds ?? [],
      ...(can(PERMISSIONS.GRC_READ) ? { riskIds: v.riskIds ?? [] } : {}),
      periodTargets: (v.periodTargets ?? [])
        .filter((p) => p?.period)
        .map((p) => ({
          period: p.period.trim(),
          target: p.target ?? null,
          greenThreshold: p.greenThreshold ?? null,
          redThreshold: p.redThreshold ?? null,
        })),
      links: [
        ...stepLinks,
        ...(v.processIds ?? []).map((processId) => ({
          processId,
          bpmnElementId: PROCESS_ELEMENT_ID,
        })),
      ],
    };
    // Salesforce-owned fields are not sent (the server refuses changes to them).
    for (const f of locked) delete body[f];
    save.mutate(
      { id: item?.id, body },
      {
        onSuccess: (r) => {
          message.success(t('saved'));
          onSaved?.(r.item.id);
          onClose();
        },
        onError: (err) => message.error(errorMessage(err)),
      },
    );
  };
  const num = (name: string, label: string) => (
    <Form.Item name={name} label={label}>
      <InputNumber style={{ width: '100%' }} disabled={locked.has(name)} />
    </Form.Item>
  );

  return (
    <Modal
      open
      width={920}
      title={item ? t('kpi:register.edit') : t('kpi:register.new')}
      okText={t('save')}
      onOk={() => form.submit()}
      onCancel={onClose}
      confirmLoading={save.isPending}
      destroyOnHidden
    >
      {locked.size > 0 && (
        <Alert
          type="info"
          showIcon
          message={t('kpi:detail.lockedHint')}
          style={{ marginBlockEnd: 12 }}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        onFinish={submit}
        data-testid="kpi-form"
      >
        <Row gutter={16}>
          <Col xs={24} md={6}>
            <Form.Item name="code" label={t('kpi:fields.code')}>
              <Input dir="ltr" maxLength={50} disabled={locked.has('code')} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="unit" label={t('kpi:fields.unit')}>
              <Input maxLength={40} disabled={locked.has('unit')} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="frequency" label={t('kpi:fields.frequency')}>
              <Select
                options={options('frequency', KPI_FREQUENCIES)}
                disabled={locked.has('frequency')}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item name="status" label={t('kpi:fields.status')}>
              <Select options={options('status', KPI_STATUSES)} />
            </Form.Item>
          </Col>
        </Row>
        <BilingualFields
          description
          descriptionLabels={{ en: t('kpi:fields.definitionEn'), ar: t('kpi:fields.definitionAr') }}
        />
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="formulaEn" label={t('kpi:fields.formulaEn')}>
              <Input.TextArea dir="ltr" rows={2} maxLength={3000} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="formulaAr" label={t('kpi:fields.formulaAr')}>
              <Input.TextArea dir="rtl" rows={2} maxLength={3000} />
            </Form.Item>
          </Col>
        </Row>
        <Divider />
        <Row gutter={16}>
          <Col xs={24} md={6}>
            <Form.Item name="direction" label={t('kpi:fields.direction')}>
              <Select
                options={options('direction', KPI_DIRECTIONS)}
                disabled={locked.has('direction')}
              />
            </Form.Item>
          </Col>
          <Col xs={8} md={4}>
            {num('target', t('kpi:fields.target'))}
          </Col>
          <Col xs={8} md={4}>
            {num('greenThreshold', t('kpi:fields.greenThreshold'))}
          </Col>
          <Col xs={8} md={4}>
            {num('redThreshold', t('kpi:fields.redThreshold'))}
          </Col>
          <Col xs={12} md={3}>
            {num('baseline', t('kpi:fields.baseline'))}
          </Col>
          <Col xs={12} md={3}>
            <Form.Item name="baselinePeriod" label={t('kpi:fields.baselinePeriod')}>
              <Input dir="ltr" placeholder="2025-12" maxLength={7} />
            </Form.Item>
          </Col>
        </Row>
        <div
          className="ph-muted"
          style={{ marginBlockStart: -12, marginBlockEnd: 12, fontSize: 12 }}
        >
          {t('kpi:fields.thresholdHint')}
        </div>
        <Form.List name="periodTargets">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <Flex key={f.key} gap={8} align="baseline" wrap="wrap">
                  <Form.Item name={[f.name, 'period']} rules={[{ required: true }]}>
                    <Input dir="ltr" placeholder={t('kpi:fields.period')} style={{ width: 110 }} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'target']}>
                    <InputNumber placeholder={t('kpi:fields.target')} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'greenThreshold']}>
                    <InputNumber placeholder={t('kpi:fields.greenThreshold')} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'redThreshold']}>
                    <InputNumber placeholder={t('kpi:fields.redThreshold')} />
                  </Form.Item>
                  <MinusCircleOutlined aria-label={t('delete')} onClick={() => remove(f.name)} />
                </Flex>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ period: '' })}>
                {t('kpi:fields.periodTargets')}
              </Button>
            </>
          )}
        </Form.List>
        <Divider />
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="ownerId" label={t('kpi:fields.owner')}>
              <UserSelect allowClear known={item?.owner ? [item.owner] : []} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="departmentId" label={t('kpi:fields.department')}>
              <TreeSelect treeData={departments} allowClear treeDefaultExpandAll showSearch />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="dataSource" label={t('kpi:fields.dataSource')}>
              <Select
                disabled={item?.dataSource === 'SALESFORCE'}
                options={options('dataSource', ['MANUAL', 'EXCEL', 'CALCULATED']).concat(
                  item?.dataSource === 'SALESFORCE'
                    ? [{ value: 'SALESFORCE', label: t('kpi:dataSource.SALESFORCE') }]
                    : [],
                )}
              />
            </Form.Item>
          </Col>
        </Row>
        {dataSource === 'CALCULATED' && (
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="calculatedMetric"
                label={t('kpi:fields.calculatedMetric')}
                rules={[{ required: true }]}
              >
                <Select options={options('metric', CALCULATED_METRICS)} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="calculatedProcessId"
                label={t('kpi:fields.calculatedProcess')}
                rules={[{ required: true }]}
              >
                <TreeSelect
                  treeData={processes.options}
                  showSearch
                  treeNodeFilterProp="title"
                  treeDefaultExpandAll
                />
              </Form.Item>
            </Col>
          </Row>
        )}
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="objectiveIds" label={t('kpi:fields.objectives')}>
              <TreeSelect
                multiple
                treeData={objectives}
                treeDefaultExpandAll
                showSearch
                treeNodeFilterProp="title"
                allowClear
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="capabilityIds" label={t('kpi:fields.capabilities')}>
              <CapabilitySelect multiple />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="processIds" label={t('kpi:fields.processes')}>
              <TreeSelect
                multiple
                treeData={processes.options}
                showSearch
                treeNodeFilterProp="title"
                treeDefaultExpandAll
                allowClear
              />
            </Form.Item>
          </Col>
          {can(PERMISSIONS.GRC_READ) && (
            <Col xs={24} md={12}>
              <Form.Item name="riskIds" label={t('kpi:fields.risks')}>
                <GrcItemSelect
                  type="RISK"
                  known={(item?.risks ?? []).map(
                    (r) => ({ ...r, type: 'RISK', status: 'ACTIVE' }) as GrcRef,
                  )}
                />
              </Form.Item>
            </Col>
          )}
        </Row>
      </Form>
    </Modal>
  );
}
