import { useNavigate } from 'react-router-dom';
import { App, DatePicker, Form, Input, InputNumber, Modal, Select, Space, TreeSelect } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { SYSTEM_ROLE_KEYS, type CampaignDetailDto } from '@processhub/shared';
import { useCampaignAction, useQuestionnaires } from '@/api/assurance';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';
import { UserMultiSelect } from './UserMultiSelect';

interface Values {
  questionnaireId: string;
  titleEn?: string;
  titleAr?: string;
  userIds?: string[];
  roleKeys?: string[];
  departmentIds?: string[];
  dates?: [Dayjs | null, Dayjs | null];
  reminderDaysBefore?: number;
  processId?: string | null;
  departmentId?: string | null;
}

/** Recipients picker shared by campaigns and feedback requests. */
export function AudienceFields() {
  const { t } = useTranslation();
  const departments = useDepartmentTreeData();
  return (
    <>
      <Form.Item name="userIds" label={t('assurance:surveys.users')}>
        <UserMultiSelect />
      </Form.Item>
      <Form.Item name="roleKeys" label={t('assurance:surveys.roles')}>
        <Select
          mode="multiple"
          allowClear
          options={SYSTEM_ROLE_KEYS.map((r) => ({ value: r, label: t(`admin:roles.${r}`) }))}
        />
      </Form.Item>
      <Form.Item name="departmentIds" label={t('assurance:surveys.departments')}>
        <TreeSelect multiple allowClear treeData={departments} treeDefaultExpandAll />
      </Form.Item>
    </>
  );
}

/** New campaign: questionnaire, recipients, dates and reminders (launched from its page). */
export function CampaignFormModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const questionnaires = useQuestionnaires();
  const departments = useDepartmentTreeData();
  const processes = useProcessTreeOptions('');
  const act = useCampaignAction();
  const [form] = Form.useForm<Values>();
  const submit = (v: Values) =>
    act.mutate(
      {
        kind: 'create',
        body: {
          questionnaireId: v.questionnaireId,
          titleEn: v.titleEn,
          titleAr: v.titleAr,
          audience: {
            userIds: v.userIds ?? [],
            roleKeys: (v.roleKeys ?? []) as never,
            departmentIds: v.departmentIds ?? [],
          },
          startAt: v.dates?.[0]?.format('YYYY-MM-DD') ?? null,
          endAt: v.dates?.[1]?.format('YYYY-MM-DD') ?? null,
          reminderDaysBefore: v.reminderDaysBefore,
          processId: v.processId ?? null,
          departmentId: v.departmentId ?? null,
        },
      },
      {
        onSuccess: (r) => {
          onClose();
          navigate(`/grc/surveys/campaigns/${(r as CampaignDetailDto).id}`);
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  return (
    <Modal
      open
      width={720}
      title={t('assurance:surveys.newCampaign')}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={act.isPending}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        data-testid="campaign-form"
        initialValues={{ reminderDaysBefore: 3, dates: [dayjs(), dayjs().add(14, 'day')] }}
      >
        <Form.Item
          name="questionnaireId"
          label={t('assurance:surveys.questionnaire')}
          rules={[{ required: true }]}
        >
          <Select
            options={(questionnaires.data ?? [])
              .filter((q) => q.status !== 'ARCHIVED')
              .map((q) => ({ value: q.id, label: loc(q, 'title') }))}
          />
        </Form.Item>
        <Space wrap size={16} style={{ width: '100%' }}>
          <Form.Item
            name="titleEn"
            label={t('assurance:issues.titleEn')}
            style={{ width: 320 }}
            extra={t('assurance:surveys.titleDefault')}
          >
            <Input dir="ltr" />
          </Form.Item>
          <Form.Item name="titleAr" label={t('assurance:issues.titleAr')} style={{ width: 320 }}>
            <Input dir="rtl" />
          </Form.Item>
        </Space>
        <AudienceFields />
        <Space wrap size={16}>
          <Form.Item name="dates" label={t('assurance:surveys.period')}>
            <DatePicker.RangePicker />
          </Form.Item>
          <Form.Item name="reminderDaysBefore" label={t('assurance:surveys.reminderDays')}>
            <InputNumber min={0} max={60} />
          </Form.Item>
        </Space>
        <Space wrap size={16} style={{ width: '100%' }}>
          <Form.Item
            name="departmentId"
            label={t('assurance:surveys.forDepartment')}
            style={{ width: 320 }}
          >
            <TreeSelect allowClear treeData={departments} treeDefaultExpandAll />
          </Form.Item>
          <Form.Item
            name="processId"
            label={t('assurance:surveys.forProcess')}
            style={{ width: 320 }}
          >
            <TreeSelect
              allowClear
              showSearch
              treeNodeFilterProp="title"
              treeData={processes.options}
            />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}

/** "Request feedback" on a process: recipients and an end date; launched at once. */
export function RequestFeedbackModal({
  processId,
  onClose,
}: {
  processId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const act = useCampaignAction();
  const [form] = Form.useForm<Values & { endAt: Dayjs; messageEn?: string; messageAr?: string }>();
  return (
    <Modal
      open
      width={640}
      title={t('assurance:surveys.requestFeedback')}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={act.isPending}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        data-testid="feedback-request-form"
        initialValues={{ endAt: dayjs().add(7, 'day') }}
        onFinish={(v) =>
          act.mutate(
            {
              kind: 'feedback',
              body: {
                processId,
                audience: {
                  userIds: v.userIds ?? [],
                  roleKeys: (v.roleKeys ?? []) as never,
                  departmentIds: v.departmentIds ?? [],
                },
                endAt: v.endAt.format('YYYY-MM-DD'),
                messageEn: v.messageEn,
                messageAr: v.messageAr,
              },
            },
            {
              onSuccess: () => {
                message.success(t('assurance:surveys.feedbackSent'));
                onClose();
              },
              onError: (e) => message.error(errorMessage(e)),
            },
          )
        }
      >
        <AudienceFields />
        <Form.Item
          name="endAt"
          label={t('assurance:surveys.answerBy')}
          rules={[{ required: true }]}
        >
          <DatePicker />
        </Form.Item>
        <Form.Item name="messageEn" label={t('assurance:surveys.messageEn')}>
          <Input.TextArea dir="ltr" autoSize={{ minRows: 2 }} />
        </Form.Item>
        <Form.Item name="messageAr" label={t('assurance:surveys.messageAr')}>
          <Input.TextArea dir="rtl" autoSize={{ minRows: 2 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
