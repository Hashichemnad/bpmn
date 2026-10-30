import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, DatePicker, Form, Input, Modal, Select, Space, TreeSelect } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import type { CreateIssueInput, IssueDto, IssueSource } from '@processhub/shared';
import { useAssuranceSettings, useSaveIssue } from '@/api/assurance';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { UserSelect } from '@/features/governance/UserSelect';
import { GrcItemSelect } from '@/features/grc/GrcItemSelect';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';

/** Defaults when an issue is raised from a test, a risk, feedback or an audit finding. */
export interface IssuePrefill extends Partial<CreateIssueInput> {
  sourceType: IssueSource;
}

interface Values {
  titleEn?: string;
  titleAr?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  severity: string;
  ownerId?: string | null;
  dueAt?: Dayjs | null;
  processId?: string | null;
  bpmnElementId?: string | null;
  riskId?: string | null;
  controlId?: string | null;
  requirementId?: string | null;
  departmentId?: string | null;
}

/** Raise (or edit) an issue: title, severity, owner, due date and its links. */
export function IssueFormModal({
  issue,
  prefill,
  onClose,
}: {
  issue?: IssueDto;
  prefill?: IssuePrefill;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const settings = useAssuranceSettings();
  const save = useSaveIssue();
  const processes = useProcessTreeOptions('');
  const departments = useDepartmentTreeData();
  const [form] = Form.useForm<Values>();

  useEffect(() => {
    if (issue)
      form.setFieldsValue({
        titleEn: issue.titleEn,
        titleAr: issue.titleAr,
        descriptionEn: issue.descriptionEn,
        descriptionAr: issue.descriptionAr,
        severity: issue.severity,
        ownerId: issue.owner?.id ?? null,
        dueAt: issue.dueAt ? dayjs(issue.dueAt) : null,
        processId: issue.process?.id ?? null,
        bpmnElementId: issue.bpmnElementId,
        riskId: issue.risk?.id ?? null,
        controlId: issue.control?.id ?? null,
        requirementId: issue.requirement?.id ?? null,
        departmentId: issue.department?.id ?? null,
      });
    else
      form.setFieldsValue({
        severity: 'MEDIUM',
        dueAt: dayjs().add(30, 'day'),
        ...(prefill as Partial<Values>),
        ...(prefill?.dueAt ? { dueAt: dayjs(prefill.dueAt) } : {}),
      });
  }, [form, issue, prefill]);

  const submit = (v: Values) => {
    const body = {
      ...v,
      dueAt: v.dueAt ? v.dueAt.format('YYYY-MM-DD') : null,
      ...(issue
        ? {}
        : {
            sourceType: prefill?.sourceType ?? 'MANUAL',
            sourceId: prefill?.sourceId ?? null,
            actions: prefill?.actions,
          }),
    };
    save.mutate(
      { id: issue?.id, body: body as never },
      {
        onSuccess: (r) => {
          message.success(
            t(issue ? 'assurance:issues.saved' : 'assurance:issues.raised', { code: r.code }),
          );
          onClose();
          if (!issue) navigate(`/grc/issues/${r.id}`);
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  };

  const one = (v: string[] | string | null) => (Array.isArray(v) ? (v[0] ?? null) : v);

  return (
    <Modal
      open
      width={760}
      title={t(issue ? 'assurance:issues.edit' : 'assurance:issues.raise')}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={t('save')}
      confirmLoading={save.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={submit} data-testid="issue-form">
        <Space wrap style={{ width: '100%' }} size={16}>
          <Form.Item name="titleEn" label={t('assurance:issues.titleEn')} style={{ width: 340 }}>
            <Input dir="ltr" maxLength={300} />
          </Form.Item>
          <Form.Item name="titleAr" label={t('assurance:issues.titleAr')} style={{ width: 340 }}>
            <Input dir="rtl" maxLength={300} />
          </Form.Item>
        </Space>
        <Space wrap style={{ width: '100%' }} size={16}>
          <Form.Item
            name="descriptionEn"
            label={t('assurance:issues.descriptionEn')}
            style={{ width: 340 }}
          >
            <Input.TextArea dir="ltr" autoSize={{ minRows: 2 }} />
          </Form.Item>
          <Form.Item
            name="descriptionAr"
            label={t('assurance:issues.descriptionAr')}
            style={{ width: 340 }}
          >
            <Input.TextArea dir="rtl" autoSize={{ minRows: 2 }} />
          </Form.Item>
        </Space>
        <Space wrap size={16}>
          <Form.Item
            name="severity"
            label={t('assurance:issues.severity')}
            rules={[{ required: true }]}
          >
            <Select
              style={{ width: 180 }}
              data-testid="issue-severity"
              options={(settings.data?.severities ?? []).map((s) => ({
                value: s.key,
                label: loc(s),
              }))}
            />
          </Form.Item>
          <Form.Item name="ownerId" label={t('assurance:issues.owner')}>
            <UserSelect
              allowClear
              style={{ width: 260 }}
              known={issue?.owner ? [issue.owner] : []}
            />
          </Form.Item>
          <Form.Item name="dueAt" label={t('assurance:issues.due')}>
            <DatePicker />
          </Form.Item>
        </Space>
        <Form.Item name="processId" label={t('assurance:issues.process')}>
          <TreeSelect
            allowClear
            showSearch
            treeNodeFilterProp="title"
            treeData={processes.options}
          />
        </Form.Item>
        <Space wrap size={16}>
          <Form.Item
            name="riskId"
            label={t('grc:types.RISK')}
            getValueFromEvent={one}
            style={{ width: 220 }}
          >
            <GrcItemSelect
              type="RISK"
              multiple={false}
              known={issue?.risk ? [{ ...issue.risk, type: 'RISK', status: 'ACTIVE' }] : []}
            />
          </Form.Item>
          <Form.Item
            name="controlId"
            label={t('grc:types.CONTROL')}
            getValueFromEvent={one}
            style={{ width: 220 }}
          >
            <GrcItemSelect
              type="CONTROL"
              multiple={false}
              known={
                issue?.control ? [{ ...issue.control, type: 'CONTROL', status: 'ACTIVE' }] : []
              }
            />
          </Form.Item>
          <Form.Item
            name="requirementId"
            label={t('grc:types.REQUIREMENT')}
            getValueFromEvent={one}
            style={{ width: 220 }}
          >
            <GrcItemSelect
              type="REQUIREMENT"
              multiple={false}
              known={
                issue?.requirement
                  ? [{ ...issue.requirement, type: 'REQUIREMENT', status: 'ACTIVE' }]
                  : []
              }
            />
          </Form.Item>
        </Space>
        <Form.Item name="departmentId" label={t('assurance:issues.department')}>
          <TreeSelect allowClear treeData={departments} treeDefaultExpandAll />
        </Form.Item>
      </Form>
    </Modal>
  );
}
