import { useMemo, useState } from 'react';
import { Button, Flex, Segmented, Slider, Tooltip, Typography } from 'antd';
import { MinusOutlined, PlusOutlined, ExpandOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { START, type DfgEdge, type DfgNode } from '@processhub/shared';
import { useFormatNumber } from '@/components/i18n-helpers';
import { useFormatDuration } from './mining-utils';
import { NODE_H, edgeKey, layoutMap, mapNodes, simplifyEdges, variantEdges } from './map-layout';

export type MapMode = 'frequency' | 'performance';

/** Blue (frequency) / red (slow) ramp from 0 to 1. */
const ramp = (v: number, mode: MapMode) => {
  const t = Math.max(0, Math.min(1, v));
  return mode === 'frequency'
    ? `hsl(214, ${55 + 30 * t}%, ${94 - 50 * t}%)`
    : `hsl(${40 - 40 * t}, ${70 + 20 * t}%, ${92 - 42 * t}%)`;
};

/**
 * Process map (directly-follows graph) as SVG: frequency or performance view, path slider,
 * zoom, start / end markers, an optional highlighted variant. Activity slider: see the caller.
 */
export function ProcessMap({
  nodes,
  edges,
  mode,
  highlight,
  height = 560,
  generic,
}: {
  nodes: DfgNode[];
  edges: DfgEdge[];
  mode: MapMode;
  highlight?: string[] | null;
  height?: number;
  /** Plain graph (e.g. handovers): counts only, no start / end markers. */
  generic?: boolean;
}) {
  const { t } = useTranslation();
  const fmtN = useFormatNumber();
  const fmtD = useFormatDuration();
  const [pathLevel, setPathLevel] = useState(1);
  const [zoom, setZoom] = useState(1);
  const shown = useMemo(() => simplifyEdges(edges, pathLevel), [edges, pathLevel]);
  const layout = useMemo(() => {
    const ns = generic
      ? nodes.map((n) => ({ id: n.activity, label: n.activity }))
      : mapNodes(nodes);
    return layoutMap(ns, shown);
  }, [nodes, shown, generic]);
  const hl = useMemo(() => (highlight ? variantEdges(highlight) : null), [highlight]);
  const hlNodes = useMemo(() => new Set(highlight ?? []), [highlight]);
  const maxCount = Math.max(1, ...edges.map((e) => e.count));
  const maxEvents = Math.max(1, ...nodes.map((n) => n.events));
  const nodeTime = (n: DfgNode) => (n.waiting?.mean ?? 0) + (n.processing?.mean ?? 0);
  const maxNodeTime = Math.max(1, ...nodes.map(nodeTime));
  const maxEdgeTime = Math.max(1, ...edges.map((e) => e.duration?.mean ?? 0));
  const byName = new Map(nodes.map((n) => [n.activity, n]));
  const width = layout.width * zoom;

  return (
    <Flex vertical gap={8}>
      <Flex gap={16} align="center" wrap="wrap">
        <Flex align="center" gap={8} style={{ minWidth: 260 }}>
          <Typography.Text type="secondary">{t('mining:map.paths')}</Typography.Text>
          <Slider
            style={{ flex: 1, minWidth: 140 }}
            min={5}
            max={100}
            value={Math.round(pathLevel * 100)}
            onChange={(v) => setPathLevel(v / 100)}
            tooltip={{ formatter: (v) => `${v}%` }}
            data-testid="map-path-slider"
          />
        </Flex>
        <Flex gap={4}>
          <Button
            size="small"
            icon={<MinusOutlined />}
            aria-label={t('mining:map.zoomOut')}
            onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))}
          />
          <Button
            size="small"
            icon={<ExpandOutlined />}
            aria-label={t('mining:map.zoomReset')}
            onClick={() => setZoom(1)}
          />
          <Button
            size="small"
            icon={<PlusOutlined />}
            aria-label={t('mining:map.zoomIn')}
            onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))}
          />
        </Flex>
        <Typography.Text type="secondary">
          {t('mining:map.shown', { edges: shown.length, total: edges.length })}
        </Typography.Text>
      </Flex>
      <div className="ph-mining-map" style={{ height, overflow: 'auto' }} data-testid="process-map">
        <svg
          width={width}
          height={layout.height * zoom}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={t('mining:map.title')}
          style={{ display: 'block', margin: '0 auto' }}
        >
          <defs>
            <marker
              id="ph-map-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="11"
              markerHeight="11"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#64748B" />
            </marker>
            <marker
              id="ph-map-arrow-hl"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="11"
              markerHeight="11"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#7C3AED" />
            </marker>
          </defs>
          {layout.edges.map(({ edge, points }, i) => {
            if (!points.length) return null;
            const on = !hl || hl.has(edgeKey(edge));
            const perf = mode === 'performance' && edge.duration;
            const w = 1 + 6 * Math.sqrt(edge.count / maxCount);
            const colour =
              hl && on
                ? '#7C3AED'
                : perf
                  ? `hsl(${40 - 40 * Math.min(1, edge.duration!.mean / maxEdgeTime)}, 85%, 45%)`
                  : '#64748B';
            const d =
              edge.from === edge.to && points.length === 4
                ? `M${points[0].x},${points[0].y} C${points[1].x + 14},${points[1].y - 6} ${points[2].x + 14},${points[2].y + 6} ${points[3].x},${points[3].y}`
                : points.map((p, k) => `${k ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
            const mid = points[Math.floor(points.length / 2)];
            const label = perf ? fmtD(edge.duration!.mean) : fmtN(edge.count);
            return (
              <g key={i} opacity={on ? 1 : 0.15} data-edge={`${edge.from}>${edge.to}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={colour}
                  strokeWidth={w}
                  markerEnd={`url(#${hl && on ? 'ph-map-arrow-hl' : 'ph-map-arrow'})`}
                />
                <Tooltip
                  title={`${edge.from} → ${edge.to}: ${fmtN(edge.count)}${edge.duration ? ` · ${t('mining:map.mean')} ${fmtD(edge.duration.mean)} · ${t('mining:map.median')} ${fmtD(edge.duration.median)} · ${t('mining:map.max')} ${fmtD(edge.duration.max)}` : ''}`}
                >
                  <text
                    x={mid.x + 6}
                    y={mid.y - 4}
                    fontSize={11}
                    fill="#334155"
                    className="ph-map-edge-label"
                    style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}
                  >
                    {label}
                  </text>
                </Tooltip>
              </g>
            );
          })}
          {layout.nodes.map((n) => {
            if (n.marker)
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                  <circle
                    r={14}
                    fill={n.id === START ? '#DCFCE7' : '#FEE2E2'}
                    stroke={n.id === START ? '#15803D' : '#B91C1C'}
                    strokeWidth={2}
                  />
                  <text textAnchor="middle" dy={4} fontSize={11}>
                    {n.id === START ? '▶' : '■'}
                  </text>
                </g>
              );
            const dn = byName.get(n.id);
            const on = !highlight || hlNodes.has(n.id);
            const value =
              mode === 'performance' && dn && nodeTime(dn) > 0
                ? nodeTime(dn) / maxNodeTime
                : (dn?.events ?? 0) / maxEvents;
            const sub = !dn
              ? ''
              : mode === 'performance' && nodeTime(dn) > 0
                ? `${t('mining:map.wait')} ${fmtD(dn.waiting?.mean ?? 0)} · ${t('mining:map.work')} ${fmtD(dn.processing?.mean ?? 0)}`
                : fmtN(dn.events);
            const label = n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x - n.width / 2},${n.y - n.height / 2})`}
                opacity={on ? 1 : 0.3}
                data-node={n.id}
              >
                <title>{n.label}</title>
                <rect
                  width={n.width}
                  height={NODE_H}
                  rx={8}
                  fill={ramp(value, mode)}
                  stroke={value > 0.6 ? (mode === 'frequency' ? '#1E3A8A' : '#991B1B') : '#94A3B8'}
                  strokeWidth={1.5}
                />
                <text
                  x={n.width / 2}
                  y={19}
                  textAnchor="middle"
                  fontSize={12.5}
                  fontWeight={600}
                  fill={value > 0.6 ? '#fff' : '#0F172A'}
                >
                  {label}
                </text>
                <text
                  x={n.width / 2}
                  y={36}
                  textAnchor="middle"
                  fontSize={11}
                  fill={value > 0.6 ? '#F1F5F9' : '#475569'}
                >
                  {sub}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </Flex>
  );
}

export function MapModeSwitch({
  value,
  onChange,
}: {
  value: MapMode;
  onChange: (m: MapMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <Segmented
      value={value}
      onChange={(v) => onChange(v as MapMode)}
      options={[
        { value: 'frequency', label: t('mining:map.frequency') },
        { value: 'performance', label: t('mining:map.performance') },
      ]}
      data-testid="map-mode"
    />
  );
}
