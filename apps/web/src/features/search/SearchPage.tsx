import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, Empty, Flex, Input, List, Pagination, Select, Space, Tag, Typography } from 'antd';
import { FileTextOutlined, PartitionOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS, type SearchType } from '@processhub/shared';
import { useSearch, useSpaces } from '@/api/docs';
import { useUsers } from '@/api/hooks';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/states';
import { useFormatDate, useFormatNumber, useLocalized } from '@/components/i18n-helpers';
import { Highlight } from './Highlight';
import { hitLink } from './links';

/** Full-text search across processes and wiki pages (Arabic and English). */
export function SearchPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const fmt = useFormatNumber();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = (params.get('type') as SearchType) || 'all';
  const spaceId = params.get('spaceId') ?? undefined;
  const authorId = params.get('authorId') ?? undefined;
  const page = Number(params.get('page') ?? 1);
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  const spaces = useSpaces();
  const users = useUsers({ pageSize: 100 }, can(PERMISSIONS.USERS_READ));
  const result = useSearch({ q, type, spaceId, authorId, page, pageSize: 20 });

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  return (
    <>
      <PageHeader title={t('search:title')} subtitle={t('search:subtitle')} />
      <Card style={{ marginBottom: 16 }}>
        <Flex gap={12} wrap="wrap">
          <Input.Search
            allowClear
            enterButton
            size="large"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onSearch={(v) => set({ q: v.trim() || undefined })}
            placeholder={t('search:placeholder')}
            aria-label={t('search:placeholder')}
            style={{ flex: '1 1 320px' }}
          />
          <Select
            size="large"
            value={type}
            onChange={(v) => set({ type: v === 'all' ? undefined : v })}
            style={{ inlineSize: 170 }}
            options={(['all', 'pages', 'processes'] as const).map((v) => ({
              value: v,
              label: t(`search:types.${v}`),
            }))}
            aria-label={t('search:typeFilter')}
          />
          <Select
            size="large"
            allowClear
            value={spaceId}
            onChange={(v) => set({ spaceId: v })}
            placeholder={t('search:allSpaces')}
            style={{ inlineSize: 200 }}
            options={(spaces.data ?? []).map((s) => ({ value: s.id, label: loc(s) }))}
            aria-label={t('search:spaceFilter')}
          />
          {can(PERMISSIONS.USERS_READ) && (
            <Select
              size="large"
              allowClear
              showSearch
              optionFilterProp="label"
              value={authorId}
              onChange={(v) => set({ authorId: v })}
              placeholder={t('search:anyAuthor')}
              style={{ inlineSize: 200 }}
              options={(users.data?.items ?? []).map((u) => ({
                value: u.id,
                label: loc(u) || u.email,
              }))}
              aria-label={t('search:authorFilter')}
            />
          )}
        </Flex>
      </Card>
      {!q ? (
        <Card>
          <Empty description={t('search:hint')} />
        </Card>
      ) : result.isError ? (
        <ErrorState error={result.error} onRetry={() => void result.refetch()} />
      ) : (
        <Card
          title={
            result.data
              ? t('search:results', { count: result.data.total, formatted: fmt(result.data.total) })
              : undefined
          }
        >
          <List
            loading={result.isLoading || result.isFetching}
            dataSource={result.data?.items ?? []}
            locale={{ emptyText: <Empty description={t('search:noResults', { q })} /> }}
            renderItem={(h) => (
              <List.Item>
                <List.Item.Meta
                  avatar={
                    h.type === 'page' ? (
                      <FileTextOutlined className="ph-search-icon" />
                    ) : (
                      <PartitionOutlined className="ph-search-icon" />
                    )
                  }
                  title={
                    <Space wrap size={6}>
                      <Link to={hitLink(h)}>
                        {h.code && (
                          <span className="ph-tree-code" dir="ltr">
                            {h.code}{' '}
                          </span>
                        )}
                        {loc(h, 'title') || t('docs:untitled')}
                      </Link>
                      <Tag>{h.type === 'page' ? t('search:page') : t('search:process')}</Tag>
                      {h.space && <Tag color="blue">{loc(h.space)}</Tag>}
                    </Space>
                  }
                  description={
                    <>
                      {h.snippet && (
                        <Typography.Paragraph
                          className="ph-search-snippet"
                          style={{ marginBottom: 4 }}
                        >
                          <Highlight text={h.snippet} />
                        </Typography.Paragraph>
                      )}
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDate(h.updatedAt)}
                        {h.author && ` · ${loc(h.author) || h.author.email}`}
                      </Typography.Text>
                    </>
                  }
                />
              </List.Item>
            )}
          />
          {(result.data?.total ?? 0) > 20 && (
            <Pagination
              style={{ marginTop: 16, textAlign: 'center' }}
              current={page}
              pageSize={20}
              total={result.data?.total}
              showSizeChanger={false}
              onChange={(p) => set({ page: String(p) })}
            />
          )}
        </Card>
      )}
    </>
  );
}
