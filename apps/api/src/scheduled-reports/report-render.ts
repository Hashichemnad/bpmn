import ExcelJS from 'exceljs';
import type { Locale } from '@processhub/shared';
import { addSheet } from '../common/excel';
import { esc } from '../exports/html-site';
import type { ReportContent } from './report-builders';

const STATUS_COLOURS: Record<string, string> = {
  'Off target': '#C62828',
  'خارج المستهدف': '#C62828',
  Watch: '#B28704',
  'تحت المراقبة': '#B28704',
  'On target': '#2E7D32',
  'ضمن المستهدف': '#2E7D32',
};

/** Excel workbook of a scheduled report (one sheet, Arabic right to left). */
export async function reportExcel(c: ReportContent, l: Locale): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ProcessHub';
  const ws = addSheet(
    wb,
    c.title.replace(/[\\/*?:[\]]/g, ' '),
    c.columns,
    c.columns.map(() => 22),
    l,
  );
  for (const r of c.rows) ws.addRow(r);
  for (const s of c.sections ?? []) {
    const sheet = addSheet(
      wb,
      s.heading.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31),
      s.columns,
      [6, 50, 30],
      l,
    );
    for (const r of s.rows) sheet.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** HTML of the PDF version (printed by the renderer): branded header, summary, table, sections. */
export function reportHtml(
  c: ReportContent,
  l: Locale,
  brand: { orgName: string; primary: string; logo: string | null; generatedAt: string },
): string {
  const dir = l === 'ar' ? 'rtl' : 'ltr';
  const primary = /^#[0-9a-fA-F]{6}$/.test(brand.primary) ? brand.primary : '#1F4E79';
  const cell = (v: string | number, i: number) => {
    const text = String(v ?? '');
    const colour = i === c.statusColumn ? STATUS_COLOURS[text] : undefined;
    return `<td${colour ? ` style="color:#fff;background:${colour};font-weight:600"` : ''}>${esc(text)}</td>`;
  };
  const table = (cols: string[], rows: (string | number)[][]) =>
    `<table><thead><tr>${cols.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map(cell).join('')}</tr>`)
      .join('')}</tbody></table>`;
  return `<!doctype html><html lang="${l}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(c.title)}</title>
<style>
body{font-family:${l === 'ar' ? "'IBM Plex Sans Arabic'," : ''}Inter,Arial,sans-serif;color:#1f2933;font-size:11px;margin:0}
header{display:flex;align-items:center;gap:12px;border-bottom:3px solid ${primary};padding-bottom:8px;margin-bottom:12px}
header img{height:36px}h1{font-size:18px;margin:0;color:${primary}}h2{font-size:14px;color:${primary};margin:16px 0 6px;page-break-after:avoid}
.muted{color:#5b6571}table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #dfe3e8;padding:4px 6px;text-align:start;vertical-align:top}
th{background:${primary};color:#fff}tr{page-break-inside:avoid}.summary{background:#f0f3f6;padding:8px 10px;border-radius:4px}
section{page-break-before:always}img.diagram{max-width:100%;max-height:150mm;display:block;margin:6px 0}
</style></head><body>
<header>${brand.logo ? `<img src="${esc(brand.logo)}" alt="">` : ''}<div><h1>${esc(c.title)}</h1><div class="muted">${esc(brand.orgName)} · ${esc(brand.generatedAt)}</div></div></header>
<div class="summary">${c.summary.map((s) => `<p>${esc(s)}</p>`).join('')}</div>
${table(c.columns, c.rows)}
${(c.sections ?? [])
  .map(
    (s) =>
      `<section><h2>${esc(s.heading)}</h2>${s.image ? `<img class="diagram" src="data:image/png;base64,${s.image.toString('base64')}" alt="">` : ''}${table(s.columns, s.rows)}</section>`,
  )
  .join('')}
</body></html>`;
}

const MAIL = {
  en: {
    intro: 'Your scheduled report is ready.',
    open: 'Open the report',
    attached: 'The report is attached.',
    linkNote: 'The link works for {days} days after signing in to ProcessHub.',
    unsubscribe: 'Unsubscribe from this report',
    footer: 'You receive this e-mail because of a report subscription in ProcessHub.',
  },
  ar: {
    intro: 'تقريرك المجدول جاهز.',
    open: 'فتح التقرير',
    attached: 'التقرير مرفق بهذه الرسالة.',
    linkNote: 'يعمل الرابط لمدة {days} يوماً بعد تسجيل الدخول إلى بروسس هب.',
    unsubscribe: 'إلغاء الاشتراك في هذا التقرير',
    footer: 'تصلك هذه الرسالة بسبب اشتراك في تقرير على بروسس هب.',
  },
};

/** The report e-mail: summary, secure link (sign-in required), unsubscribe link. */
export function reportEmail(
  c: ReportContent,
  l: Locale,
  name: string,
  link: string,
  unsubscribe: string,
  linkDays: number,
  attached: boolean,
) {
  const m = MAIL[l];
  const dir = l === 'ar' ? 'rtl' : 'ltr';
  const subject = `${c.title} — ${name}`.slice(0, 200);
  const note = m.linkNote.replace('{days}', String(linkDays));
  const html = `<!doctype html><html lang="${l}" dir="${dir}"><body style="margin:0;background:#f1f5f9;font-family:${l === 'ar' ? "'IBM Plex Sans Arabic', Tahoma, " : 'Inter, '}Arial, sans-serif">
<div dir="${dir}" style="max-width:600px;margin:24px auto;background:#fff;border-radius:8px;padding:24px;color:#0f172a;text-align:${dir === 'rtl' ? 'right' : 'left'}">
<h2 style="margin:0 0 4px;font-size:18px">${esc(c.title)}</h2>
<p style="margin:0 0 12px;color:#64748b">${esc(name)}</p>
<p>${esc(m.intro)}</p>
${c.summary.map((s) => `<p style="margin:4px 0;line-height:1.6">${esc(s)}</p>`).join('')}
${attached ? `<p>${esc(m.attached)}</p>` : ''}
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${esc(m.open)}</a></p>
<p style="color:#64748b;font-size:12px">${esc(note)}</p>
<p style="margin:24px 0 0;color:#64748b;font-size:12px">${esc(m.footer)} <a href="${esc(unsubscribe)}" style="color:#64748b">${esc(m.unsubscribe)}</a></p>
</div></body></html>`;
  const text = [
    c.title,
    name,
    '',
    m.intro,
    ...c.summary,
    attached ? m.attached : '',
    '',
    `${m.open}: ${link}`,
    note,
    '',
    `${m.unsubscribe}: ${unsubscribe}`,
  ]
    .filter((x, i, a) => x !== '' || a[i - 1] !== '')
    .join('\n');
  return { subject, html, text };
}
