/**
 * Rules for rich-text (wiki) HTML shared by the server-side sanitiser and the
 * client-side DOMPurify pass on render. Both apply the same allow-lists.
 */

export const RICH_TEXT_ALLOWED_TAGS = [
  'p',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'label',
  'input',
  'span',
  'div',
  'hr',
  'a',
  'img',
  'table',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'mark',
] as const;

export const RICH_TEXT_ALLOWED_ATTR = [
  'href',
  'target',
  'rel',
  'src',
  'alt',
  'title',
  'width',
  'dir',
  'class',
  'type',
  'checked',
  'disabled',
  'colspan',
  'rowspan',
  'colwidth',
  'start',
  'data-type',
  'data-checked',
  'data-callout',
  'data-process-id',
  'data-attachment-id',
  'data-file-name',
  'data-language',
] as const;

export const CALLOUT_TYPES = ['info', 'note', 'success', 'warning', 'danger'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ATTACHMENT_SRC = new RegExp(`^/api/v1/attachments/(${UUID})/content$`, 'i');

/** URL of an uploaded attachment's content. */
export const attachmentUrl = (id: string) => `/api/v1/attachments/${id}/content`;

/** Images may only point at our own attachments (no tracking pixels or external content). */
export function isAllowedImageSrc(src: string | null | undefined): boolean {
  return !!src && ATTACHMENT_SRC.test(src.trim());
}

/** Links: http(s), mailto, in-app absolute paths and fragments. Never javascript:, data: etc. */
export function isAllowedHref(href: string | null | undefined): boolean {
  if (!href) return false;
  const v = href.trim();
  if (v.startsWith('#')) return true;
  if (v.startsWith('/')) return !v.startsWith('//') && !v.startsWith('/\\');
  return /^(https?:\/\/|mailto:)/i.test(v);
}

export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

/** Process ids of diagrams embedded in a page (`<div data-type="bpmn-diagram" data-process-id>`). */
export function embeddedProcessIds(html: string): string[] {
  const ids = new Set<string>();
  const re = new RegExp(`data-process-id="(${UUID})"`, 'gi');
  for (const m of html.matchAll(re)) ids.add(m[1].toLowerCase());
  return [...ids];
}

/** Attachment ids referenced by images or file links in a page. */
export function referencedAttachmentIds(html: string): string[] {
  const ids = new Set<string>();
  const re = new RegExp(`/api/v1/attachments/(${UUID})/content`, 'gi');
  for (const m of html.matchAll(re)) ids.add(m[1].toLowerCase());
  return [...ids];
}

/** True when the HTML has visible text or embedded content (an empty editor yields `<p></p>`). */
export function hasRichContent(html: string): boolean {
  if (/<(img|table|hr|div[^>]+data-type="bpmn-diagram")/i.test(html)) return true;
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '').length > 0;
}
