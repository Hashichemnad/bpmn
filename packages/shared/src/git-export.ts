/**
 * Pure helpers for the Git export (M7): repository paths that mirror the process
 * house and the space/page tree, Markdown front-matter and commit messages.
 */
import type { Locale, ProcessCategory } from './constants';

/** ASCII slug ("Order Handling" → "order-handling"); '' when nothing usable remains (e.g. Arabic only). */
export function slugify(text: string, max = 60): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** Joins path parts, dropping empty segments and duplicate slashes. */
export function joinRepoPath(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split('/'))
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

export interface ProcessPathNode {
  code: string;
  nameEn: string;
  nameAr: string;
}

export function processSegment(p: ProcessPathNode): string {
  const slug = slugify(p.nameEn);
  return slug ? `${p.code}-${slug}` : p.code;
}

/**
 * `<root>/processes/<category>/<code-name>/…/<code-name>/<code>.bpmn` (+ `.json`).
 * `chain` runs from the top-level process down to the process itself.
 */
export function processFilePaths(
  root: string,
  category: ProcessCategory,
  chain: ProcessPathNode[],
): { bpmn: string; json: string } {
  const self = chain[chain.length - 1];
  const folder = joinRepoPath(
    root,
    'processes',
    category.toLowerCase(),
    ...chain.map(processSegment),
  );
  return { bpmn: `${folder}/${self.code}.bpmn`, json: `${folder}/${self.code}.json` };
}

export interface PagePathNode {
  id: string;
  titleEn: string;
  titleAr: string;
}

/** Page titles are not unique, so the segment ends with the first 8 characters of the page id. */
export function pageSegment(p: PagePathNode): string {
  const slug = slugify(p.titleEn) || 'page';
  return `${slug}-${p.id.slice(0, 8)}`;
}

/** `<root>/docs/<SPACE>/<page>/…/<page>/index.<lang>.md`; `chain` runs from the top-level page down. */
export function pageFilePath(
  root: string,
  spaceKey: string,
  chain: PagePathNode[],
  lang: Locale,
): string {
  return joinRepoPath(root, 'docs', spaceKey, ...chain.map(pageSegment), `index.${lang}.md`);
}

/** YAML front-matter; values are JSON-encoded, which is valid YAML for strings and numbers. */
export function frontMatter(fields: Record<string, string | number | null>): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}

const oneLine = (s: string, max: number) => {
  const v = s.replace(/\s+/g, ' ').trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
};

export function processCommitMessage(p: {
  code: string;
  name: string;
  version: number;
  changeNote: string;
}): string {
  return oneLine(`Update ${p.code} ${p.name} — v${p.version}: ${p.changeNote}`, 200);
}

export function pageCommitMessage(p: {
  spaceKey: string;
  title: string;
  version: number;
  changeNote: string;
}): string {
  return oneLine(`Update page ${p.spaceKey} / ${p.title} — v${p.version}: ${p.changeNote}`, 200);
}

export function removalCommitMessage(p: { kind: 'process' | 'page'; title: string }): string {
  return oneLine(`Remove ${p.kind} ${p.title}`, 200);
}
