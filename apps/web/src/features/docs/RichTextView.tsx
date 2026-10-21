import { EditorContent, useEditor } from '@tiptap/react';
import type { Locale, TextDirection } from '@processhub/shared';
import { sanitizeHtml } from './sanitize';
import { wikiExtensions } from './editor/extensions';
import { RenderModeContext, toPortalAttachments } from './embed-context';

/** Read-only rendering of sanitised wiki HTML with the editor's schema (diagrams, callouts…). */
export function RichTextView({
  html,
  dir,
  lang,
  portal = false,
}: {
  html: string;
  dir: TextDirection;
  lang: Locale;
  /** Published content in the Knowledge Portal (portal diagrams and files). */
  portal?: boolean;
}) {
  // Attachment URLs are validated by the sanitiser, then pointed at the portal endpoint.
  const safe = sanitizeHtml(html);
  const editor = useEditor(
    {
      editable: false,
      extensions: wikiExtensions(),
      content: portal ? toPortalAttachments(safe) : safe,
      editorProps: { attributes: { class: 'ph-prose', dir, lang } },
    },
    [html, dir, lang, portal],
  );
  return (
    <RenderModeContext.Provider value={portal ? 'portal' : 'workspace'}>
      <EditorContent editor={editor} />
    </RenderModeContext.Provider>
  );
}
