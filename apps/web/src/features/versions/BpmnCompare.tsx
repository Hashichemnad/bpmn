import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Col, Empty, Row, Space, Table, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useLocalized } from '@/components/i18n-helpers';
import { LoadingState } from '@/components/states';
import { DiagramCanvas } from '@/features/docs/EmbeddedDiagram';
import type {
  BpmnInstance,
  Canvas,
  ElementRegistry,
  EventBus,
} from '@/features/modeler/bpmn-types';
import { diffBpmn, type BpmnChange, type BpmnChangeKind } from './bpmn-diff';

const KIND_COLOR: Record<BpmnChangeKind, string> = {
  added: 'green',
  removed: 'red',
  changed: 'gold',
  layout: 'blue',
};

interface Viewbox {
  x: number;
  y: number;
  width: number;
  height: number;
}
type CanvasWithViewbox = Canvas & { viewbox(box?: Viewbox): Viewbox };

/** Applies diff markers: the old model shows removals, the new one additions; both show changes. */
function mark(viewer: BpmnInstance, changes: BpmnChange[], side: 'old' | 'new') {
  const canvas = viewer.get<Canvas>('canvas');
  const registry = viewer.get<ElementRegistry>('elementRegistry');
  for (const c of changes) {
    if ((c.kind === 'added' && side === 'old') || (c.kind === 'removed' && side === 'new'))
      continue;
    if (registry.get(c.id)) canvas.addMarker(c.id, `ph-diff-${c.kind}`);
  }
}

/**
 * Visual compare of two BPMN versions (bpmn-js-differ): side-by-side canvases with
 * synchronised pan/zoom, coloured markers and a list of changes.
 */
export function BpmnCompare({
  oldXml,
  newXml,
  oldTitle,
  newTitle,
}: {
  oldXml: string;
  newXml: string;
  oldTitle: string;
  newTitle: string;
}) {
  const { t, i18n } = useTranslation();
  const loc = useLocalized();
  const [changes, setChanges] = useState<BpmnChange[] | null>(null);
  const [error, setError] = useState(false);
  const viewers = useRef<{ old?: BpmnInstance; new?: BpmnInstance }>({});
  const syncing = useRef(false);
  const focused = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    setChanges(null);
    diffBpmn(oldXml, newXml)
      .then((c) => alive && setChanges(c))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [oldXml, newXml]);

  const ready = (side: 'old' | 'new') => (viewer: BpmnInstance) => {
    viewers.current[side] = viewer;
    if (changes) mark(viewer, changes, side);
    viewer.get<EventBus>('eventBus').on('canvas.viewbox.changed', ((e: { viewbox: Viewbox }) => {
      const other = viewers.current[side === 'old' ? 'new' : 'old'];
      if (!other || syncing.current) return;
      syncing.current = true;
      other.get<CanvasWithViewbox>('canvas').viewbox(e.viewbox);
      syncing.current = false;
    }) as never);
  };

  // Markers for viewers that rendered before the diff was ready.
  useEffect(() => {
    if (!changes) return;
    if (viewers.current.old) mark(viewers.current.old, changes, 'old');
    if (viewers.current.new) mark(viewers.current.new, changes, 'new');
  }, [changes]);

  const focus = (id: string) => {
    for (const v of [viewers.current.old, viewers.current.new]) {
      if (!v) continue;
      const canvas = v.get<Canvas>('canvas');
      const el = v.get<ElementRegistry>('elementRegistry').get(id);
      if (focused.current) canvas.removeMarker(focused.current, 'ph-diff-focus');
      if (el) {
        canvas.addMarker(id, 'ph-diff-focus');
        canvas.scrollToElement(el);
      }
    }
    focused.current = id;
  };

  const typeLabel = (type: string) => {
    const key = `modeler:types.${type}`;
    return i18n.exists(key) ? t(key) : type;
  };
  const attrLabel = (name: string) =>
    ({ name: t('docs:compare.attr.name'), nameEn: t('fields.nameEn'), nameAr: t('fields.nameAr') })[
      name
    ] ?? name;

  const counts = useMemo(() => {
    const c: Record<BpmnChangeKind, number> = { added: 0, removed: 0, changed: 0, layout: 0 };
    for (const x of changes ?? []) c[x.kind]++;
    return c;
  }, [changes]);

  if (error) return <Alert type="error" showIcon message={t('docs:compare.failed')} />;

  return (
    <Space direction="vertical" size={12} style={{ inlineSize: '100%' }}>
      <Space wrap>
        {(['added', 'removed', 'changed', 'layout'] as const).map((k) => (
          <Tag key={k} color={KIND_COLOR[k]}>
            {t(`docs:compare.kind.${k}`)}: {counts[k]}
          </Tag>
        ))}
        <Typography.Text type="secondary">{t('docs:compare.syncHint')}</Typography.Text>
      </Space>
      <Row gutter={12}>
        <Col xs={24} lg={12}>
          <Typography.Text strong>{oldTitle}</Typography.Text>
          <DiagramCanvas xml={oldXml} className="ph-compare-canvas" onReady={ready('old')} />
        </Col>
        <Col xs={24} lg={12}>
          <Typography.Text strong>{newTitle}</Typography.Text>
          <DiagramCanvas xml={newXml} className="ph-compare-canvas" onReady={ready('new')} />
        </Col>
      </Row>
      {!changes ? (
        <LoadingState />
      ) : !changes.length ? (
        <Empty description={t('docs:compare.noChanges')} />
      ) : (
        <Table
          size="small"
          rowKey={(c) => `${c.kind}:${c.id}`}
          dataSource={changes}
          pagination={changes.length > 10 ? { pageSize: 10 } : false}
          onRow={(c) => ({ onClick: () => focus(c.id), className: 'ph-clickable' })}
          columns={[
            {
              title: t('docs:compare.change'),
              key: 'kind',
              width: 130,
              render: (_, c) => (
                <Tag color={KIND_COLOR[c.kind]}>{t(`docs:compare.kind.${c.kind}`)}</Tag>
              ),
            },
            {
              title: t('fields.type'),
              key: 'type',
              width: 170,
              render: (_, c) => typeLabel(c.type),
            },
            {
              title: t('fields.name'),
              key: 'name',
              render: (_, c) =>
                loc(c) || (
                  <span dir="ltr" className="ph-muted">
                    {c.id}
                  </span>
                ),
            },
            {
              title: t('docs:compare.details'),
              key: 'attrs',
              render: (_, c) =>
                c.attrs.map((a) => (
                  <div key={a.name} className="ph-compare-attr">
                    <Typography.Text type="secondary">{attrLabel(a.name)}: </Typography.Text>
                    <del className="ph-diff-del">{a.oldValue || '—'}</del> →{' '}
                    <ins className="ph-diff-ins">{a.newValue || '—'}</ins>
                  </div>
                )),
            },
          ]}
        />
      )}
    </Space>
  );
}
