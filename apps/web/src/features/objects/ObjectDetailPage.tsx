import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { App, Button, Card, Col, Descriptions, Flex, Row, Table, Tag, Typography } from 'antd';
import {
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  FileExcelOutlined,
  FormOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { isGrcObjectType, type ObjectUsageDto } from '@processhub/shared';
import { grcItemPath } from '@/features/grc/grc-helpers';
import { useObject, useObjectUsage } from '@/api/hooks';
import { useApproveTerm } from '@/api/dictionary';
import { PageHeader } from '@/components/PageHeader';
import { CategoryTag } from '@/components/tags';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { RelatedDocsCard } from '@/features/docs/RelatedDocsCard';
import { ObjectFormModal } from './ObjectFormModal';
import { useConfirmDeleteObject } from './useConfirmDeleteObject';
import { useObjectAccess } from './term-access';
import { RenameModal } from './RenameModal';
import { useReports } from '@/features/reports/useReports';
import { useLocale } from '@/app/LocaleProvider';

const LIBRARY_PATH: Record<string, string> = {
  ROLE: '/library/roles',
  SYSTEM: '/library/systems',
  DOCUMENT: '/library/documents',
  TERM: '/library/dictionary',
};

export function ObjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const access = useObjectAccess();
  const loc = useLocalized();
  const errorMessage = useErrorMessage();
  const { message } = App.useApp();
  const approve = useApproveTerm();
  const [renaming, setRenaming] = useState(false);
  const reports = useReports();
  const { locale } = useLocale();
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  const object = useObject(id);
  const usage = useObjectUsage(id);
  const [editing, setEditing] = useState(false);
  const confirmDelete = useConfirmDeleteObject();

  if (object.isLoading) return <LoadingState />;
  if (object.isError || !object.data)
    return <ErrorState error={object.error} onRetry={() => void object.refetch()} />;
  const o = object.data;
  // Risks, controls and requirements have their own pages (Risk & Compliance).
  if (isGrcObjectType(o.type)) return <Navigate to={grcItemPath(o.type, o.id)} replace />;
  const libraryPath = LIBRARY_PATH[o.type];
  const attributes = Object.entries(o.attributes);
  const isTerm = o.type === 'TERM';
  const person = (u: typeof o.owner) => (u ? loc(u) || u.email : '—');

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('nav.library') },
          {
            title: t(`objects:library.${o.type}.title`, {
              defaultValue: t(`objects:types.${o.type}`),
            }),
            to: libraryPath,
          },
          { title: loc(o) },
        ]}
        title={loc(o)}
        subtitle={
          <>
            <Tag>{t(`objects:types.${o.type}`)}</Tag>
            {isTerm && (
              <Tag color={o.status === 'DRAFT' ? 'orange' : 'green'}>
                {t(`objects:dictionary.status.${o.status}`)}
              </Tag>
            )}
            {o.code && <span dir="ltr">{o.code}</span>}
          </>
        }
        extra={
          <Flex gap={8} wrap="wrap">
            {isTerm && o.status === 'DRAFT' && access.canApprove && (
              <Button
                type="primary"
                icon={<CheckOutlined />}
                loading={approve.isPending}
                onClick={() =>
                  approve.mutate(o.id, {
                    onSuccess: () => message.success(t('objects:dictionary.approved')),
                    onError: (err) => message.error(errorMessage(err)),
                  })
                }
              >
                {t('objects:dictionary.approve')}
              </Button>
            )}
            {access.canEdit(o) && (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {t('edit')}
              </Button>
            )}
            {access.canRename(o) && (
              <Button icon={<FormOutlined />} onClick={() => setRenaming(true)}>
                {t('objects:rename.button')}
              </Button>
            )}
            {access.canDelete(o) && (
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() => confirmDelete(o, () => navigate(libraryPath ?? '/'))}
              >
                {t('delete')}
              </Button>
            )}
          </Flex>
        }
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} xl={9}>
          <Card title={t('processes:details')}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('fields.nameEn')}>
                <span dir="ltr">{o.nameEn || '—'}</span>
              </Descriptions.Item>
              <Descriptions.Item label={t('fields.nameAr')}>
                <span dir="rtl">{o.nameAr || '—'}</span>
              </Descriptions.Item>
              <Descriptions.Item
                label={isTerm ? t('objects:dictionary.definitionEn') : t('fields.descriptionEn')}
              >
                <span dir="ltr" className="ph-prewrap">
                  {o.descriptionEn || '—'}
                </span>
              </Descriptions.Item>
              <Descriptions.Item
                label={isTerm ? t('objects:dictionary.definitionAr') : t('fields.descriptionAr')}
              >
                <span dir="rtl" className="ph-prewrap">
                  {o.descriptionAr || '—'}
                </span>
              </Descriptions.Item>
              {isTerm && (
                <>
                  <Descriptions.Item label={t('objects:dictionary.synonymsEn')}>
                    <span dir="ltr">{o.synonymsEn.join(' · ') || '—'}</span>
                  </Descriptions.Item>
                  <Descriptions.Item label={t('objects:dictionary.synonymsAr')}>
                    <span dir="rtl">{o.synonymsAr.join(' · ') || '—'}</span>
                  </Descriptions.Item>
                  <Descriptions.Item label={t('objects:dictionary.category')}>
                    {o.category || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('objects:dictionary.owner')}>
                    {person(o.owner)}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('objects:dictionary.proposedBy')}>
                    {person(o.createdBy)}
                  </Descriptions.Item>
                  {o.approvedAt && (
                    <Descriptions.Item label={t('objects:dictionary.approvedBy')}>
                      {person(o.approvedBy)} · {formatDate(o.approvedAt)}
                    </Descriptions.Item>
                  )}
                </>
              )}
              <Descriptions.Item label={t('fields.updatedAt')}>
                {formatDate(o.updatedAt)}
              </Descriptions.Item>
            </Descriptions>
          </Card>
          <Card title={t('objects:attributes')} style={{ marginTop: 24 }}>
            {attributes.length === 0 ? (
              <Typography.Text type="secondary">{t('objects:noAttributes')}</Typography.Text>
            ) : (
              <Descriptions column={1} size="small">
                {attributes.map(([k, v]) => (
                  <Descriptions.Item key={k} label={k}>
                    {String(v)}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={15}>
          <Card
            title={t('objects:whereUsed')}
            extra={
              <Flex gap={8} align="center">
                <Tag color="blue">
                  {t('objects:usedInSteps', { count: usage.data?.length ?? 0 })}
                </Tag>
                <Button
                  size="small"
                  icon={<FileExcelOutlined />}
                  loading={reports.busy}
                  onClick={() => void reports.objectReport(o.id, locale)}
                >
                  {t('objects:exportUsage')}
                </Button>
              </Flex>
            }
          >
            {usage.isError ? (
              <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
            ) : (
              <Table<ObjectUsageDto>
                rowKey="linkId"
                loading={usage.isLoading}
                dataSource={usage.data}
                pagination={{ pageSize: 20, hideOnSinglePage: true }}
                locale={{ emptyText: <EmptyState description={t('objects:notUsed')} /> }}
                columns={[
                  {
                    title: t('objects:process'),
                    key: 'process',
                    render: (_, u) => (
                      <Link to={`/processes/${u.process.id}`}>
                        <span dir="ltr" className="ph-tree-code">
                          {u.process.code}
                        </span>{' '}
                        {loc(u.process)}
                      </Link>
                    ),
                  },
                  {
                    title: t('fields.category'),
                    key: 'category',
                    width: 150,
                    render: (_, u) => <CategoryTag category={u.process.category} />,
                  },
                  {
                    title: t('objects:step'),
                    key: 'step',
                    render: (_, u) => (
                      <Link
                        to={`/processes/${u.process.id}?tab=model&element=${encodeURIComponent(u.bpmnElementId)}`}
                      >
                        {loc(u.element) || <span dir="ltr">{u.bpmnElementId}</span>}
                      </Link>
                    ),
                  },
                  {
                    title: t('objects:relation'),
                    key: 'relation',
                    width: 140,
                    render: (_, u) => <Tag>{t(`objects:relations.${u.relation}`)}</Tag>,
                  },
                ]}
              />
            )}
          </Card>
          <div style={{ marginTop: 24 }}>
            <RelatedDocsCard kind="objects" id={o.id} />
          </div>
        </Col>
      </Row>
      {editing && (
        <ObjectFormModal open type={o.type} object={o} onClose={() => setEditing(false)} />
      )}
      {renaming && <RenameModal object={o} onClose={() => setRenaming(false)} />}
    </>
  );
}
