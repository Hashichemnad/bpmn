import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import {
  Alert,
  App,
  Badge,
  Button,
  Dropdown,
  Form,
  Input,
  Modal,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseOutlined,
  CommentOutlined,
  DownloadOutlined,
  HistoryOutlined,
  LayoutOutlined,
  LinkOutlined,
  QuestionOutlined,
  RedoOutlined,
  SaveOutlined,
  SyncOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { DiagramDto } from '@processhub/shared';
import { useComments } from '@/api/governance';
import { useCreateDiagramVersion, useDiagramVersions, useSaveDiagramContent } from '@/api/diagrams';
import { useLocale } from '@/app/LocaleProvider';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { StatusTag } from '@/components/tags';
import { CommentsPanel } from '@/features/comments/CommentsPanel';
import { ShortcutsDialog } from '@/features/modeler/ShortcutsDialog';
import { downloadBlob, exportFileName, svgToPng } from '@/features/modeler/export';
import { embedDiagramFonts } from '@/features/modeler/export-fonts';
import { isTypingTarget, workspaceShortcut } from '@/features/modeler/keys';
import { DiagramVersionsDrawer } from './DiagramVersionsDrawer';
import { DiagramLinksPanel } from './DiagramLinksPanel';
import { DiagramTypeIcon } from './DiagramTypeIcon';

/** Changes are autosaved to the working content (a draft) after this pause; versions are explicit. */
const AUTOSAVE_MS = 3000;
const PANEL_WIDTH = 360;

export interface SelectedElement {
  id: string;
  nameEn: string;
  nameAr: string;
}

export interface WorkspacePanel {
  key: string;
  label: string;
  children: ReactNode;
}

interface Props {
  diagram: DiagramDto;
  canEdit: boolean;
  loaded: boolean;
  /** Current content to save (null while the editor cannot serialise). */
  getContent: () => string | null;
  /** SVG of the whole diagram for export. */
  getSvg: () => Promise<string>;
  /** Increments after every change (drives autosave). */
  changeTick: number;
  history?: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  selected: SelectedElement | null;
  onFocusElement?: (elementId: string) => void;
  canvas: ReactNode;
  palette?: ReactNode;
  /** Extra tools in the top bar (zoom, mini-map, notation actions). */
  tools?: ReactNode;
  /** Side panel tabs before Links / Comments (Properties first). */
  panels: WorkspacePanel[];
  /** Extra export formats (e.g. DMN XML). */
  exports?: { key: string; label: string; run: () => void | Promise<void> }[];
  importError?: string | null;
  /** Reload the working content after a version was restored. */
  onRestored: () => void;
  onClose: () => void;
  /** Elements can carry object links (not for DMN rules etc.). */
  linkable?: boolean;
}

/**
 * Full-screen workspace shared by every non-BPMN notation (D-120): slim top bar with status,
 * autosave and "Save version", undo / redo, versions, export (SVG / PNG / PDF), palette on the
 * inline-start side, canvas, and a side panel with the notation's own tabs plus Links and
 * Comments. Same look and keys as the BPMN modeler.
 */
export function DiagramWorkspace({
  diagram,
  canEdit,
  loaded,
  getContent,
  getSvg,
  changeTick,
  history,
  selected,
  onFocusElement,
  canvas,
  palette,
  tools,
  panels,
  exports = [],
  importError,
  onRestored,
  onClose,
  linkable = true,
}: Props) {
  const { t } = useTranslation();
  const { dir } = useLocale();
  const loc = useLocalized();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message, modal } = App.useApp();
  const save = useSaveDiagramContent(diagram.id);
  const createVersion = useCreateDiagramVersion(diagram.id);
  const versions = useDiagramVersions(diagram.id);
  const comments = useComments('DIAGRAM', diagram.id);
  const [dirty, setDirty] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState(panels[0]?.key ?? 'comments');
  const [versionOpen, setVersionOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [form] = Form.useForm<{ changeNote: string }>();
  const lastSaved = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const autosave = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current);
    if (!canEdit) return true;
    const content = getContent();
    if (content === null) return true;
    if (content === lastSaved.current) {
      setDirty(false);
      return true;
    }
    try {
      await save.mutateAsync({ content });
      lastSaved.current = content;
      setDirty(false);
      return true;
    } catch (err) {
      message.error(errorMessage(err));
      return false;
    }
  }, [canEdit, getContent, save, message, errorMessage]);
  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;

  // The first content after loading is the saved state.
  useEffect(() => {
    if (loaded && lastSaved.current === null) lastSaved.current = getContent();
  }, [loaded, getContent]);

  useEffect(() => {
    if (!changeTick || !canEdit) return;
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void autosaveRef.current(), AUTOSAVE_MS);
  }, [changeTick, canEdit]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void autosaveRef.current().then((ok) => {
      if (ok) return blocker.proceed();
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

  const saveVersion = async () => {
    const { changeNote } = await form.validateFields();
    const content = getContent();
    if (content === null) return;
    try {
      const v = await createVersion.mutateAsync({ content, changeNote });
      lastSaved.current = content;
      setDirty(false);
      setVersionOpen(false);
      form.resetFields();
      void versions.refetch();
      message.success(t('modeler:versionSaved', { number: v.versionNumber }));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  // Workspace keys: Ctrl+S version, F focus, ? shortcuts, Esc leaves focus mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 's' || e.key === 'S') &&
        !isTypingTarget(e.target)
      ) {
        e.preventDefault();
        if (canEdit) setVersionOpen(true);
        return;
      }
      const action = workspaceShortcut(e);
      if (action === 'focus') setFocusMode((f) => !f);
      else if (action === 'help') setShortcutsOpen(true);
      else if (action === 'escape') setFocusMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit]);

  const fileBase = loc(diagram);
  const doExport = async (kind: 'svg' | 'png') => {
    try {
      const svg = await embedDiagramFonts(await getSvg());
      if (kind === 'svg')
        downloadBlob(
          new Blob([svg], { type: 'image/svg+xml' }),
          exportFileName(diagram.code, fileBase, 'svg'),
        );
      else downloadBlob(await svgToPng(svg), exportFileName(diagram.code, fileBase, 'png'));
    } catch (err) {
      message.error(errorMessage(err));
    }
  };
  const printPdf = async () => {
    await autosaveRef.current();
    window.open(`/print/diagrams/${diagram.id}`, '_blank', 'noopener');
  };

  const icon = (
    key: string,
    title: string,
    node: ReactNode,
    onClick: () => void,
    extra: { disabled?: boolean; active?: boolean } = {},
  ) => (
    <Tooltip key={key} title={title}>
      <Button
        size="small"
        type={extra.active ? 'primary' : 'text'}
        ghost={extra.active}
        icon={node}
        disabled={extra.disabled}
        aria-label={title}
        aria-pressed={extra.active}
        onClick={onClick}
      />
    </Tooltip>
  );

  const latest = versions.data?.[0];
  const openComments = (comments.data ?? []).filter((c) => !c.resolvedAt).length;
  const saveState = !canEdit ? (
    <Tag>{t('modeler:readOnly')}</Tag>
  ) : dirty ? (
    <Tag color="orange" icon={save.isPending ? <SyncOutlined spin /> : undefined}>
      {save.isPending ? t('modeler:autosaving') : t('modeler:unsaved')}
    </Tag>
  ) : (
    <Tooltip
      title={
        latest
          ? t('modeler:latestVersion', {
              number: latest.versionNumber,
              time: formatDate(latest.createdAt),
            })
          : t('modeler:noVersionYet')
      }
    >
      <Tag color="green" icon={<CheckCircleOutlined />}>
        {t('modeler:saved')}
      </Tag>
    </Tooltip>
  );
  const showPanel = panelOpen && !focusMode;

  return (
    <div className={['ph-ws', 'ph-dg-ws', focusMode && 'is-focus'].filter(Boolean).join(' ')}>
      <header className="ph-ws-bar">
        <div className="ph-ws-title">
          {icon('close-start', t('modeler:workspace.close'), <CloseOutlined />, onClose)}
          <DiagramTypeIcon type={diagram.type} />
          <span className="ph-title-code" dir="ltr">
            {diagram.code}
          </span>
          <Typography.Text strong ellipsis className="ph-ws-name" title={loc(diagram)}>
            {loc(diagram)}
          </Typography.Text>
          <StatusTag status={diagram.status} />
          {saveState}
        </div>
        <div className="ph-ws-tools" role="toolbar" aria-label={t('modeler:workspace.toolbar')}>
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
              {history &&
                icon('undo', t('modeler:undo'), <UndoOutlined />, history.undo, {
                  disabled: !history.canUndo,
                })}
              {history &&
                icon('redo', t('modeler:redo'), <RedoOutlined />, history.redo, {
                  disabled: !history.canRedo,
                })}
              <span className="ph-ws-sep" />
            </>
          )}
          {tools}
          <span className="ph-ws-sep" />
          {icon('history', t('modeler:versions'), <HistoryOutlined />, () => setHistoryOpen(true))}
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'svg', label: t('modeler:exportSvg'), onClick: () => void doExport('svg') },
                { key: 'png', label: t('modeler:exportPng'), onClick: () => void doExport('png') },
                { key: 'pdf', label: t('diagrams:exportPdf'), onClick: () => void printPdf() },
                ...exports.map((x) => ({
                  key: x.key,
                  label: x.label,
                  onClick: () => void x.run(),
                })),
              ],
            }}
          >
            <Button
              size="small"
              type="text"
              icon={<DownloadOutlined />}
              aria-label={t('diagrams:export')}
            >
              <span className="ph-ws-label">{t('diagrams:export')}</span>
            </Button>
          </Dropdown>
          {icon('help', t('modeler:shortcuts.title'), <QuestionOutlined />, () =>
            setShortcutsOpen(true),
          )}
          <Badge count={openComments} size="small" offset={[-4, 4]}>
            {icon('comments', t('modeler:commentsTab'), <CommentOutlined />, () => {
              setPanelOpen(true);
              setTab('comments');
            })}
          </Badge>
          {icon(
            'panel',
            showPanel ? t('modeler:workspace.panelHide') : t('modeler:workspace.panelShow'),
            <LayoutOutlined />,
            () => {
              setPanelOpen((p) => !p);
              setFocusMode(false);
            },
            { active: showPanel },
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
          message={t('diagrams:importFailed')}
          description={importError}
        />
      )}
      <div className="ph-ws-body">
        {canEdit && !focusMode && palette}
        <div className="ph-ws-canvas-wrap">
          {canvas}
          {focusMode && (
            <div className="ph-ws-focus-hint" role="status">
              {t('modeler:workspace.focusHint')}
            </div>
          )}
        </div>
        {showPanel && (
          <aside className="ph-ws-panel" style={{ inlineSize: PANEL_WIDTH }} dir={dir}>
            <Tabs
              size="small"
              activeKey={tab}
              onChange={setTab}
              items={[
                ...panels,
                ...(linkable
                  ? [
                      {
                        key: 'links',
                        label: (
                          <span>
                            <LinkOutlined /> {t('diagrams:links.tab')}
                          </span>
                        ),
                        children: (
                          <DiagramLinksPanel
                            diagramId={diagram.id}
                            element={selected}
                            canEdit={canEdit}
                            beforeLink={autosave}
                          />
                        ),
                      },
                    ]
                  : []),
                {
                  key: 'comments',
                  label: t('modeler:commentsTab'),
                  children: (
                    <CommentsPanel
                      type="DIAGRAM"
                      id={diagram.id}
                      elementId={selected?.id}
                      onOpenElement={onFocusElement}
                    />
                  ),
                },
              ]}
            />
          </aside>
        )}
      </div>
      <Modal
        open={versionOpen}
        title={t('modeler:saveVersionTitle')}
        onCancel={() => setVersionOpen(false)}
        onOk={() => void saveVersion()}
        okText={t('modeler:saveVersion')}
        confirmLoading={createVersion.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="changeNote"
            label={t('modeler:changeNote')}
            rules={[
              { required: true, whitespace: true, message: t('diagrams:changeNoteRequired') },
            ]}
          >
            <Input.TextArea rows={3} maxLength={1000} autoFocus />
          </Form.Item>
        </Form>
      </Modal>
      <ShortcutsDialog
        open={shortcutsOpen}
        canEdit={canEdit}
        onClose={() => setShortcutsOpen(false)}
      />
      <DiagramVersionsDrawer
        diagram={diagram}
        open={historyOpen}
        canEdit={canEdit}
        onClose={() => setHistoryOpen(false)}
        onRestored={() => {
          lastSaved.current = null;
          setDirty(false);
          onRestored();
        }}
      />
    </div>
  );
}
