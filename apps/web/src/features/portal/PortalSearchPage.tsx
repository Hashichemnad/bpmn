import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Card,
  Empty,
  Flex,
  Input,
  List,
  Pagination,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { FileTextOutlined, PartitionOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  PROCESS_CATEGORIES,
  type PortalSearchType,
  type ProcessCategory,
} from '@processhub/shared';
import { usePortalSearch, usePortalSpaces } from '@/api/portal';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { CategoryTag } from '@/components/tags';
import { useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { DiagramTypeIcon } from '@/features/diagrams/DiagramTypeIcon';
import { Highlight } from '@/features/search/Highlight';
import { portalItemLink } from './portal-links';

/** Search over published processes and pages (Arabic and English) with filters. */
export function PortalSearchPage() {
  const { t } = useTranslation();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = (params.get('type') as PortalSearchType) || 'all';
  const category = (params.get('category') as ProcessCategory) || undefined;
  const spaceId = params.get('spaceId') || undefined;
  const page = Number(params.get('page') || 1);
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  const spaces = usePortalSpaces();
  const results = usePortalSearch({ q, type, category, spaceId, page, pageSize: 20 });

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
      <PageHeader
        crumbs={[{ title: t('portal:nav.home'), to: '/portal' }, { title: t('portal:nav.search') }]}
        title={t('portal:search.title')}
      />
      <Card>
        <Input.Search
          size="large"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onSearch={(v) => set({ q: v.trim() || undefined })}
          placeholder={t('portal:searchHero')}
          enterButton
          allowClear
        />
        <Flex gap={12} wrap="wrap" style={{ marginBlockStart: 12 }}>
          <Segmented
            value={type}
            onChange={(v) =>
              set({
                type: v === 'all' ? undefined : String(v),
                category: undefined,
                spaceId: undefined,
              })
            }
            options={[
              { value: 'all', label: t('portal:search.all') },
              { value: 'processes', label: t('portal:nav.processes') },
              { value: 'pages', label: t('portal:nav.docs') },
            ]}
          />
          {type !== 'pages' && (
            <Select
              allowClear
              style={{ minInlineSize: 180 }}
              placeholder={t('portal:search.category')}
              value={category}
              onChange={(v?: string) =>
                set({ category: v, type: v ? 'processes' : type === 'all' ? undefined : type })
              }
              options={PROCESS_CATEGORIES.map((c) => ({
                value: c,
                label: t(`processes:category.${c}`),
              }))}
            />
          )}
          {type !== 'processes' && (
            <Select
              allowClear
              style={{ minInlineSize: 200 }}
              placeholder={t('portal:search.space')}
              value={spaceId}
              onChange={(v?: string) =>
                set({ spaceId: v, type: v ? 'pages' : type === 'all' ? undefined : type })
              }
              options={(spaces.data ?? []).map((s) => ({ value: s.id, label: loc(s) }))}
            />
          )}
        </Flex>
      </Card>
      <div style={{ marginBlockStart: 16 }}>
        {!q ? (
          <Empty description={t('portal:search.prompt')} />
        ) : results.isLoading ? (
          <LoadingState />
        ) : results.isError ? (
          <ErrorState error={results.error} />
        ) : results.data?.items.length ? (
          <Card>
            <Typography.Text type="secondary">
              {t('portal:search.count', { count: results.data.total })}
            </Typography.Text>
            <List
              itemLayout="vertical"
              dataSource={results.data.items}
              renderItem={(r) => (
                <List.Item key={`${r.type}-${r.id}`}>
                  <Space size={6} wrap>
                    {r.type === 'PROCESS' ? (
                      <PartitionOutlined />
                    ) : r.type === 'DIAGRAM' ? (
                      <DiagramTypeIcon type={r.diagramType} />
                    ) : (
                      <FileTextOutlined />
                    )}
                    <Link to={portalItemLink(r)} style={{ fontSize: 16, fontWeight: 600 }}>
                      {r.code && (
                        <span dir="ltr" className="ph-title-code" style={{ marginInlineEnd: 6 }}>
                          {r.code}
                        </span>
                      )}
                      {loc(r, 'title') || t('docs:untitled')}
                    </Link>
                    {r.category && <CategoryTag category={r.category} />}
                    {r.space && <Tag bordered={false}>{loc(r.space)}</Tag>}
                  </Space>
                  {r.snippet && (
                    <Typography.Paragraph type="secondary" style={{ margin: '6px 0 0' }} dir="auto">
                      <Highlight text={r.snippet} />
                    </Typography.Paragraph>
                  )}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.versionLabel || t('governance:versionN', { number: r.versionNumber })} ·{' '}
                    {t('portal:updatedOn', { date: formatDate(r.publishedAt, false) })}
                  </Typography.Text>
                </List.Item>
              )}
            />
            <Pagination
              style={{ marginBlockStart: 12, textAlign: 'center' }}
              current={page}
              pageSize={20}
              total={results.data.total}
              hideOnSinglePage
              onChange={(p) => set({ page: String(p) })}
            />
          </Card>
        ) : (
          <Empty description={t('portal:search.none', { q })} />
        )}
      </div>
    </>
  );
}
