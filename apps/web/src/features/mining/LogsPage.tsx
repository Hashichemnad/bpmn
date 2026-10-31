import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Flex,
  Form,
  Input,
  Modal,
  Radio,
  Space,
  Table,
  Typography,
} from 'antd';
import { CloudUploadOutlined, DatabaseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { Dayjs } from 'dayjs';
import type { EventLogDto } from '@processhub/shared';
import { useCreateProcessHubLog, useEventLogs, type MiningQuery } from '@/api/mining';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState } from '@/components/states';
import {
  useErrorMessage,
  useFormatDate,
  useFormatNumber,
  useLocalized,
} from '@/components/i18n-helpers';
import { useLocale } from '@/app/LocaleProvider';
import { LogStatusTag } from './mining-helpers';
import { logPath, useMiningAccess } from './mining-utils';

/** Event logs the user may see (owner, department, granted), with import entry points. */
export function LogsPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const formatDate = useFormatDate();
  const formatNumber = useFormatNumber();
  const access = useMiningAccess();
  const [params, setParams] = useSearchParams();
  const [internal, setInternal] = useState(false);
  const query: MiningQuery = {
    q: params.get('q'),
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 20),
  };
  const list = useEventLogs(query);

  return (
    <>
      <PageHeader
        title={t('mining:logs.title')}
        subtitle={t('mining:logs.subtitle')}
        extra={
          access.canManage && (
            <>
              <Button icon={<DatabaseOutlined />} onClick={() => setInternal(true)}>
                {t('mining:logs.fromProcessHub')}
              </Button>
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                onClick={() => navigate('/mining/logs/new')}
              >
                {t('mining:logs.import')}
              </Button>
            </>
          )
        }
      />
      <Card>
        <Flex gap={8} style={{ marginBlockEnd: 16 }}>
          <Input.Search
            allowClear
            placeholder={t('mining:logs.search')}
            defaultValue={params.get('q') ?? undefined}
            onSearch={(q) => {
              const next = new URLSearchParams(params);
              if (q) next.set('q', q);
              else next.delete('q');
              next.delete('page');
              setParams(next, { replace: true });
            }}
            style={{ width: 260 }}
          />
        </Flex>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <Table<EventLogDto>
            rowKey="id"
            data-testid="mining-logs"
            loading={list.isLoading}
            dataSource={list.data?.items ?? []}
            scroll={{ x: 900 }}
            locale={{ emptyText: <EmptyState description={t('mining:logs.empty')} /> }}
            onRow={(l) => ({ onDoubleClick: () => navigate(logPath(l.id)) })}
            pagination={{
              current: query.page as number,
              pageSize: query.pageSize as number,
              total: list.data?.total ?? 0,
              onChange: (page, pageSize) => {
                const next = new URLSearchParams(params);
                next.set('page', String(page));
                next.set('pageSize', String(pageSize));
                setParams(next, { replace: true });
              },
            }}
            columns={[
              { title: t('mining:fields.code'), dataIndex: 'code', width: 100 },
              {
                title: t('mining:fields.name'),
                render: (_, l) => <Link to={logPath(l.id)}>{loc(l)}</Link>,
              },
              {
                title: t('mining:fields.process'),
                render: (_, l) =>
                  l.process ? (
                    `${l.process.code} ${loc(l.process)}`
                  ) : (
                    <Typography.Text type="secondary">—</Typography.Text>
                  ),
              },
              {
                title: t('mining:fields.status'),
                width: 130,
                render: (_, l) => <LogStatusTag status={l.status} />,
              },
              {
                title: t('mining:fields.cases'),
                align: 'end',
                width: 100,
                render: (_, l) => formatNumber(l.caseCount),
              },
              {
                title: t('mining:fields.events'),
                align: 'end',
                width: 110,
                render: (_, l) => formatNumber(l.eventCount),
              },
              {
                title: t('mining:fields.period'),
                width: 220,
                render: (_, l) =>
                  l.periodStart
                    ? `${formatDate(l.periodStart, false)} – ${formatDate(l.periodEnd, false)}`
                    : '—',
              },
              { title: t('mining:fields.owner'), render: (_, l) => (l.owner ? loc(l.owner) : '—') },
            ]}
          />
        )}
      </Card>
      {internal && <ProcessHubLogModal onClose={() => setInternal(false)} />}
    </>
  );
}

/** "Create log from ProcessHub": governance reviews of processes, pages and diagrams (D-132). */
function ProcessHubLogModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const create = useCreateProcessHubLog();
  const [form] = Form.useForm<{
    nameEn: string;
    nameAr: string;
    itemTypes: ('PROCESS' | 'PAGE' | 'DIAGRAM')[];
    range?: [Dayjs, Dayjs];
    language: 'en' | 'ar';
  }>();
  return (
    <Modal
      open
      title={t('mining:processhub.title')}
      okText={t('mining:processhub.create')}
      confirmLoading={create.isPending}
      onCancel={onClose}
      onOk={() =>
        void form.validateFields().then((v) =>
          create
            .mutateAsync({
              nameEn: v.nameEn ?? '',
              nameAr: v.nameAr ?? '',
              itemTypes: v.itemTypes,
              language: v.language,
              from: v.range?.[0]?.startOf('day').toDate() ?? null,
              to: v.range?.[1]?.endOf('day').toDate() ?? null,
            })
            .then((log) => {
              void message.success(t('mining:processhub.started'));
              navigate(logPath(log.id));
            })
            .catch((e: unknown) => void message.error(errorMessage(e))),
        )
      }
    >
      <Typography.Paragraph type="secondary">{t('mining:processhub.help')}</Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          nameEn: 'Governance reviews',
          nameAr: 'مراجعات الحوكمة',
          itemTypes: ['PROCESS', 'PAGE', 'DIAGRAM'],
          language: locale,
        }}
      >
        <Space.Compact block>
          <Form.Item name="nameEn" label={t('mining:fields.nameEn')} style={{ flex: 1 }}>
            <Input />
          </Form.Item>
          <Form.Item name="nameAr" label={t('mining:fields.nameAr')} style={{ flex: 1 }}>
            <Input dir="rtl" />
          </Form.Item>
        </Space.Compact>
        <Form.Item
          name="itemTypes"
          label={t('mining:processhub.items')}
          rules={[{ required: true }]}
        >
          <Checkbox.Group
            options={(['PROCESS', 'PAGE', 'DIAGRAM'] as const).map((k) => ({
              value: k,
              label: t(`mining:processhub.item.${k}`),
            }))}
          />
        </Form.Item>
        <Form.Item name="range" label={t('mining:processhub.period')}>
          <DatePicker.RangePicker allowEmpty={[true, true]} />
        </Form.Item>
        <Form.Item name="language" label={t('mining:processhub.language')}>
          <Radio.Group
            options={[
              { value: 'en', label: 'English' },
              { value: 'ar', label: 'العربية' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
