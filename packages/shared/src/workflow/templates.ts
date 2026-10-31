/**
 * Placeholders in notification and document templates: `{{fieldKey}}`, `{{case.number}}`,
 * `{{initiator.name}}`, `{{process.name}}`. The result is plain text: templates never produce HTML
 * (e-mails escape it, the web client renders it as text), so form data cannot inject markup.
 */
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/g;

export function formatTemplateValue(v: unknown, locale: string): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number')
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-AE' : 'en-GB', {
      maximumFractionDigits: 2,
    }).format(v);
  if (typeof v === 'boolean')
    return v ? (locale === 'ar' ? 'نعم' : 'Yes') : locale === 'ar' ? 'لا' : 'No';
  if (Array.isArray(v)) return v.map((x) => formatTemplateValue(x, locale)).join(', ');
  if (typeof v === 'object') return '';
  return String(v);
}

export function renderTemplate(
  text: string,
  vars: Record<string, unknown>,
  locale: string,
  /** Display values for some keys (choice labels, user names) — checked first. */
  display: Record<string, string> = {},
): string {
  return text
    .replace(PLACEHOLDER, (_, path: string) => {
      if (display[path] !== undefined) return display[path];
      let cur: unknown = vars;
      for (const seg of path.split('.')) {
        if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, seg))
          return '';
        cur = (cur as Record<string, unknown>)[seg];
      }
      return formatTemplateValue(cur, locale);
    })
    // Control characters except tab and line breaks.
    .replace(/(?![\t\n\r])\p{Cc}/gu, '');
}

/** Placeholder names used in a template (editor hints, checks). */
export function templatePlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}
