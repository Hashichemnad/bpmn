import { useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Checkbox,
  Dropdown,
  Flex,
  Select,
  Space,
  TreeSelect,
  Typography,
} from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { APP_LIFECYCLES, type LandscapeDto } from '@processhub/shared';
import { useLandscape } from '@/api/ea';
import { useLocale } from '@/app/LocaleProvider';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useLocalized } from '@/components/i18n-helpers';
import { useDepartmentTreeData } from '@/features/admin/useDepartmentTreeData';
import { downloadBlob, svgToPng } from '@/features/modeler/export';
import { CapabilitySelect } from './ea-components';
import { LIFECYCLE_HEX, applicationPath, useEnumOptions } from './ea-helpers';
import { NODE_H, NODE_W, layoutLandscape } from './landscape-layout';

const FONT = "Inter, 'IBM Plex Sans Arabic', Arial, sans-serif";
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Application landscape: applications as nodes, interfaces as arrows (auto-layout, export). */
export function LandscapePage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const departments = useDepartmentTreeData();
  const lifecycles = useEnumOptions('lifecycle', APP_LIFECYCLES);
  const [params, setParams] = useSearchParams();
  const q = {
    departmentId: params.get('departmentId') ?? undefined,
    capabilityId: params.get('capabilityId') ?? undefined,
    lifecycle: params.get('lifecycle') ?? undefined,
    neighbours: params.get('neighbours') ?? undefined,
  };
  const data = useLandscape(q);
  const svgRef = useRef<SVGSVGElement>(null);
  const set = (k: string, v: string | null | undefined) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const exportAs = async (kind: 'svg' | 'png') => {
    const el = svgRef.current;
    if (!el) return;
    const svg = new XMLSerializer().serializeToString(el);
    try {
      if (kind === 'svg')
        downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), 'landscape.svg');
      else downloadBlob(await svgToPng(svg), 'landscape.png');
    } catch {
      message.error(t('errors:GENERIC'));
    }
  };

  return (
    <>
      <PageHeader
        title={t('ea:landscape.title')}
        subtitle={t('ea:landscape.subtitle')}
        extra={
          <Dropdown
            menu={{
              items: [
                { key: 'svg', label: 'SVG', onClick: () => void exportAs('svg') },
                { key: 'png', label: 'PNG', onClick: () => void exportAs('png') },
              ],
            }}
          >
            <Button icon={<DownloadOutlined />} data-testid="landscape-export">
              {t('ea:landscape.export')}
            </Button>
          </Dropdown>
        }
      />
      <Card>
        <Flex gap={8} wrap="wrap" align="center" style={{ marginBlockEnd: 16 }}>
          <TreeSelect
            allowClear
            placeholder={t('ea:fields.department')}
            value={q.departmentId}
            onChange={(v) => set('departmentId', v)}
            treeData={departments}
            treeDefaultExpandAll
            style={{ width: 200 }}
          />
          <div style={{ width: 240 }}>
            <CapabilitySelect
              value={q.capabilityId}
              onChange={(v) => set('capabilityId', v as string | null)}
            />
          </div>
          <Select
            allowClear
            placeholder={t('ea:fields.lifecycle')}
            value={q.lifecycle}
            onChange={(v) => set('lifecycle', v)}
            options={lifecycles}
            style={{ width: 180 }}
          />
          <Checkbox
            checked={q.neighbours === 'true'}
            onChange={(e) => set('neighbours', e.target.checked ? 'true' : null)}
          >
            {t('ea:landscape.neighbours')}
          </Checkbox>
        </Flex>
        {data.isLoading ? (
          <LoadingState />
        ) : data.isError ? (
          <ErrorState error={data.error} onRetry={() => void data.refetch()} />
        ) : !data.data?.nodes.length ? (
          <EmptyState description={t('ea:landscape.empty')} />
        ) : (
          <>
            <Space wrap size={12} style={{ marginBlockEnd: 8 }}>
              {APP_LIFECYCLES.map((l) => (
                <Space key={l} size={4}>
                  <span
                    className="ph-legend-swatch"
                    style={{ background: '#fff', borderColor: LIFECYCLE_HEX[l], borderWidth: 2 }}
                    aria-hidden="true"
                  />
                  <Typography.Text type="secondary">{t(`ea:lifecycle.${l}`)}</Typography.Text>
                </Space>
              ))}
            </Space>
            <div className="ph-landscape-scroll">
              <LandscapeSvg
                data={data.data}
                svgRef={svgRef}
                onOpen={(id) => navigate(applicationPath(id))}
              />
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function LandscapeSvg({
  data,
  svgRef,
  onOpen,
}: {
  data: LandscapeDto;
  svgRef: React.RefObject<SVGSVGElement>;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { dir } = useLocale();
  const loc = useLocalized();
  const rtl = dir === 'rtl';
  const layout = useMemo(() => layoutLandscape(data.nodes, data.edges), [data]);
  // Arabic reads right to left: the flow runs from the right edge.
  const pos = (id: string) => {
    const p = layout.positions.get(id)!;
    return { x: rtl ? layout.width - p.x - NODE_W : p.x, y: p.y };
  };

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={t('ea:landscape.title')}
      data-testid="landscape-svg"
      direction="ltr"
      style={{ fontFamily: FONT, background: '#fff', direction: 'ltr' }}
    >
      <defs>
        <marker
          id="ph-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="#475569" />
        </marker>
      </defs>
      {data.edges.map((e) => {
        const s = pos(e.sourceId);
        const g = pos(e.targetId);
        const forward = g.x > s.x + 1;
        const back = g.x < s.x - 1;
        const sx = forward ? s.x + NODE_W : back ? s.x : s.x + NODE_W / 2;
        const sy = forward || back ? s.y + NODE_H / 2 : s.y + NODE_H;
        const tx = forward ? g.x : back ? g.x + NODE_W : g.x + NODE_W / 2;
        const ty = forward || back ? g.y + NODE_H / 2 : g.y;
        const dx = forward || back ? (tx - sx) / 2 : 0;
        const dy = forward || back ? 0 : (ty - sy) / 2;
        const path = `M${sx},${sy} C${sx + dx},${sy + dy} ${tx - dx},${ty - dy} ${tx},${ty}`;
        const label = loc(e) || t(`ea:technology.${e.technology}`);
        return (
          <g key={e.id} data-testid="landscape-edge">
            <title>
              {[label, ...e.dataObjects.map((d) => loc(d))].filter(Boolean).join(' · ')}
            </title>
            <path
              d={path}
              fill="none"
              stroke={e.status === 'ACTIVE' ? '#475569' : '#94a3b8'}
              strokeWidth={1.5}
              strokeDasharray={e.status === 'ACTIVE' ? undefined : '5 4'}
              markerEnd="url(#ph-arrow)"
              markerStart={e.direction === 'TWO_WAY' ? 'url(#ph-arrow)' : undefined}
            />
            <text
              x={(sx + tx) / 2}
              y={(sy + ty) / 2 - 6}
              textAnchor="middle"
              fontSize={11}
              fill="#334155"
              stroke="#fff"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {truncate(label, 24)}
            </text>
          </g>
        );
      })}
      {data.nodes.map((n) => {
        const p = pos(n.id);
        const colour = LIFECYCLE_HEX[n.lifecycle];
        const name = loc(n) || n.code || '';
        return (
          <g
            key={n.id}
            transform={`translate(${p.x},${p.y})`}
            style={{ cursor: 'pointer' }}
            role="link"
            tabIndex={0}
            aria-label={name}
            data-testid="landscape-node"
            onClick={() => onOpen(n.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onOpen(n.id);
            }}
          >
            <title>{`${name} · ${t(`ea:lifecycle.${n.lifecycle}`)}`}</title>
            <rect
              width={NODE_W}
              height={NODE_H}
              rx={8}
              fill={n.neighbour ? '#f8fafc' : '#ffffff'}
              stroke={colour}
              strokeWidth={n.lifecycle === 'ACTIVE' ? 1.5 : 2.5}
              strokeDasharray={n.neighbour ? '4 3' : undefined}
            />
            <rect x={rtl ? NODE_W - 6 : 0} width={6} height={NODE_H} rx={3} fill={colour} />
            <text
              x={rtl ? NODE_W - 16 : 16}
              y={24}
              textAnchor={rtl ? 'end' : 'start'}
              fontSize={13}
              fontWeight={600}
              fill="#0f172a"
            >
              {truncate(name, 24)}
            </text>
            <text
              x={rtl ? NODE_W - 16 : 16}
              y={43}
              textAnchor={rtl ? 'end' : 'start'}
              fontSize={11}
              fill="#64748b"
            >
              {[n.code, t(`ea:appType.${n.appType}`)].filter(Boolean).join(' · ')}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
