import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import {
  App,
  Button,
  Divider,
  Dropdown,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Tooltip,
  Upload,
  type MenuProps,
} from 'antd';
import {
  BoldOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  ConsoleSqlOutlined,
  InfoCircleOutlined,
  ItalicOutlined,
  LineOutlined,
  LinkOutlined,
  OrderedListOutlined,
  PaperClipOutlined,
  PartitionOutlined,
  PictureOutlined,
  RedoOutlined,
  StrikethroughOutlined,
  SwapOutlined,
  TableOutlined,
  UnderlineOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  ATTACHMENT_IMAGE_TYPES,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  CALLOUT_TYPES,
  isAllowedHref,
  type Locale,
  type TextDirection,
} from '@processhub/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useProcessTree } from '@/api/hooks';
import { docKeys, uploadAttachment } from '@/api/docs';
import { useErrorMessage, useLocalized } from '@/components/i18n-helpers';
import { sanitizeHtml } from '../sanitize';
import { wikiExtensions } from './extensions';

interface Props {
  value: string;
  onChange: (html: string) => void;
  dir: TextDirection;
  lang: Locale;
  /** Needed for image / file uploads (attachments belong to a page). */
  pageId?: string;
  placeholder?: string;
}

const extOf = (name: string) => name.toLowerCase().split('.').pop() ?? '';

function ToolButton({
  title,
  icon,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Tooltip title={title} mouseEnterDelay={0.4}>
      <Button
        size="small"
        type={active ? 'primary' : 'text'}
        ghost={active}
        icon={icon}
        aria-label={title}
        aria-pressed={active}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

function Toolbar({ editor, pageId }: { editor: Editor; pageId?: string }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const errorMessage = useErrorMessage();
  const loc = useLocalized();
  const qc = useQueryClient();
  const processes = useProcessTree();
  const [linkOpen, setLinkOpen] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [linkForm] = Form.useForm<{ href: string }>();
  const [diagramForm] = Form.useForm<{ processId: string }>();

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive('heading', { level: 1 })
        ? 'h1'
        : e.isActive('heading', { level: 2 })
          ? 'h2'
          : e.isActive('heading', { level: 3 })
            ? 'h3'
            : e.isActive('heading', { level: 4 })
              ? 'h4'
              : 'p',
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      callout: e.isActive('callout'),
      link: e.isActive('link'),
      table: e.isActive('table'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const chain = () => editor.chain().focus();

  const upload = async (file: File, kind: 'image' | 'file') => {
    if (!pageId) return false;
    const type = ATTACHMENT_TYPES[extOf(file.name)];
    const isImage = (ATTACHMENT_IMAGE_TYPES as readonly string[]).includes(type ?? '');
    if (!type || (kind === 'image' && !isImage)) {
      message.error(t('errors:UNSUPPORTED_FILE_TYPE'));
      return false;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      message.error(t('errors:FILE_TOO_LARGE'));
      return false;
    }
    setUploading(true);
    try {
      const a = await uploadAttachment(pageId, file);
      if (kind === 'image') chain().setImage({ src: a.url, alt: a.fileName }).run();
      else
        chain()
          .insertContent([
            {
              type: 'text',
              text: `📎 ${a.fileName}`,
              marks: [{ type: 'link', attrs: { href: a.url } }],
            },
            { type: 'text', text: ' ' },
          ])
          .run();
      void qc.invalidateQueries({ queryKey: docKeys.attachments(pageId) });
    } catch (err) {
      message.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
    return false;
  };

  const openLink = () => {
    linkForm.setFieldsValue({ href: (editor.getAttributes('link').href as string) ?? '' });
    setLinkOpen(true);
  };

  const applyLink = async () => {
    const { href } = await linkForm.validateFields();
    const url = href.trim();
    if (!url) chain().extendMarkRange('link').unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive('link')) {
      chain()
        .insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] })
        .run();
    } else chain().extendMarkRange('link').setLink({ href: url }).run();
    setLinkOpen(false);
  };

  const insertDiagram = async () => {
    const { processId } = await diagramForm.validateFields();
    chain().insertBpmnDiagram(processId).run();
    setDiagramOpen(false);
    diagramForm.resetFields();
  };

  const calloutItems: MenuProps['items'] = [
    ...CALLOUT_TYPES.map((c) => ({
      key: c,
      label: (
        <span className={`ph-callout-swatch ph-callout-swatch-${c}`}>{t(`docs:callout.${c}`)}</span>
      ),
      onClick: () => chain().setCallout(c).run(),
    })),
    { type: 'divider' as const },
    {
      key: 'remove',
      label: t('docs:callout.remove'),
      disabled: !s.callout,
      onClick: () => chain().unsetCallout().run(),
    },
  ];

  const tableItems: MenuProps['items'] = s.table
    ? [
        {
          key: 'rowBefore',
          label: t('docs:table.rowBefore'),
          onClick: () => chain().addRowBefore().run(),
        },
        {
          key: 'rowAfter',
          label: t('docs:table.rowAfter'),
          onClick: () => chain().addRowAfter().run(),
        },
        {
          key: 'colBefore',
          label: t('docs:table.colBefore'),
          onClick: () => chain().addColumnBefore().run(),
        },
        {
          key: 'colAfter',
          label: t('docs:table.colAfter'),
          onClick: () => chain().addColumnAfter().run(),
        },
        { type: 'divider' as const },
        {
          key: 'header',
          label: t('docs:table.toggleHeader'),
          onClick: () => chain().toggleHeaderRow().run(),
        },
        { type: 'divider' as const },
        {
          key: 'delRow',
          danger: true,
          label: t('docs:table.deleteRow'),
          onClick: () => chain().deleteRow().run(),
        },
        {
          key: 'delCol',
          danger: true,
          label: t('docs:table.deleteColumn'),
          onClick: () => chain().deleteColumn().run(),
        },
        {
          key: 'delTable',
          danger: true,
          label: t('docs:table.delete'),
          onClick: () => chain().deleteTable().run(),
        },
      ]
    : [
        {
          key: 'insert',
          label: t('docs:table.insert'),
          onClick: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        },
      ];

  const directionItems: MenuProps['items'] = [
    {
      key: 'ltr',
      label: t('docs:direction.ltr'),
      onClick: () => chain().setBlockDirection('ltr').run(),
    },
    {
      key: 'rtl',
      label: t('docs:direction.rtl'),
      onClick: () => chain().setBlockDirection('rtl').run(),
    },
    {
      key: 'page',
      label: t('docs:direction.page'),
      onClick: () => chain().setBlockDirection(null).run(),
    },
  ];

  const processOptions = useMemo(
    () =>
      (processes.data ?? [])
        .slice()
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((p) => ({ value: p.id, label: `${p.code} ${loc(p)}` })),
    [processes.data, loc],
  );

  return (
    <div className="ph-editor-toolbar" role="toolbar" aria-label={t('docs:editor.toolbar')}>
      <Flex wrap="wrap" gap={2} align="center">
        <Select
          size="small"
          value={s.block}
          style={{ inlineSize: 130 }}
          aria-label={t('docs:editor.blockType')}
          onChange={(v) =>
            v === 'p'
              ? chain().setParagraph().run()
              : chain()
                  .toggleHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 | 4 })
                  .run()
          }
          options={['p', 'h1', 'h2', 'h3', 'h4'].map((v) => ({
            value: v,
            label: t(`docs:editor.blocks.${v}`),
          }))}
        />
        <Divider type="vertical" />
        <ToolButton
          title={t('docs:editor.bold')}
          icon={<BoldOutlined />}
          active={s.bold}
          onClick={() => chain().toggleBold().run()}
        />
        <ToolButton
          title={t('docs:editor.italic')}
          icon={<ItalicOutlined />}
          active={s.italic}
          onClick={() => chain().toggleItalic().run()}
        />
        <ToolButton
          title={t('docs:editor.underline')}
          icon={<UnderlineOutlined />}
          active={s.underline}
          onClick={() => chain().toggleUnderline().run()}
        />
        <ToolButton
          title={t('docs:editor.strike')}
          icon={<StrikethroughOutlined />}
          active={s.strike}
          onClick={() => chain().toggleStrike().run()}
        />
        <ToolButton
          title={t('docs:editor.code')}
          icon={<CodeOutlined />}
          active={s.code}
          onClick={() => chain().toggleCode().run()}
        />
        <ToolButton
          title={t('docs:editor.link')}
          icon={<LinkOutlined />}
          active={s.link}
          onClick={openLink}
        />
        <Divider type="vertical" />
        <ToolButton
          title={t('docs:editor.bulletList')}
          icon={<UnorderedListOutlined />}
          active={s.bullet}
          onClick={() => chain().toggleBulletList().run()}
        />
        <ToolButton
          title={t('docs:editor.orderedList')}
          icon={<OrderedListOutlined />}
          active={s.ordered}
          onClick={() => chain().toggleOrderedList().run()}
        />
        <ToolButton
          title={t('docs:editor.taskList')}
          icon={<CheckSquareOutlined />}
          active={s.task}
          onClick={() => chain().toggleTaskList().run()}
        />
        <Divider type="vertical" />
        <ToolButton
          title={t('docs:editor.quote')}
          active={s.quote}
          onClick={() => chain().toggleBlockquote().run()}
        >
          <span aria-hidden className="ph-tool-glyph">
            ❝
          </span>
        </ToolButton>
        <ToolButton
          title={t('docs:editor.codeBlock')}
          icon={<ConsoleSqlOutlined />}
          active={s.codeBlock}
          onClick={() => chain().toggleCodeBlock().run()}
        />
        <Dropdown menu={{ items: calloutItems }} trigger={['click']}>
          <span>
            <ToolButton
              title={t('docs:editor.callout')}
              icon={<InfoCircleOutlined />}
              active={s.callout}
            />
          </span>
        </Dropdown>
        <ToolButton
          title={t('docs:editor.horizontalRule')}
          icon={<LineOutlined />}
          onClick={() => chain().setHorizontalRule().run()}
        />
        <Dropdown menu={{ items: tableItems }} trigger={['click']}>
          <span>
            <ToolButton title={t('docs:editor.table')} icon={<TableOutlined />} active={s.table} />
          </span>
        </Dropdown>
        <Divider type="vertical" />
        {pageId && (
          <>
            <Upload
              showUploadList={false}
              accept={ATTACHMENT_IMAGE_TYPES.join(',')}
              beforeUpload={(f) => upload(f, 'image')}
              disabled={uploading}
            >
              <ToolButton
                title={t('docs:editor.image')}
                icon={<PictureOutlined />}
                disabled={uploading}
              />
            </Upload>
            <Upload
              showUploadList={false}
              accept={Object.keys(ATTACHMENT_TYPES)
                .map((e) => `.${e}`)
                .join(',')}
              beforeUpload={(f) => upload(f, 'file')}
              disabled={uploading}
            >
              <ToolButton
                title={t('docs:editor.attachment')}
                icon={<PaperClipOutlined />}
                disabled={uploading}
              />
            </Upload>
          </>
        )}
        <ToolButton
          title={t('docs:editor.diagram')}
          icon={<PartitionOutlined />}
          onClick={() => setDiagramOpen(true)}
        />
        <Dropdown menu={{ items: directionItems }} trigger={['click']}>
          <span>
            <ToolButton title={t('docs:editor.direction')} icon={<SwapOutlined />} />
          </span>
        </Dropdown>
        <Divider type="vertical" />
        <ToolButton
          title={t('modeler:undo')}
          icon={<UndoOutlined />}
          disabled={!s.canUndo}
          onClick={() => chain().undo().run()}
        />
        <ToolButton
          title={t('modeler:redo')}
          icon={<RedoOutlined />}
          disabled={!s.canRedo}
          onClick={() => chain().redo().run()}
        />
      </Flex>

      <Modal
        title={t('docs:editor.link')}
        open={linkOpen}
        onCancel={() => setLinkOpen(false)}
        onOk={() => void applyLink()}
        okText={t('docs:editor.apply')}
        cancelText={t('cancel')}
        destroyOnHidden
      >
        <Form form={linkForm} layout="vertical" onFinish={() => void applyLink()}>
          <Form.Item
            name="href"
            label={t('docs:editor.linkUrl')}
            extra={t('docs:editor.linkHint')}
            rules={[
              {
                validator: (_r, v: string) =>
                  !v?.trim() || isAllowedHref(v)
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('docs:editor.invalidLink'))),
              },
            ]}
          >
            <Input dir="ltr" autoFocus placeholder="https://" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={t('docs:editor.insertDiagram')}
        open={diagramOpen}
        onCancel={() => setDiagramOpen(false)}
        onOk={() => void insertDiagram()}
        okText={t('docs:editor.insert')}
        cancelText={t('cancel')}
        destroyOnHidden
      >
        <Form form={diagramForm} layout="vertical">
          <Form.Item
            name="processId"
            label={t('docs:editor.chooseProcess')}
            extra={t('docs:editor.diagramHint')}
            rules={[{ required: true, message: t('validation.required') }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={processOptions}
              loading={processes.isLoading}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/** TipTap editor for one language version of a page (or template). */
export function RichTextEditor({ value, onChange, dir, lang, pageId, placeholder }: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editor = useEditor({
    extensions: wikiExtensions({ placeholder }),
    content: sanitizeHtml(value),
    editorProps: { attributes: { class: 'ph-prose ph-prose-edit', dir, lang } },
    onUpdate: ({ editor: e }) => onChangeRef.current(e.getHTML()),
  });

  useEffect(() => {
    editor?.setOptions({
      editorProps: { attributes: { class: 'ph-prose ph-prose-edit', dir, lang } },
    });
  }, [editor, dir, lang]);

  if (!editor) return null;
  return (
    <div className="ph-editor">
      <Toolbar editor={editor} pageId={pageId} />
      <EditorContent editor={editor} className="ph-editor-content" />
    </div>
  );
}
