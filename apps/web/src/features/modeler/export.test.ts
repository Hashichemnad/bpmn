import { describe, expect, it, vi } from 'vitest';
import { exportFileName } from './export';

describe('exportFileName', () => {
  it('builds a safe file name', () => {
    expect(exportFileName('S.01.01', 'Purchase Requisition', 'bpmn')).toBe(
      'S.01.01_Purchase_Requisition.bpmn',
    );
    expect(exportFileName('C.01', 'a/b:c*?', 'svg')).toBe('C.01_abc.svg');
    expect(exportFileName('', '', 'png')).toBe('process.png');
  });
});

describe('embedDiagramFonts', () => {
  it('adds the fonts as @font-face data URLs right after the <svg> tag', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetchMock);
    const { embedDiagramFonts } = await import('./export-fonts');
    const out = await embedDiagramFonts(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10"><g/></svg>',
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(out).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="10"><defs><style>@font-face\{font-family:'Inter'/,
    );
    expect(out).toContain("font-family:'IBM Plex Sans Arabic';font-style:normal;font-weight:600");
    expect(out).toContain('base64,AQID');
    expect(out.endsWith('<g/></svg>')).toBe(true);
    vi.unstubAllGlobals();
  });
});
