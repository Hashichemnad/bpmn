import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  App,
  Badge,
  Button,
  Card,
  Flex,
  Input,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  type TableProps,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { ObjectStatus, RepoObjectDto } from '@processhub/shared';
import { useObjects } from '@/api/hooks';
import { useApproveTerm, useRejectTerm } from '@/api/dictionary';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState } from '@/components/states';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { useLocale } from '@/app/LocaleProvider';
import { ObjectFormModal } from './ObjectFormModal';
import { useConfirmDeleteObject } from './useConfirmDeleteObject';
import { synonymsOf, useObjectAccess } from './term-access';

/**
 * Dictionary (Modeler design B2, D-083): approved business terms with definition, synonyms,
 * category and owner, and the proposals waiting for an approver.
 */
export function DictionaryPage() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const loc = useLocalized();
  const errorMessage = useErrorMessage();
  const { message, modal } = App.useApp();
  const access = useObjectAccess();
  const [status, setStatus] = useState<ObjectStatus>('APPROVED');
  const [query, setQuery] = useState({
    page: 1,
    pageSize: 20,
    q: undefined as string | undefined,
    sort: 'nameEn',
    order: 'asc' as 'asc' | 'desc',
  });
  const terms = useObjects({ ...query, type: 'TERM', status });
  const proposals = useObjects({ type: 'TERM', status: 'DRAFT', pageSize: 1 });
  const approve = useApproveTerm();
  const reject = useRejectTerm();
  const [editing, setEditing] = useState<RepoObjectDto | 'new' | null>(null);
  const confirmDelete = useConfirmDeleteObject();

  const doApprove = (o: RepoObjectDto) =>
    approve.mutate(o.id, {
      onSuccess: () => message.success(t('objects:dictionary.approved')),
      onError: (err) => message.error(errorMessage(err)),
    });
  const doReject = (o: RepoObjectDto) => {
    let reason = '';
    modal.confirm({
      title: t('objects:dictionary.rejectTitle', { name: loc(o) }),
      content: (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text>{t('objects:dictionary.rejectText')}</Typography.Text>
          <Input.TextArea
            rows={2}
            maxLength={1000}
            placeholder={t('objects:dictionary.rejectReason')}
            aria-label={t('objects:dictionary.rejectReason')}
            onChange={(e) => (reason = e.target.value)}
          />
        </Space>
      ),
      okText: t('objects:dictionary.reject'),
      okButtonProps: { danger: true },
      cancelText: t('cancel'),
      onOk: () =>
        reject
          .mutateAsync({ id: o.id, reason: reason.trim() || undefined })
          .then(() => message.success(t('objects:dictionary.rejected')))
          .catch((err) => message.error(errorMessage(err))),
    });
  };

  const columns: TableProps<RepoObjectDto>['columns'] = [
    {
      title: t('fields.name'),
      key: 'nameEn',
      sorter: true,
      render: (_, o) => {
        const synonyms = synonymsOf(o, locale === 'ar');
        return (
          <Space direction="vertical" size={0}>
            <Link to={`/library/objects/${o.id}`}>
              <Typography.Text strong>{loc(o)}</Typography.Text>
            </Link>
            {synonyms.length > 0 && (
              <span className="ph-synonyms">
                {t('objects:dictionary.synonyms')}: {synonyms.join(' · ')}
              </span>
            )}
          </Space>
        );
      },
    },
    {
      title: t('objects:dictionary.definition'),
      key: 'description',
      ellipsis: true,
      render: (_, o) => (
        <Typography.Text type="secondary">{loc(o, 'description') || '—'}</Typography.Text>
      ),
    },
    {
      title: t('objects:dictionary.category'),
      dataIndex: 'category',
      key: 'category',
      sorter: true,
      width: 150,
      render: (c: string | null) => (c ? <Tag>{c}</Tag> : '—'),
    },
    status === 'DRAFT'
      ? {
          title: t('objects:dictionary.proposedBy'),
          key: 'createdBy',
          width: 170,
          render: (_, o) => (o.createdBy ? loc(o.createdBy) || o.createdBy.email : '—'),
        }
      : {
          title: t('objects:dictionary.owner'),
          key: 'owner',
          width: 170,
          render: (_, o) => (o.owner ? loc(o.owner) || o.owner.email : '—'),
        },
    {
      title: t('objects:usage'),
      dataIndex: 'usageCount',
      width: 140,
      render: (n: number) =>
        n ? (
          <Tag color="blue">{t('objects:usedInSteps', { count: n })}</Tag>
        ) : (
          <Tag>{t('objects:unused')}</Tag>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: status === 'DRAFT' ? 210 : 90,
      render: (_, o) => (
        <Space size={0} wrap>
          {o.status === 'DRAFT' && access.canApprove && (
            <>
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                loading={approve.isPending && approve.variables === o.id}
                onClick={() => doApprove(o)}
              >
                {t('objects:dictionary.approve')}
              </Button>
              <Button
                size="small"
                type="text"
                danger
                icon={<CloseOutlined />}
                onClick={() => doReject(o)}
              >
                {t('objects:dictionary.reject')}
              </Button>
            </>
          )}
          {access.canEdit(o) && (
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => setEditing(o)}
              aria-label={t('edit')}
              title={t('edit')}
            />
          )}
          {access.canDelete(o) && o.status === 'APPROVED' && (
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => confirmDelete(o)}
              aria-label={t('delete')}
              title={t('delete')}
            />
          )}
        </Space>
      ),
    },
  ];

  const canAdd = access.canPropose || access.canApprove;
  const addLabel = access.canApprove ? t('objects:new.TERM') : t('objects:dictionary.propose');
  const proposalCount = proposals.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title={t('objects:library.TERM.title')}
        subtitle={t('objects:library.TERM.subtitle')}
        extra={
          canAdd && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
              {addLabel}
            </Button>
          )
        }
      />
      <Card>
        <Flex justify="space-between" wrap="wrap" gap={12} style={{ marginBottom: 8 }}>
          <Tabs
            activeKey={status}
            onChange={(k) => {
              setStatus(k as ObjectStatus);
              setQuery((q) => ({ ...q, page: 1 }));
            }}
            items={[
              { key: 'APPROVED', label: t('objects:dictionary.approvedTab') },
              {
                key: 'DRAFT',
                label: (
                  <Space size={6}>
                    {t('objects:dictionary.proposalsTab')}
                    {proposalCount > 0 && <Badge count={proposalCount} size="small" />}
                  </Space>
                ),
              },
            ]}
          />
          <Input.Search
            allowClear
            placeholder={t('objects:dictionary.searchHint')}
            style={{ width: 300 }}
            onSearch={(q) => setQuery((s) => ({ ...s, q: q || undefined, page: 1 }))}
          />
        </Flex>
        {terms.isError ? (
          <ErrorState error={terms.error} onRetry={() => void terms.refetch()} />
        ) : (
          <Table<RepoObjectDto>
            rowKey="id"
            columns={columns}
            dataSource={terms.data?.items}
            loading={terms.isFetching}
            scroll={{ x: 900 }}
            locale={{
              emptyText: (
                <EmptyState
                  description={
                    status === 'DRAFT'
                      ? t('objects:dictionary.noProposals')
                      : t('objects:library.TERM.empty')
                  }
                  action={
                    canAdd &&
                    status === 'APPROVED' && (
                      <Button onClick={() => setEditing('new')}>{addLabel}</Button>
                    )
                  }
                />
              ),
            }}
            pagination={{
              current: query.page,
              pageSize: query.pageSize,
              total: terms.data?.total,
              showTotal: (total) => t('totalItems', { count: total }),
            }}
            onChange={(p, _f, sorter) => {
              const s = Array.isArray(sorter) ? sorter[0] : sorter;
              setQuery((q) => ({
                ...q,
                page: p.current ?? 1,
                pageSize: p.pageSize ?? 20,
                sort: s?.order ? String(s.columnKey) : 'nameEn',
                order: s?.order === 'descend' ? 'desc' : 'asc',
              }));
            }}
          />
        )}
      </Card>
      {editing && (
        <ObjectFormModal
          open
          type="TERM"
          object={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
