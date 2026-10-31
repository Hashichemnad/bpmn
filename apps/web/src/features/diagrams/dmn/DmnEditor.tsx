import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Empty,
  Form,
  Input,
  List,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ImportOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import DmnModeler from 'dmn-js/lib/Modeler';
import DmnViewer from 'dmn-js/lib/NavigatedViewer';
import { DIAGRAM_LIMITS, dmnIssues, type DiagramDto } from '@processhub/shared';
import { useDiagramContent } from '@/api/diagrams';
import { useLocale } from '@/app/LocaleProvider';
import { ErrorState, LoadingState } from '@/components/states';
import { downloadBlob, exportFileName } from '@/features/modeler/export';
import { useLocalized } from '@/components/i18n-helpers';
import { DiagramWorkspace } from '../DiagramWorkspace';
import './dmn-assets';
import { dmnName, type DmnInstance, type DmnView } from './dmn-types';
import {
  bilingualTexts,
  dmnForLocale,
  dmnFromLocale,
  evaluateDecision,
  readDecisions,
  validateDecisions,
  type DecisionResult,
  type DmnDecision,
} from './dmn-model';

interface Props {
  diagram: DiagramDto;
  readOnly?: boolean;
  onClose: () => void;
}

interface Bus {
  on(e: string | string[], cb: (e: unknown) => void): void;
  off(e: string | string[], cb: (e: unknown) => void): void;
}

const viewKey = (v: DmnView) => `${v.type}:${v.element.id}`;

/**
 * DMN workspace (D-123): dmn-js decision requirements diagram and decision table editors in the
 * shared workspace, names in the active language (the other language in the Translations panel),
 * a Test panel evaluating a decision with FEEL, a Validation panel, DMN import / export.
 */
export default function DmnEditor({ diagram, readOnly, onClose }: Props) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { message } = App.useApp();
  const content = useDiagramContent(diagram.id);
  const canEdit = diagram.canEditContent && !readOnly;
  const containerRef = useRef<HTMLDivElement>(null);
  const modelerRef = useRef<DmnInstance | null>(null);
  /** Serialised content (stored form), refreshed after every change. */
  const latest = useRef<string | null>(null);
  /** Names in the language not shown in the editor, by element id. */
  const other = useRef(new Map<string, string>());
  const [loaded, setLoaded] = useState(false);
  const [changeTick, setChangeTick] = useState(0);
  const [views, setViews] = useState<DmnView[]>([]);
  const [active, setActive] = useState('');
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importedRef = useRef(false);

  const serialise = useCallback(async () => {
    const m = modelerRef.current;
    if (!m) return;
    const { xml } = await m.saveXML({ format: true });
    latest.current = dmnFromLocale(xml, locale, other.current);
  }, [locale]);

  const load = useCallback(
    async (stored: string) => {
      const m = modelerRef.current;
      if (!m) return;
      const texts = bilingualTexts(stored);
      other.current = new Map(
        [...texts].map(([id, v]) => [id, locale === 'ar' ? v.en : v.ar] as [string, string]),
      );
      try {
        await m.importXML(dmnForLocale(stored, locale));
        latest.current = stored;
        setImportError(null);
        setLoaded(true);
        const first = m.getViews().find((v) => v.type === 'decisionTable');
        if (first) await m.open(first);
      } catch (err) {
        setImportError((err as Error).message);
      }
    },
    [locale],
  );

  // Create the modeler (or a viewer when read-only) once.
  useEffect(() => {
    if (!containerRef.current) return;
    const Ctor = (canEdit ? DmnModeler : DmnViewer) as unknown as new (o: object) => DmnInstance;
    const m = new Ctor({ container: containerRef.current });
    modelerRef.current = m;
    let bus: Bus | null = null;
    const onChange = () => {
      const stack = m
        .getActiveViewer()
        ?.get<{ canUndo(): boolean; canRedo(): boolean }>('commandStack', false);
      setHistory({ canUndo: !!stack?.canUndo(), canRedo: !!stack?.canRedo() });
      void serialise().then(() => setChangeTick((n) => n + 1));
    };
    m.on('views.changed', (e) => {
      const { views: list, activeView } = e as { views: DmnView[]; activeView: DmnView | null };
      setViews(list);
      setActive(activeView ? viewKey(activeView) : '');
      bus?.off('commandStack.changed', onChange);
      bus = m.getActiveViewer()?.get<Bus>('eventBus', false) ?? null;
      bus?.on('commandStack.changed', onChange);
    });
    return () => {
      bus?.off('commandStack.changed', onChange);
      m.destroy();
      modelerRef.current = null;
    };
    // serialise reads the locale; the modeler itself is created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  useEffect(() => {
    if (!content.data || importedRef.current || !modelerRef.current) return;
    importedRef.current = true;
    void load(content.data.content);
  }, [content.data, load]);

  // A language switch re-imports the current content with the other language visible.
  const shownLocale = useRef(locale);
  useEffect(() => {
    if (shownLocale.current === locale || !loaded || !latest.current) return;
    shownLocale.current = locale;
    void load(latest.current);
  }, [locale, loaded, load]);

  const getContent = useCallback(() => (loaded ? latest.current : null), [loaded]);

  /** SVG of the decision requirements diagram (rendered off-screen). */
  const getSvg = useCallback(async () => {
    const host = document.createElement('div');
    host.style.cssText =
      'position:fixed;inset-inline-start:-10000px;inline-size:1200px;block-size:800px';
    document.body.appendChild(host);
    const v = new (DmnViewer as unknown as new (o: object) => DmnInstance)({ container: host });
    try {
      await v.importXML(dmnForLocale(latest.current ?? '', locale));
      const drd = v.getViews().find((x) => x.type === 'drd');
      if (drd) await v.open(drd);
      const viewer = v.getActiveViewer();
      return (await viewer?.saveSVG?.())?.svg ?? '';
    } finally {
      v.destroy();
      host.remove();
    }
  }, [locale]);

  const importFile = async (file: File) => {
    if (file.size > DIAGRAM_LIMITS.dmnBytes) return message.error(t('errors:INVALID_DMN'));
    const xml = await file.text();
    if (dmnIssues(xml).length || /<!DOCTYPE|<!ENTITY/i.test(xml))
      return message.error(t('errors:INVALID_DMN'));
    await load(xml);
    // Imported content is a change: autosaved (the server validates and sanitises it again).
    setChangeTick((n) => n + 1);
    message.success(t('diagrams:dmn.imported'));
  };

  const decisions = useMemo(() => {
    // Re-read after every change and after loading.
    void changeTick;
    void loaded;
    try {
      return latest.current ? readDecisions(latest.current) : [];
    } catch {
      return [];
    }
  }, [changeTick, loaded]);

  const openView = (key: string) => {
    const v = views.find((x) => viewKey(x) === key);
    if (v) void modelerRef.current?.open(v);
  };

  if (content.isError)
    return <ErrorState error={content.error} onRetry={() => void content.refetch()} />;

  return (
    <DiagramWorkspace
      diagram={diagram}
      canEdit={canEdit}
      loaded={loaded}
      getContent={getContent}
      getSvg={getSvg}
      changeTick={changeTick}
      linkable={false}
      history={
        canEdit
          ? {
              ...history,
              undo: () =>
                modelerRef.current?.getActiveViewer()?.get<{ undo(): void }>('commandStack').undo(),
              redo: () =>
                modelerRef.current?.getActiveViewer()?.get<{ redo(): void }>('commandStack').redo(),
            }
          : undefined
      }
      selected={null}
      importError={importError}
      onRestored={() => {
        void content.refetch().then((r) => r.data && load(r.data.content));
      }}
      onClose={onClose}
      exports={[
        {
          key: 'dmn',
          label: t('diagrams:dmn.exportXml'),
          run: () =>
            downloadBlob(
              new Blob([latest.current ?? ''], { type: 'application/xml' }),
              exportFileName(diagram.code, diagram.nameEn || diagram.nameAr, 'dmn'),
            ),
        },
      ]}
      tools={
        <>
          {views.length > 1 && (
            <Segmented
              size="small"
              value={active}
              onChange={(v) => openView(String(v))}
              data-testid="dmn-views"
              options={views.map((v) => ({
                value: viewKey(v),
                label: v.type === 'drd' ? t('diagrams:dmn.drd') : dmnName(v.element, locale),
              }))}
            />
          )}
          {canEdit && (
            <>
              <Tooltip title={t('diagrams:dmn.import')}>
                <Button
                  size="small"
                  type="text"
                  icon={<ImportOutlined />}
                  aria-label={t('diagrams:dmn.import')}
                  onClick={() => fileRef.current?.click()}
                />
              </Tooltip>
              <input
                ref={fileRef}
                type="file"
                accept=".dmn,.xml,application/xml"
                hidden
                data-testid="dmn-import"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void importFile(f);
                }}
              />
            </>
          )}
        </>
      }
      panels={[
        {
          key: 'test',
          label: t('diagrams:dmn.test'),
          children: <TestDecision decisions={decisions} container={containerRef} />,
        },
        {
          key: 'validation',
          label: t('diagrams:dmn.validation'),
          children: <DmnValidation decisions={decisions} xml={latest.current} />,
        },
        {
          key: 'translations',
          label: t('diagrams:dmn.translations'),
          children: (
            <DmnTranslations
              xml={latest.current}
              locale={locale}
              canEdit={canEdit}
              other={other.current}
              onChange={(id, value) => {
                other.current.set(id, value);
                void serialise().then(() => setChangeTick((n) => n + 1));
              }}
            />
          ),
        },
      ]}
      canvas={
        <>
          <div
            ref={containerRef}
            dir="ltr"
            className="ph-ws-canvas ph-dmn-editor"
            data-testid="dmn-canvas"
          />
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

/** "Test decision": input values → matching rules (highlighted in the table) and the result. */
function TestDecision({
  decisions,
  container,
}: {
  decisions: DmnDecision[];
  container: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const tables = decisions.filter((d) => d.isTable);
  const [decisionId, setDecisionId] = useState<string | undefined>(tables[0]?.id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<DecisionResult | null>(null);
  const decision = tables.find((d) => d.id === decisionId) ?? tables[0];

  // Matching rows of the open decision table are highlighted.
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    root.querySelectorAll('.ph-dmn-hit').forEach((el) => el.classList.remove('ph-dmn-hit'));
    for (const m of result?.matched ?? [])
      root
        .querySelectorAll(`[data-row-id="${CSS.escape(m.ruleId)}"]`)
        .forEach((el) => el.classList.add('ph-dmn-hit'));
  }, [result, container]);

  if (!decision)
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('diagrams:dmn.noTable')} />;
  const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  return (
    <div className="ph-panel-section" data-testid="dmn-test">
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('diagrams:dmn.testHint')}
      </Typography.Paragraph>
      <Form layout="vertical" size="small">
        {tables.length > 1 && (
          <Form.Item label={t('diagrams:kinds.decision')}>
            <Select
              value={decision.id}
              onChange={(v) => {
                setDecisionId(v);
                setResult(null);
              }}
              options={tables.map((d) => ({ value: d.id, label: d.name || d.id }))}
            />
          </Form.Item>
        )}
        {decision.inputs.map((i) => (
          <Form.Item key={i.id} label={`${i.label || i.expression} (${i.typeRef})`}>
            <Input
              value={values[i.id] ?? ''}
              data-input-id={i.id}
              onChange={(e) => setValues((v) => ({ ...v, [i.id]: e.target.value }))}
              onPressEnter={() => setResult(evaluateDecision(decision, values))}
            />
          </Form.Item>
        ))}
      </Form>
      <Button
        type="primary"
        icon={<PlayCircleOutlined />}
        onClick={() => setResult(evaluateDecision(decision, values))}
      >
        {t('diagrams:dmn.run')}
      </Button>
      {result && (
        <div style={{ marginBlockStart: 12 }} data-testid="dmn-result">
          {result.error ? (
            <Alert
              type="warning"
              showIcon
              message={t(`diagrams:dmn.errors.${result.error}`)}
              description={result.message}
            />
          ) : (
            <Alert
              type="success"
              showIcon
              message={
                <span>
                  {t('diagrams:dmn.result')}: <strong dir="auto">{show(result.result)}</strong>
                </span>
              }
            />
          )}
          <List
            size="small"
            header={t('diagrams:dmn.matched', { count: result.matched.length })}
            dataSource={result.matched}
            renderItem={(m) => (
              <List.Item>
                <Space wrap>
                  <Tag color="blue">#{m.ruleIndex + 1}</Tag>
                  <span dir="auto">{Object.values(m.outputs).map(show).join(', ')}</span>
                  {m.annotation && (
                    <Typography.Text type="secondary">{m.annotation}</Typography.Text>
                  )}
                </Space>
              </List.Item>
            )}
          />
        </div>
      )}
    </div>
  );
}

function DmnValidation({ decisions, xml }: { decisions: DmnDecision[]; xml: string | null }) {
  const { t } = useTranslation();
  const issues = useMemo(() => (xml ? validateDecisions(decisions, xml) : []), [decisions, xml]);
  if (!issues.length)
    return (
      <Alert type="success" showIcon message={t('diagrams:dmn.valid')} data-testid="dmn-valid" />
    );
  return (
    <List
      size="small"
      dataSource={issues}
      data-testid="dmn-issues"
      renderItem={(i) => (
        <List.Item>
          <Space direction="vertical" size={0}>
            <Typography.Text>{t(`diagrams:dmn.issues.${i.code}`)}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {decisions.find((d) => d.id === i.decisionId)?.name || i.decisionId}
              {i.detail ? ` · ${i.detail}` : ''}
            </Typography.Text>
          </Space>
        </List.Item>
      )}
    />
  );
}

/** Names of the language not shown in the editor (Arabic while working in English, and back). */
function DmnTranslations({
  xml,
  locale,
  canEdit,
  other,
  onChange,
}: {
  xml: string | null;
  locale: string;
  canEdit: boolean;
  other: Map<string, string>;
  onChange: (id: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const loc = useLocalized();
  const rows = useMemo(() => (xml ? [...bilingualTexts(xml)] : []), [xml]);
  const otherLang = locale === 'ar' ? 'en' : 'ar';
  return (
    <div className="ph-panel-section">
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('diagrams:dmn.translationsHint', { language: t(`diagrams:dmn.lang.${otherLang}`) })}
      </Typography.Paragraph>
      {rows.map(([id, v]) => (
        <Form.Item
          key={id}
          label={`${t(`diagrams:kinds.${v.kind}`, v.kind)} · ${loc({ nameEn: v.en, nameAr: v.ar }) || id}`}
          style={{ marginBlockEnd: 8 }}
        >
          <Input
            size="small"
            dir={otherLang === 'ar' ? 'rtl' : 'ltr'}
            defaultValue={other.get(id) ?? (otherLang === 'ar' ? v.ar : v.en)}
            readOnly={!canEdit}
            data-translation-id={id}
            onBlur={(e) => {
              if (e.target.value !== (other.get(id) ?? '')) onChange(id, e.target.value.trim());
            }}
          />
        </Form.Item>
      ))}
    </div>
  );
}
