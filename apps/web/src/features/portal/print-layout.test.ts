import { describe, expect, it } from 'vitest';
import { cropSvg, diagramParts, pageCss, paperOf, printableArea, svgViewBox } from './print-layout';

describe('print layout', () => {
  it('knows the printable area of A4 and A3 landscape', () => {
    expect(paperOf('a3')).toBe('a3');
    expect(paperOf('letter')).toBe('a4');
    const a4 = printableArea('a4');
    const a3 = printableArea('a3');
    expect(a4.width).toBeGreaterThan(1000);
    expect(a3.width).toBeGreaterThan(a4.width * 1.4);
    expect(a3.height).toBeGreaterThan(a4.height);
  });

  it('keeps a diagram that is readable at page width on one part', () => {
    expect(diagramParts(1500, 1047)).toEqual([{ x: 0, width: 1500 }]);
  });

  it('splits a wide diagram into overlapping page-wide parts', () => {
    const parts = diagramParts(3600, 1047);
    expect(parts).toHaveLength(2);
    expect(parts[0].x).toBe(0);
    expect(parts[1].x).toBeLessThan(parts[0].x + parts[0].width);
    expect(parts[1].x + parts[1].width).toBe(3600);
    // Each part is shown at least at 55 %.
    for (const p of parts) expect(1047 / p.width).toBeGreaterThanOrEqual(0.55);
  });

  it('crops the SVG viewBox to a part', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="3600" height="900" viewBox="-10 20 3600 900"><g/></svg>';
    const box = svgViewBox(svg)!;
    expect(box).toEqual({ x: -10, y: 20, width: 3600, height: 900 });
    const part = cropSvg(svg, box, { x: 1780, width: 1820 });
    expect(part).toContain('viewBox="1770 20 1820 900"');
    expect(part).toContain('width="1820"');
    expect(part).toContain('<g/>');
  });

  it('writes the page size and localised page numbers', () => {
    const css = pageCss('a3', (p, n) => `صفحة ${p} من ${n}`);
    expect(css).toContain('size: A3 landscape');
    expect(css).toContain('content: "صفحة " counter(page) " من " counter(pages)');
    expect(pageCss('a4', (p, n) => `Page ${p} of "${n}"`)).toContain(
      'content: "Page " counter(page) " of " counter(pages)',
    );
  });
});
