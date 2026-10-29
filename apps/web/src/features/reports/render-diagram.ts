import type { Locale } from '@processhub/shared';
import { createDiagram, importDiagram } from '@/features/modeler/create-diagram';
import { applyLanguage, normaliseDiagram } from '@/features/modeler/diagram';
import { embedDiagramFonts } from '@/features/modeler/export-fonts';
import { svgToPng } from '@/features/modeler/export';
import { translateModule } from '@/features/modeler/translate';

/** Image width (px) by number of diagrams: the handbook request must stay below 10 MB. */
export const diagramWidthFor = (count: number) => (count <= 5 ? 1800 : count <= 15 ? 1300 : 950);

/**
 * Renders BPMN XML to a PNG (base64, no data: prefix) in the report language, off screen, with the
 * same renderer and fonts as the app (the handbook embeds it; the server cannot draw diagrams).
 */
export async function renderDiagramPng(
  xml: string,
  locale: Locale,
  maxWidth: number,
): Promise<string> {
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed',
    insetInlineStart: '-20000px',
    top: '0',
    width: '1600px',
    height: '1000px',
  });
  document.body.append(container);
  const state = { locale };
  const instance = createDiagram('viewer', {
    container,
    additionalModules: [translateModule(state)],
  });
  try {
    await importDiagram(instance, xml);
    normaliseDiagram(instance);
    applyLanguage(instance, locale);
    const svg = await embedDiagramFonts((await instance.saveSVG()).svg);
    const width = Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? maxWidth);
    const scale = Math.min(2, maxWidth / Math.max(1, width));
    const png = await svgToPng(svg, scale);
    const bytes = new Uint8Array(await png.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  } finally {
    instance.destroy();
    container.remove();
  }
}
