import DOMPurify from 'dompurify';
import {
  CALLOUT_TYPES,
  RICH_TEXT_ALLOWED_ATTR,
  RICH_TEXT_ALLOWED_TAGS,
  isAllowedHref,
  isAllowedImageSrc,
  isExternalHref,
} from '@processhub/shared';

// A dedicated instance so these hooks do not affect other DOMPurify users.
const purify = DOMPurify(window);
const DATA_TYPES = new Set(['taskList', 'taskItem', 'callout', 'bpmn-diagram', 'file']);
const DIRECTIONS = new Set(['ltr', 'rtl', 'auto']);

purify.addHook('uponSanitizeElement', (node, data) => {
  const el = node as Element;
  if (data.tagName === 'img' && !isAllowedImageSrc(el.getAttribute?.('src'))) el.remove();
  if (data.tagName === 'input' && el.getAttribute?.('type') !== 'checkbox') el.remove();
});

purify.addHook('afterSanitizeAttributes', (node) => {
  const el = node as Element;
  if (!el.getAttribute) return;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') {
    const href = el.getAttribute('href');
    const ok = isAllowedHref(href);
    if (!ok) el.removeAttribute('href');
    if (ok && href && isExternalHref(href)) {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer nofollow');
    } else {
      el.removeAttribute('target');
      el.removeAttribute('rel');
    }
  } else {
    el.removeAttribute('href');
    el.removeAttribute('target');
    el.removeAttribute('rel');
  }
  if (tag !== 'img') el.removeAttribute('src');
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

/**
 * Sanitises wiki HTML before it is rendered or loaded into the editor. Same rules as the
 * server (defence in depth against stored XSS).
 */
export function sanitizeHtml(html: string): string {
  return purify.sanitize(html, {
    ALLOWED_TAGS: [...RICH_TEXT_ALLOWED_TAGS],
    ALLOWED_ATTR: [...RICH_TEXT_ALLOWED_ATTR],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
