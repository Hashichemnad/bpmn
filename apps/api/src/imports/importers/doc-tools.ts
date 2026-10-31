import { JSDOM } from 'jsdom';
import {
  findProcessCodes,
  isArabicText,
  type ImportIssue,
  type ImportSuggestion,
} from '@processhub/shared';
import { issue, norm } from './tabular';

/** An asset of an imported document (image / attachment), loaded again when the batch is applied. */
export type AssetSource =
  | { kind: 'docx'; fileId: string; index: number }
  | { kind: 'zip'; fileId: string; path: string }
  | { kind: 'file'; fileId: string };

export interface AssetRef {
  key: string;
  name: string;
  source: AssetSource;
}

/** Importer payload of one wiki page. */
export interface PagePayload {
  externalKey: string;
  lang: 'en' | 'ar';
  title: string;
  /** Unsanitised HTML with `import-asset:KEY` and `import-page:REF` placeholders. */
  html: string;
  parentRef: string | null;
  assets: AssetRef[];
  /** Attach the original file and link it at the top of the page (PDF). */
  original?: AssetRef;
  needsManualWork?: boolean;
}

export const ASSET = 'import-asset:';
export const PAGE = 'import-page:';

let dom: JSDOM | null = null;
const doc = () => (dom ??= new JSDOM('')).window.document;

/** Parses an HTML fragment into a container element. */
export function fragment(html: string): HTMLElement {
  const div = doc().createElement('div');
  div.innerHTML = html;
  return div;
}

const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote';

/** Arabic paragraphs keep right-to-left: blocks with Arabic text get `dir="rtl"`. */
export function markRtl(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll(BLOCKS)))
    if (!el.getAttribute('dir') && isArabicText(el.textContent ?? ''))
      el.setAttribute('dir', 'rtl');
}

/** Language of a document: Arabic when most of its letters are Arabic. */
export const languageOf = (text: string): 'en' | 'ar' => (isArabicText(text) ? 'ar' : 'en');

/** Splits HTML at its Heading 1 elements: [{ title, html }] (content before the first H1 is kept). */
export function splitByHeading1(
  html: string,
  fallbackTitle: string,
): { title: string; html: string }[] {
  const root = fragment(html);
  const parts: { title: string; nodes: Node[] }[] = [{ title: fallbackTitle, nodes: [] }];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 1 && (node as Element).tagName === 'H1') {
      parts.push({ title: (node.textContent ?? '').trim() || fallbackTitle, nodes: [] });
      continue;
    }
    parts[parts.length - 1].nodes.push(node);
  }
  return parts
    .filter((p, i) => i > 0 || p.nodes.some((n) => (n.textContent ?? '').trim()))
    .map((p) => {
      const wrap = doc().createElement('div');
      for (const n of p.nodes) wrap.appendChild(n);
      return { title: p.title, html: wrap.innerHTML };
    });
}

/** The first heading as the title (removed from the body), else the fallback. */
export function takeTitle(html: string, fallback: string): { title: string; html: string } {
  const root = fragment(html);
  const first = Array.from(root.children).find((c) => /^H[12]$/.test(c.tagName));
  if (first && (first.textContent ?? '').trim()) {
    const title = (first.textContent ?? '').trim();
    first.remove();
    return { title, html: root.innerHTML };
  }
  return { title: fallback, html };
}

/** Template sections (headings) the document lacks: appended as empty headings to fill in. */
export function templateGaps(html: string, templateHtml: string): string[] {
  const have = new Set(
    Array.from(fragment(html).querySelectorAll('h1,h2,h3')).map((h) => norm(h.textContent ?? '')),
  );
  return Array.from(fragment(templateHtml).querySelectorAll('h1,h2,h3'))
    .map((h) => (h.textContent ?? '').trim())
    .filter((t) => t && !have.has(norm(t)));
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text → paragraphs (blank lines separate paragraphs; single line breaks are kept). */
export function textToHtml(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const rtl = isArabicText(p) ? ' dir="rtl"' : '';
      return `<p${rtl}>${p.split('\n').map(escapeHtml).join('<br>')}</p>`;
    })
    .join('');
}

export interface ProcessCandidate {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}

/**
 * Process link suggestions: a process code in the file name or title (accepted), a code in the
 * text or an exact process name in the title (offered).
 */
export function processSuggestions(
  processes: ProcessCandidate[],
  where: { file: string; title: string; text: string },
): ImportSuggestion[] {
  const byCode = new Map(processes.map((p) => [norm(p.code), p]));
  const out = new Map<string, ImportSuggestion>();
  const add = (p: ProcessCandidate, at: string, accepted: boolean, source: string) => {
    const prev = out.get(p.id);
    if (prev && (prev.accepted || !accepted)) return;
    out.set(p.id, {
      id: `PROCESS:${p.id}`,
      kind: 'PROCESS',
      source,
      targetId: p.id,
      targetLabelEn: `${p.code} ${p.nameEn}`.trim(),
      targetLabelAr: `${p.code} ${p.nameAr}`.trim(),
      at,
      accepted,
    });
  };
  for (const c of findProcessCodes(`${where.file} ${where.title}`)) {
    const p = byCode.get(norm(c));
    if (p) add(p, 'title', true, c);
  }
  for (const c of findProcessCodes(where.text).slice(0, 20)) {
    const p = byCode.get(norm(c));
    if (p) add(p, 'text', false, c);
  }
  const title = norm(where.title);
  for (const p of processes)
    for (const n of [p.nameEn, p.nameAr])
      if (n && norm(n).length >= 5 && title.includes(norm(n))) add(p, 'title', false, n);
  return [...out.values()].slice(0, 20);
}

/** Broken internal links are reported per page. */
export const brokenLinksIssue = (links: string[]): ImportIssue[] =>
  links.length
    ? [
        issue('WARNING', 'BROKEN_LINKS', {
          count: links.length,
          list: links.slice(0, 5).join(', '),
        }),
      ]
    : [];
