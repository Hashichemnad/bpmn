import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, ColorPicker, Divider, Empty, Form, Input, Space, Tooltip, Typography } from 'antd';
import { BorderOuterOutlined, ClearOutlined, CompassOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_DIAGRAM_THEME,
  parseDiagramContent,
  stringifyDiagramContent,
  type DiagramDto,
  type GraphContent,
  type GraphDiagramType,
} from '@processhub/shared';
import { usePublicSettings } from '@/api/hooks';
import { useDiagramContent } from '@/api/diagrams';
import { useLocale } from '@/app/LocaleProvider';
import { ErrorState, LoadingState } from '@/components/states';
import { ZoomControl } from '@/features/modeler/ZoomControl';
import { LayoutToolbar } from '@/features/modeler/LayoutToolbar';
import { setMinimap } from '@/features/modeler/minimap';
import { fitPage } from '@/features/modeler/view';
import type { Canvas, DiagramElement } from '@/features/modeler/bpmn-types';
import { DiagramWorkspace, type SelectedElement, type WorkspacePanel } from './DiagramWorkspace';
import { GraphPalette } from './GraphPalette';
import {
  createGraphDiagram,
  exportGraph,
  graphSvg,
  importGraph,
  redrawAll,
  type GraphInstance,
} from './kit/graph-diagram';
import {
  EDGE_TYPE,
  SHAPE_TYPE,
  isConnection,
  type GraphElement,
  type GraphState,
} from './kit/graph-modules';
import { NOTATIONS } from './kit/notations';

export interface GraphEditorContext {
  instance: GraphInstance;
  element: GraphElement;
  /** Undoable update of the element's business properties. */
  update: (properties: Record<string, unknown>) => void;
  canEdit: boolean;
}

interface Props {
  diagram: DiagramDto;
  readOnly?: boolean;
  onClose: () => void;
  /** Notation-specific fields under the label fields of the selected element. */
  renderProperties?: (ctx: GraphEditorContext) => ReactNode;
  /** Extra tools in the top bar (generate, colour by …). */
  tools?: (instance: GraphInstance | null, reload: (content: GraphContent) => void) => ReactNode;
  /** Extra side panel tabs (validation …), after Properties. */
  panels?: (instance: GraphInstance | null, changeTick: number) => WorkspacePanel[];
  /** Receives the "save the draft now" function of the workspace. */
  saveRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  /** Floating content on the canvas (colour-by legend …). */
  overlay?: ReactNode;
  /** Reports the diagram instance and every change (notation overlays, colour by). */
  onState?: (instance: GraphInstance | null, changeTick: number, loaded: boolean) => void;
}

/**
 * Editor of a graph notation (value chain, organisation chart, EPC) on the shared diagram-js kit:
 * palette, context pad, snapping, align / distribute, zoom / mini-map, undo, keyboard shortcuts,
 * bilingual labels in the active language and theme colours (D-120).
 */
export function GraphEditor({
  diagram,
  readOnly,
  onClose,
  renderProperties,
  tools,
  panels,
  overlay,
  onState,
  saveRef,
}: Props) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const settings = usePublicSettings();
  const content = useDiagramContent(diagram.id);
  const type = diagram.type as GraphDiagramType;
  const notation = NOTATIONS[type];
  const canEdit = diagram.canEditContent && !readOnly;
  const theme = settings.data?.diagramTheme ?? DEFAULT_DIAGRAM_THEME;
  const stateRef = useRef<GraphState>({ notation, locale, theme, readOnly: !canEdit });
  const containerRef = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<GraphInstance | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [changeTick, setChangeTick] = useState(0);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [selection, setSelection] = useState<GraphElement[]>([]);
  const [rev, setRev] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [minimap, setMinimapOpen] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  /** Import in progress: its command stack reset is not a user change. */
  const importingRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const inst = createGraphDiagram(
      canEdit ? 'modeler' : 'viewer',
      containerRef.current,
      stateRef.current,
      {
        minimap: { open: false },
      },
    );
    const bus = inst.get<{ on(e: string | string[], cb: (e: never) => void): void }>('eventBus');
    bus.on('selection.changed', (e: { newSelection: GraphElement[] }) =>
      setSelection(e.newSelection),
    );
    bus.on('canvas.viewbox.changed', (e: { viewbox: { scale: number } }) =>
      setZoom(e.viewbox.scale),
    );
    bus.on('commandStack.changed', () => {
      if (importingRef.current) return;
      const stack = inst.get<{ canUndo(): boolean; canRedo(): boolean }>('commandStack');
      setHistory({ canUndo: stack.canUndo(), canRedo: stack.canRedo() });
      setChangeTick((n) => n + 1);
      setRev((n) => n + 1);
    });
    if (!canEdit)
      bus.on('element.click', (e: { element: GraphElement }) =>
        setSelection(e.element.businessObject ? [e.element] : []),
      );
    setInstance(inst);
    return () => inst.destroy();
  }, [canEdit]);

  const load = useCallback(async (inst: GraphInstance, c: GraphContent) => {
    try {
      await importGraph(inst, c);
      inst.get<{ clear(): void }>('commandStack').clear();
      setHistory({ canUndo: false, canRedo: false });
      setImportError(null);
      setLoaded(true);
      requestAnimationFrame(() => fitPage(inst.get<Canvas>('canvas')));
    } catch (err) {
      setImportError((err as Error).message);
    }
  }, []);

  // Import once per instance (a refetch of the content must not replace the canvas being edited);
  // `onRestored` resets it.
  const importedRef = useRef<GraphInstance | null>(null);
  useEffect(() => {
    if (!instance || !content.data || loaded || importedRef.current === instance) return;
    importedRef.current = instance;
    const parsed = parseDiagramContent(type, content.data.content);
    if (!parsed.ok) {
      setImportError(t('diagrams:invalidContent'));
      return;
    }
    void load(instance, parsed.content as GraphContent);
  }, [instance, content.data, loaded, type, load, t]);

  useEffect(() => {
    onState?.(instance, rev, loaded);
  }, [onState, instance, rev, loaded]);

  useEffect(() => {
    stateRef.current.locale = locale;
    stateRef.current.theme = theme;
    if (instance) redrawAll(instance);
  }, [locale, theme, instance]);

  const getContent = useCallback(
    () => (instance && loaded ? stringifyDiagramContent(exportGraph(instance, type)) : null),
    [instance, loaded, type],
  );

  /** Replaces the whole content as one change (generation): it is saved, and undo is reset. */
  const reload = useCallback(
    (c: GraphContent) => {
      if (!instance) return;
      void load(instance, c).then(() => setChangeTick((n) => n + 1));
    },
    [instance, load],
  );

  const selected = selection.length === 1 ? selection[0] : null;
  const selectedRef: SelectedElement | null = useMemo(() => {
    void rev;
    if (!selected || (selected.type !== SHAPE_TYPE && selected.type !== EDGE_TYPE)) return null;
    const bo = selected.businessObject;
    return { id: selected.id, nameEn: bo.nameEn ?? '', nameAr: bo.nameAr ?? '' };
  }, [selected, rev]);

  const update = useCallback(
    (element: GraphElement, properties: Record<string, unknown>) =>
      instance
        ?.get<{ execute(c: string, ctx: unknown): void }>('commandStack')
        .execute('ph.updateProperties', { element, properties }),
    [instance],
  );

  const focusElement = (id: string) => {
    const el = instance
      ?.get<{ get(id: string): GraphElement | undefined }>('elementRegistry')
      .get(id);
    if (!el || !instance) return;
    instance.get<{ select(e: unknown): void }>('selection').select(el);
    instance.get<{ scrollToElement(e: unknown): void }>('canvas').scrollToElement(el);
  };

  const properties = (
    <div className="ph-panel-section">
      {!selected || !selectedRef ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('diagrams:selectElement')} />
      ) : (
        <ElementProperties
          key={`${selected.id}-${rev}`}
          element={selected}
          canEdit={canEdit}
          onChange={(props) => update(selected, props)}
          extra={
            instance &&
            renderProperties?.({
              instance,
              element: selected,
              update: (props) => update(selected, props),
              canEdit,
            })
          }
        />
      )}
    </div>
  );

  if (content.isError)
    return <ErrorState error={content.error} onRetry={() => void content.refetch()} />;

  return (
    <DiagramWorkspace
      diagram={diagram}
      canEdit={canEdit}
      loaded={loaded}
      getContent={getContent}
      getSvg={async () => (instance ? graphSvg(instance) : '')}
      changeTick={changeTick}
      history={
        canEdit && instance
          ? {
              ...history,
              undo: () => instance.get<{ undo(): void }>('commandStack').undo(),
              redo: () => instance.get<{ redo(): void }>('commandStack').redo(),
            }
          : undefined
      }
      selected={selectedRef}
      onFocusElement={focusElement}
      importError={importError}
      onRestored={() => {
        void content.refetch().then(() => {
          importedRef.current = null;
          setLoaded(false);
        });
      }}
      onClose={onClose}
      saveRef={saveRef}
      palette={
        <GraphPalette
          instance={instance}
          notation={notation}
          theme={theme}
          collapsed={paletteCollapsed}
          onCollapsedChange={setPaletteCollapsed}
        />
      }
      tools={
        <>
          {tools?.(instance, reload)}
          <ZoomControl instance={instance} zoom={zoom} />
          <Tooltip title={t('diagrams:fit')}>
            <Button
              size="small"
              type="text"
              icon={<BorderOuterOutlined />}
              aria-label={t('diagrams:fit')}
              onClick={() => instance && fitPage(instance.get<Canvas>('canvas'))}
            />
          </Tooltip>
          <Tooltip title={t('diagrams:minimap')}>
            <Button
              size="small"
              type={minimap ? 'primary' : 'text'}
              ghost={minimap}
              icon={<CompassOutlined />}
              aria-label={t('diagrams:minimap')}
              aria-pressed={minimap}
              onClick={() => {
                if (!instance) return;
                setMinimap(instance, !minimap);
                setMinimapOpen(!minimap);
              }}
            />
          </Tooltip>
        </>
      }
      panels={[
        { key: 'properties', label: t('modeler:properties'), children: properties },
        ...(panels?.(instance, changeTick) ?? []),
      ]}
      canvas={
        <>
          <div
            className="ph-ws-canvas ph-graph-canvas"
            dir="ltr"
            ref={containerRef}
            data-notation={type}
            aria-label={t(`diagrams:type.${type}`)}
          />
          {overlay}
          {canEdit && instance && (
            <LayoutToolbar
              instance={instance}
              selection={selection as unknown as DiagramElement[]}
            />
          )}
          {content.isLoading && (
            <div className="ph-modeler-loading">
              <LoadingState />
            </div>
          )}
        </>
      }
    />
  );
}

/** Bilingual label, description and colours of the selected shape or connection. */
function ElementProperties({
  element,
  canEdit,
  onChange,
  extra,
}: {
  element: GraphElement;
  canEdit: boolean;
  onChange: (props: Record<string, unknown>) => void;
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const bo = element.businessObject as unknown as Record<string, string | undefined>;
  const [draft, setDraft] = useState({
    nameEn: bo.nameEn ?? '',
    nameAr: bo.nameAr ?? '',
    descriptionEn: bo.descriptionEn ?? '',
    descriptionAr: bo.descriptionAr ?? '',
  });
  const commit = (key: keyof typeof draft) => {
    const value = draft[key].trim();
    if ((bo[key] ?? '') !== value) onChange({ [key]: value });
  };
  const connection = isConnection(element);
  return (
    <Form layout="vertical" size="small">
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t(`diagrams:kinds.${String(bo.kind)}`)}
      </Typography.Text>
      <Form.Item label={t('diagrams:label.en')} style={{ marginBlockStart: 8 }}>
        <Input
          dir="ltr"
          lang="en"
          maxLength={300}
          value={draft.nameEn}
          readOnly={!canEdit}
          onChange={(e) => setDraft((d) => ({ ...d, nameEn: e.target.value }))}
          onBlur={() => commit('nameEn')}
          onPressEnter={() => commit('nameEn')}
          data-field="nameEn"
        />
      </Form.Item>
      <Form.Item label={t('diagrams:label.ar')}>
        <Input
          dir="rtl"
          lang="ar"
          maxLength={300}
          value={draft.nameAr}
          readOnly={!canEdit}
          onChange={(e) => setDraft((d) => ({ ...d, nameAr: e.target.value }))}
          onBlur={() => commit('nameAr')}
          onPressEnter={() => commit('nameAr')}
          data-field="nameAr"
        />
      </Form.Item>
      {!connection && (
        <>
          <Form.Item label={t('modeler:description.en')}>
            <Input.TextArea
              dir="ltr"
              autoSize={{ minRows: 2, maxRows: 6 }}
              maxLength={4000}
              value={draft.descriptionEn}
              readOnly={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, descriptionEn: e.target.value }))}
              onBlur={() => commit('descriptionEn')}
            />
          </Form.Item>
          <Form.Item label={t('modeler:description.ar')}>
            <Input.TextArea
              dir="rtl"
              lang="ar"
              autoSize={{ minRows: 2, maxRows: 6 }}
              maxLength={4000}
              value={draft.descriptionAr}
              readOnly={!canEdit}
              onChange={(e) => setDraft((d) => ({ ...d, descriptionAr: e.target.value }))}
              onBlur={() => commit('descriptionAr')}
            />
          </Form.Item>
          {canEdit && (
            <Form.Item label={t('diagrams:colour')}>
              <Space>
                <ColorPicker
                  size="small"
                  value={bo.fill ?? null}
                  onChangeComplete={(c) => onChange({ fill: c.toHexString().toUpperCase() })}
                  showText={() => t('diagrams:fill')}
                />
                <ColorPicker
                  size="small"
                  value={bo.stroke ?? null}
                  onChangeComplete={(c) => onChange({ stroke: c.toHexString().toUpperCase() })}
                  showText={() => t('diagrams:stroke')}
                />
                <Tooltip title={t('diagrams:resetColour')}>
                  <Button
                    size="small"
                    icon={<ClearOutlined />}
                    aria-label={t('diagrams:resetColour')}
                    onClick={() => onChange({ fill: undefined, stroke: undefined })}
                  />
                </Tooltip>
              </Space>
            </Form.Item>
          )}
        </>
      )}
      {extra && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          {extra}
        </>
      )}
    </Form>
  );
}
