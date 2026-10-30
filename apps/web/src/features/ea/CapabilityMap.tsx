import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, Descriptions, Drawer, Flex, Segmented, Space, Tag, Typography } from 'antd';
import { ApartmentOutlined, NodeIndexOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  CAPABILITY_COLOUR_BY,
  DEFAULT_GRC_SETTINGS,
  PERMISSIONS,
  buildTree,
  type CapabilityColourBy,
  type CapabilityDto,
  type CapabilityMetricsDto,
  type TreeNode,
} from '@processhub/shared';
import { useCapabilityMap } from '@/api/ea';
import { useGrcSettings } from '@/api/grc';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { useLocalized } from '@/components/i18n-helpers';
import { LifecycleTag } from './ea-components';
import { LIFECYCLE_HEX, applicationPath, useEaLabel } from './ea-helpers';

type Cap = CapabilityDto & { metrics: CapabilityMetricsDto };
interface Swatch {
  key: string;
  label: string;
  colour: string;
}
const GREY = '#cbd5e1';

/** Colour of a capability tile in a view, and the legend of that view. */
function useColouring(mode: CapabilityColourBy) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const grc = useGrcSettings(can(PERMISSIONS.GRC_READ));
  const bands = grc.data?.bands ?? DEFAULT_GRC_SETTINGS.bands;
  const loc = useLocalized();
  return useMemo(() => {
    const legend: Swatch[] = [];
    let colourOf: (m: CapabilityMetricsDto) => string;
    if (mode === 'coverage') {
      legend.push(
        { key: '0', label: t('ea:map.coverage.none'), colour: '#fca5a5' },
        { key: '1', label: t('ea:map.coverage.one'), colour: '#fcd34d' },
        { key: '2', label: t('ea:map.coverage.many'), colour: '#86efac' },
      );
      colourOf = (m) => legend[Math.min(m.processCount, 2)].colour;
    } else if (mode === 'applications') {
      legend.push(
        { key: '0', label: '0', colour: GREY },
        { key: '1', label: '1–2', colour: '#bfdbfe' },
        { key: '3', label: '3–5', colour: '#60a5fa' },
        { key: '6', label: '6+', colour: '#1d4ed8' },
      );
      colourOf = (m) =>
        legend[
          m.applicationCount === 0
            ? 0
            : m.applicationCount <= 2
              ? 1
              : m.applicationCount <= 5
                ? 2
                : 3
        ].colour;
    } else if (mode === 'lifecycle') {
      for (const l of ['ACTIVE', 'PLANNED', 'PHASING_OUT', 'RETIRED'] as const)
        legend.push({ key: l, label: t(`ea:lifecycle.${l}`), colour: LIFECYCLE_HEX[l] });
      legend.push({ key: 'none', label: t('ea:map.noApplications'), colour: GREY });
      colourOf = (m) => (m.worstLifecycle ? LIFECYCLE_HEX[m.worstLifecycle] : GREY);
    } else {
      for (const b of bands) legend.push({ key: b.key, label: loc(b), colour: b.colour });
      legend.push({ key: 'none', label: t('ea:map.noRisk'), colour: GREY });
      colourOf = (m) => bands.find((b) => b.key === m.maxRiskBand)?.colour ?? GREY;
    }
    return { legend, colourOf };
  }, [mode, t, bands, loc]);
}

/** Capability map: level-1 columns with nested tiles, "colour by" and a detail drawer. */
export function CapabilityMap() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const label = useEaLabel();
  const loc = useLocalized();
  const [params, setParams] = useSearchParams();
  const modes = CAPABILITY_COLOUR_BY.filter((m) => m !== 'risk' || can(PERMISSIONS.GRC_READ));
  const mode = (modes as readonly string[]).includes(params.get('colourBy') ?? '')
    ? (params.get('colourBy') as CapabilityColourBy)
    : 'coverage';
  const map = useCapabilityMap();
  const { legend, colourOf } = useColouring(mode);
  const [open, setOpen] = useState<Cap | null>(null);
  const tree = useMemo(() => buildTree<Cap>(map.data?.capabilities ?? []), [map.data]);

  if (map.isLoading) return <LoadingState />;
  if (map.isError) return <ErrorState error={map.error} onRetry={() => void map.refetch()} />;

  const setMode = (m: string) => {
    const next = new URLSearchParams(params);
    next.set('colourBy', m);
    setParams(next, { replace: true });
  };
  const metricText = (m: CapabilityMetricsDto) =>
    mode === 'risk'
      ? m.maxRiskScore !== null
        ? t('ea:map.riskScore', { score: m.maxRiskScore })
        : ''
      : t('ea:map.counts', { processes: m.processCount, applications: m.applicationCount });

  const tile = (c: TreeNode<Cap>) => {
    const colour = colourOf(c.metrics);
    return (
      <div
        key={c.id}
        role="button"
        tabIndex={0}
        className={`ph-cap-tile ph-cap-clickable ph-cap-l${c.level}`}
        data-testid="cap-tile"
        data-colour={colour}
        style={
          {
            '--ph-cap-accent': colour,
            '--ph-cap-bg': c.level === 1 ? `${colour}33` : `${colour}22`,
          } as React.CSSProperties
        }
        onClick={(e) => {
          e.stopPropagation();
          setOpen(c);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(c);
          }
        }}
      >
        <Typography.Text strong={c.level < 3}>{label(c)}</Typography.Text>
        <span className="ph-cap-meta">{metricText(c.metrics)}</span>
        {c.children.length > 0 && <div className="ph-cap-children">{c.children.map(tile)}</div>}
      </div>
    );
  };

  return (
    <Card>
      <Flex
        justify="space-between"
        align="center"
        gap={12}
        wrap="wrap"
        style={{ marginBlockEnd: 16 }}
      >
        <Space wrap>
          <Typography.Text strong>{t('ea:map.colourBy')}</Typography.Text>
          <Segmented
            value={mode}
            onChange={(v) => setMode(String(v))}
            options={modes.map((m) => ({ value: m, label: t(`ea:map.modes.${m}`) }))}
            data-testid="cap-colour-by"
          />
        </Space>
        <Space wrap size={12} aria-label={t('ea:map.legend')} data-testid="cap-legend">
          {legend.map((s) => (
            <Space key={s.key} size={4}>
              <span
                className="ph-legend-swatch"
                style={{ background: s.colour }}
                aria-hidden="true"
              />
              <Typography.Text type="secondary">{s.label}</Typography.Text>
            </Space>
          ))}
        </Space>
      </Flex>
      {tree.length ? (
        <div className="ph-cap-map">{tree.map(tile)}</div>
      ) : (
        <EmptyState description={t('ea:capabilities.empty')} />
      )}
      <Drawer
        open={!!open}
        onClose={() => setOpen(null)}
        width={520}
        title={open ? label(open) : ''}
        extra={
          open && (
            <Space>
              <Link to={`/ea/landscape?capabilityId=${open.id}`}>
                <Button icon={<ApartmentOutlined />}>{t('ea:nav.landscape')}</Button>
              </Link>
              <Link to={`/ea/traceability?capabilityId=${open.id}`}>
                <Button icon={<NodeIndexOutlined />}>{t('ea:nav.traceability')}</Button>
              </Link>
            </Space>
          )
        }
      >
        {open && (
          <Space direction="vertical" size={16} style={{ width: '100%' }} data-testid="cap-detail">
            {loc(open, 'description') && (
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                {loc(open, 'description')}
              </Typography.Paragraph>
            )}
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={t('ea:fields.importance')}>
                {t(`ea:importance.${open.importance}`)}
              </Descriptions.Item>
              <Descriptions.Item label={t('ea:fields.owner')}>
                {open.owner ? loc(open.owner) || open.owner.email : '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('ea:map.modes.coverage')}>
                {t('ea:map.counts', {
                  processes: open.metrics.processCount,
                  applications: open.metrics.applicationCount,
                })}
              </Descriptions.Item>
            </Descriptions>
            <div>
              <Typography.Title level={5}>{t('ea:fields.processes')}</Typography.Title>
              {open.processes.length
                ? open.processes.map((p) => (
                    <Tag key={p.id} style={{ marginBlockEnd: 4 }}>
                      <Link to={`/processes/${p.id}`}>
                        {p.code} {loc(p)}
                      </Link>
                    </Tag>
                  ))
                : '—'}
            </div>
            <div>
              <Typography.Title level={5}>{t('ea:fields.applications')}</Typography.Title>
              {open.applications.length
                ? open.applications.map((a) => (
                    <Flex key={a.id} gap={8} align="center" style={{ marginBlockEnd: 4 }}>
                      <Link to={applicationPath(a.id)}>{label(a)}</Link>
                      <LifecycleTag lifecycle={a.lifecycle} />
                    </Flex>
                  ))
                : '—'}
            </div>
          </Space>
        )}
      </Drawer>
    </Card>
  );
}
