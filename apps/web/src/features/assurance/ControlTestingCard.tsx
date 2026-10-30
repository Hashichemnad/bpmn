import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  DatePicker,
  Descriptions,
  List,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, ExperimentOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs, { type Dayjs } from 'dayjs';
import { PERMISSIONS, type ControlDto, type TestPlanDto } from '@processhub/shared';
import {
  useControlTests,
  useCreateControlTest,
  useDeleteTestPlan,
  useTestPlans,
} from '@/api/assurance';
import { useAuth } from '@/auth/AuthProvider';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { TestPlanModal } from './TestPlanModal';
import { AssigneeLabel, ConclusionTag, TestStatusTag } from './assurance-tags';

/** Control page → Testing: test plans, the latest tests, "Test now". */
export function ControlTestingCard({ control }: { control: ControlDto }) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const { can } = useAuth();
  const manage = can(PERMISSIONS.GRC_EDIT);
  const plans = useTestPlans(control.id);
  const tests = useControlTests({
    controlId: control.id,
    sort: 'dueAt',
    order: 'desc',
    pageSize: 10,
  });
  const create = useCreateControlTest();
  const removePlan = useDeleteTestPlan();
  const [editing, setEditing] = useState<TestPlanDto | 'new' | null>(null);
  const [testNow, setTestNow] = useState<TestPlanDto | null>(null);
  const [due, setDue] = useState<Dayjs>(dayjs().add(14, 'day'));

  return (
    <Card
      title={
        <Space>
          <ExperimentOutlined />
          {t('assurance:tests.cardTitle')}
        </Space>
      }
      data-testid="control-testing"
      extra={
        manage && (
          <Button size="small" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            {t('assurance:plans.new')}
          </Button>
        )
      }
      style={{ marginBlockEnd: 16 }}
    >
      <Descriptions
        size="small"
        column={1}
        items={[
          {
            key: 'op',
            label: t('assurance:tests.operatingEffectiveness'),
            children: (
              <Space>
                <Tag>{t(`grc:effectiveness.${control.operatingEffectiveness}`)}</Tag>
                {control.lastTestedAt && (
                  <Typography.Text type="secondary">
                    {t('assurance:tests.lastTested', {
                      date: formatDate(control.lastTestedAt, false),
                    })}
                  </Typography.Text>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Typography.Title level={5}>{t('assurance:plans.title')}</Typography.Title>
      <List
        size="small"
        locale={{ emptyText: t('assurance:plans.empty') }}
        dataSource={plans.data ?? []}
        renderItem={(p) => (
          <List.Item
            actions={
              manage
                ? [
                    <Button key="now" size="small" type="primary" onClick={() => setTestNow(p)}>
                      {t('assurance:plans.testNow')}
                    </Button>,
                    <Button
                      key="edit"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => setEditing(p)}
                    />,
                    <Popconfirm
                      key="del"
                      title={t('assurance:plans.deleteConfirm')}
                      onConfirm={() =>
                        removePlan.mutate(p.id, { onError: (e) => message.error(errorMessage(e)) })
                      }
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>,
                  ]
                : []
            }
          >
            <Space direction="vertical" size={0}>
              <Space wrap>
                <Typography.Text strong>{t(`assurance:tests.types.${p.testType}`)}</Typography.Text>
                <Tag>{t(`assurance:plans.frequencies.${p.frequency}`)}</Tag>
                {!p.active && <Tag>{t('assurance:plans.inactive')}</Tag>}
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('assurance:tests.tester')}: <AssigneeLabel value={p.tester} /> ·{' '}
                {t('assurance:tests.reviewer')}: <AssigneeLabel value={p.reviewer} /> ·{' '}
                {t('assurance:plans.nextDue')}: {formatDate(p.nextDueAt, false)}
              </Typography.Text>
            </Space>
          </List.Item>
        )}
      />
      <Typography.Title level={5} style={{ marginBlockStart: 16 }}>
        {t('assurance:tests.history')}
      </Typography.Title>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={tests.data?.items ?? []}
        locale={{ emptyText: t('assurance:tests.empty') }}
        columns={[
          {
            title: t('assurance:tests.period'),
            render: (_, r) => <Link to={`/grc/tests/${r.id}`}>{r.period}</Link>,
          },
          {
            title: t('assurance:tests.statusLabel'),
            render: (_, r) => <TestStatusTag status={r.status} />,
          },
          {
            title: t('assurance:tests.conclusionLabel'),
            render: (_, r) => <ConclusionTag value={r.conclusion} />,
          },
          {
            title: t('assurance:tests.due'),
            render: (_, r) => (
              <Typography.Text type={r.overdue ? 'danger' : undefined}>
                {formatDate(r.dueAt, false)}
              </Typography.Text>
            ),
          },
        ]}
      />
      {editing && (
        <TestPlanModal
          control={control}
          plan={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {testNow && (
        <Modal
          open
          title={t('assurance:plans.testNow')}
          onCancel={() => setTestNow(null)}
          confirmLoading={create.isPending}
          onOk={() =>
            create.mutate(
              { planId: testNow.id, dueAt: due.format('YYYY-MM-DD') },
              {
                onSuccess: (r) => navigate(`/grc/tests/${r.id}`),
                onError: (e) => message.error(errorMessage(e)),
              },
            )
          }
        >
          <Typography.Paragraph>{loc(control)}</Typography.Paragraph>
          <Space>
            {t('assurance:tests.due')}
            <DatePicker value={due} onChange={(d) => d && setDue(d)} allowClear={false} />
          </Space>
        </Modal>
      )}
    </Card>
  );
}
