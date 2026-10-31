import { useMemo } from 'react';
import { Col, Empty, List, Row, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { DiagramType } from '@processhub/shared';
import { useLocalized } from '@/components/i18n-helpers';
import { DiagramView } from './DiagramView';
import { diffDiagram, type DiagramChange } from './kit/diagram-diff';

/**
 * Two versions side by side with added (green), changed (orange) and removed (red) elements
 * highlighted, and the list of changes (review page and version history).
 */
export function DiagramCompare({
  type,
  baseContent,
  newContent,
  baseTitle,
  nextTitle,
}: {
  type: DiagramType;
  baseContent: string | null;
  newContent: string;
  baseTitle: string;
  nextTitle: string;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const diff = useMemo(
    () => diffDiagram(type, baseContent, newContent),
    [type, baseContent, newContent],
  );
  const nextMarkers = useMemo(
    () => ({
      'ph-diff-added': diff.added.map((c) => c.id),
      'ph-diff-changed': diff.changed.map((c) => c.id),
    }),
    [diff],
  );
  const baseMarkers = useMemo(() => ({ 'ph-diff-removed': diff.removed.map((c) => c.id) }), [diff]);
  const name = (c: DiagramChange) => {
    const l = c.after ?? c.before;
    return (l && loc(l)) || c.id;
  };
  const rows = [
    ...diff.added.map((c) => ({ c, tag: <Tag color="green">{t('diagrams:diff.added')}</Tag> })),
    ...diff.changed.map((c) => ({
      c,
      tag: (
        <Tag color="orange">{c.aspects.map((a) => t(`diagrams:diff.aspect.${a}`)).join(', ')}</Tag>
      ),
    })),
    ...diff.removed.map((c) => ({ c, tag: <Tag color="red">{t('diagrams:diff.removed')}</Tag> })),
  ];
  return (
    <>
      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Typography.Title level={5}>{baseTitle}</Typography.Title>
          {baseContent ? (
            <DiagramView type={type} content={baseContent} height={420} markers={baseMarkers} />
          ) : (
            <Empty description={t('diagrams:diff.noBase')} />
          )}
        </Col>
        <Col xs={24} lg={12}>
          <Typography.Title level={5}>{nextTitle}</Typography.Title>
          <DiagramView type={type} content={newContent} height={420} markers={nextMarkers} />
        </Col>
      </Row>
      <Typography.Title level={5} style={{ marginBlockStart: 16 }}>
        {t('diagrams:diff.title', { count: rows.length })}
      </Typography.Title>
      <List
        size="small"
        dataSource={rows}
        locale={{ emptyText: t('diagrams:diff.none') }}
        renderItem={({ c, tag }) => (
          <List.Item>
            <Space>
              {tag}
              <span>{name(c)}</span>
              {c.kind && (
                <Typography.Text type="secondary">
                  {t(`diagrams:kinds.${c.kind}`, c.kind)}
                </Typography.Text>
              )}
            </Space>
          </List.Item>
        )}
      />
    </>
  );
}
