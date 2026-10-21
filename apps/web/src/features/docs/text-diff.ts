import { diffArrays } from 'diff';

export type BlockKind =
  'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'li' | 'task' | 'quote' | 'code' | 'row' | 'special';

export interface Block {
  kind: BlockKind;
  text: string;
  /** For task items. */
  checked?: boolean;
}

export interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface DiffRow {
  type: 'equal' | 'added' | 'removed' | 'changed';
  left?: Block;
  right?: Block;
  /** Word-level parts for changed rows (both sides, and merged for the inline view). */
  leftParts?: DiffPart[];
  rightParts?: DiffPart[];
  inlineParts?: DiffPart[];
}

const LEAF: Record<string, BlockKind> = {
  P: 'p',
  H1: 'h1',
  H2: 'h2',
  H3: 'h3',
  H4: 'h4',
  PRE: 'code',
};

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Flattens wiki HTML into comparable text blocks (one per paragraph, heading, list item, row…). */
export function htmlToBlocks(
  html: string,
  labels: { diagram: string; image: string } = { diagram: 'BPMN', image: 'Image' },
): Block[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks: Block[] = [];
  const walk = (
    node: Element,
    ctx: { list?: 'li' | 'task'; checked?: boolean; quote?: boolean },
  ) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName;
      const type = child.getAttribute('data-type');
      if (type === 'bpmn-diagram') {
        blocks.push({
          kind: 'special',
          text: `[${labels.diagram}: ${child.getAttribute('data-process-id') ?? ''}]`,
        });
      } else if (tag === 'IMG') {
        blocks.push({
          kind: 'special',
          text: `[${labels.image}: ${child.getAttribute('alt') || child.getAttribute('src') || ''}]`,
        });
      } else if (tag === 'HR') {
        blocks.push({ kind: 'special', text: '———' });
      } else if (tag === 'TR') {
        const cells = Array.from(child.children).map((c) => clean(c.textContent ?? ''));
        blocks.push({ kind: 'row', text: cells.join(' | ') });
      } else if (LEAF[tag]) {
        const kind: BlockKind = ctx.list ?? (ctx.quote && tag === 'P' ? 'quote' : LEAF[tag]);
        const text = tag === 'PRE' ? (child.textContent ?? '') : clean(child.textContent ?? '');
        if (text || kind !== 'p')
          blocks.push({ kind, text, ...(ctx.list === 'task' ? { checked: ctx.checked } : {}) });
        if (child.querySelector('img')) walk(child, ctx);
      } else if (tag === 'LI') {
        const task = child.getAttribute('data-type') === 'taskItem';
        walk(child, {
          ...ctx,
          list: task ? 'task' : 'li',
          checked: task ? child.getAttribute('data-checked') === 'true' : undefined,
        });
      } else if (tag === 'BLOCKQUOTE' || type === 'callout') {
        walk(child, { ...ctx, quote: true });
      } else if (tag === 'LABEL' || tag === 'INPUT') {
        continue;
      } else {
        walk(child, ctx);
      }
    }
  };
  walk(doc.body, {});
  return blocks;
}

const sameBlock = (a: Block, b: Block) =>
  a.kind === b.kind && a.text === b.text && a.checked === b.checked;

/** Word tokens that work for every script (Arabic included): runs of non-space and of space. */
const tokens = (s: string) => s.match(/\s+|[^\s]+/gu) ?? [];

export function diffWords(
  a: string,
  b: string,
): { left: DiffPart[]; right: DiffPart[]; inline: DiffPart[] } {
  const left: DiffPart[] = [];
  const right: DiffPart[] = [];
  const inline: DiffPart[] = [];
  for (const c of diffArrays(tokens(a), tokens(b))) {
    const value = c.value.join('');
    if (c.added) {
      right.push({ value, added: true });
      inline.push({ value, added: true });
    } else if (c.removed) {
      left.push({ value, removed: true });
      inline.push({ value, removed: true });
    } else {
      left.push({ value });
      right.push({ value });
      inline.push({ value });
    }
  }
  return { left, right, inline };
}

/**
 * Block-level diff; runs of removed + added blocks are paired up as "changed" rows with
 * a word-level diff, which gives the side-by-side view aligned rows.
 */
export function diffBlocks(a: Block[], b: Block[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const changes = diffArrays(a, b, { comparator: sameBlock });
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (!c.added && !c.removed) {
      for (const blk of c.value) rows.push({ type: 'equal', left: blk, right: blk });
      continue;
    }
    const next = changes[i + 1];
    if (c.removed && next?.added) {
      const removed = c.value;
      const added = next.value;
      const n = Math.max(removed.length, added.length);
      for (let j = 0; j < n; j++) {
        const l = removed[j];
        const r = added[j];
        if (l && r) {
          const { left, right, inline } = diffWords(l.text, r.text);
          rows.push({
            type: 'changed',
            left: l,
            right: r,
            leftParts: left,
            rightParts: right,
            inlineParts: inline,
          });
        } else if (l) rows.push({ type: 'removed', left: l });
        else rows.push({ type: 'added', right: r });
      }
      i++;
      continue;
    }
    for (const blk of c.value)
      rows.push(c.added ? { type: 'added', right: blk } : { type: 'removed', left: blk });
  }
  return rows;
}

export function diffStats(rows: DiffRow[]) {
  return {
    added: rows.filter((r) => r.type === 'added').length,
    removed: rows.filter((r) => r.type === 'removed').length,
    changed: rows.filter((r) => r.type === 'changed').length,
  };
}
