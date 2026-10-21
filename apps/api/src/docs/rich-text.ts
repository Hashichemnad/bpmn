import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import {
  CALLOUT_TYPES,
  RICH_TEXT_ALLOWED_ATTR,
  RICH_TEXT_ALLOWED_TAGS,
  isAllowedHref,
  isAllowedImageSrc,
  isExternalHref,
} from '@processhub/shared';

const { window } = new JSDOM('');
const purify = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);

const DATA_TYPES = new Set(['taskList', 'taskItem', 'callout', 'bpmn-diagram', 'file']);
const DIRECTIONS = new Set(['ltr', 'rtl', 'auto']);

purify.addHook('uponSanitizeElement', (node, data) => {
  const el = node as Element;
  if (data.tagName === 'img' && !isAllowedImageSrc(el.getAttribute?.('src'))) {
    el.parentNode?.removeChild(el);
  }
  if (data.tagName === 'input' && el.getAttribute?.('type') !== 'checkbox') {
    el.parentNode?.removeChild(el);
  }
});

purify.addHook('afterSanitizeAttributes', (node) => {
  const el = node as Element;
  if (!el.getAttribute) return;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') {
    const href = el.getAttribute('href');
    if (!isAllowedHref(href)) el.removeAttribute('href');
    if (href && isAllowedHref(href) && isExternalHref(href)) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer nofollow');
    } else {
      el.removeAttribute('target');
      el.removeAttribute('rel');
    }
  } else {
    el.removeAttribute('target');
    el.removeAttribute('rel');
    el.removeAttribute('href');
  }
  if (tag !== 'img') el.removeAttribute('src');
  if (tag === 'input') el.setAttribute('disabled', 'disabled');
  const cls = el.getAttribute('class');
  if (cls !== null && !(tag === 'code' && /^language-[\w-]{1,30}$/.test(cls))) {
    el.removeAttribute('class');
  }
  const dir = el.getAttribute('dir');
  if (dir !== null && !DIRECTIONS.has(dir)) el.removeAttribute('dir');
  const type = el.getAttribute('data-type');
  if (type !== null && !DATA_TYPES.has(type)) el.removeAttribute('data-type');
  const callout = el.getAttribute('data-callout');
  if (callout !== null && !(CALLOUT_TYPES as readonly string[]).includes(callout)) {
    el.setAttribute('data-callout', 'info');
  }
});

/** Sanitises wiki HTML on the server: only the editor's tags/attributes and safe URLs survive. */
export function sanitizeRichText(html: string): string {
  return purify.sanitize(html, {
    ALLOWED_TAGS: [...RICH_TEXT_ALLOWED_TAGS],
    ALLOWED_ATTR: [...RICH_TEXT_ALLOWED_ATTR],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

const BLOCK_END = /<\/(p|h[1-6]|li|blockquote|pre|tr|div|table)>|<br\s*\/?>|<hr\s*\/?>/gi;

/** Plain text of (sanitised) HTML, one line per block, for search and diffs. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(BLOCK_END, (m) => `${m}\n`)
    .replace(/<\/t[dh]>/gi, (m) => `${m} `);
  const fragment = JSDOM.fragment(`<div>${withBreaks}</div>`);
  return (fragment.textContent ?? '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}
