import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Flex,
  Form,
  Input,
  Modal,
  Segmented,
  Space,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { CloudSyncOutlined, SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  hasRichContent,
  type Locale,
  type PageDraftDto,
  type PageDto,
  type TextDirection,
} from '@processhub/shared';
import { ApiError } from '@/api/client';
import { discardDraft, saveDraft, usePage, usePageDraft, useSavePage } from '@/api/docs';
import { useLocale } from '@/app/LocaleProvider';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/states';
import { useErrorMessage, useFormatDate, useLocalized } from '@/components/i18n-helpers';
import { RichTextEditor } from './editor/RichTextEditor';
import { AiBadge, AiButton } from '@/features/ai/AiParts';
import { TranslatePageModal } from '@/features/ai/TranslatePageModal';
import { useSpaceContext } from './space-context';

interface EditorState {
  titleEn: string;
  titleAr: string;
  contentEn: string;
  contentAr: string;
  dirEn: TextDirection;
  dirAr: TextDirection;
}

const AUTOSAVE_MS = 3000;

const fromPage = (p: PageDto | PageDraftDto): EditorState => ({
  titleEn: p.titleEn,
  titleAr: p.titleAr,
  contentEn: p.contentEn,
  contentAr: p.contentAr,
  dirEn: p.dirEn,
  dirAr: p.dirAr,
});

function Editor({ page, initialDraft }: { page: PageDto; initialDraft: PageDraftDto | null }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const loc = useLocalized();
  const navigate = useNavigate();
  const formatDate = useFormatDate();
  const errorMessage = useErrorMessage();
  const { message, modal } = App.useApp();
  const { space } = useSpaceContext();
  const savePage = useSavePage(page.id);
  const [state, setState] = useState<EditorState>(() => fromPage(page));
  const [lang, setLang] = useState<Locale>(locale);
  const [editorKey, setEditorKey] = useState(0);
  const [draft, setDraft] = useState<PageDraftDto | null>(initialDraft);
  const [draftOffer, setDraftOffer] = useState(!!initialDraft);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [changed, setChanged] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [form] = Form.useForm<{ changeNote: string }>();
  const stateRef = useRef(state);
  stateRef.current = state;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const leavingRef = useRef(false);
  /** Content is unedited AI output (translation / generated page): cleared by any edit. */
  const aiRef = useRef(page.aiGenerated);
  const [aiFlag, setAiFlag] = useState(page.aiGenerated);
  const [translateTo, setTranslateTo] = useState<Locale | null>(null);

  const flushDraft = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      const res = await saveDraft(page.id, { ...stateRef.current, baseVersion: page.version });
      setDraftSavedAt(res.draft.updatedAt);
      setPending(false);
    } catch {
      /* the next change retries; the leave guard still protects the user */
    }
  }, [page.id, page.version]);

  const update = (patch: Partial<EditorState>, ai = false) => {
    aiRef.current = ai;
    setAiFlag(ai);
    setState((s) => ({ ...s, ...patch }));
    setChanged(true);
    setPending(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushDraft(), AUTOSAVE_MS);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  // Leaving with changes that are not autosaved yet.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      pending && !leavingRef.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void flushDraft().then(() => blocker.proceed());
  }, [blocker, flushDraft]);
  useEffect(() => {
    if (!pending) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [pending]);

  const restoreDraft = () => {
    if (!draft) return;
    setState(fromPage(draft));
    setEditorKey((k) => k + 1);
    setDraftOffer(false);
    setChanged(true);
  };

  const dropDraft = async () => {
    await discardDraft(page.id).catch(() => undefined);
    setDraft(null);
    setDraftOffer(false);
  };

  const doSave = async () => {
    const { changeNote } = await form.validateFields();
    try {
      clearTimeout(timer.current);
      await savePage.mutateAsync({
        ...state,
        changeNote,
        baseVersion: page.version,
        aiGenerated: aiRef.current,
      });
      leavingRef.current = true;
      setPending(false);
      setSaveOpen(false);
      message.success(t('docs:editor.savedVersion', { number: page.version + 1 }));
      navigate(`/docs/${space.id}/pages/${page.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PAGE_CHANGED') {
        setSaveOpen(false);
        modal.warning({ title: t('errors:PAGE_CHANGED'), content: t('docs:editor.conflictHelp') });
      } else message.error(errorMessage(err));
    }
  };

  const openSave = () => {
    if (!state.titleEn.trim() && !state.titleAr.trim()) {
      message.error(t('docs:pages.titleRequired'));
      return;
    }
    setSaveOpen(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        openSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const cancel = () => {
    if (!changed) {
      navigate(`/docs/${space.id}/pages/${page.id}`);
      return;
    }
    modal.confirm({
      title: t('docs:editor.cancelTitle'),
      content: t('docs:editor.cancelText'),
      okText: t('docs:editor.discard'),
      okButtonProps: { danger: true },
      cancelText: t('docs:editor.keepEditing'),
      onOk: async () => {
        clearTimeout(timer.current);
        leavingRef.current = true;
        await discardDraft(page.id).catch(() => undefined);
        navigate(`/docs/${space.id}/pages/${page.id}`);
      },
    });
  };

  const pane = (l: Locale) => {
    const title = l === 'ar' ? state.titleAr : state.titleEn;
    const html = l === 'ar' ? state.contentAr : state.contentEn;
    const dir = l === 'ar' ? state.dirAr : state.dirEn;
    return (
      <Space direction="vertical" size={12} style={{ inlineSize: '100%' }}>
        <Flex gap={12} wrap="wrap" align="center">
          <Input
            size="large"
            className="ph-title-input"
            dir={dir}
            lang={l}
            maxLength={300}
            value={title}
            placeholder={t(l === 'ar' ? 'docs:pages.titleAr' : 'docs:pages.titleEn')}
            aria-label={t(l === 'ar' ? 'docs:pages.titleAr' : 'docs:pages.titleEn')}
            onChange={(e) =>
              update(l === 'ar' ? { titleAr: e.target.value } : { titleEn: e.target.value })
            }
            style={{ flex: 1, minInlineSize: 240 }}
          />
          {filled(l === 'ar' ? 'en' : 'ar') && (
            <AiButton onClick={() => setTranslateTo(l)}>
              {t(`ai:translate.fillFrom.${l === 'ar' ? 'en' : 'ar'}`)}
            </AiButton>
          )}
          <Space size={6}>
            <Typography.Text type="secondary">{t('docs:editor.pageDirection')}</Typography.Text>
            <Segmented
              value={dir}
              onChange={(d) =>
                update(l === 'ar' ? { dirAr: d as TextDirection } : { dirEn: d as TextDirection })
              }
              options={[
                { value: 'ltr', label: t('docs:direction.ltrShort') },
                { value: 'rtl', label: t('docs:direction.rtlShort') },
              ]}
            />
          </Space>
        </Flex>
        <RichTextEditor
          key={`${l}-${editorKey}`}
          value={html}
          dir={dir}
          lang={l}
          pageId={page.id}
          placeholder={t('docs:editor.placeholder')}
          onChange={(v) => update(l === 'ar' ? { contentAr: v } : { contentEn: v })}
        />
      </Space>
    );
  };

  const filled = (l: Locale) =>
    l === 'ar'
      ? !!state.titleAr.trim() || hasRichContent(state.contentAr)
      : !!state.titleEn.trim() || hasRichContent(state.contentEn);

  return (
    <>
      <PageHeader
        crumbs={[
          { title: t('nav.docs'), to: '/docs' },
          { title: loc(space), to: `/docs/${space.id}` },
          {
            title: loc(page, 'title') || t('docs:untitled'),
            to: `/docs/${space.id}/pages/${page.id}`,
          },
          { title: t('edit') },
        ]}
        title={t('docs:editor.title')}
        subtitle={
          <Space size={8} style={{ marginTop: 4 }}>
            <Tag>{t('docs:editor.basedOn', { version: page.version })}</Tag>
            {aiFlag && <AiBadge />}
            {pending ? (
              <Tag color="orange">{t('modeler:unsaved')}</Tag>
            ) : draftSavedAt ? (
              <Tag icon={<CloudSyncOutlined />} color="blue">
                {t('docs:editor.draftSaved', { time: formatDate(draftSavedAt) })}
              </Tag>
            ) : null}
          </Space>
        }
        extra={
          <>
            <Button onClick={cancel}>{t('cancel')}</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={openSave}>
              {t('save')}
            </Button>
          </>
        }
      />
      {draftOffer && draft && (
        <Alert
          type={
            draft.baseVersion !== null && draft.baseVersion !== page.version ? 'warning' : 'info'
          }
          showIcon
          style={{ marginBottom: 16 }}
          message={t('docs:editor.draftFound', { time: formatDate(draft.updatedAt) })}
          description={
            draft.baseVersion !== null && draft.baseVersion !== page.version
              ? t('docs:editor.draftOutdated', { draft: draft.baseVersion, current: page.version })
              : t('docs:editor.draftHint')
          }
          action={
            <Space direction="vertical">
              <Button size="small" type="primary" onClick={restoreDraft}>
                {t('docs:editor.restoreDraft')}
              </Button>
              <Button size="small" danger onClick={() => void dropDraft()}>
                {t('docs:editor.discardDraft')}
              </Button>
            </Space>
          }
        />
      )}
      <Card>
        <Tabs
          activeKey={lang}
          onChange={(k) => setLang(k as Locale)}
          items={(['en', 'ar'] as const).map((l) => ({
            key: l,
            label: (
              <Space size={6}>
                {l === 'ar' ? 'العربية' : 'English'}
                <Badge status={filled(l) ? 'success' : 'default'} />
              </Space>
            ),
            children: pane(l),
          }))}
        />
      </Card>
      {translateTo && (
        <TranslatePageModal
          open
          target={translateTo}
          source={
            translateTo === 'ar'
              ? { title: state.titleEn, html: state.contentEn }
              : { title: state.titleAr, html: state.contentAr }
          }
          onClose={() => setTranslateTo(null)}
          onUse={({ title, html }) => {
            update(
              translateTo === 'ar'
                ? { titleAr: title, contentAr: html, dirAr: 'rtl' }
                : { titleEn: title, contentEn: html, dirEn: 'ltr' },
              true,
            );
            setEditorKey((k) => k + 1);
          }}
        />
      )}
      <Modal
        title={t('docs:editor.saveTitle')}
        open={saveOpen}
        onCancel={() => setSaveOpen(false)}
        onOk={() => void doSave()}
        okText={t('save')}
        cancelText={t('cancel')}
        confirmLoading={savePage.isPending}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          {t('docs:editor.saveHint', { number: page.version + 1 })}
        </Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={() => void doSave()}>
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
    </>
  );
}

export function PageEditorPage() {
  const { pageId } = useParams<{ pageId: string }>();
  const page = usePage(pageId);
  const draft = usePageDraft(pageId!, !!pageId);
  if (page.isLoading || draft.isLoading) return <LoadingState />;
  if (page.isError || !page.data)
    return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  if (!page.data.canEdit) return <ErrorState error={new ApiError(403, 'FORBIDDEN', 'Forbidden')} />;
  return <Editor key={page.data.id} page={page.data} initialDraft={draft.data?.draft ?? null} />;
}
