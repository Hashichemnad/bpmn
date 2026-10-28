/**
 * Print / PDF layout of a published process (browser print, D-024): paper size, how the diagram
 * is scaled to the page width and, when that would make it too small to read, split into
 * page-wide parts.
 */
export type Paper = 'a4' | 'a3';
export const PAPERS: Paper[] = ['a4', 'a3'];

/** Landscape page sizes and the page margin (millimetres). */
const PAPER_MM: Record<Paper, { width: number; height: number }> = {
  a4: { width: 297, height: 210 },
  a3: { width: 420, height: 297 },
};
export const PAGE_MARGIN_MM = 10;
const PX_PER_MM = 96 / 25.4;

export const paperOf = (value: string | null): Paper => (value === 'a3' ? 'a3' : 'a4');

/** Printable area in CSS pixels (landscape, without margins and the page-number footer). */
export function printableArea(paper: Paper): { width: number; height: number } {
  const p = PAPER_MM[paper];
  return {
    width: Math.floor((p.width - 2 * PAGE_MARGIN_MM) * PX_PER_MM),
    height: Math.floor((p.height - 2 * PAGE_MARGIN_MM - 8) * PX_PER_MM),
  };
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** viewBox of an SVG document (as written by bpmn-js saveSVG). */
export function svgViewBox(svg: string): ViewBox | null {
  const m = /<svg\b[^>]*\bviewBox="([^"]+)"/.exec(svg);
  if (!m) return null;
  const [x, y, width, height] = m[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
    ? { x, y, width, height }
    : null;
}

/**
 * Horizontal parts of a diagram `width` wide so each part, scaled to `pageWidth`, is shown at
 * least at `minScale` (and never enlarged above 100 %). Neighbouring parts overlap by `overlap`
 * so an element on the cut is complete in one of them.
 */
export function diagramParts(
  width: number,
  pageWidth: number,
  minScale = 0.55,
  overlap = 40,
): { x: number; width: number }[] {
  if (width * minScale <= pageWidth) return [{ x: 0, width }];
  const count = Math.ceil((width * minScale) / pageWidth);
  const step = width / count;
  return Array.from({ length: count }, (_, i) => {
    const x = Math.max(0, i * step - (i ? overlap / 2 : 0));
    const end = Math.min(width, (i + 1) * step + (i < count - 1 ? overlap / 2 : 0));
    return { x: Math.round(x), width: Math.round(end - x) };
  });
}

/** The SVG cropped to one horizontal part (same height). */
export function cropSvg(svg: string, box: ViewBox, part: { x: number; width: number }): string {
  return svg.replace(/<svg\b[^>]*>/, (tag) =>
    tag
      .replace(
        /\bviewBox="[^"]*"/,
        `viewBox="${box.x + part.x} ${box.y} ${part.width} ${box.height}"`,
      )
      .replace(/\bwidth="[^"]*"/, `width="${part.width}"`)
      .replace(/\bheight="[^"]*"/, `height="${box.height}"`),
  );
}

/** CSS for the chosen paper: landscape page, margins and the page numbers in the footer. */
export function pageCss(paper: Paper, pageLabel: (page: string, pages: string) => string): string {
  const quote = (s: string) => `"${s.replace(/["\\]/g, '')}"`;
  const parts = pageLabel('%%PAGE%%', '%%PAGES%%').split(/(%%PAGES?%%)/);
  const content = parts
    .filter(Boolean)
    .map((p) =>
      p === '%%PAGE%%' ? 'counter(page)' : p === '%%PAGES%%' ? 'counter(pages)' : quote(p),
    )
    .join(' ');
  return `@page { size: ${paper.toUpperCase()} landscape; margin: ${PAGE_MARGIN_MM}mm ${PAGE_MARGIN_MM}mm 14mm; @bottom-center { content: ${content}; font: 9pt Inter, 'IBM Plex Sans Arabic', sans-serif; color: #64748b; } }`;
}
