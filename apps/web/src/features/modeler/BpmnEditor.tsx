import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router-dom';
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Dropdown,
  Flex,
  Form,
  Input,
  Modal,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import {
  CompressOutlined,
  DownloadOutlined,
  HistoryOutlined,
  RedoOutlined,
  CloudSyncOutlined,
  SaveOutlined,
  UndoOutlined,
  UploadOutlined,
  WarningOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import Modeler from 'bpmn-js/lib/Modeler';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import {
  BPMN_MAX_BYTES,
  validateBpmnGraph,
  type BpmnIssue,
  type ProcessDto,
} from '@processhub/shared';
import {
  useCreateVersion,
  useLinks,
  useProcessModel,
  useSaveModel,
  useVersions,
} from '@/api/hooks';
import { useLocale } from '@/app/LocaleProvider';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { ErrorState, LoadingState } from '@/components/states';
import type {
  BpmnInstance,
  Canvas,
  CommandStack,
  DiagramElement,
  ElementRegistry,
  EventBus,
  Overlays,
  Selection,
} from './bpmn-types';
import {
  applyLanguage,
  bilingualModule,
  buildGraph,
  canDrillDown,
  exportXml,
  linkedProcessOf,
  normaliseDiagram,
  type LabelState,
} from './diagram';
import { EMPTY_DIAGRAM, phModdleDescriptor } from './phModdle';
import { translateModule } from './translate';
import { downloadBlob, exportFileName, svgToPng } from './export';
import { ElementPanel } from './ElementPanel';
import { VersionsDrawer } from './VersionsDrawer';

/** Fits the diagram once the browser has laid out the canvas. */
function fitViewport(instance: BpmnInstance) {
  requestAnimationFrame(() => {
    const canvas = instance.get<Canvas>('canvas');
    canvas.resized();
    const fit = canvas.zoom('fit-viewport', 'auto');
    // Leave room for the palette and never enlarge small diagrams beyond 100%.
    canvas.zoom(Math.min(fit * 0.85, 1), 'auto');
  });
}

interface Props {
  process: ProcessDto;
  focusElementId?: string;
}

/** Changes are autosaved to the working model (a draft) after this pause; versions are explicit. */
const AUTOSAVE_MS = 3000;

export function BpmnEditor({ process, focusElementId }: Props) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const loc = useLocalized();
  const navigate = useNavigate();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message, modal } = App.useApp();
  const canEdit = process.canEditModel;

  const model = useProcessModel(process.id);
  const links = useLinks(process.id);
  const saveModel = useSaveModel(process.id);
  const createVersion = useCreateVersion(process.id);
  const versions = useVersions(process.id);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const autosaveRef = useRef<() => Promise<boolean>>(async () => true);

  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<BpmnInstance | null>(null);
  const stateRef = useRef<LabelState>({ locale });
  const loadedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<DiagramElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<BpmnIssue[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<'properties' | 'issues'>('properties');
  const [versionOpen, setVersionOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [versionForm] = Form.useForm<{ changeNote: string }>();

  const fileBase = loc(process);

  const revalidate = useCallback(() => {
    const instance = instanceRef.current;
    if (instance) setIssues(validateBpmnGraph(buildGraph(instance)));
  }, []);

  const refreshOverlays = useCallback(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    const overlays = instance.get<Overlays>('overlays');
    const registry = instance.get<ElementRegistry>('elementRegistry');
    overlays.remove({ type: 'ph-badge' });
    overlays.remove({ type: 'ph-drill' });
    const counts = new Map<string, number>();
    for (const l of links.data ?? [])
      counts.set(l.bpmnElementId, (counts.get(l.bpmnElementId) ?? 0) + 1);
    for (const [elementId, count] of counts) {
      if (!registry.get(elementId)) continue;
      const badge = document.createElement('div');
      badge.className = 'ph-overlay-badge';
      badge.textContent = String(count);
      badge.title = t('modeler:linkedObjectsCount', { count });
      overlays.add(elementId, 'ph-badge', { position: { top: -8, right: 8 }, html: badge });
    }
    for (const el of registry.filter(
      (e) => canDrillDown(e) && !!linkedProcessOf(e.businessObject),
    )) {
      const target = linkedProcessOf(el.businessObject)!;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ph-overlay-drill';
      button.textContent = '↗';
      button.title = t('modeler:openLinkedProcess');
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        navigate(`/processes/${target}?tab=model`);
      });
      overlays.add(el.id, 'ph-drill', { position: { bottom: 10, left: 6 }, html: button });
    }
  }, [links.data, navigate, t]);

  // Create the modeler (editable) or viewer (read-only) once.
  useEffect(() => {
    if (!containerRef.current) return;
    const options = {
      container: containerRef.current,
      moddleExtensions: { ph: phModdleDescriptor },
      additionalModules: [
        translateModule(stateRef.current),
        ...(canEdit ? [bilingualModule(stateRef.current)] : []),
      ],
    };
    const instance = (canEdit
      ? new Modeler(options)
      : new NavigatedViewer(options)) as unknown as BpmnInstance;
    instanceRef.current = instance;
    const eventBus = instance.get<EventBus>('eventBus');
    eventBus.on('selection.changed', (e: { newSelection: DiagramElement[] }) => {
      const el = e.newSelection[0];
      setSelected(el && el.type !== 'label' ? el : (el?.labelTarget ?? null));
    });
    eventBus.on('commandStack.changed', () => {
      const stack = instance.get<CommandStack>('commandStack');
      setCanUndo(stack.canUndo());
      setCanRedo(stack.canRedo());
      setDirty(true);
      revalidate();
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => void autosaveRef.current(), AUTOSAVE_MS);
    });
    if (!canEdit) {
      eventBus.on('element.click', (e: { element: DiagramElement }) => {
        const el = e.element;
        setSelected(
          el.type === 'bpmn:Process' || el.type === 'label' ? (el.labelTarget ?? null) : el,
        );
      });
    }
    const observer = new ResizeObserver(() => instance.get<Canvas>('canvas').resized());
    observer.observe(containerRef.current);
    setReady(true);
    return () => {
      clearTimeout(autosaveTimer.current);
      observer.disconnect();
      instance.destroy();
      instanceRef.current = null;
      loadedRef.current = false;
      setReady(false);
    };
  }, [canEdit, revalidate]);

  const importDiagram = useCallback(
    async (xml: string, markDirty: boolean) => {
      const instance = instanceRef.current;
      if (!instance) return false;
      try {
        await instance.importXML(xml);
        normaliseDiagram(instance);
        applyLanguage(instance, stateRef.current.locale);
        fitViewport(instance);
        setImportError(null);
        setDirty(markDirty);
        if (markDirty) {
          clearTimeout(autosaveTimer.current);
          autosaveTimer.current = setTimeout(() => void autosaveRef.current(), AUTOSAVE_MS);
        }
        setSelected(null);
        revalidate();
        refreshOverlays();
        return true;
      } catch (err) {
        setImportError((err as Error).message);
        return false;
      }
    },
    [revalidate, refreshOverlays],
  );

  // Load the stored model once the instance and data are ready.
  useEffect(() => {
    if (!ready || !model.data || loadedRef.current) return;
    loadedRef.current = true;
    void importDiagram(model.data.bpmnXml ?? EMPTY_DIAGRAM, false).then((ok) => {
      if (ok && focusElementId) {
        const el = instanceRef.current?.get<ElementRegistry>('elementRegistry').get(focusElementId);
        if (el) {
          instanceRef.current!.get<Selection>('selection').select(el);
          instanceRef.current!.get<Canvas>('canvas').scrollToElement(el);
          setSelected(el);
        }
      }
    });
  }, [ready, model.data, importDiagram, focusElementId]);

  useEffect(() => {
    stateRef.current.locale = locale;
    if (instanceRef.current && loadedRef.current) {
      applyLanguage(instanceRef.current, locale);
      revalidate();
    }
  }, [locale, revalidate]);

  useEffect(() => {
    if (loadedRef.current) refreshOverlays();
  }, [refreshOverlays]);

  // Warn before leaving with unsaved changes.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    // Save the draft on the way out; only ask when that fails.
    void autosaveRef.current().then((ok) => {
      if (ok) {
        blocker.proceed();
        return;
      }
      modal.confirm({
        title: t('modeler:unsavedTitle'),
        content: t('modeler:unsavedText'),
        okText: t('modeler:leave'),
        okButtonProps: { danger: true },
        cancelText: t('modeler:stay'),
        onOk: () => blocker.proceed(),
        onCancel: () => blocker.reset(),
      });
    });
  }, [blocker, modal, t]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const currentXml = useCallback(
    () => exportXml(instanceRef.current!, stateRef.current.locale),
    [],
  );

  /** Saves the working model as a draft (no version). Returns false when saving failed. */
  const autosave = useCallback(async () => {
    clearTimeout(autosaveTimer.current);
    if (!instanceRef.current || !canEdit) return true;
    try {
      await saveModel.mutateAsync(await currentXml());
      setDirty(false);
      return true;
    } catch (err) {
      message.error(errorMessage(err));
      return false;
    }
  }, [canEdit, currentXml, saveModel, message, errorMessage]);
  autosaveRef.current = autosave;

  const saveVersion = async () => {
    const { changeNote } = await versionForm.validateFields();
    try {
      clearTimeout(autosaveTimer.current);
      const v = await createVersion.mutateAsync({ bpmnXml: await currentXml(), changeNote });
      setDirty(false);
      setVersionOpen(false);
      versionForm.resetFields();
      message.success(t('modeler:versionSaved', { number: v.versionNumber }));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setVersionOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit]);

  /** After a restore the working model on the server changed: reload it. */
  const reloadModel = async () => {
    const res = await model.refetch();
    if (res.data?.bpmnXml) await importDiagram(res.data.bpmnXml, false);
  };

  const doExport = async (kind: 'bpmn' | 'svg' | 'png') => {
    const instance = instanceRef.current;
    if (!instance) return;
    try {
      if (kind === 'bpmn') {
        downloadBlob(
          new Blob([await currentXml()], { type: 'application/xml' }),
          exportFileName(process.code, fileBase, 'bpmn'),
        );
        return;
      }
      const { svg } = await instance.saveSVG();
      if (kind === 'svg')
        downloadBlob(
          new Blob([svg], { type: 'image/svg+xml' }),
          exportFileName(process.code, fileBase, 'svg'),
        );
      else downloadBlob(await svgToPng(svg), exportFileName(process.code, fileBase, 'png'));
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const importFile = async (file: File) => {
    if (file.size > BPMN_MAX_BYTES) {
      message.error(t('errors:FILE_TOO_LARGE'));
      return;
    }
    const xml = await file.text();
    const run = async () => {
      if (await importDiagram(xml, true)) message.success(t('modeler:imported'));
      else message.error(t('modeler:importFailed'));
    };
    modal.confirm({
      title: t('modeler:importTitle'),
      content: t('modeler:importText'),
      okText: t('modeler:import'),
      cancelText: t('cancel'),
      onOk: run,
    });
  };

  const zoom = (delta: number | 'fit') => {
    const canvas = instanceRef.current?.get<Canvas>('canvas');
    if (!canvas) return;
    if (delta === 'fit') fitViewport(instanceRef.current!);
    else canvas.zoom(Math.min(4, Math.max(0.2, canvas.zoom() + delta)));
  };

  const focusElement = (id?: string) => {
    if (!id || !instanceRef.current) return;
    const el = instanceRef.current.get<ElementRegistry>('elementRegistry').get(id);
    if (!el) return;
    if (canEdit) instanceRef.current.get<Selection>('selection').select(el);
    instanceRef.current.get<Canvas>('canvas').scrollToElement(el);
    setSelected(el);
    setPanelTab('properties');
  };

  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const lastSaved = useMemo(
    () =>
      model.data?.updatedAt
        ? t('modeler:draftSaved', {
            time: formatDate(model.data.updatedAt),
            name: loc(model.data.updatedBy) || model.data.updatedBy?.email || '—',
          })
        : t('modeler:neverSaved'),
    [model.data, formatDate, loc, t],
  );
  const latestVersion = versions.data?.[0];

  if (model.isError) return <ErrorState error={model.error} onRetry={() => void model.refetch()} />;

  return (
    <Card className="ph-modeler-card" styles={{ body: { padding: 0 } }}>
      <Flex
        className="ph-modeler-toolbar"
        justify="space-between"
        align="center"
        wrap="wrap"
        gap={8}
      >
        <Space wrap size={6}>
          {canEdit ? (
            <>
              <Tooltip title={t('modeler:saveHint')}>
                <Button type="primary" icon={<SaveOutlined />} onClick={() => setVersionOpen(true)}>
                  {t('save')}
                </Button>
              </Tooltip>
              <Tooltip title={t('modeler:undo')}>
                <Button
                  icon={<UndoOutlined />}
                  disabled={!canUndo}
                  onClick={() => instanceRef.current?.get<CommandStack>('commandStack').undo()}
                  aria-label={t('modeler:undo')}
                />
              </Tooltip>
              <Tooltip title={t('modeler:redo')}>
                <Button
                  icon={<RedoOutlined />}
                  disabled={!canRedo}
                  onClick={() => instanceRef.current?.get<CommandStack>('commandStack').redo()}
                  aria-label={t('modeler:redo')}
                />
              </Tooltip>
            </>
          ) : (
            <Tag color="default">{t('modeler:readOnly')}</Tag>
          )}
          <Tooltip title={t('modeler:zoomIn')}>
            <Button
              icon={<ZoomInOutlined />}
              onClick={() => zoom(0.2)}
              aria-label={t('modeler:zoomIn')}
            />
          </Tooltip>
          <Tooltip title={t('modeler:zoomOut')}>
            <Button
              icon={<ZoomOutOutlined />}
              onClick={() => zoom(-0.2)}
              aria-label={t('modeler:zoomOut')}
            />
          </Tooltip>
          <Tooltip title={t('modeler:fit')}>
            <Button
              icon={<CompressOutlined />}
              onClick={() => zoom('fit')}
              aria-label={t('modeler:fit')}
            />
          </Tooltip>
        </Space>
        <Space wrap size={6}>
          <Badge count={warnings} size="small" offset={[-4, 4]}>
            <Button icon={<WarningOutlined />} onClick={() => setPanelTab('issues')}>
              {t('modeler:validation')}
            </Button>
          </Badge>
          <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>
            {t('modeler:versions')}
          </Button>
          {canEdit && (
            <Upload
              accept=".bpmn,.xml,application/xml,text/xml"
              showUploadList={false}
              beforeUpload={(f) => {
                void importFile(f);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />}>{t('modeler:import')}</Button>
            </Upload>
          )}
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'bpmn',
                  label: t('modeler:exportBpmn'),
                  onClick: () => void doExport('bpmn'),
                },
                { key: 'svg', label: t('modeler:exportSvg'), onClick: () => void doExport('svg') },
                { key: 'png', label: t('modeler:exportPng'), onClick: () => void doExport('png') },
              ],
            }}
          >
            <Button icon={<DownloadOutlined />}>{t('modeler:export')}</Button>
          </Dropdown>
        </Space>
      </Flex>
      {importError && (
        <Alert
          type="error"
          showIcon
          banner
          message={t('modeler:importFailed')}
          description={importError}
          closable
          onClose={() => setImportError(null)}
        />
      )}
      <div className="ph-modeler-body">
        {/* bpmn-js renders its own UI; keep it LTR so palette and canvas behave consistently. */}
        <div className="ph-modeler-canvas-wrap">
          <div
            className="ph-modeler-canvas"
            dir="ltr"
            ref={containerRef}
            aria-label={t('modeler:canvas')}
          />
          {model.isLoading && (
            <div className="ph-modeler-loading">
              <LoadingState />
            </div>
          )}
        </div>
        <aside className="ph-modeler-panel">
          <Tabs
            size="small"
            activeKey={panelTab}
            onChange={(k) => setPanelTab(k as 'properties' | 'issues')}
            items={[
              {
                key: 'properties',
                label: t('modeler:properties'),
                children: (
                  <ElementPanel
                    instance={instanceRef.current}
                    element={selected}
                    process={process}
                    links={links.data ?? []}
                    canEdit={canEdit}
                  />
                ),
              },
              {
                key: 'issues',
                label: (
                  <Space size={4}>
                    {t('modeler:issues')}
                    {issues.length > 0 && (
                      <Badge
                        count={issues.length}
                        size="small"
                        color={warnings ? '#b45309' : '#64748b'}
                      />
                    )}
                  </Space>
                ),
                children:
                  issues.length === 0 ? (
                    <Alert type="success" showIcon message={t('modeler:noIssues')} />
                  ) : (
                    <ul className="ph-issues">
                      {issues.map((i, idx) => (
                        <li key={`${i.code}-${i.elementId ?? idx}`}>
                          <button
                            type="button"
                            className="ph-issue"
                            onClick={() => focusElement(i.elementId)}
                            disabled={!i.elementId}
                          >
                            <Tag color={i.severity === 'warning' ? 'orange' : 'default'}>
                              {t(`modeler:severity.${i.severity}`)}
                            </Tag>
                            <span>{t(`modeler:rules.${i.code}`)}</span>
                            {i.elementId && (
                              <Typography.Text type="secondary" className="ph-issue-id" dir="ltr">
                                {i.elementId}
                              </Typography.Text>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ),
              },
            ]}
          />
        </aside>
      </div>

      <Flex className="ph-modeler-status" justify="space-between" align="center" gap={8}>
        <Space size={6} wrap>
          {canEdit && <CloudSyncOutlined className="ph-muted" />}
          <Typography.Text type="secondary">{lastSaved}</Typography.Text>
        </Space>
        <Space size={6} wrap>
          {dirty ? (
            <Tag color="orange">
              {saveModel.isPending ? t('modeler:autosaving') : t('modeler:unsaved')}
            </Tag>
          ) : null}
          <Typography.Text type="secondary">
            {latestVersion
              ? t('modeler:latestVersion', {
                  number: latestVersion.versionNumber,
                  time: formatDate(latestVersion.createdAt),
                })
              : t('modeler:noVersionYet')}
          </Typography.Text>
        </Space>
      </Flex>

      <Modal
        title={t('modeler:saveVersionTitle')}
        open={versionOpen}
        onCancel={() => setVersionOpen(false)}
        onOk={() => void saveVersion()}
        okText={t('save')}
        cancelText={t('cancel')}
        confirmLoading={createVersion.isPending}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">{t('modeler:versionHint')}</Typography.Paragraph>
        <Form form={versionForm} layout="vertical">
          <Form.Item
            name="changeNote"
            label={t('modeler:changeNote')}
            rules={[
              { required: true, whitespace: true, message: t('validation.required') },
              { max: 1000 },
            ]}
          >
            <Input.TextArea rows={3} maxLength={1000} showCount autoFocus />
          </Form.Item>
        </Form>
      </Modal>
      <VersionsDrawer
        processId={process.id}
        open={historyOpen}
        canEdit={canEdit}
        onClose={() => setHistoryOpen(false)}
        onRestored={() => void reloadModel()}
      />
    </Card>
  );
}
