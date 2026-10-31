import { SIPOC_COLUMNS, type Locale, type SipocContent } from '@processhub/shared';
import { DIAGRAM_FONT } from '@/features/modeler/renderer';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Wraps text to lines of at most `max` characters (rough, for the static export). */
function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max && line) {
      lines.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * SIPOC as a standalone SVG (export SVG / PNG, handbook image): five columns with their items in
 * the given language (falling back to the other one), process steps numbered. Columns run right to
 * left in Arabic.
 */
export function sipocSvg(
  content: SipocContent,
  locale: Locale,
  titles: Record<(typeof SIPOC_COLUMNS)[number], string>,
): string {
  const colW = 200;
  const gap = 10;
  const head = 40;
  const lineH = 16;
  const pad = 16;
  const label = (i: { nameEn: string; nameAr: string }) =>
    (locale === 'ar' ? i.nameAr || i.nameEn : i.nameEn || i.nameAr) || '—';
  const cols = locale === 'ar' ? [...SIPOC_COLUMNS].reverse() : [...SIPOC_COLUMNS];
  const blocks = cols.map((col) =>
    content.columns[col].map((item, i) =>
      wrap(`${col === 'steps' ? `${i + 1}. ` : ''}${label(item)}`, 26),
    ),
  );
  const colH = Math.max(
    160,
    ...blocks.map((b) => b.reduce((h, lines) => h + lines.length * lineH + 14, 0) + 8),
  );
  const width = pad * 2 + cols.length * colW + (cols.length - 1) * gap;
  const height = pad * 2 + head + colH;
  const anchor = locale === 'ar' ? 'end' : 'start';
  const parts: string[] = [
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`,
  ];
  cols.forEach((col, c) => {
    const x = pad + c * (colW + gap);
    const steps = col === 'steps';
    parts.push(
      `<rect x="${x}" y="${pad}" width="${colW}" height="${head + colH}" rx="8" fill="#FFFFFF" stroke="#CBD5E1"/>`,
      `<rect x="${x}" y="${pad}" width="${colW}" height="${head}" rx="8" fill="${steps ? '#E8F1FB' : '#F8FAFC'}" stroke="#CBD5E1"/>`,
      `<text x="${x + colW / 2}" y="${pad + 25}" text-anchor="middle" font-weight="600" font-size="13" fill="#1F2933">${esc(titles[col])}</text>`,
    );
    let y = pad + head + 8;
    for (const lines of blocks[c]) {
      const h = lines.length * lineH + 8;
      parts.push(
        `<rect x="${x + 6}" y="${y}" width="${colW - 12}" height="${h}" rx="5" fill="#F1F5F9"/>`,
      );
      lines.forEach((l, i) => {
        const tx = anchor === 'end' ? x + colW - 12 : x + 12;
        parts.push(
          `<text x="${tx}" y="${y + 16 + i * lineH}" text-anchor="${anchor}" font-size="12" fill="#1F2933"${locale === 'ar' ? ' direction="rtl"' : ''}>${esc(l)}</text>`,
        );
      });
      y += h + 6;
    }
  });
  return `<?xml version="1.0" encoding="utf-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(DIAGRAM_FONT)}">${parts.join('')}</svg>`;
}
