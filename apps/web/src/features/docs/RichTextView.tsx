import { EditorContent, useEditor } from '@tiptap/react';
import type { Locale, TextDirection } from '@processhub/shared';
import { sanitizeHtml } from './sanitize';
import { wikiExtensions } from './editor/extensions';

/** Read-only rendering of sanitised wiki HTML with the editor's schema (diagrams, callouts…). */
export function RichTextView({
  html,
  dir,
  lang,
}: {
  html: string;
  dir: TextDirection;
  lang: Locale;
}) {
  const editor = useEditor(
    {
      editable: false,
      extensions: wikiExtensions(),
      content: sanitizeHtml(html),
      editorProps: { attributes: { class: 'ph-prose', dir, lang } },
    },
    [html, dir, lang],
  );
  return <EditorContent editor={editor} />;
}
