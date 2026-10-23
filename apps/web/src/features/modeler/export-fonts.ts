import interRegular from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import interSemiBold from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import plexRegular from '@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2?url';
import plexSemiBold from '@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-600-normal.woff2?url';

/** The self-hosted diagram fonts embedded into SVG/PNG exports (Latin Inter, Arabic Plex). */
const FONTS = [
  { family: 'Inter', weight: 400, url: interRegular },
  { family: 'Inter', weight: 600, url: interSemiBold },
  { family: 'IBM Plex Sans Arabic', weight: 400, url: plexRegular },
  { family: 'IBM Plex Sans Arabic', weight: 600, url: plexSemiBold },
];

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

let css: Promise<string> | null = null;

/** @font-face rules with the fonts as data URLs (loaded once). */
export function embeddedFontCss(): Promise<string> {
  return (css ??= Promise.all(
    FONTS.map(async (f) => {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`Font ${f.url}: ${res.status}`);
      const data = toBase64(await res.arrayBuffer());
      return `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};src:url(data:font/woff2;base64,${data}) format('woff2');}`;
    }),
  )
    .then((rules) => rules.join(''))
    .catch(() => {
      css = null;
      return '';
    }));
}

/**
 * Embeds the diagram fonts into an exported SVG so it (and the PNG rendered from it) shows Inter
 * and IBM Plex Sans Arabic without the fonts being installed. Without the fonts (offline) the
 * SVG is returned unchanged and viewers fall back to their sans-serif font.
 */
export async function embedDiagramFonts(svg: string): Promise<string> {
  const rules = await embeddedFontCss();
  if (!rules) return svg;
  return svg.replace(/<svg\b[^>]*>/, (open) => `${open}<defs><style>${rules}</style></defs>`);
}
