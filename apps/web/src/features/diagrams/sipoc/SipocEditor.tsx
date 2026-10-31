import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Alert, App, Button, Input, Space, Tooltip, TreeSelect, Typography } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  DIAGRAM_LIMITS,
  SIPOC_COLUMNS,
  SIPOC_MAX_STEPS,
  SIPOC_MIN_STEPS,
  generateSipoc,
  parseDiagramContent,
  stringifyDiagramContent,
  type DiagramDto,
  type SipocColumn,
  type SipocContent,
  type SipocItem,
} from '@processhub/shared';
import { api } from '@/api/client';
import { useDiagramContent } from '@/api/diagrams';
import { useLocale } from '@/app/LocaleProvider';
import { ErrorState, LoadingState } from '@/components/states';
import { useProcessTreeOptions } from '@/features/modeler/process-tree-options';
import { DiagramWorkspace, type SelectedElement } from '../DiagramWorkspace';
import { newElementId } from '../kit/graph-modules';
import type { GeneratorProps } from '../NewDiagramModal';
import { sipocSvg } from './sipoc-svg';

interface History {
  present: SipocContent | null;
  past: SipocContent[];
  future: SipocContent[];
}
type Action =
  | { type: 'load'; content: SipocContent }
  | { type: 'set'; content: SipocContent }
  | { type: 'undo' }
  | { type: 'redo' };

function reducer(h: History, a: Action): History {
  switch (a.type) {
    case 'load':
      return { present: a.content, past: [], future: [] };
    case 'set':
      return h.present
        ? { present: a.content, past: [...h.past, h.present].slice(-100), future: [] }
        : h;
    case 'undo':
      return h.past.length
        ? {
            present: h.past[h.past.length - 1],
            past: h.past.slice(0, -1),
            future: [h.present!, ...h.future],
          }
        : h;
    case 'redo':
      return h.future.length
        ? { present: h.future[0], past: [...h.past, h.present!], future: h.future.slice(1) }
        : h;
  }
}

/** The working model of a process → SIPOC content. */
async function fromProcess(processId: string): Promise<SipocContent | null> {
  const model = await api<{ bpmnXml: string | null }>(`/processes/${processId}/model`);
  return model.bpmnXml ? generateSipoc(model.bpmnXml, processId) : null;
}

/**
 * SIPOC workspace (D-125): five editable columns (bilingual items, add / reorder / delete, undo),
 * "Generate from process" (main path, step attributes, lanes and pools), export as SVG / PNG / PDF.
 */
export default function SipocEditor({
  diagram,
  readOnly,
  onClose,
}: {
  diagram: DiagramDto;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { modal, message } = App.useApp();
  const content = useDiagramContent(diagram.id);
  const canEdit = diagram.canEditContent && !readOnly;
  const [h, dispatch] = useReducer(reducer, { present: null, past: [], future: [] });
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<SelectedElement | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);

  useEffect(() => {
    if (!content.data || loadedFrom !== null) return;
    const parsed = parseDiagramContent('SIPOC', content.data.content);
    if (parsed.ok && parsed.content?.type === 'SIPOC') {
      dispatch({ type: 'load', content: parsed.content });
      setLoadedFrom(content.data.updatedAt);
    }
  }, [content.data, loadedFrom]);

  const change = useCallback((next: SipocContent) => {
    dispatch({ type: 'set', content: next });
    setTick((n) => n + 1);
  }, []);
  const c = h.present;
  const titles = useMemo(
    () =>
      Object.fromEntries(
        SIPOC_COLUMNS.map((col) => [col, t(`diagrams:sipoc.columns.${col}`)]),
      ) as Record<SipocColumn, string>,
    [t],
  );
  const getContent = useCallback(() => (c ? stringifyDiagramContent(c) : null), [c]);

  const updateColumn = (col: SipocColumn, items: SipocItem[]) =>
    c && change({ ...c, columns: { ...c.columns, [col]: items } });

  const sourceProcess = c?.processId ?? diagram.processId ?? null;
  const regenerate = () =>
    modal.confirm({
      title: t('diagrams:sipoc.generateTitle'),
      content: t('diagrams:sipoc.generateReplace'),
      okText: t('diagrams:valueChain.generate'),
      cancelText: t('cancel'),
      onOk: async () => {
        const next = sourceProcess ? await fromProcess(sourceProcess) : null;
        if (!next) return void message.warning(t('diagrams:sipoc.noModel'));
        change(next);
      },
    });

  if (content.isError)
    return <ErrorState error={content.error} onRetry={() => void content.refetch()} />;

  const steps = c?.columns.steps.length ?? 0;
  return (
    <DiagramWorkspace
      diagram={diagram}
      canEdit={canEdit}
      loaded={!!c}
      getContent={getContent}
      getSvg={async () => (c ? sipocSvg(c, locale, titles) : '')}
      changeTick={tick}
      history={
        canEdit
          ? {
              canUndo: h.past.length > 0,
              canRedo: h.future.length > 0,
              undo: () => {
                dispatch({ type: 'undo' });
                setTick((n) => n + 1);
              },
              redo: () => {
                dispatch({ type: 'redo' });
                setTick((n) => n + 1);
              },
            }
          : undefined
      }
      selected={selected}
      onRestored={() => {
        setLoadedFrom(null);
        void content.refetch();
      }}
      onClose={onClose}
      tools={
        canEdit && sourceProcess ? (
          <Tooltip title={t('diagrams:sipoc.generateHint')}>
            <Button
              size="small"
              type="text"
              icon={<ThunderboltOutlined />}
              onClick={regenerate}
              data-testid="sipoc-generate"
            >
              <span className="ph-ws-label">{t('diagrams:valueChain.generate')}</span>
            </Button>
          </Tooltip>
        ) : null
      }
      panels={[
        {
          key: 'properties',
          label: t('modeler:properties'),
          children: (
            <div className="ph-panel-section">
              <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                {t('diagrams:sipoc.hint')}
              </Typography.Paragraph>
              {(steps < SIPOC_MIN_STEPS || steps > SIPOC_MAX_STEPS) && (
                <Alert
                  type="warning"
                  showIcon
                  data-testid="sipoc-steps-warning"
                  message={t('diagrams:sipoc.stepsCount', {
                    count: steps,
                    min: SIPOC_MIN_STEPS,
                    max: SIPOC_MAX_STEPS,
                  })}
                />
              )}
            </div>
          ),
        },
      ]}
      canvas={
        c ? (
          <div className="ph-ws-canvas ph-sipoc-editor" data-testid="sipoc-editor">
            <div className="ph-sipoc">
              {SIPOC_COLUMNS.map((col) => (
                <SipocColumnEditor
                  key={col}
                  col={col}
                  title={titles[col]}
                  items={c.columns[col]}
                  canEdit={canEdit}
                  selectedId={selected?.id ?? null}
                  onSelect={(item) =>
                    setSelected({ id: item.id, nameEn: item.nameEn, nameAr: item.nameAr })
                  }
                  onChange={(items) => updateColumn(col, items)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="ph-modeler-loading">
            <LoadingState />
          </div>
        )
      }
    />
  );
}

function SipocColumnEditor({
  col,
  title,
  items,
  canEdit,
  selectedId,
  onSelect,
  onChange,
}: {
  col: SipocColumn;
  title: string;
  items: SipocItem[];
  canEdit: boolean;
  selectedId: string | null;
  onSelect: (item: SipocItem) => void;
  onChange: (items: SipocItem[]) => void;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const [first, second] =
    locale === 'ar' ? (['nameAr', 'nameEn'] as const) : (['nameEn', 'nameAr'] as const);
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const set = (i: number, key: 'nameEn' | 'nameAr', value: string) => {
    if (items[i][key] === value) return;
    onChange(items.map((x, j) => (j === i ? { ...x, [key]: value } : x)));
  };
  return (
    <div className={`ph-sipoc-col ph-sipoc-${col}`} data-column={col}>
      <div className="ph-sipoc-head">
        <span className="ph-sipoc-letter" aria-hidden="true">
          {t(`diagrams:sipoc.letter.${col}`)}
        </span>
        {title}
      </div>
      <ol className="ph-sipoc-items">
        {items.map((item, i) => (
          <li
            key={item.id}
            className={item.id === selectedId ? 'is-selected' : undefined}
            onClick={() => onSelect(item)}
            data-element-id={item.id}
          >
            {col === 'steps' && <span className="ph-sipoc-num">{i + 1}</span>}
            <div className="ph-sipoc-fields">
              {[first, second].map((key) => (
                <Input
                  key={`${item.id}-${key}-${item[key]}`}
                  size="small"
                  variant={key === first ? 'outlined' : 'filled'}
                  dir={key === 'nameAr' ? 'rtl' : 'ltr'}
                  lang={key === 'nameAr' ? 'ar' : 'en'}
                  placeholder={t(key === 'nameAr' ? 'diagrams:label.ar' : 'diagrams:label.en')}
                  defaultValue={item[key]}
                  maxLength={DIAGRAM_LIMITS.label}
                  readOnly={!canEdit}
                  data-field={key}
                  onBlur={(e) => set(i, key, e.target.value.trim())}
                  onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
                />
              ))}
            </div>
            {canEdit && (
              <Space size={0} direction="vertical" className="ph-sipoc-actions">
                <Button
                  size="small"
                  type="text"
                  icon={<ArrowUpOutlined />}
                  disabled={!i}
                  aria-label={t('diagrams:sipoc.up')}
                  onClick={() => move(i, -1)}
                />
                <Button
                  size="small"
                  type="text"
                  icon={<ArrowDownOutlined />}
                  disabled={i === items.length - 1}
                  aria-label={t('diagrams:sipoc.down')}
                  onClick={() => move(i, 1)}
                />
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label={t('delete')}
                  onClick={() => onChange(items.filter((x) => x.id !== item.id))}
                />
              </Space>
            )}
          </li>
        ))}
      </ol>
      {canEdit && items.length < DIAGRAM_LIMITS.sipocItems && (
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          block
          className="ph-sipoc-add"
          data-testid={`sipoc-add-${col}`}
          onClick={() =>
            onChange([...items, { id: newElementId(col.slice(0, -1)), nameEn: '', nameAr: '' }])
          }
        >
          {t('diagrams:sipoc.add')}
        </Button>
      )}
    </div>
  );
}

/** "New SIPOC": optionally generate it from a process. */
export function SipocGenerator({ onContent }: GeneratorProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const processes = useProcessTreeOptions('');
  const [processId, setProcessId] = useState<string | null>(null);
  return (
    <Alert
      type="info"
      style={{ marginBlockEnd: 16 }}
      message={
        <Space direction="vertical" style={{ width: '100%' }}>
          <span>{t('diagrams:sipoc.generateFrom')}</span>
          <TreeSelect
            allowClear
            showSearch
            style={{ width: '100%' }}
            treeNodeFilterProp="title"
            treeData={processes.options}
            value={processId}
            placeholder={t('diagrams:sipoc.chooseProcess')}
            data-testid="sipoc-generate-process"
            onChange={async (id: string | null) => {
              setProcessId(id);
              if (!id) return onContent(null);
              const generated = await fromProcess(id);
              if (!generated) {
                message.warning(t('diagrams:sipoc.noModel'));
                return onContent(null);
              }
              onContent(stringifyDiagramContent(generated), 'Generated from the process');
            }}
          />
        </Space>
      }
    />
  );
}
