import {
  DEFAULT_DIAGRAM_THEME,
  type DiagramTheme,
  type GraphContent,
  type Locale,
} from '@processhub/shared';
import { createDiagram, importDiagram } from '@/features/modeler/create-diagram';
import { applyLanguage, normaliseDiagram } from '@/features/modeler/diagram';
import { embedDiagramFonts } from '@/features/modeler/export-fonts';
import { svgToPng } from '@/features/modeler/export';
import { translateModule } from '@/features/modeler/translate';
import { createGraphDiagram, graphSvg, importGraph } from '@/features/diagrams/kit/graph-diagram';
import { NOTATIONS } from '@/features/diagrams/kit/notations';

/** What the API asks the renderer for (mirrored in apps/renderer and apps/api/src/renderer). */
export interface RenderRequest {
  /** bpmn: BPMN 2.0 XML; graph: JSON content of a value chain, organisation chart or EPC. */
  kind: 'bpmn' | 'graph';
  source: string;
  locale: Locale;
  format: 'svg' | 'png';
  /** Largest PNG width in pixels (the image is never scaled up beyond 2×). */
  maxWidth?: number;
  /** Colours of graph notations (Settings → Branding → diagram theme). */
  theme?: DiagramTheme;
}

export interface RenderResult {
  /** SVG text, or PNG as base64 (no data: prefix). */
  data: string;
  width: number;
  height: number;
}

function offscreen(): HTMLDivElement {
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed',
    insetInlineStart: '0',
    top: '0',
    width: '1600px',
    height: '1000px',
  });
  document.body.append(container);
  return container;
}

async function bpmnSvg(xml: string, locale: Locale): Promise<string> {
  const container = offscreen();
  const instance = createDiagram('viewer', {
    container,
    additionalModules: [translateModule({ locale })],
  });
  try {
    await importDiagram(instance, xml);
    normaliseDiagram(instance);
    applyLanguage(instance, locale);
    return (await instance.saveSVG()).svg;
  } finally {
    instance.destroy();
    container.remove();
  }
}

async function graphContentSvg(json: string, locale: Locale, theme: DiagramTheme): Promise<string> {
  const content = JSON.parse(json) as GraphContent;
  const notation = NOTATIONS[content.type];
  if (!notation) throw new Error(`Unsupported diagram type ${String(content.type)}`);
  const container = offscreen();
  const instance = createGraphDiagram('viewer', container, {
    notation,
    locale,
    theme,
    readOnly: true,
  });
  try {
    await importGraph(instance, content);
    return graphSvg(instance);
  } finally {
    instance.destroy();
    container.remove();
  }
}

const sizeOf = (svg: string) => ({
  width: Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 0),
  height: Number(/<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 0),
});

/** Draws one diagram; SVG with the fonts embedded, or PNG on white. */
export async function renderRequest(req: RenderRequest): Promise<RenderResult> {
  const raw =
    req.kind === 'bpmn'
      ? await bpmnSvg(req.source, req.locale)
      : await graphContentSvg(req.source, req.locale, req.theme ?? DEFAULT_DIAGRAM_THEME);
  const svg = await embedDiagramFonts(raw);
  const { width, height } = sizeOf(svg);
  if (req.format === 'svg') return { data: svg, width, height };
  const maxWidth = req.maxWidth ?? 1800;
  const scale = Math.min(2, maxWidth / Math.max(1, width));
  const png = await svgToPng(svg, scale);
  const bytes = new Uint8Array(await png.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(binary), width: Math.ceil(width * scale), height: Math.ceil(height * scale) };
}
