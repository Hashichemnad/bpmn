import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Flex,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { DATA_CLASSIFICATIONS, type ApplicationRef, type DataObjectDto } from '@processhub/shared';
import { useDataObjects, useDeleteEa, useEaImport, useSaveEa } from '@/api/ea';
import { PageHeader } from '@/components/PageHeader';
import { ExcelMenu } from '@/components/ExcelMenu';
import { EmptyState, ErrorState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { UserSelect } from '@/features/governance/UserSelect';
import { ApplicationSelect, ClassificationTag } from './ea-components';
import { applicationPath, useEaAccess, useEaLabel, useEnumOptions } from './ea-helpers';

const useDataImport = () => useEaImport('data-objects');
const CRUD = ['create', 'read', 'update', 'delete'] as const;
const letters = (u: Record<(typeof CRUD)[number], boolean>) =>
  CRUD.filter((k) => u[k])
    .map((k) => k[0].toUpperCase())
    .join('');

/** Data objects: list with system of record and the CRUD matrix (applications × data objects). */
export function DataObjectsPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const label = useEaLabel();
  const access = useEaAccess();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'matrix' ? 'matrix' : 'list';
  const [editing, setEditing] = useState<DataObjectDto | 'new' | null>(null);
  const classifications = useEnumOptions('classification', DATA_CLASSIFICATIONS);
  const q = params.get('q') ?? undefined;
  const classification = params.get('classification') ?? undefined;
  const list = useDataObjects({ q, classification, pageSize: 500 });
  const remove = useDeleteEa('dataObject');
  const items = list.data?.items ?? [];
  const set = (k: string, v: string | null | undefined) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  // Matrix columns: every application that is a system of record or uses a data object.
  const apps = useMemo(() => {
    const m = new Map<string, ApplicationRef>();
    for (const d of items) {
      if (d.systemOfRecord) m.set(d.systemOfRecord.id, d.systemOfRecord);
      for (const u of d.usages) m.set(u.application.id, u.application);
    }
    return [...m.values()].sort((a, b) => label(a).localeCompare(label(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  return (
    <>
      <PageHeader
        title={t('ea:dataObjects.title')}
        subtitle={t('ea:dataObjects.subtitle')}
        extra={
          <>
            <ExcelMenu
              basePath="/ea"
              kind="data-objects"
              title={t('ea:dataObjects.title')}
              canImport={access.canEdit}
              useImport={useDataImport}
            />
            {access.canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
                {t('ea:dataObjects.new')}
              </Button>
            )}
          </>
        }
      />
      <Card>
        <Flex gap={8} wrap="wrap" align="center" style={{ marginBlockEnd: 16 }}>
          <Segmented
            value={view}
            onChange={(v) => set('view', v === 'matrix' ? 'matrix' : null)}
            options={[
              { value: 'list', label: t('ea:dataObjects.list') },
              { value: 'matrix', label: t('ea:dataObjects.matrix') },
            ]}
          />
          <Input.Search
            allowClear
            placeholder={t('ea:filters.search')}
            defaultValue={q}
            onSearch={(v) => set('q', v)}
            style={{ width: 240 }}
          />
          <Select
            allowClear
            placeholder={t('ea:fields.classification')}
            value={classification}
            onChange={(v) => set('classification', v)}
            options={classifications}
            style={{ width: 170 }}
          />
        </Flex>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : view === 'matrix' ? (
          <>
            <Typography.Paragraph type="secondary">
              {t('ea:dataObjects.matrixHint')}
            </Typography.Paragraph>
            <Table<DataObjectDto>
              rowKey="id"
              size="small"
              bordered
              data-testid="crud-matrix"
              loading={list.isLoading}
              dataSource={items}
              pagination={false}
              scroll={{ x: 200 + apps.length * 110 }}
              columns={[
                {
                  title: t('ea:fields.dataObjects'),
                  key: 'n',
                  fixed: 'left',
                  width: 200,
                  render: (_, d) => label(d),
                },
                ...apps.map((a) => ({
                  title: <Link to={applicationPath(a.id)}>{a.code || loc(a)}</Link>,
                  key: a.id,
                  width: 110,
                  align: 'center' as const,
                  render: (_: unknown, d: DataObjectDto) => {
                    const u = d.usages.find((x) => x.application.id === a.id);
                    const sor = d.systemOfRecord?.id === a.id;
                    if (!u && !sor) return null;
                    return (
                      <span dir="ltr" style={{ fontFamily: 'monospace' }}>
                        {u ? letters(u) : ''}
                        {sor ? ' ★' : ''}
                      </span>
                    );
                  },
                })),
              ]}
            />
          </>
        ) : (
          <Table<DataObjectDto>
            rowKey="id"
            size="middle"
            loading={list.isLoading}
            dataSource={items}
            pagination={{ pageSize: 20 }}
            locale={{ emptyText: <EmptyState description={t('ea:dataObjects.empty')} /> }}
            columns={[
              {
                title: t('ea:fields.name'),
                key: 'n',
                render: (_, d) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{loc(d)}</Typography.Text>
                    {d.code && (
                      <span className="ph-muted" dir="ltr" style={{ fontSize: 12 }}>
                        {d.code}
                      </span>
                    )}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {loc(d, 'definition')}
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: t('ea:fields.classification'),
                key: 'c',
                width: 130,
                render: (_, d) => <ClassificationTag value={d.classification} />,
              },
              {
                title: t('ea:fields.systemOfRecord'),
                key: 'sor',
                width: 180,
                render: (_, d) =>
                  d.systemOfRecord ? (
                    <Link to={applicationPath(d.systemOfRecord.id)}>{label(d.systemOfRecord)}</Link>
                  ) : (
                    '—'
                  ),
              },
              {
                title: t('ea:fields.usage'),
                key: 'u',
                render: (_, d) =>
                  d.usages.map((u) => (
                    <Tag key={u.application.id}>
                      {u.application.code || loc(u.application)}:{' '}
                      <span dir="ltr">{letters(u)}</span>
                    </Tag>
                  )),
              },
              ...(access.canEdit
                ? [
                    {
                      title: '',
                      key: 'a',
                      width: 90,
                      render: (_: unknown, d: DataObjectDto) => (
                        <Space size={0}>
                          <Button
                            type="text"
                            icon={<EditOutlined />}
                            aria-label={t('edit')}
                            onClick={() => setEditing(d)}
                          />
                          {access.canAdmin && (
                            <Popconfirm
                              title={t('ea:dataObjects.deleteConfirm')}
                              onConfirm={() =>
                                remove.mutate(d.id, {
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
        <DataObjectFormModal
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

type UsageRow = { applicationId?: string; crud: string[] };

function DataObjectFormModal({ item, onClose }: { item?: DataObjectDto; onClose: () => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const [form] = Form.useForm();
  const save = useSaveEa('dataObject');
  const classifications = useEnumOptions('classification', DATA_CLASSIFICATIONS);
  const crudOptions = CRUD.map((k) => ({ value: k, label: t(`ea:crud.${k}`) }));
  const initial = item
    ? {
        ...item,
        systemOfRecordId: item.systemOfRecord?.id ?? null,
        ownerId: item.owner?.id ?? null,
        usages: item.usages.map<UsageRow>((u) => ({
          applicationId: u.application.id,
          crud: CRUD.filter((k) => u[k]),
        })),
      }
    : { classification: 'INTERNAL', usages: [] as UsageRow[] };

  return (
    <Modal
      open
      width={780}
      title={item ? t('ea:dataObjects.edit') : t('ea:dataObjects.new')}
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
        onFinish={(v: Record<string, unknown> & { usages?: UsageRow[] }) =>
          save.mutate(
            {
              id: item?.id,
              body: {
                code: v.code || null,
                nameEn: v.nameEn ?? '',
                nameAr: v.nameAr ?? '',
                definitionEn: v.definitionEn ?? '',
                definitionAr: v.definitionAr ?? '',
                classification: v.classification,
                systemOfRecordId: v.systemOfRecordId ?? null,
                ownerId: v.ownerId ?? null,
                usages: (v.usages ?? [])
                  .filter((u) => u.applicationId)
                  .map((u) => ({
                    applicationId: u.applicationId,
                    ...Object.fromEntries(CRUD.map((k) => [k, u.crud?.includes(k) ?? false])),
                  })),
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
          <Col xs={24} md={8}>
            <Form.Item name="code" label={t('ea:fields.code')}>
              <Input dir="ltr" maxLength={50} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="nameEn"
              label={t('fields.nameEn')}
              rules={[
                ({ getFieldValue }) => ({
                  validator: () =>
                    getFieldValue('nameEn') || getFieldValue('nameAr')
                      ? Promise.resolve()
                      : Promise.reject(new Error(t('validation.nameRequired'))),
                }),
              ]}
            >
              <Input dir="ltr" maxLength={300} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="nameAr" label={t('fields.nameAr')}>
              <Input dir="rtl" maxLength={300} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="definitionEn" label={t('ea:fields.definitionEn')}>
              <Input.TextArea dir="ltr" rows={3} maxLength={5000} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="definitionAr" label={t('ea:fields.definitionAr')}>
              <Input.TextArea dir="rtl" rows={3} maxLength={5000} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="classification" label={t('ea:fields.classification')}>
              <Select options={classifications} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="systemOfRecordId" label={t('ea:fields.systemOfRecord')}>
              <ApplicationSelect />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="ownerId" label={t('ea:fields.owner')}>
              <UserSelect allowClear known={item?.owner ? [item.owner] : []} />
            </Form.Item>
          </Col>
        </Row>
        <Typography.Text strong>{t('ea:fields.usage')}</Typography.Text>
        <Form.List name="usages">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <Flex key={f.key} gap={8} align="baseline" wrap="wrap">
                  <Form.Item name={[f.name, 'applicationId']} style={{ flex: '1 1 220px' }}>
                    <ApplicationSelect
                      allowClear={false}
                      placeholder={t('ea:fields.application')}
                    />
                  </Form.Item>
                  <Form.Item name={[f.name, 'crud']}>
                    <Checkbox.Group options={crudOptions} />
                  </Form.Item>
                  <MinusCircleOutlined aria-label={t('delete')} onClick={() => remove(f.name)} />
                </Flex>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => add({ crud: ['read'] })}
                style={{ marginBlockStart: 8 }}
              >
                {t('ea:dataObjects.addApplication')}
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}
