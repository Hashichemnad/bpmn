import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { App, Button, Card, Col, Flex, Row, Select, Space, Table, Typography } from 'antd';
import {
  ApartmentOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  PartitionOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  IMPORT_BATCH_STATUSES,
  IMPORT_GROUPS,
  type ImportBatchSummaryDto,
  type ImportGroup,
  type ImportKind,
} from '@processhub/shared';
import { useImportBatches, useImportKinds, type ImportQuery } from '@/api/imports';
import { apiDownload } from '@/api/client';
import { useLocale } from '@/app/LocaleProvider';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState } from '@/components/states';
import {
  useErrorMessage,
  useFormatDate,
  useFormatNumber,
  useLocalized,
} from '@/components/i18n-helpers';
import { downloadBlob } from '@/features/modeler/export';
import { ImportStatusTag } from './import-helpers';
import { NewImportModal } from './NewImportModal';

const GROUP_ICONS: Record<ImportGroup, React.ReactNode> = {
  STRUCTURE: <ApartmentOutlined />,
  DIAGRAMS: <PartitionOutlined />,
  DOCUMENTS: <FileTextOutlined />,
  LIBRARY: <DatabaseOutlined />,
  PACKAGE: <FolderOpenOutlined />,
};

/** Import Center (M15): import kinds by group and the history of batches. */
export function ImportCenterPage() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const formatNumber = useFormatNumber();
  const kinds = useImportKinds();
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState<ImportKind | null>(null);
  const query: ImportQuery = {
    page: Number(params.get('page') ?? 1),
    pageSize: 20,
    kind: params.get('kind'),
    status: params.get('status'),
  };
  const list = useImportBatches(query);
  const setFilter = (k: string, v: string | undefined) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('page');
    setParams(next, { replace: true });
  };

  const template = async (k: ImportKind) => {
    try {
      const f = await apiDownload(`/imports/templates/${k}`, { query: { locale } }, `${k}.xlsx`);
      downloadBlob(f.blob, f.fileName);
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const available = kinds.data ?? [];
  return (
    <>
      <PageHeader title={t('imports:center.title')} subtitle={t('imports:center.subtitle')} />
      <Row gutter={[16, 16]} style={{ marginBlockEnd: 16 }}>
        {IMPORT_GROUPS.map((g) => {
          const items = available.filter((k) => k.info.group === g);
          if (!items.length) return null;
          return (
            <Col key={g} xs={24} md={12} xl={8}>
              <Card
                size="small"
                title={
                  <Space>
                    {GROUP_ICONS[g]}
                    {t(`imports:group.${g}`)}
                  </Space>
                }
                style={{ height: '100%' }}
              >
                <Flex vertical gap={6}>
                  {items.map(({ kind: k, info }) => (
                    <Flex key={k} justify="space-between" align="center" gap={8}>
                      <Typography.Text>{t(`imports:kind.${k}`)}</Typography.Text>
                      <Space size={4}>
                        {info.template && (
                          <Button
                            size="small"
                            type="text"
                            icon={<DownloadOutlined />}
                            title={t('imports:center.template')}
                            aria-label={t('imports:center.template')}
                            onClick={() => void template(k)}
                          />
                        )}
                        <Button
                          size="small"
                          icon={<CloudUploadOutlined />}
                          data-testid={`import-kind-${k}`}
                          onClick={() => setKind(k)}
                        >
                          {t('imports:center.import')}
                        </Button>
                      </Space>
                    </Flex>
                  ))}
                </Flex>
              </Card>
            </Col>
          );
        })}
      </Row>
      <Card title={t('imports:center.history')}>
        <Flex gap={8} wrap="wrap" style={{ marginBlockEnd: 16 }}>
          <Select
            allowClear
            placeholder={t('imports:fields.kind')}
            style={{ width: 240 }}
            value={(query.kind as string) || undefined}
            onChange={(v) => setFilter('kind', v)}
            options={available.map((k) => ({ value: k.kind, label: t(`imports:kind.${k.kind}`) }))}
          />
          <Select
            allowClear
            placeholder={t('imports:fields.status')}
            style={{ width: 180 }}
            value={(query.status as string) || undefined}
            onChange={(v) => setFilter('status', v)}
            options={IMPORT_BATCH_STATUSES.map((s) => ({
              value: s,
              label: t(`imports:status.${s}`),
            }))}
          />
        </Flex>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <Table<ImportBatchSummaryDto>
            rowKey="id"
            data-testid="import-batches"
            loading={list.isLoading}
            dataSource={list.data?.items ?? []}
            scroll={{ x: 900 }}
            locale={{ emptyText: <EmptyState description={t('imports:center.empty')} /> }}
            onRow={(b) => ({ onDoubleClick: () => navigate(`/admin/imports/${b.id}`) })}
            pagination={{
              current: query.page as number,
              pageSize: 20,
              total: list.data?.total ?? 0,
              onChange: (page) => {
                const next = new URLSearchParams(params);
                next.set('page', String(page));
                setParams(next, { replace: true });
              },
            }}
            columns={[
              {
                title: t('imports:fields.number'),
                width: 110,
                render: (_, b) => <Link to={`/admin/imports/${b.id}`}>{b.number}</Link>,
              },
              { title: t('imports:fields.kind'), render: (_, b) => t(`imports:kind.${b.kind}`) },
              {
                title: t('imports:fields.files'),
                ellipsis: true,
                render: (_, b) => b.fileNames.join(', '),
              },
              {
                title: t('imports:fields.status'),
                width: 130,
                render: (_, b) => <ImportStatusTag status={b.status} />,
              },
              {
                title: t('imports:fields.outcome'),
                width: 220,
                render: (_, b) =>
                  b.result
                    ? t('imports:center.resultLine', {
                        created: formatNumber(b.result.created),
                        updated: formatNumber(b.result.updated),
                        failed: formatNumber(b.result.failed),
                      })
                    : b.summary
                      ? t('imports:center.summaryLine', {
                          create: formatNumber(b.summary.create),
                          update: formatNumber(b.summary.update),
                          errors: formatNumber(b.summary.errors),
                        })
                      : '—',
              },
              {
                title: t('imports:fields.createdBy'),
                render: (_, b) => (b.createdBy ? loc(b.createdBy) : '—'),
              },
              {
                title: t('imports:fields.createdAt'),
                width: 180,
                render: (_, b) => formatDate(b.createdAt),
              },
            ]}
          />
        )}
      </Card>
      {kind && <NewImportModal kind={kind} onClose={() => setKind(null)} />}
    </>
  );
}
