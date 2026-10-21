import TurndownService from 'turndown';
import { strikethrough, tables, taskListItems } from '@joplin/turndown-plugin-gfm';

export interface MarkdownContext {
  /** Resolves an embedded process diagram to a label and an optional link target. */
  diagram?: (processId: string) => { label: string; href?: string } | null;
}

function diagramMarkdown(node: HTMLElement, ctx: MarkdownContext): string {
  const id = node.getAttribute('data-process-id') ?? '';
  const info = ctx.diagram?.(id);
  const label = info?.label ?? id;
  return info?.href ? `\n\n📊 [BPMN: ${label}](${info.href})\n\n` : `\n\n📊 BPMN: ${label}\n\n`;
}

const isDiagram = (node: HTMLElement) =>
  node.nodeName === 'DIV' && node.getAttribute('data-type') === 'bpmn-diagram';

function createService(ctx: MarkdownContext): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    // Embedded diagrams are empty elements, which Turndown treats as blank.
    blankReplacement: (_content, node) => {
      const el = node as HTMLElement;
      if (isDiagram(el)) return diagramMarkdown(el, ctx);
      return (node as unknown as { isBlock: boolean }).isBlock ? '\n\n' : '';
    },
  });
  td.use([tables, strikethrough, taskListItems]);
  td.addRule('underline', {
    filter: ['u'],
    replacement: (content) => `<u>${content}</u>`,
  });
  td.addRule('callout', {
    filter: (node) => node.nodeName === 'DIV' && node.getAttribute('data-type') === 'callout',
    replacement: (content, node) => {
      const kind = (node as HTMLElement).getAttribute('data-callout') ?? 'info';
      const body = content
        .trim()
        .split('\n')
        .map((l) => `> ${l}`.trimEnd())
        .join('\n');
      return `\n\n> [!${kind.toUpperCase()}]\n${body}\n\n`;
    },
  });
  td.addRule('bpmnDiagram', {
    filter: (node) => isDiagram(node),
    replacement: (_content, node) => diagramMarkdown(node as HTMLElement, ctx),
  });
  return td;
}

/** Converts sanitised wiki HTML to GitHub-flavoured Markdown. */
export function htmlToMarkdown(html: string, ctx: MarkdownContext = {}): string {
  return createService(ctx).turndown(html).trim() + '\n';
}
