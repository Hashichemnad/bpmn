import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Dropdown,
  Form,
  Select,
  Space,
  Tooltip,
  TreeSelect,
  Typography,
} from 'antd';
import { BgColorsOutlined, ExportOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  PERMISSIONS,
  VALUE_CHAIN_COLOUR_MODES,
  generateValueChain,
  stringifyDiagramContent,
  type GraphContent,
  type ValueChainColourMode,
} from '@processhub/shared';
import { useProcessTree } from '@/api/hooks';
import { useAllDiagrams } from '@/api/diagrams';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/app/LocaleProvider';
import { useLocalized } from '@/components/i18n-helpers';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';
import type { GraphEditorContext } from '../GraphEditor';
import type { GeneratorProps } from '../NewDiagramModal';
import { SHAPE_TYPE, type GraphShape } from '../kit/graph-modules';
import type { LegendEntry } from './value-chain-colours';

/** Top-bar tools: Colour by (with legend) and "Generate from process house". */
export function ValueChainTools({
  mode,
  setMode,
  canEdit,
  onGenerate,
}: {
  mode: ValueChainColourMode;
  setMode: (m: ValueChainColourMode) => void;
  canEdit: boolean;
  onGenerate: (content: GraphContent) => void;
}) {
  const { t } = useTranslation();
  const { modal } = App.useApp();
  const { can } = useAuth();
  const tree = useProcessTree();
  const modes = VALUE_CHAIN_COLOUR_MODES.filter(
    (m) =>
      (m !== 'kpi' || can(PERMISSIONS.KPI_READ)) && (m !== 'risk' || can(PERMISSIONS.GRC_READ)),
  );
  const generate = () => {
    let level2 = false;
    modal.confirm({
      title: t('diagrams:valueChain.generateTitle'),
      content: (
        <>
          <Typography.Paragraph>{t('diagrams:valueChain.generateReplace')}</Typography.Paragraph>
          <Checkbox onChange={(e) => (level2 = e.target.checked)}>
            {t('diagrams:valueChain.includeLevel2')}
          </Checkbox>
        </>
      ),
      okText: t('diagrams:valueChain.generate'),
      cancelText: t('cancel'),
      onOk: () => onGenerate(generateValueChain(tree.data ?? [], { includeLevel2: level2 })),
    });
  };
  return (
    <>
      {canEdit && (
        <Tooltip title={t('diagrams:valueChain.generateHint')}>
          <Button
            size="small"
            type="text"
            icon={<ThunderboltOutlined />}
            onClick={generate}
            data-testid="vc-generate"
          >
            <span className="ph-ws-label">{t('diagrams:valueChain.generate')}</span>
          </Button>
        </Tooltip>
      )}
      <Dropdown
        trigger={['click']}
        menu={{
          selectable: true,
          selectedKeys: [mode],
          items: modes.map((m) => ({ key: m, label: t(`diagrams:colourBy.${m}`) })),
          onClick: ({ key }) => setMode(key as ValueChainColourMode),
        }}
      >
        <Button
          size="small"
          type={mode === 'none' ? 'text' : 'primary'}
          ghost={mode !== 'none'}
          icon={<BgColorsOutlined />}
          data-testid="vc-colour-by"
        >
          <span className="ph-ws-label">{t('diagrams:colourBy.title')}</span>
        </Button>
      </Dropdown>
    </>
  );
}

export function ColourLegend({ items }: { items: LegendEntry[] }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const text = (e: LegendEntry) =>
    e.label.key
      ? t(e.label.key)
      : (e.label.text ?? '').split('|')[locale === 'ar' ? 1 : 0] ||
        (e.label.text ?? '').split('|')[0];
  return (
    <div className="ph-vc-legend" role="list" aria-label={t('diagrams:colourBy.legend')}>
      {items.map((e) => (
        <span key={e.key} role="listitem">
          <i style={{ background: e.fill, borderColor: e.stroke }} />
          {text(e)}
        </span>
      ))}
    </div>
  );
}

/** Value chain fields of the selected element: block row, linked process or diagram. */
export function ValueChainProperties({ element, update, canEdit }: GraphEditorContext) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const navigate = useNavigate();
  const processes = useProcessTreeOptions('');
  const diagrams = useAllDiagrams();
  if (element.type !== SHAPE_TYPE) return null;
  const n = (element as GraphShape).businessObject;
  if (n.kind === 'frame') return null;
  const tree = processes.processes;
  return (
    <>
      {n.kind === 'block' && (
        <Form.Item label={t('diagrams:valueChain.row')}>
          <Select
            value={n.category ?? 'SUPPORT'}
            disabled={!canEdit}
            onChange={(category) => update({ category })}
            options={(['MANAGEMENT', 'SUPPORT'] as const).map((c) => ({
              value: c,
              label: t(`processes:category.${c}`),
            }))}
          />
        </Form.Item>
      )}
      <Form.Item
        label={t('diagrams:valueChain.linkedProcess')}
        extra={t('diagrams:valueChain.linkedHint')}
      >
        <TreeSelect
          allowClear
          showSearch
          treeNodeFilterProp="title"
          value={n.processId ?? null}
          disabled={!canEdit}
          treeData={processes.options}
          placeholder={t('none')}
          data-testid="vc-linked-process"
          onChange={(processId: string | null) => {
            const p = tree.find((x) => x.id === processId);
            update({
              processId: processId ?? undefined,
              diagramId: undefined,
              // An unnamed element takes the name of the process.
              ...(p && !n.nameEn && !n.nameAr ? { nameEn: p.nameEn, nameAr: p.nameAr } : {}),
            });
          }}
        />
      </Form.Item>
      <Form.Item label={t('diagrams:valueChain.linkedDiagram')}>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          value={n.diagramId ?? null}
          disabled={!canEdit}
          placeholder={t('none')}
          options={(diagrams.data ?? [])
            .filter((d) => d.type === 'VALUE_CHAIN')
            .map((d) => ({ value: d.id, label: `${d.code} ${loc(d)}` }))}
          onChange={(diagramId: string | null) =>
            update({ diagramId: diagramId ?? undefined, processId: undefined })
          }
        />
      </Form.Item>
      {(n.processId || n.diagramId) && (
        <Space>
          <Button
            size="small"
            icon={<ExportOutlined />}
            onClick={() =>
              navigate(n.diagramId ? `/diagrams/${n.diagramId}` : `/processes/${n.processId}`)
            }
          >
            {t('diagrams:valueChain.openLinked')}
          </Button>
        </Space>
      )}
    </>
  );
}

/** "New value chain": optionally generate the first version from the process house. */
export function ValueChainGenerator({ onContent }: GeneratorProps) {
  const { t } = useTranslation();
  const tree = useProcessTree();
  const [on, setOn] = useState(false);
  const [level2, setLevel2] = useState(false);
  useEffect(() => {
    if (!on || !tree.data) return onContent(null);
    onContent(
      stringifyDiagramContent(generateValueChain(tree.data, { includeLevel2: level2 })),
      'Generated from the process house',
    );
    // onContent is stable enough for this form; regenerate when the options change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, level2, tree.data]);
  return (
    <Alert
      type="info"
      style={{ marginBlockEnd: 16 }}
      message={
        <Space direction="vertical">
          <Checkbox
            checked={on}
            onChange={(e) => setOn(e.target.checked)}
            data-testid="vc-generate-new"
          >
            {t('diagrams:valueChain.generateFromHouse')}
          </Checkbox>
          {on && (
            <Checkbox checked={level2} onChange={(e) => setLevel2(e.target.checked)}>
              {t('diagrams:valueChain.includeLevel2')}
            </Checkbox>
          )}
        </Space>
      }
    />
  );
}
