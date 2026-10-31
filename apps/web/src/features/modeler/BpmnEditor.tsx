import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router-dom';
import {
  Alert,
  App,
  Badge,
  Button,
  Dropdown,
  Form,
  Input,
  Modal,
  Segmented,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ApartmentOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  CommentOutlined,
  ExpandOutlined,
  CompressOutlined,
  EyeOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  HistoryOutlined,
  LayoutOutlined,
  QuestionOutlined,
  RedoOutlined,
  SaveOutlined,
  SearchOutlined,
  SwapOutlined,
  SyncOutlined,
  UndoOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import {
  BPMN_MAX_BYTES,
  DEFAULT_DIAGRAM_THEME,
  DEFAULT_GRC_SETTINGS,
  PERMISSIONS,
  isFlowNode,
  summariseSteps,
  validateBpmnGraph,
  type AiGeneratedProcessDto,
  type AiSuggestedLinkDto,
  type BpmnIssue,
  type ConventionIssue,
  type Locale,
  type ProcessDto,
  type ProcessSummaryDto,
  type KpiRag,
} from '@processhub/shared';
import {
  useCreateLink,
  useCreateVersion,
  useDeleteLink,
  useLinks,
  useProcessModel,
  usePublicSettings,
  useSaveModel,
  useVersions,
} from '@/api/hooks';
import { useComments } from '@/api/governance';
import { useConventions } from '@/api/conventions';
import { useAuth } from '@/auth/AuthProvider';
import { useLocale } from '@/app/LocaleProvider';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { ErrorState, LoadingState } from '@/components/states';
import { StatusTag } from '@/components/tags';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { AiBadge, AiButton, AiIcon } from '@/features/ai/AiParts';
import { AiChatPanel } from '@/features/ai/AiChatPanel';
import { AnalysisDrawer } from '@/features/ai/AnalysisDrawer';
import { useAi } from '@/features/ai/useAi';
import { GenerateProcessModal } from '@/features/ai/GenerateProcessModal';
import { TranslateLabelsModal, type LabelTranslation } from '@/features/ai/TranslateLabelsModal';
import type {
  BpmnInstance,
  Canvas,
  CommandStack,
  DiagramElement,
  ElementRegistry,
  EventBus,
  Modeling,
  Selection,
} from './bpmn-types';
import {
  applyLanguage,
  bilingualModule,
  buildGraph,
  exportXml,
  normaliseDiagram,
  readLabels,
  type LabelState,
} from './diagram';
import { pickLabel } from './labels';
import { ConventionIssueList } from './ConventionIssues';
import { conventionIssues, withoutDuplicates } from './conventions';
import { EMPTY_DIAGRAM } from './phModdle';
import { translateModule } from './translate';
import { downloadBlob, exportFileName, svgToPng } from './export';
import { embedDiagramFonts } from './export-fonts';
import { createDiagram, importDiagram as importDiagramXml } from './create-diagram';
import { themeModule, type ThemeState } from './theme';
import { colourPickerModule, pickerColours, syncPickerColours } from './color-picker';
import { ElementPanel } from './ElementPanel';
import { GrcStepPanel } from '@/features/grc/GrcStepPanel';
import { ControlGapsDrawer } from '@/features/grc/ControlGapsDrawer';
import { useGrcSettings, useProcessGrc } from '@/api/grc';
import { useProcessKpis } from '@/api/kpi';
import { KpiStepPanel } from '@/features/kpi/ProcessKpis';
import { useAllApplications } from '@/api/ea';
import { VersionsDrawer } from './VersionsDrawer';
import { useWorkspacePrefs } from './workspace-prefs';
import { initialPanelState, panelReducer } from './panel-state';
import { afterLayout, fitWidth } from './view';
import { ZoomControl } from './ZoomControl';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Palette } from './Palette';
import { LayoutToolbar } from './LayoutToolbar';
import { ProcessPickerModal } from './ProcessPickerModal';
import { MinimapModule, setMinimap } from './minimap';
import { autoLayoutModule, runAutoLayout } from './auto-layout';
import {
  commentBadgeItems,
  grcAlertBadgeItems,
  kpiBadgeItems,
  linkBadgeItems,
  useDiagramOverlays,
} from './useDiagramOverlays';
import type { ReadyStep } from './palette-entries';
import { workspaceShortcut } from './keys';
import { applyLabelSource, syncLabelRefMarkers } from './label-source';
import { LabelAutocomplete } from './LabelAutocomplete';
import { keepSelectionModule } from './keep-selection';
import { applyRows, diagramToRows, quickModelModule, type QuickRow } from './quick-model';
import { QuickModelView } from './QuickModelView';
import {
  COLOUR_BY_MODES,
  applyColourBy,
  clearColourBy,
  type ColourByMode,
  type LegendItem,
} from './colour-by';
import { ColourByLegend } from './ColourByLegend';
import { ReportDialog, type ReportKind } from '@/features/reports/ReportDialog';

type PanelTab = 'properties' | 'grc' | 'kpis' | 'issues' | 'comments' | 'ai';

interface Props {
  process: ProcessDto;
  focusElementId?: string;
  /** Open read-only even when the user may edit the model. */
  readOnly?: boolean;
  onClose: () => void;
}

/** Changes are autosaved to the working model (a draft) after this pause; versions are explicit. */
const AUTOSAVE_MS = 3000;

/**
 * Full-screen modeler workspace (route /processes/:id/model): slim top bar, palette on the
 * inline-start side, the canvas filling the viewport, and a collapsible / resizable side panel
 * (Properties, Issues, Comments, AI).
 */
export function BpmnEditor({ process, focusElementId, readOnly = false, onClose }: Props) {
  const { t } = useTranslation();
  const { locale, dir } = useLocale();
  const dirRef = useRef(dir);
  dirRef.current = dir;
  const { user, can } = useAuth();
  const loc = useLocalized();
  const navigate = useNavigate();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message, modal } = App.useApp();
  const canEdit = process.canEditModel && !readOnly;

  const model = useProcessModel(process.id);
  const links = useLinks(process.id);
  const saveModel = useSaveModel(process.id);
  const createVersion = useCreateVersion(process.id);
  const createLink = useCreateLink(process.id);
  const deleteLink = useDeleteLink(process.id);
  const { available: aiAvailable } = useAi();
  const versions = useVersions(process.id);
  const comments = useComments('PROCESS', process.id);
  const canReadGrc = can(PERMISSIONS.GRC_READ);
  const processGrc = useProcessGrc(process.id, canReadGrc);
  const grcConfig = useGrcSettings(canReadGrc);
  const grcSteps = useMemo(() => summariseSteps(processGrc.data?.items ?? []), [processGrc.data]);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const autosaveRef = useRef<() => Promise<boolean>>(async () => true);

  const [prefs, updatePrefs] = useWorkspacePrefs(user?.id);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [panel, panelDispatch] = useReducer(panelReducer, prefs, initialPanelState);
  const [focusMode, setFocusMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Diagram or Quick Model (table) view of the same model. */
  const [view, setView] = useState<'diagram' | 'table'>('diagram');
  const [tableOpened, setTableOpened] = useState(false);
  /** "Colour by" view (view only, stored colours never change). */
  const [colourBy, setColourBy] = useState<ColourByMode>('none');
  // KPIs of the process and its steps (Phase 4.3): side panel, badges, "Colour by → KPI status".
  const canReadKpi = can(PERMISSIONS.KPI_READ);
  const processKpis = useProcessKpis(process.id, canReadKpi);
  const kpiSteps = useMemo(() => {
    const m = new Map<string, (KpiRag | null)[]>();
    for (const k of processKpis.data?.items ?? [])
      m.set(k.bpmnElementId, [...(m.get(k.bpmnElementId) ?? []), k.rag]);
    return m;
  }, [processKpis.data]);
  // Application lifecycles for "Colour by → Application lifecycle" (Phase 4.3).
  const canReadEa = can(PERMISSIONS.EA_READ);
  const applications = useAllApplications(canReadEa && colourBy === 'appLifecycle');
  const lifecycles = useMemo(
    () => new Map((applications.data?.items ?? []).map((a) => [a.id, a.lifecycle])),
    [applications.data],
  );
  const [legend, setLegend] = useState<LegendItem[]>([]);
  const [missingCounts, setMissingCounts] = useState({ role: 0, description: 0 });
  const [report, setReport] = useState<ReportKind | null>(null);
  const [gapsOpen, setGapsOpen] = useState(false);
  useEffect(() => {
    if (view === 'table') setTableOpened(true);
  }, [view]);

  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<BpmnInstance | null>(null);
  const [instance, setInstance] = useState<BpmnInstance | null>(null);
  const stateRef = useRef<LabelState>({ locale });
  const settings = usePublicSettings();
  const themeRef = useRef<ThemeState>({ theme: DEFAULT_DIAGRAM_THEME });
  const paletteRef = useRef(pickerColours(DEFAULT_DIAGRAM_THEME));
  const loadedRef = useRef(false);
  /** Incremented after each import (redraws badges). */
  const [loadCount, setLoadCount] = useState(0);
  const loaded = loadCount > 0;
  const [selected, setSelected] = useState<DiagramElement | null>(null);
  const [selection, setSelection] = useState<DiagramElement[]>([]);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<BpmnIssue[]>([]);
  const [conventionFindings, setConventionFindings] = useState<ConventionIssue[]>([]);
  const conventions = useConventions();
  const conventionsRef = useRef(conventions.data);
  conventionsRef.current = conventions.data;
  const conventionRun = useRef(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>('properties');
  const [versionOpen, setVersionOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pickFor, setPickFor] = useState<DiagramElement | null>(null);
  const [versionForm] = Form.useForm<{ changeNote: string }>();
  const fileInput = useRef<HTMLInputElement>(null);
  /** The diagram is exactly what the AI assistant produced: cleared by any edit (D-041). */
  const aiRef = useRef(process.aiGenerated);
  const [aiFlag, setAiFlag] = useState(process.aiGenerated);
  const [aiDialog, setAiDialog] = useState<
    'generate' | 'translate-ar' | 'translate-en' | 'analyse' | null
  >(null);

  const fileBase = loc(process);

  const showPanel = useCallback((tab: PanelTab) => {
    setPanelTab(tab);
    setFocusMode(false);
    panelDispatch({ type: 'show' });
  }, []);

  const revalidate = useCallback(() => {
    const inst = instanceRef.current;
    if (!inst) return;
    setIssues(validateBpmnGraph(buildGraph(inst)));
    const rules = conventionsRef.current;
    if (!rules) return;
    const run = ++conventionRun.current;
    void conventionIssues(inst, rules)
      .then((found) => {
        if (run === conventionRun.current) setConventionFindings(found);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (conventions.data) revalidate();
  }, [conventions.data, revalidate]);

  const selectElement = useCallback(
    (el: DiagramElement, tab: PanelTab = 'properties') => {
      const inst = instanceRef.current;
      if (!inst) return;
      if (canEdit) inst.get<Selection>('selection').select(el);
      setSelected(el);
      showPanel(tab);
    },
    [canEdit, showPanel],
  );

  const badgeItems = useMemo(
    () => [
      ...linkBadgeItems(
        (links.data ?? []).map((l) => ({ bpmnElementId: l.bpmnElementId, object: l.repoObject })),
        loc,
      ),
      ...commentBadgeItems(comments.data ?? []),
      ...grcAlertBadgeItems(grcSteps, t('grc:detail.notControlled')),
      ...kpiBadgeItems(processKpis.data?.items ?? [], loc),
    ],
    [links.data, comments.data, loc, grcSteps, t, processKpis.data],
  );
  useDiagramOverlays({
    instance,
    version: loadCount,
    items: badgeItems,
    onBadge: (elementId, kind) => {
      const el = instanceRef.current?.get<ElementRegistry>('elementRegistry').get(elementId);
      if (el)
        selectElement(
          el,
          kind === 'COMMENT'
            ? 'comments'
            : canReadGrc && ['RISK', 'CONTROL', 'ALERT'].includes(kind)
              ? 'grc'
              : canReadKpi && kind.startsWith('KPI_')
                ? 'kpis'
                : 'properties',
        );
    },
    drill: { open: (target) => navigate(`/processes/${target}/model`) },
  });

  // Labels from the library (dictionary terms, roles, systems) carry a small book marker.
  useEffect(() => {
    if (!instance || !loaded) return;
    return syncLabelRefMarkers(instance, t('modeler:dictionary.marker'));
  }, [instance, loaded, t]);

  // "Colour by": re-applied after every edit, when links load or the language changes.
  useEffect(() => {
    if (!instance || !loaded) return;
    const eventBus = instance.get<EventBus>('eventBus');
    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const result = applyColourBy(instance, colourBy, {
          links: links.data ?? [],
          locale,
          label: (key) => t(`modeler:colourBy.categories.${key.replace(':', '.')}`),
          grc: { steps: grcSteps, bands: grcConfig.data?.bands ?? DEFAULT_GRC_SETTINGS.bands },
          lifecycles,
          kpis: kpiSteps,
        });
        setLegend(result.legend);
        const lacks = [...result.missing.values()];
        setMissingCounts({
          role: lacks.filter((l) => l.includes('role')).length,
          description: lacks.filter((l) => l.includes('description')).length,
        });
      });
    };
    apply();
    if (colourBy === 'none') return;
    eventBus.on(['commandStack.changed', 'import.done'], apply);
    return () => {
      cancelAnimationFrame(frame);
      eventBus.off(['commandStack.changed', 'import.done'], apply);
      clearColourBy(instance);
    };
  }, [
    instance,
    loaded,
    colourBy,
    links.data,
    locale,
    t,
    grcSteps,
    grcConfig.data,
    lifecycles,
    kpiSteps,
  ]);

  // The colour theme (Settings → Branding) applies to new elements and the colour picker.
  const theme = settings.data?.diagramTheme;
  useEffect(() => {
    if (!theme) return;
    themeRef.current.theme = theme;
    syncPickerColours(paletteRef.current, theme);
  }, [theme]);

  // Create the modeler (editable) or viewer (read-only) once.
  useEffect(() => {
    if (!containerRef.current) return;
    const inst = createDiagram(canEdit ? 'modeler' : 'navigated', {
      container: containerRef.current,
      additionalModules: [
        translateModule(stateRef.current),
        MinimapModule,
        ...(canEdit
          ? [
              bilingualModule(stateRef.current),
              themeModule(themeRef.current),
              colourPickerModule(),
              autoLayoutModule,
              keepSelectionModule,
              quickModelModule,
            ]
          : []),
      ],
      config: {
        minimap: { open: prefsRef.current.minimap },
        ...(canEdit ? { colorPicker: { colors: paletteRef.current } } : {}),
      },
    });
    instanceRef.current = inst;
    const eventBus = inst.get<EventBus>('eventBus');
    eventBus.on('selection.changed', (e: { newSelection: DiagramElement[] }) => {
      const el = e.newSelection[0];
      setSelection(e.newSelection);
      const current = el && el.type !== 'label' ? el : (el?.labelTarget ?? null);
      setSelected(current);
      panelDispatch({ type: 'select', hasSelection: !!current });
      if (current) setPanelTab((tab) => (tab === 'issues' ? 'properties' : tab));
    });
    eventBus.on('canvas.viewbox.changed', (e: { viewbox: { scale: number } }) =>
      setZoom(e.viewbox.scale),
    );
    eventBus.on('commandStack.changed', () => {
      const stack = inst.get<CommandStack>('commandStack');
      setCanUndo(stack.canUndo());
      setCanRedo(stack.canRedo());
      setDirty(true);
      aiRef.current = false;
      setAiFlag(false);
      revalidate();
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => void autosaveRef.current(), AUTOSAVE_MS);
    });
    if (!canEdit) {
      eventBus.on('element.click', (e: { element: DiagramElement }) => {
        const el = e.element;
        const current =
          el.type === 'bpmn:Process' || el.type === 'bpmn:Collaboration' || el.type === 'label'
            ? (el.labelTarget ?? null)
            : el;
        setSelected(current);
        panelDispatch({ type: 'select', hasSelection: !!current });
      });
    }
    if (canEdit) {
      inst
        .get<{ setActive(active: boolean): void }>('gridSnapping')
        .setActive(prefsRef.current.grid);
    }
    // Arabic: keep the diagram still on screen when the canvas's left edge moves. The side panel
    // opens on the left, and a click that selects (or deselects) a shape would otherwise shift the
    // diagram under the pointer, so a double-click to edit a label hit the wrong element. (In
    // English only the palette sits on the left; the diagram moves with it as before.)
    const container = containerRef.current;
    let left = container.getBoundingClientRect().left;
    const observer = new ResizeObserver(() => {
      const canvas = inst.get<Canvas>('canvas');
      canvas.resized();
      const now = container.getBoundingClientRect().left;
      if (now !== left && loadedRef.current && dirRef.current === 'rtl')
        canvas.scroll({ dx: left - now, dy: 0 });
      left = now;
    });
    observer.observe(container);
    setInstance(inst);
    return () => {
      clearTimeout(autosaveTimer.current);
      observer.disconnect();
      inst.destroy();
      instanceRef.current = null;
      loadedRef.current = false;
      setLoadCount(0);
      setInstance(null);
    };
  }, [canEdit, revalidate]);

  const importDiagram = useCallback(
    async (xml: string, markDirty: boolean) => {
      const inst = instanceRef.current;
      if (!inst) return false;
      try {
        await importDiagramXml(inst, xml);
        normaliseDiagram(inst);
        applyLanguage(inst, stateRef.current.locale);
        afterLayout(() => fitWidth(inst.get<Canvas>('canvas')));
        setImportError(null);
        setDirty(markDirty);
        if (markDirty) {
          clearTimeout(autosaveTimer.current);
          autosaveTimer.current = setTimeout(() => void autosaveRef.current(), AUTOSAVE_MS);
        }
        setSelected(null);
        revalidate();
        setLoadCount((n) => n + 1);
        return true;
      } catch (err) {
        setImportError((err as Error).message);
        return false;
      }
    },
    [revalidate],
  );

  // Load the stored model once the instance and data are ready.
  useEffect(() => {
    if (!instance || !model.data || loadedRef.current) return;
    loadedRef.current = true;
    void importDiagram(model.data.bpmnXml ?? EMPTY_DIAGRAM, false).then((ok) => {
      const el =
        ok && focusElementId
          ? instance.get<ElementRegistry>('elementRegistry').get(focusElementId)
          : null;
      if (el) {
        afterLayout(() => {
          instance.get<Canvas>('canvas').scrollToElement(el);
          selectElement(el);
        });
      }
    });
  }, [instance, model.data, importDiagram, focusElementId, selectElement]);

  useEffect(() => {
    stateRef.current.locale = locale;
    if (instanceRef.current && loadedRef.current) {
      applyLanguage(instanceRef.current, locale);
      revalidate();
    }
  }, [locale, revalidate]);

  // View preferences applied to the live diagram.
  useEffect(() => {
    if (instance) setMinimap(instance, prefs.minimap);
  }, [instance, prefs.minimap]);
  useEffect(() => {
    if (instance && canEdit)
      instance.get<{ setActive(active: boolean): void }>('gridSnapping').setActive(prefs.grid);
  }, [instance, canEdit, prefs.grid]);

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
      await saveModel.mutateAsync({ bpmnXml: await currentXml(), aiGenerated: aiRef.current });
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
      const v = await createVersion.mutateAsync({
        bpmnXml: await currentXml(),
        changeNote,
        aiGenerated: aiRef.current,
      });
      setDirty(false);
      setVersionOpen(false);
      versionForm.resetFields();
      message.success(t('modeler:versionSaved', { number: v.versionNumber }));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const toggleFullscreen = useCallback(() => {
    // The whole page goes full screen so dialogs and menus (rendered in <body>) stay visible.
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, []);

  // Workspace keys (outside fields): F focus mode, ? shortcuts, Esc leaves focus mode;
  // Ctrl+S opens "Save version". bpmn-js handles its own keys on the focused canvas only.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (canEdit && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setVersionOpen(true);
        return;
      }
      if (e.defaultPrevented) return;
      const action = workspaceShortcut(e);
      if (action === 'focus') setFocusMode((f) => !f);
      else if (action === 'help') setShortcutsOpen(true);
      else if (action === 'escape') setFocusMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit]);

  // The canvas changes size with the panel, focus mode and full screen: keep the view.
  useEffect(() => {
    instanceRef.current?.get<Canvas>('canvas').resized();
  }, [panel.visible, panel.width, focusMode, fullscreen]);

  /** Feature 1: replaces the diagram with the generated one, saves it and adds the confirmed links. */
  const applyAiModel = async (result: AiGeneratedProcessDto, accepted: AiSuggestedLinkDto[]) => {
    if (!(await importDiagram(result.bpmnXml, true))) {
      message.error(t('modeler:importFailed'));
      throw new Error('import failed');
    }
    aiRef.current = true;
    setAiFlag(true);
    if (!(await autosaveRef.current())) throw new Error('save failed');
    try {
      for (const l of accepted)
        await createLink.mutateAsync({
          bpmnElementId: l.elementId,
          repoObjectId: l.object.id,
          relation: l.relation,
        });
    } catch (err) {
      message.error(errorMessage(err));
    }
    message.success(t('ai:generate.inserted'));
  };

  /** Feature 4: writes reviewed label translations into the diagram as normal edits. */
  const applyTranslations = (target: Locale, rows: LabelTranslation[]) => {
    const inst = instanceRef.current;
    if (!inst) return;
    const registry = inst.get<ElementRegistry>('elementRegistry');
    const modeling = inst.get<Modeling>('modeling');
    const suffix = target === 'ar' ? 'Ar' : 'En';
    for (const r of rows) {
      const el = registry.get(r.id);
      if (!el) continue;
      const props: Record<string, string> = {};
      if (r.name.trim()) props[`ph:name${suffix}`] = r.name.trim();
      if (r.description.trim()) props[`ph:description${suffix}`] = r.description.trim();
      if (Object.keys(props).length) modeling.updateModdleProperties(el, el.businessObject, props);
    }
    applyLanguage(inst, stateRef.current.locale);
    aiRef.current = true;
    setAiFlag(true);
    message.success(t('ai:translate.applied'));
  };

  /** After a restore the working model on the server changed: reload it. */
  const reloadModel = async () => {
    const res = await model.refetch();
    if (res.data?.bpmnXml) await importDiagram(res.data.bpmnXml, false);
  };

  const doExport = async (kind: 'bpmn' | 'svg' | 'png') => {
    const inst = instanceRef.current;
    if (!inst) return;
    try {
      if (kind === 'bpmn') {
        downloadBlob(
          new Blob([await currentXml()], { type: 'application/xml' }),
          exportFileName(process.code, fileBase, 'bpmn'),
        );
        return;
      }
      const svg = await embedDiagramFonts((await inst.saveSVG()).svg);
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

  const autoLayout = () =>
    modal.confirm({
      title: t('modeler:autoLayout.title'),
      content: t('modeler:autoLayout.text'),
      okText: t('modeler:autoLayout.run'),
      cancelText: t('cancel'),
      onOk: () => {
        const inst = instanceRef.current;
        if (!inst) return;
        const problem = runAutoLayout(inst);
        if (problem) message.warning(t(`modeler:autoLayout.problems.${problem}`));
        else {
          afterLayout(() => fitWidth(inst.get<Canvas>('canvas')));
          message.success(t('modeler:autoLayout.done'));
        }
      },
    });

  /** First IT system linked to an element (the table's "IT system" column). */
  const systemOf = (elementId: string) =>
    (links.data ?? []).find((l) => l.bpmnElementId === elementId && l.repoObject.type === 'SYSTEM')
      ?.repoObject.id ?? null;

  /**
   * Quick Model "Generate diagram": table → diagram (one undo step), save the draft, then link the
   * IT systems chosen in the table (SUPPORTS links, D-085).
   */
  const generateFromTable = async (rows: QuickRow[], original: QuickRow[]) => {
    const inst = instanceRef.current;
    if (!inst) return null;
    const ids = applyRows(inst, rows, stateRef.current.locale);
    if (!(await autosaveRef.current())) return null;
    const idOf = (key: string) => ids.get(key) ?? key;
    try {
      for (const row of rows) {
        const was = original.find((o) => o.key === row.key)?.systemId ?? null;
        if (was === row.systemId) continue;
        const elementId = idOf(row.key);
        const old = (links.data ?? []).find(
          (l) =>
            l.bpmnElementId === elementId && l.repoObject.id === was && l.relation === 'SUPPORTS',
        );
        if (old) await deleteLink.mutateAsync(old.id);
        if (row.systemId)
          await createLink.mutateAsync({
            bpmnElementId: elementId,
            repoObjectId: row.systemId,
            relation: 'SUPPORTS',
          });
      }
    } catch (err) {
      message.error(errorMessage(err));
    }
    setView('diagram');
    afterLayout(() => fitWidth(inst.get<Canvas>('canvas')));
    message.success(t('modeler:quick.generated'));
    const systems = new Map(rows.map((r) => [idOf(r.key), r.systemId]));
    return diagramToRows(inst, (id) => systems.get(id) ?? null);
  };

  const focusElement = (id?: string) => {
    if (!id || !instanceRef.current) return;
    const el = instanceRef.current.get<ElementRegistry>('elementRegistry').get(id);
    if (!el) return;
    instanceRef.current.get<Canvas>('canvas').scrollToElement(el);
    selectElement(el);
  };

  /** A "Link to sub-process" step was placed: choose the process it calls. */
  const onReadyStep = (step: ReadyStep, element: DiagramElement) => {
    if (step.key !== 'subProcessLink' || !instanceRef.current) return;
    const eventBus = instanceRef.current.get<EventBus>('eventBus');
    const onCreated = (e: { context: { shape?: DiagramElement; elements?: DiagramElement[] } }) => {
      const created = e.context.shape ?? e.context.elements?.[0];
      if (created === element) setPickFor(element);
      eventBus.off('commandStack.elements.create.postExecuted', onCreated as never);
      eventBus.off('commandStack.shape.create.postExecuted', onCreated as never);
    };
    eventBus.on('commandStack.elements.create.postExecuted', onCreated as never);
    eventBus.on('commandStack.shape.create.postExecuted', onCreated as never);
  };
  const linkPicked = (p: ProcessSummaryDto) => {
    const inst = instanceRef.current;
    const el = pickFor;
    setPickFor(null);
    if (!inst || !el) return;
    const modeling = inst.get<Modeling>('modeling');
    modeling.updateModdleProperties(el, el.businessObject, {
      'ph:linkedProcessId': p.id,
      'ph:nameEn': p.nameEn || p.nameAr,
      'ph:nameAr': p.nameAr || p.nameEn,
    });
    modeling.updateLabel(
      el,
      (locale === 'ar' ? p.nameAr || p.nameEn : p.nameEn || p.nameAr) || null,
    );
  };

  const shownIssues = withoutDuplicates(issues, conventionFindings);
  const issueCount = shownIssues.length + conventionFindings.length;
  const warnings =
    shownIssues.filter((i) => i.severity === 'warning').length + conventionFindings.length;
  const blockingConventions = conventionFindings.some((i) => i.mandatory);
  const labelOf = (id: string) => {
    const el = instanceRef.current?.get<ElementRegistry>('elementRegistry').get(id);
    return el ? pickLabel(readLabels(el.businessObject), locale) : '';
  };
  const openComments = (comments.data ?? []).filter((c) => !c.resolvedAt).length;
  const latestVersion = versions.data?.[0];
  const lastSaved = model.data?.updatedAt
    ? t('modeler:draftSaved', {
        time: formatDate(model.data.updatedAt),
        name: loc(model.data.updatedBy) || model.data.updatedBy?.email || '—',
      })
    : t('modeler:neverSaved');
  const versionText = latestVersion
    ? t('modeler:latestVersion', {
        number: latestVersion.versionNumber,
        time: formatDate(latestVersion.createdAt),
      })
    : t('modeler:noVersionYet');
  const panelVisible = panel.visible && !focusMode;
  const flowNodes = loaded
    ? (instance?.get<ElementRegistry>('elementRegistry').filter((e) => isFlowNode(e.type)).length ??
      0)
    : 0;

  if (model.isError) return <ErrorState error={model.error} onRetry={() => void model.refetch()} />;

  const iconButton = (
    key: string,
    title: string,
    icon: React.ReactNode,
    onClick: () => void,
    extra: { disabled?: boolean; active?: boolean; label?: boolean } = {},
  ) => (
    <Tooltip key={key} title={title}>
      <Button
        size="small"
        type={extra.active ? 'primary' : 'text'}
        ghost={extra.active}
        icon={icon}
        disabled={extra.disabled}
        aria-label={title}
        aria-pressed={extra.active}
        onClick={onClick}
      >
        {extra.label ? <span className="ph-ws-label">{title}</span> : null}
      </Button>
    </Tooltip>
  );

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panel.width;
    let width = startWidth;
    const move = (ev: PointerEvent) => {
      // The panel sits on the inline-end side: dragging towards the canvas widens it.
      width = startWidth + (dir === 'rtl' ? ev.clientX - startX : startX - ev.clientX);
      panelDispatch({ type: 'resize', width });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      updatePrefs({ panelWidth: width });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const togglePanel = () => {
    panelDispatch({ type: 'toggle' });
    updatePrefs({ panelAuto: !panel.visible });
    if (focusMode) setFocusMode(false);
  };

  const saveState = !canEdit ? (
    <Tag>{t('modeler:readOnly')}</Tag>
  ) : dirty ? (
    <Tag color="orange" icon={saveModel.isPending ? <SyncOutlined spin /> : undefined}>
      {saveModel.isPending ? t('modeler:autosaving') : t('modeler:unsaved')}
    </Tag>
  ) : (
    <Tooltip title={`${lastSaved} · ${versionText}`}>
      <Tag color="green" icon={<CheckCircleOutlined />}>
        {t('modeler:saved')}
      </Tag>
    </Tooltip>
  );

  return (
    <div
      className={[
        'ph-ws',
        focusMode && 'is-focus',
        !prefs.badges && 'ph-badges-off',
        canEdit && prefs.grid ? 'ph-grid-on' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="ph-ws-bar">
        <div className="ph-ws-title">
          {iconButton('close-start', t('modeler:workspace.close'), <CloseOutlined />, onClose)}
          <span className="ph-title-code" dir="ltr">
            {process.code}
          </span>
          <Typography.Text strong ellipsis className="ph-ws-name" title={loc(process)}>
            {loc(process)}
          </Typography.Text>
          <StatusTag status={process.status} />
          {aiFlag && <AiBadge />}
          {saveState}
        </div>
        <div className="ph-ws-tools" role="toolbar" aria-label={t('modeler:workspace.toolbar')}>
          <Segmented
            size="small"
            className="ph-ws-view"
            value={view}
            onChange={(v) => setView(v as 'diagram' | 'table')}
            options={[
              { value: 'diagram', label: t('modeler:quick.viewDiagram') },
              { value: 'table', label: t('modeler:quick.viewTable') },
            ]}
            aria-label={t('modeler:quick.viewLabel')}
          />
          <span className="ph-ws-sep" />
          {canEdit && (
            <>
              <Tooltip title={t('modeler:saveHint')}>
                <Button
                  size="small"
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={() => setVersionOpen(true)}
                >
                  <span className="ph-ws-label">{t('modeler:saveVersion')}</span>
                </Button>
              </Tooltip>
              {iconButton(
                'undo',
                t('modeler:undo'),
                <UndoOutlined />,
                () => instanceRef.current?.get<CommandStack>('commandStack').undo(),
                { disabled: !canUndo },
              )}
              {iconButton(
                'redo',
                t('modeler:redo'),
                <RedoOutlined />,
                () => instanceRef.current?.get<CommandStack>('commandStack').redo(),
                { disabled: !canRedo },
              )}
              <span className="ph-ws-sep" />
            </>
          )}
          <ZoomControl instance={instance} zoom={zoom} />
          <span className="ph-ws-sep" />
          {canEdit &&
            iconButton('search', t('modeler:search'), <SearchOutlined />, () =>
              instanceRef.current?.get<{ toggle(): void }>('searchPad').toggle(),
            )}
          {canEdit &&
            iconButton(
              'layout',
              t('modeler:autoLayout.button'),
              <ApartmentOutlined />,
              autoLayout,
              {
                disabled: !flowNodes,
              },
            )}
          <Dropdown
            trigger={['click']}
            menu={{
              selectable: false,
              items: [
                {
                  key: 'minimap',
                  label: t('modeler:view.minimap'),
                  icon: prefs.minimap ? (
                    <CheckCircleOutlined />
                  ) : (
                    <span className="ph-menu-blank" />
                  ),
                  onClick: () => updatePrefs({ minimap: !prefs.minimap }),
                },
                {
                  key: 'badges',
                  label: t('modeler:view.badges'),
                  icon: prefs.badges ? <CheckCircleOutlined /> : <span className="ph-menu-blank" />,
                  onClick: () => updatePrefs({ badges: !prefs.badges }),
                },
                ...(canEdit
                  ? [
                      {
                        key: 'grid',
                        label: t('modeler:view.grid'),
                        icon: prefs.grid ? (
                          <CheckCircleOutlined />
                        ) : (
                          <span className="ph-menu-blank" />
                        ),
                        onClick: () => updatePrefs({ grid: !prefs.grid }),
                      },
                    ]
                  : []),
                { type: 'divider' as const },
                {
                  key: 'colourBy',
                  type: 'group' as const,
                  label: t('modeler:colourBy.title'),
                  children: COLOUR_BY_MODES.filter(
                    (m) =>
                      (canReadGrc || (m !== 'riskRating' && m !== 'riskControl')) &&
                      (canReadEa || m !== 'appLifecycle') &&
                      (canReadKpi || m !== 'kpiStatus'),
                  ).map((mode) => ({
                    key: `colourBy-${mode}`,
                    label: t(`modeler:colourBy.modes.${mode}`),
                    icon:
                      colourBy === mode ? (
                        <CheckCircleOutlined />
                      ) : (
                        <span className="ph-menu-blank" />
                      ),
                    onClick: () => setColourBy(mode),
                  })),
                },
              ],
            }}
          >
            <Tooltip title={t('modeler:view.title')}>
              <Button
                size="small"
                type="text"
                icon={<EyeOutlined />}
                aria-label={t('modeler:view.title')}
              />
            </Tooltip>
          </Dropdown>
          {iconButton(
            'focus',
            focusMode ? t('modeler:workspace.focusLeave') : t('modeler:workspace.focus'),
            focusMode ? <CompressOutlined /> : <ExpandOutlined />,
            () => setFocusMode((f) => !f),
            { active: focusMode },
          )}
          {iconButton(
            'fullscreen',
            fullscreen ? t('modeler:workspace.fullscreenLeave') : t('modeler:workspace.fullscreen'),
            fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />,
            toggleFullscreen,
          )}
          {iconButton('help', t('modeler:shortcuts.title'), <QuestionOutlined />, () =>
            setShortcutsOpen(true),
          )}
          <span className="ph-ws-sep" />
          <Badge count={warnings} size="small" offset={[-4, 2]}>
            {iconButton(
              'validation',
              t('modeler:validation'),
              <WarningOutlined />,
              () => showPanel('issues'),
              { label: true, active: panelVisible && panelTab === 'issues' },
            )}
          </Badge>
          {iconButton('versions', t('modeler:versions'), <HistoryOutlined />, () =>
            setHistoryOpen(true),
          )}
          <Badge count={openComments} size="small" offset={[-4, 2]} color="#2563eb">
            {iconButton(
              'comments',
              t('modeler:commentsTab'),
              <CommentOutlined />,
              () => showPanel('comments'),
              { active: panelVisible && panelTab === 'comments' },
            )}
          </Badge>
          <AiButton
            size="small"
            type="text"
            menu={[
              ...(canEdit
                ? [
                    {
                      key: 'generate',
                      label: t('ai:menu.generate'),
                      onClick: () => setAiDialog('generate'),
                    },
                    { key: 'chat', label: t('ai:menu.chat'), onClick: () => showPanel('ai') },
                  ]
                : []),
              {
                key: 'analyse',
                label: t('ai:menu.analyse'),
                onClick: () => setAiDialog('analyse'),
              },
              ...(canEdit
                ? [
                    {
                      key: 'translate-ar',
                      label: t('ai:menu.translateToAr'),
                      onClick: () => setAiDialog('translate-ar'),
                    },
                    {
                      key: 'translate-en',
                      label: t('ai:menu.translateToEn'),
                      onClick: () => setAiDialog('translate-en'),
                    },
                  ]
                : []),
            ]}
          />
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                ...(canEdit
                  ? [
                      {
                        key: 'import',
                        label: t('modeler:import'),
                        onClick: () => fileInput.current?.click(),
                      },
                      { type: 'divider' as const },
                    ]
                  : []),
                {
                  key: 'bpmn',
                  label: t('modeler:exportBpmn'),
                  onClick: () => void doExport('bpmn'),
                },
                { key: 'svg', label: t('modeler:exportSvg'), onClick: () => void doExport('svg') },
                { key: 'png', label: t('modeler:exportPng'), onClick: () => void doExport('png') },
                { type: 'divider' as const },
                {
                  key: 'handbook',
                  label: t('processes:reports.handbook'),
                  onClick: () => setReport('handbook'),
                },
                {
                  key: 'raci',
                  label: t('processes:reports.raci'),
                  onClick: () => setReport('raci'),
                },
              ],
            }}
          >
            <Tooltip title={t('modeler:importExport')}>
              <Button
                size="small"
                type="text"
                icon={<SwapOutlined />}
                aria-label={t('modeler:importExport')}
              />
            </Tooltip>
          </Dropdown>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".bpmn,.xml,application/xml,text/xml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importFile(f);
            }}
          />
          {iconButton(
            'panel',
            panelVisible ? t('modeler:workspace.panelHide') : t('modeler:workspace.panelShow'),
            <LayoutOutlined />,
            togglePanel,
            { active: panelVisible },
          )}
          <Button size="small" icon={<CloseOutlined />} onClick={onClose}>
            <span className="ph-ws-label">{t('modeler:workspace.close')}</span>
          </Button>
        </div>
      </header>
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
      <div className="ph-ws-body">
        {canEdit && view === 'diagram' && (
          <Palette
            instance={instance}
            collapsed={prefs.paletteCollapsed || focusMode}
            onCollapsedChange={(c) => {
              if (!focusMode) updatePrefs({ paletteCollapsed: c });
            }}
            onReadyStep={onReadyStep}
          />
        )}
        <div className="ph-ws-canvas-wrap">
          {/* bpmn-js renders its own UI; keep it LTR so canvas behaves the same in both languages. */}
          <div
            className="ph-ws-canvas"
            dir="ltr"
            ref={containerRef}
            aria-label={t('modeler:canvas')}
          />
          {canEdit && instance && <LayoutToolbar instance={instance} selection={selection} />}
          {colourBy !== 'none' && view === 'diagram' && (
            <ColourByLegend
              mode={colourBy}
              items={legend}
              missing={missingCounts}
              onClose={() => setColourBy('none')}
            />
          )}
          {canEdit && (
            <LabelAutocomplete
              instance={instance}
              onPick={(el, s) =>
                instanceRef.current &&
                applyLabelSource(instanceRef.current, el, s, stateRef.current.locale)
              }
            />
          )}
          {focusMode && (
            <div className="ph-ws-focus-hint" role="status">
              {t('modeler:workspace.focusHint')}
            </div>
          )}
          {tableOpened && loaded && instance && (
            <div className="ph-quick-wrap" hidden={view !== 'table'}>
              <QuickModelView
                visible={view === 'table'}
                readRows={() => diagramToRows(instance, systemOf)}
                canEdit={canEdit}
                onGenerate={generateFromTable}
              />
            </div>
          )}
          {model.isLoading && (
            <div className="ph-modeler-loading">
              <LoadingState />
            </div>
          )}
        </div>
        {panelVisible && (
          <>
            <div
              className="ph-ws-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('modeler:workspace.resize')}
              aria-valuenow={panel.width}
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
                if (!step) return;
                e.preventDefault();
                const width = panel.width + (dir === 'rtl' ? -step : step);
                panelDispatch({ type: 'resize', width });
                updatePrefs({ panelWidth: width });
              }}
            />
            <aside className="ph-ws-panel" style={{ inlineSize: panel.width }}>
              <Tabs
                size="small"
                activeKey={panelTab}
                onChange={(k) => setPanelTab(k as PanelTab)}
                tabBarExtraContent={iconButton(
                  'panel-close',
                  t('modeler:workspace.panelHide'),
                  <CloseOutlined />,
                  togglePanel,
                )}
                items={[
                  {
                    key: 'properties',
                    label: t('modeler:properties'),
                    children: (
                      <ElementPanel
                        instance={instance}
                        element={selected}
                        process={process}
                        links={links.data ?? []}
                        canEdit={canEdit}
                      />
                    ),
                  },
                  ...(canReadGrc
                    ? [
                        {
                          key: 'grc',
                          label: (
                            <Space size={4}>
                              {t('grc:panel.tab')}
                              {[...grcSteps.values()].some((x) => x.alert) && (
                                <Badge status="error" />
                              )}
                            </Space>
                          ),
                          children: (
                            <GrcStepPanel
                              processId={process.id}
                              elementId={
                                selected && selected.type !== 'bpmn:Process' ? selected.id : null
                              }
                              elementName={selected ? labelOf(selected.id) || selected.id : ''}
                              canEditModel={process.canEditModel}
                              locked={
                                process.status === 'IN_REVIEW' || process.status === 'ARCHIVED'
                              }
                              onCheckGaps={() => setGapsOpen(true)}
                            />
                          ),
                        },
                      ]
                    : []),
                  ...(canReadKpi
                    ? [
                        {
                          key: 'kpis',
                          label: (
                            <Space size={4}>
                              {t('kpi:process.tab')}
                              {(processKpis.data?.items ?? []).some((k) => k.rag === 'RED') && (
                                <Badge status="error" />
                              )}
                            </Space>
                          ),
                          children: (
                            <KpiStepPanel
                              processId={process.id}
                              data={processKpis.data}
                              elementId={
                                selected && selected.type !== 'bpmn:Process' ? selected.id : null
                              }
                              elementName={selected ? labelOf(selected.id) || selected.id : ''}
                              canLink={
                                process.canEditModel &&
                                process.status !== 'IN_REVIEW' &&
                                process.status !== 'ARCHIVED'
                              }
                            />
                          ),
                        },
                      ]
                    : []),
                  {
                    key: 'issues',
                    label: (
                      <Space size={4}>
                        {t('modeler:issues')}
                        {issueCount > 0 && (
                          <Badge
                            count={issueCount}
                            size="small"
                            color={
                              blockingConventions ? '#dc2626' : warnings ? '#b45309' : '#64748b'
                            }
                          />
                        )}
                      </Space>
                    ),
                    children:
                      issueCount === 0 ? (
                        <Alert type="success" showIcon message={t('modeler:noIssues')} />
                      ) : (
                        <>
                          <AiButton
                            size="small"
                            onClick={() => setAiDialog('analyse')}
                            style={{ marginBlockEnd: 8 }}
                          >
                            {t('ai:analyse.explainWarnings')}
                          </AiButton>
                          <ConventionIssueList
                            issues={conventionFindings}
                            labelOf={labelOf}
                            onFocus={focusElement}
                          />
                          {conventionFindings.length > 0 && shownIssues.length > 0 && (
                            <Typography.Title level={5} style={{ marginBlock: '12px 4px' }}>
                              {t('modeler:conventions.diagramChecks')}
                            </Typography.Title>
                          )}
                          <ul className="ph-issues">
                            {shownIssues.map((i, idx) => (
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
                                    <Typography.Text
                                      type="secondary"
                                      className="ph-issue-id"
                                      dir="ltr"
                                    >
                                      {i.elementId}
                                    </Typography.Text>
                                  )}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </>
                      ),
                  },
                  {
                    key: 'comments',
                    label: t('modeler:commentsTab'),
                    children: (
                      <>
                        {!selected && (
                          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                            {t('modeler:commentsAll')}
                          </Typography.Paragraph>
                        )}
                        <CommentsPanel
                          type="PROCESS"
                          id={process.id}
                          elementId={
                            selected && selected.type !== 'bpmn:Process' ? selected.id : undefined
                          }
                          onOpenElement={focusElement}
                        />
                      </>
                    ),
                  },
                  ...(canEdit && aiAvailable
                    ? [
                        {
                          key: 'ai',
                          label: (
                            <Space size={4}>
                              <AiIcon />
                              {t('ai:chat.tab')}
                            </Space>
                          ),
                          children: (
                            <AiChatPanel
                              processId={process.id}
                              getXml={currentXml}
                              onAccept={applyAiModel}
                            />
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </aside>
          </>
        )}
      </div>

      {canReadGrc && gapsOpen && (
        <ControlGapsDrawer
          open
          processId={process.id}
          getXml={currentXml}
          nameOf={labelOf}
          onFocusElement={focusElement}
          canChange={
            process.status !== 'IN_REVIEW' &&
            process.status !== 'ARCHIVED' &&
            (can(PERMISSIONS.GRC_EDIT) || (process.canEditModel && can(PERMISSIONS.GRC_PROPOSE)))
          }
          onClose={() => setGapsOpen(false)}
        />
      )}
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
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {lastSaved} · {versionText}
        </Typography.Paragraph>
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
      <ShortcutsDialog
        open={shortcutsOpen}
        canEdit={canEdit}
        onClose={() => setShortcutsOpen(false)}
      />
      {canEdit && (
        <>
          <ProcessPickerModal
            open={!!pickFor}
            processId={process.id}
            onPick={linkPicked}
            onClose={() => setPickFor(null)}
          />
          <GenerateProcessModal
            open={aiDialog === 'generate'}
            processId={process.id}
            replaces={flowNodes > 1}
            acceptLabel={t('ai:generate.insert')}
            onClose={() => setAiDialog(null)}
            onAccept={applyAiModel}
          />
          <TranslateLabelsModal
            open={aiDialog === 'translate-ar' || aiDialog === 'translate-en'}
            target={aiDialog === 'translate-en' ? 'en' : 'ar'}
            getXml={currentXml}
            onClose={() => setAiDialog(null)}
            onApply={(rows) => applyTranslations(aiDialog === 'translate-en' ? 'en' : 'ar', rows)}
          />
        </>
      )}
      <AnalysisDrawer
        open={aiDialog === 'analyse'}
        processId={process.id}
        getXml={currentXml}
        issues={issues}
        nameOf={(id) => {
          const el = instanceRef.current?.get<ElementRegistry>('elementRegistry').get(id);
          return (el?.businessObject?.name as string | undefined) ?? '';
        }}
        onFocusElement={focusElement}
        onClose={() => setAiDialog(null)}
      />
      {report && (
        <ReportDialog
          kind={report}
          process={process}
          hasChildren={process.children.length > 0}
          onClose={() => setReport(null)}
        />
      )}
      <VersionsDrawer
        processId={process.id}
        open={historyOpen}
        canEdit={canEdit}
        onClose={() => setHistoryOpen(false)}
        onRestored={() => void reloadModel()}
      />
    </div>
  );
}
