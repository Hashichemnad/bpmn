import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Button, Card, Empty, Flex, List, Select, Tag, Tooltip } from 'antd';
import { DeleteOutlined, LinkOutlined, PartitionOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useObjects, useProcessTree } from '@/api/hooks';
import { useAddPageLink, usePageLinks, useRemovePageLink } from '@/api/docs';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';

type Kind = 'PROCESS' | 'ROLE' | 'SYSTEM';

/** "Related processes" and repository objects of a page. */
export function PageLinksPanel({ pageId, canEdit }: { pageId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const loc = useLocalized();
  const errorMessage = useErrorMessage();
  const links = usePageLinks(pageId);
  const add = useAddPageLink(pageId);
  const remove = useRemovePageLink(pageId);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Kind>('PROCESS');
  const processes = useProcessTree();
  const objects = useObjects(
    { type: kind === 'PROCESS' ? 'ROLE' : kind, pageSize: 100 },
    adding && kind !== 'PROCESS',
  );

  const processLinks = (links.data ?? []).filter((l) => l.process);
  const objectLinks = (links.data ?? []).filter((l) => l.object);

  const options = useMemo(() => {
    if (kind === 'PROCESS') {
      const linked = new Set(processLinks.map((l) => l.process!.id));
      return (processes.data ?? [])
        .filter((p) => !linked.has(p.id))
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((p) => ({ value: p.id, label: `${p.code} ${loc(p)}` }));
    }
    const linked = new Set(objectLinks.map((l) => l.object!.id));
    return (objects.data?.items ?? [])
      .filter((o) => !linked.has(o.id))
      .map((o) => ({ value: o.id, label: loc(o) }));
  }, [kind, processes.data, objects.data, processLinks, objectLinks, loc]);

  const onAdd = (targetId: string) =>
    add.mutate(
      { targetType: kind === 'PROCESS' ? 'PROCESS' : 'OBJECT', targetId },
      { onError: (err) => message.error(errorMessage(err)) },
    );

  const removeButton = (id: string) =>
    canEdit && (
      <Button
        key="remove"
        size="small"
        type="text"
        danger
        icon={<DeleteOutlined />}
        aria-label={t('docs:links.remove')}
        onClick={() => remove.mutate(id, { onError: (err) => message.error(errorMessage(err)) })}
      />
    );

  return (
    <Card
      size="small"
      title={
        <span className="ph-card-title-wrap">
          <LinkOutlined /> {t('docs:links.title')}
        </span>
      }
      loading={links.isLoading}
      extra={
        canEdit && (
          <Button
            size="small"
            type="link"
            icon={<PlusOutlined />}
            onClick={() => setAdding((v) => !v)}
          >
            {t('docs:links.add')}
          </Button>
        )
      }
    >
      {adding && (
        <Flex gap={8} wrap="wrap" style={{ marginBottom: 12 }}>
          <Select
            size="small"
            value={kind}
            onChange={setKind}
            style={{ inlineSize: 130 }}
            options={(['PROCESS', 'ROLE', 'SYSTEM'] as const).map((k) => ({
              value: k,
              label: t(`docs:links.kind.${k}`),
            }))}
          />
          <Select
            size="small"
            showSearch
            optionFilterProp="label"
            style={{ flex: 1, minInlineSize: 160 }}
            placeholder={t('docs:links.choose')}
            value={null}
            options={options}
            onChange={(v: string) => onAdd(v)}
            loading={kind === 'PROCESS' ? processes.isLoading : objects.isLoading}
          />
        </Flex>
      )}
      {!processLinks.length && !objectLinks.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('docs:links.none')} />
      ) : (
        <>
          {processLinks.length > 0 && (
            <List
              size="small"
              header={<strong>{t('docs:links.processes')}</strong>}
              dataSource={processLinks}
              renderItem={(l) => (
                <List.Item actions={[removeButton(l.id)]} className="ph-link-item">
                  <div className="ph-link-row">
                    <PartitionOutlined className="ph-muted" />
                    <Link to={`/processes/${l.process!.id}`} className="ph-link-text">
                      <span dir="ltr" className="ph-tree-code">
                        {l.process!.code}
                      </span>{' '}
                      {loc(l.process)}
                    </Link>
                    {l.embedded && (
                      <Tooltip title={t('docs:links.embeddedHint')}>
                        <Tag color="blue">{t('docs:links.embedded')}</Tag>
                      </Tooltip>
                    )}
                  </div>
                </List.Item>
              )}
            />
          )}
          {objectLinks.length > 0 && (
            <List
              size="small"
              header={<strong>{t('docs:links.objects')}</strong>}
              dataSource={objectLinks}
              renderItem={(l) => (
                <List.Item actions={[removeButton(l.id)]} className="ph-link-item">
                  <div className="ph-link-row">
                    <Link to={`/library/objects/${l.object!.id}`} className="ph-link-text">
                      {loc(l.object)}
                    </Link>
                    <Tag>{t(`objects:types.${l.object!.type}`)}</Tag>
                  </div>
                </List.Item>
              )}
            />
          )}
        </>
      )}
    </Card>
  );
}
