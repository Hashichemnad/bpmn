import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Col,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  EA_STATUSES,
  INTERFACE_DIRECTIONS,
  INTERFACE_FREQUENCIES,
  INTERFACE_TECHNOLOGIES,
  type InterfaceDto,
} from '@processhub/shared';
import { useDataObjects, useDeleteEa, useEaImport, useInterfaces, useSaveEa } from '@/api/ea';
import { PageHeader } from '@/components/PageHeader';
import { ExcelMenu } from '@/components/ExcelMenu';
import { BilingualFields } from '@/components/BilingualFields';
import { EmptyState, ErrorState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { UserSelect } from '@/features/governance/UserSelect';
import { ApplicationSelect } from './ea-components';
import { applicationPath, useEaAccess, useEaLabel, useEnumOptions } from './ea-helpers';

const useInterfaceImport = () => useEaImport('interfaces');

/** Interfaces between applications (list, filters, form, Excel). */
export function InterfacesPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const label = useEaLabel();
  const access = useEaAccess();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<InterfaceDto | 'new' | null>(null);
  const technologies = useEnumOptions('technology', INTERFACE_TECHNOLOGIES);
  const remove = useDeleteEa('interface');
  const q = {
    q: params.get('q') ?? undefined,
    applicationId: params.get('applicationId') ?? undefined,
    technology: params.get('technology') ?? undefined,
    page: Number(params.get('page') ?? 1),
    pageSize: 20,
  };
  const list = useInterfaces(q);
  const set = (k: string, v: string | null | undefined) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={t('ea:interfaces.title')}
        subtitle={t('ea:interfaces.subtitle')}
        extra={
          <>
            <ExcelMenu
              basePath="/ea"
              kind="interfaces"
              title={t('ea:interfaces.title')}
              canImport={access.canEdit}
              useImport={useInterfaceImport}
            />
            {access.canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
                {t('ea:interfaces.new')}
              </Button>
            )}
          </>
        }
      />
      <Card>
        <Flex gap={8} wrap="wrap" style={{ marginBlockEnd: 16 }}>
          <Input.Search
            allowClear
            placeholder={t('ea:filters.search')}
            defaultValue={q.q}
            onSearch={(v) => set('q', v)}
            style={{ width: 260 }}
          />
          <ApplicationSelect
            value={q.applicationId}
            onChange={(v) => set('applicationId', v as string | null)}
            placeholder={t('ea:fields.application')}
            style={{ width: 240 }}
          />
          <Select
            allowClear
            placeholder={t('ea:fields.technology')}
            value={q.technology}
            onChange={(v) => set('technology', v)}
            options={technologies}
            style={{ width: 170 }}
          />
        </Flex>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <Table<InterfaceDto>
            rowKey="id"
            size="middle"
            loading={list.isLoading}
            dataSource={list.data?.items ?? []}
            scroll={{ x: 900 }}
            locale={{ emptyText: <EmptyState description={t('ea:interfaces.empty')} /> }}
            pagination={{
              current: q.page,
              pageSize: q.pageSize,
              total: list.data?.total ?? 0,
              onChange: (p) => set('page', String(p)),
            }}
            columns={[
              {
                title: t('ea:fields.name'),
                key: 'name',
                render: (_, i) => (
                  <Space direction="vertical" size={0}>
                    <span>{loc(i) || `${loc(i.source)} → ${loc(i.target)}`}</span>
                    {i.code && (
                      <span className="ph-muted" dir="ltr" style={{ fontSize: 12 }}>
                        {i.code}
                      </span>
                    )}
                  </Space>
                ),
              },
              {
                title: t('ea:fields.source'),
                key: 'source',
                render: (_, i) => <Link to={applicationPath(i.source.id)}>{label(i.source)}</Link>,
              },
              {
                title: t('ea:fields.direction'),
                key: 'direction',
                width: 70,
                render: (_, i) =>
                  i.direction === 'TWO_WAY' ? '⇄' : <span className="ph-flip-rtl">→</span>,
              },
              {
                title: t('ea:fields.target'),
                key: 'target',
                render: (_, i) => <Link to={applicationPath(i.target.id)}>{label(i.target)}</Link>,
              },
              {
                title: t('ea:fields.technology'),
                key: 'technology',
                width: 140,
                render: (_, i) => t(`ea:technology.${i.technology}`),
              },
              {
                title: t('ea:fields.frequency'),
                key: 'frequency',
                width: 110,
                render: (_, i) => t(`ea:frequency.${i.frequency}`),
              },
              {
                title: t('ea:fields.dataObjects'),
                key: 'data',
                render: (_, i) => i.dataObjects.map((o) => <Tag key={o.id}>{loc(o)}</Tag>),
              },
              {
                title: t('ea:fields.status'),
                key: 'status',
                width: 100,
                render: (_, i) => t(`ea:status.${i.status}`),
              },
              ...(access.canEdit
                ? [
                    {
                      title: '',
                      key: 'actions',
                      width: 90,
                      render: (_: unknown, i: InterfaceDto) => (
                        <Space size={0}>
                          <Button
                            type="text"
                            icon={<EditOutlined />}
                            aria-label={t('edit')}
                            onClick={() => setEditing(i)}
                          />
                          {access.canAdmin && (
                            <Popconfirm
                              title={t('ea:interfaces.deleteConfirm')}
                              onConfirm={() =>
                                remove.mutate(i.id, {
                                  onError: (err) => message.error(errorMessage(err)),
                                })
                              }
                            >
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                aria-label={t('delete')}
                              />
                            </Popconfirm>
                          )}
                        </Space>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Card>
      {editing && (
        <InterfaceFormModal
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function InterfaceFormModal({
  item,
  preset,
  onClose,
}: {
  item?: InterfaceDto;
  preset?: { sourceId?: string; targetId?: string };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const label = useEaLabel();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [form] = Form.useForm();
  const save = useSaveEa('interface');
  const data = useDataObjects({ pageSize: 500 });
  const directions = useEnumOptions('direction', INTERFACE_DIRECTIONS);
  const technologies = useEnumOptions('technology', INTERFACE_TECHNOLOGIES);
  const frequencies = useEnumOptions('frequency', INTERFACE_FREQUENCIES);
  const statuses = useEnumOptions('status', EA_STATUSES);
  const sourceId = Form.useWatch('sourceId', form) as string | undefined;

  const initial = item
    ? {
        ...item,
        sourceId: item.source.id,
        targetId: item.target.id,
        ownerId: item.owner?.id ?? null,
        dataObjectIds: item.dataObjects.map((d) => d.id),
      }
    : {
        direction: 'ONE_WAY',
        technology: 'API',
        frequency: 'DAILY',
        status: 'ACTIVE',
        dataObjectIds: [],
        ...preset,
      };

  return (
    <Modal
      open
      width={760}
      title={item ? t('ea:interfaces.edit') : t('ea:interfaces.new')}
      okText={t('save')}
      onOk={() => form.submit()}
      onCancel={onClose}
      confirmLoading={save.isPending}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        onFinish={(v: Record<string, unknown>) =>
          save.mutate(
            {
              id: item?.id,
              body: {
                code: v.code || null,
                nameEn: v.nameEn ?? '',
                nameAr: v.nameAr ?? '',
                descriptionEn: v.descriptionEn ?? '',
                descriptionAr: v.descriptionAr ?? '',
                sourceId: v.sourceId,
                targetId: v.targetId,
                direction: v.direction,
                technology: v.technology,
                frequency: v.frequency,
                status: v.status,
                ownerId: v.ownerId ?? null,
                dataObjectIds: v.dataObjectIds ?? [],
              },
            },
            {
              onSuccess: () => {
                message.success(t('saved'));
                onClose();
              },
              onError: (err) => message.error(errorMessage(err)),
            },
          )
        }
      >
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="sourceId" label={t('ea:fields.source')} rules={[{ required: true }]}>
              <ApplicationSelect allowClear={false} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="targetId" label={t('ea:fields.target')} rules={[{ required: true }]}>
              <ApplicationSelect allowClear={false} exclude={sourceId} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="direction" label={t('ea:fields.direction')}>
              <Select options={directions} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="technology" label={t('ea:fields.technology')}>
              <Select options={technologies} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="frequency" label={t('ea:fields.frequency')}>
              <Select options={frequencies} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="status" label={t('ea:fields.status')}>
              <Select options={statuses} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="dataObjectIds" label={t('ea:fields.dataObjects')}>
          <Select
            mode="multiple"
            optionFilterProp="label"
            options={(data.data?.items ?? []).map((d) => ({ value: d.id, label: label(d) }))}
          />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="code" label={t('ea:fields.code')}>
              <Input dir="ltr" maxLength={50} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="ownerId" label={t('ea:fields.owner')}>
              <UserSelect allowClear known={item?.owner ? [item.owner] : []} />
            </Form.Item>
          </Col>
        </Row>
        <BilingualFields required={false} description />
      </Form>
    </Modal>
  );
}
