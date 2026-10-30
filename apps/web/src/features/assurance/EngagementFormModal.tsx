import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, DatePicker, Form, Input, InputNumber, Modal, Space, TreeSelect } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import type { AuditEngagementDto, CreateEngagementInput } from '@processhub/shared';
import { useSaveEngagement } from '@/api/assurance';
import { useErrorMessage } from '@/components/i18n-helpers';
import { UserSelect } from '@/features/governance/UserSelect';
import { GrcItemSelect } from '@/features/grc/GrcItemSelect';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { UserMultiSelect } from './UserMultiSelect';

interface Values {
  year: number;
  titleEn?: string;
  titleAr?: string;
  objectiveEn?: string;
  objectiveAr?: string;
  scopeEn?: string;
  scopeAr?: string;
  leadId?: string | null;
  teamIds?: string[];
  dates?: [Dayjs | null, Dayjs | null];
  processIds?: string[];
  departmentIds?: string[];
  riskIds?: string[];
  controlIds?: string[];
  requirementIds?: string[];
  summaryEn?: string;
  summaryAr?: string;
}

/** Plan or edit an engagement: title, objective, scope, team and dates. */
export function EngagementFormModal({
  engagement,
  prefill,
  onClose,
}: {
  engagement?: AuditEngagementDto;
  prefill?: Partial<CreateEngagementInput>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const save = useSaveEngagement();
  const processes = useProcessTreeOptions('');
  const departments = useDepartmentTreeData();
  const [form] = Form.useForm<Values>();

  useEffect(() => {
    const e = engagement;
    form.setFieldsValue(
      e
        ? {
            year: e.year,
            titleEn: e.titleEn,
            titleAr: e.titleAr,
            objectiveEn: e.objectiveEn,
            objectiveAr: e.objectiveAr,
            scopeEn: e.scopeEn,
            scopeAr: e.scopeAr,
            leadId: e.lead?.id ?? null,
            teamIds: e.team.map((u) => u.id),
            dates: [
              e.plannedStart ? dayjs(e.plannedStart) : null,
              e.plannedEnd ? dayjs(e.plannedEnd) : null,
            ] as [Dayjs | null, Dayjs | null],
            processIds: e.scope.processes.map((p) => p.id),
            departmentIds: e.scope.departments.map((d) => d.id),
            riskIds: e.scope.risks.map((r) => r.id),
            controlIds: e.scope.controls.map((r) => r.id),
            requirementIds: e.scope.requirements.map((r) => r.id),
            summaryEn: e.summaryEn,
            summaryAr: e.summaryAr,
          }
        : { year: new Date().getFullYear(), ...(prefill as Partial<Values>) },
    );
  }, [form, engagement, prefill]);

  const submit = (v: Values) => {
    const { dates, ...rest } = v;
    const body = {
      ...rest,
      leadId: v.leadId ?? null,
      plannedStart: dates?.[0] ? dates[0].format('YYYY-MM-DD') : null,
      plannedEnd: dates?.[1] ? dates[1].format('YYYY-MM-DD') : null,
    };
    save.mutate(
      { id: engagement?.id, body },
      {
        onSuccess: (r) => {
          message.success(t('assurance:audits.saved'));
          onClose();
          if (!engagement) navigate(`/grc/audits/${r.id}`);
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  };
  const known = (
    list: { id: string; code: string | null; nameEn: string; nameAr: string }[],
    type: 'RISK' | 'CONTROL' | 'REQUIREMENT',
  ) => list.map((r) => ({ ...r, type, status: 'ACTIVE' as const }));

  return (
    <Modal
      open
      width={820}
      title={t(engagement ? 'assurance:audits.edit' : 'assurance:audits.new')}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={t('save')}
      confirmLoading={save.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={submit} data-testid="engagement-form">
        <Space wrap size={16}>
          <Form.Item name="year" label={t('assurance:audits.year')} rules={[{ required: true }]}>
            <InputNumber min={2000} max={2100} />
          </Form.Item>
          <Form.Item name="dates" label={t('assurance:audits.plannedDates')}>
            <DatePicker.RangePicker allowEmpty={[true, true]} />
          </Form.Item>
        </Space>
        <Space wrap size={16} style={{ width: '100%' }}>
          <Form.Item name="titleEn" label={t('assurance:issues.titleEn')} style={{ width: 360 }}>
            <Input dir="ltr" maxLength={300} />
          </Form.Item>
          <Form.Item name="titleAr" label={t('assurance:issues.titleAr')} style={{ width: 360 }}>
            <Input dir="rtl" maxLength={300} />
          </Form.Item>
          <Form.Item
            name="objectiveEn"
            label={t('assurance:audits.objectiveEn')}
            style={{ width: 360 }}
          >
            <Input.TextArea dir="ltr" autoSize={{ minRows: 2 }} />
          </Form.Item>
          <Form.Item
            name="objectiveAr"
            label={t('assurance:audits.objectiveAr')}
            style={{ width: 360 }}
          >
            <Input.TextArea dir="rtl" autoSize={{ minRows: 2 }} />
          </Form.Item>
          <Form.Item name="scopeEn" label={t('assurance:audits.scopeEn')} style={{ width: 360 }}>
            <Input.TextArea dir="ltr" autoSize={{ minRows: 2 }} />
          </Form.Item>
          <Form.Item name="scopeAr" label={t('assurance:audits.scopeAr')} style={{ width: 360 }}>
            <Input.TextArea dir="rtl" autoSize={{ minRows: 2 }} />
          </Form.Item>
        </Space>
        <Form.Item name="processIds" label={t('assurance:audits.scopeProcesses')}>
          <TreeSelect
            multiple
            allowClear
            showSearch
            treeNodeFilterProp="title"
            treeData={processes.options}
          />
        </Form.Item>
        <Form.Item name="departmentIds" label={t('assurance:audits.scopeDepartments')}>
          <TreeSelect multiple allowClear treeData={departments} treeDefaultExpandAll />
        </Form.Item>
        <Form.Item name="riskIds" label={t('grc:register.RISK.title')}>
          <GrcItemSelect
            type="RISK"
            known={engagement ? known(engagement.scope.risks, 'RISK') : []}
          />
        </Form.Item>
        <Form.Item name="controlIds" label={t('grc:register.CONTROL.title')}>
          <GrcItemSelect
            type="CONTROL"
            known={engagement ? known(engagement.scope.controls, 'CONTROL') : []}
          />
        </Form.Item>
        <Form.Item name="requirementIds" label={t('grc:register.REQUIREMENT.title')}>
          <GrcItemSelect
            type="REQUIREMENT"
            known={engagement ? known(engagement.scope.requirements, 'REQUIREMENT') : []}
          />
        </Form.Item>
        <Space wrap size={16}>
          <Form.Item name="leadId" label={t('assurance:audits.lead')} style={{ width: 300 }}>
            <UserSelect allowClear known={engagement?.lead ? [engagement.lead] : []} />
          </Form.Item>
          <Form.Item name="teamIds" label={t('assurance:audits.team')} style={{ width: 420 }}>
            <UserMultiSelect known={engagement?.team ?? []} />
          </Form.Item>
        </Space>
        {engagement && (
          <Space wrap size={16} style={{ width: '100%' }}>
            <Form.Item
              name="summaryEn"
              label={t('assurance:audits.summaryEn')}
              style={{ width: 360 }}
            >
              <Input.TextArea dir="ltr" autoSize={{ minRows: 3 }} />
            </Form.Item>
            <Form.Item
              name="summaryAr"
              label={t('assurance:audits.summaryAr')}
              style={{ width: 360 }}
            >
              <Input.TextArea dir="rtl" autoSize={{ minRows: 3 }} />
            </Form.Item>
          </Space>
        )}
      </Form>
    </Modal>
  );
}
