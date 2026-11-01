import { createHash } from 'node:crypto';
import type { Locale } from '@processhub/shared';
import type { ReportStep } from '../reports/report-steps';
import { reportTexts, minutesText } from '../reports/report-i18n';

/**
 * Static offline website of an HTML export (Phase 4.4, D-177): pure function from collected data to
 * files. Every page is self-contained (CSS and the small language / search script inline), carries a
 * Content-Security-Policy that forbids any network request, and shows both languages (switch at the
 * top, Arabic right to left). All texts are escaped; wiki HTML arrives sanitised; diagrams are
 * embedded as `data:` images (an <img> never runs scripts).
 */

export interface SiteBranding {
  orgNameEn: string;
  orgNameAr: string;
  /** data: URI of the logo, or null. */
  logo: string | null;
  primary: string;
  accent: string;
}

export interface SiteProcess {
  id: string;
  code: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  category: string;
  facts: { labelEn: string; labelAr: string; valueEn: string; valueAr: string }[];
  /** data: URIs of the diagram per language (null when the renderer is off). */
  diagram: { en: string | null; ar: string | null };
  steps: { en: ReportStep[]; ar: ReportStep[] };
  documents: { code: string | null; nameEn: string; nameAr: string }[];
  pages: { id: string; titleEn: string; titleAr: string }[];
}

export interface SitePage {
  id: string;
  parentId: string | null;
  titleEn: string;
  titleAr: string;
  /** Sanitised HTML of each language. */
  htmlEn: string;
  htmlAr: string;
  textEn: string;
  textAr: string;
}

export interface SiteInput {
  titleEn: string;
  titleAr: string;
  branding: SiteBranding;
  generatedAt: Date;
  generatedByEn: string;
  generatedByAr: string;
  /** Workspace drafts: every page carries a "Draft" watermark. */
  draft: boolean;
  /** Value chain picture on the start page. */
  overview: { en: string | null; ar: string | null } | null;
  processes: SiteProcess[];
  pages: SitePage[];
}

const UI = {
  en: {
    home: 'Home',
    processes: 'Processes',
    pages: 'Documentation',
    search: 'Search',
    searchPlaceholder: 'Search processes and pages…',
    noResults: 'No results.',
    language: 'العربية',
    generated: 'Exported on {date} by {user}',
    offline: 'Offline copy — the current version is in ProcessHub.',
    draft: 'DRAFT — not approved',
    noImage: 'Diagram image not available.',
    linkedPages: 'Procedures and documentation',
    back: 'Back to the overview',
    noSteps: 'No steps.',
  },
  ar: {
    home: 'الرئيسية',
    processes: 'العمليات',
    pages: 'التوثيق',
    search: 'بحث',
    searchPlaceholder: 'ابحث في العمليات والصفحات…',
    noResults: 'لا توجد نتائج.',
    language: 'English',
    generated: 'صُدّرت في {date} بواسطة {user}',
    offline: 'نسخة غير متصلة — الإصدار الحالي في ProcessHub.',
    draft: 'مسودة — غير معتمدة',
    noImage: 'صورة المخطط غير متاحة.',
    linkedPages: 'الإجراءات والتوثيق',
    back: 'العودة إلى النظرة العامة',
    noSteps: 'لا توجد خطوات.',
  },
};

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const safeColour = (c: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback);

/** Text in both languages: one span per language, the CSS shows the active one. */
const both = (en: string, ar: string, tag = 'span') =>
  `<${tag} lang="en">${esc(en || ar)}</${tag}><${tag} lang="ar" dir="rtl">${esc(ar || en)}</${tag}>`;

const fmtDate = (d: Date, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium' }).format(d);

export const processFile = (p: { id: string }) => `processes/${p.id}.html`;
export const pageFile = (p: { id: string }) => `pages/${p.id}.html`;

function css(b: SiteBranding) {
  const primary = safeColour(b.primary, '#1F4E79');
  const accent = safeColour(b.accent, '#B28704');
  return `
:root{--p:${primary};--a:${accent};--muted:#5b6571;--line:#dfe3e8}
*{box-sizing:border-box}body{margin:0;font-family:Inter,'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif;color:#1f2933;background:#f6f8fa;line-height:1.5}
html[data-lang=en] [lang=ar]{display:none}html[data-lang=ar] [lang=en]{display:none}
header{background:var(--p);color:#fff;padding:12px 24px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header img{height:40px;background:#fff;border-radius:4px;padding:2px}header .org{font-weight:600;font-size:18px;flex:1}
header a{color:#fff}button.lang{background:#fff;color:var(--p);border:0;border-radius:4px;padding:6px 12px;cursor:pointer;font:inherit}
main{max-width:1200px;margin:0 auto;padding:24px}
.card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:16px 20px;margin-bottom:16px}
h1{font-size:24px;margin:0 0 8px}h2{font-size:18px;margin:0 0 12px;color:var(--p)}
.muted{color:var(--muted);font-size:13px}.code{direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums;color:var(--muted)}
ul.tree{list-style:none;padding-inline-start:18px;margin:4px 0}ul.tree>li{margin:4px 0}ul.tree a{text-decoration:none;color:var(--p)}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid var(--line);padding:6px 8px;text-align:start;vertical-align:top}th{background:#f0f3f6}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}dt{color:var(--muted)}dd{margin:0}
.diagram{overflow:auto;border:1px solid var(--line);border-radius:6px;background:#fff;padding:8px}.diagram img{max-width:100%;height:auto;display:block}
.tag{display:inline-block;background:#eef2f6;border-radius:4px;padding:1px 8px;margin:2px;font-size:13px}
input.search{width:100%;padding:8px 12px;font:inherit;border:1px solid var(--line);border-radius:6px}
#results a{display:block;padding:6px 0;color:var(--p)}
.draft{position:fixed;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;font-size:96px;font-weight:700;color:rgba(200,30,30,.12);transform:rotate(-24deg);z-index:9}
.rich img{max-width:100%}.rich table{margin:8px 0}footer{max-width:1200px;margin:0 auto;padding:0 24px 32px}
@media print{header button,input.search{display:none}body{background:#fff}.card{border:0}}
`;
}

const SCRIPT = `
(function(){var k='ph.export.lang';var l='en';try{l=localStorage.getItem(k)||document.documentElement.getAttribute('data-lang')||'en'}catch(e){}
function set(v){l=v;document.documentElement.setAttribute('data-lang',v);document.documentElement.setAttribute('lang',v);document.documentElement.setAttribute('dir',v==='ar'?'rtl':'ltr');try{localStorage.setItem(k,v)}catch(e){}}
set(l);document.addEventListener('DOMContentLoaded',function(){var b=document.querySelector('button.lang');if(b)b.addEventListener('click',function(){set(l==='ar'?'en':'ar')});
var s=document.querySelector('input.search');var r=document.getElementById('results');var idx=[];try{var d=document.getElementById('ph-index');if(d)idx=JSON.parse(d.textContent||'[]')}catch(e){}
if(s&&r){s.addEventListener('input',function(){var q=s.value.trim().toLowerCase();r.textContent='';if(!q)return;var n=0;
for(var i=0;i<idx.length&&n<50;i++){var e=idx[i];if((e.t+' '+e.x).toLowerCase().indexOf(q)>=0){var a=document.createElement('a');a.href=e.u;a.textContent=(e.c?e.c+' ':'')+(l==='ar'?(e.ta||e.te):(e.te||e.ta));r.appendChild(a);n++}}
if(!n){var p=document.createElement('p');p.className='muted';p.textContent=r.getAttribute('data-none-'+l);r.appendChild(p)}})}})})();
`;

/**
 * Only the one static script above may run (its SHA-256 hash, final session part B, SEC-44): even
 * if sanitised wiki HTML ever let a script through, the browser would not execute it. The search
 * index travels as a JSON data block, which is not executed.
 */
const CSP = `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-${createHash('sha256').update(SCRIPT, 'utf8').digest('base64')}'; font-src data:; base-uri 'none'; form-action 'none'`;

function shell(
  site: SiteInput,
  title: { en: string; ar: string },
  body: string,
  depth: number,
  extraHead = '',
) {
  const root = depth ? '../'.repeat(depth) : '';
  const b = site.branding;
  return `<!doctype html>
<html lang="en" dir="ltr" data-lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<title>${esc(title.en)} · ${esc(title.ar)}</title>
<style>${css(b)}</style>
${extraHead}
<script>${SCRIPT}</script>
</head>
<body>
${site.draft ? `<div class="draft" aria-hidden="true">${both(UI.en.draft, UI.ar.draft)}</div>` : ''}
<header>
${b.logo ? `<img src="${esc(b.logo)}" alt="">` : ''}
<div class="org">${both(b.orgNameEn || 'ProcessHub', b.orgNameAr || b.orgNameEn || 'ProcessHub')}</div>
<a href="${root}index.html">${both(UI.en.home, UI.ar.home)}</a>
<button class="lang" type="button">${both(UI.en.language, UI.ar.language)}</button>
</header>
<main>
${site.draft ? `<p class="card" style="border-color:#c62828;color:#c62828"><strong>${both(UI.en.draft, UI.ar.draft)}</strong></p>` : ''}
${body}
</main>
<footer class="muted">
${both(
  UI.en.generated
    .replace('{date}', fmtDate(site.generatedAt, 'en'))
    .replace('{user}', site.generatedByEn),
  UI.ar.generated
    .replace('{date}', fmtDate(site.generatedAt, 'ar'))
    .replace('{user}', site.generatedByAr || site.generatedByEn),
)} · ${both(UI.en.offline, UI.ar.offline)}
</footer>
</body>
</html>
`;
}

function tree<T extends { id: string; parentId: string | null }>(
  items: T[],
  label: (t: T) => string,
  href: (t: T) => string,
): string {
  const ids = new Set(items.map((i) => i.id));
  const children = new Map<string | null, T[]>();
  for (const i of items) {
    const parent = i.parentId && ids.has(i.parentId) ? i.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), i]);
  }
  const render = (parent: string | null): string => {
    const list = children.get(parent) ?? [];
    if (!list.length) return '';
    return `<ul class="tree">${list
      .map((i) => `<li><a href="${esc(href(i))}">${label(i)}</a>${render(i.id)}</li>`)
      .join('')}</ul>`;
  };
  return render(null);
}

function image(uri: string | null, alt: string, missing: string) {
  return uri ? `<img src="${esc(uri)}" alt="${esc(alt)}">` : `<p class="muted">${esc(missing)}</p>`;
}

function stepTable(steps: ReportStep[], l: Locale): string {
  const t = reportTexts(l);
  if (!steps.length) return `<p class="muted">${esc(UI[l].noSteps)}</p>`;
  const attrs = (s: ReportStep) => {
    const a = s.attributes;
    return [
      typeof a.durationMinutes === 'number'
        ? `${t.processing}: ${minutesText(l, a.durationMinutes)}`
        : '',
      typeof a.waitingMinutes === 'number'
        ? `${t.waiting}: ${minutesText(l, a.waitingMinutes)}`
        : '',
      typeof a.slaMinutes === 'number' ? `${t.sla}: ${minutesText(l, a.slaMinutes)}` : '',
    ]
      .filter(Boolean)
      .map((x) => `<span class="tag">${esc(x)}</span>`)
      .join('');
  };
  return `<table dir="${l === 'ar' ? 'rtl' : 'ltr'}"><thead><tr><th>#</th><th>${esc(t.step)}</th><th>${esc(t.role)}</th><th>${esc(t.system)}</th><th>${esc(t.documents)}</th><th>${esc(t.attributes)}</th></tr></thead><tbody>${steps
    .map(
      (s, i) =>
        `<tr><td>${i + 1}</td><td><strong>${esc(s.name)}</strong>${s.description ? `<div class="muted">${esc(s.description)}</div>` : ''}</td><td>${esc(s.roles.join(', '))}</td><td>${esc(s.systems.join(', '))}</td><td>${esc(s.documents.join(', '))}</td><td>${attrs(s)}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function processPage(site: SiteInput, p: SiteProcess): string {
  const te = reportTexts('en');
  const ta = reportTexts('ar');
  const facts = p.facts
    .map((f) => `<dt>${both(f.labelEn, f.labelAr)}</dt><dd>${both(f.valueEn, f.valueAr)}</dd>`)
    .join('');
  const body = `
<p><a href="../index.html">${both(UI.en.back, UI.ar.back)}</a></p>
<div class="card"><h1><span class="code">${esc(p.code)}</span> ${both(p.nameEn, p.nameAr)}</h1>
${p.descriptionEn || p.descriptionAr ? `<p>${both(p.descriptionEn, p.descriptionAr)}</p>` : ''}
<dl>${facts}</dl></div>
<div class="card"><h2>${both(te.diagram, ta.diagram)}</h2>
<div class="diagram" lang="en">${image(p.diagram.en, p.nameEn, UI.en.noImage)}</div>
<div class="diagram" lang="ar" dir="rtl">${image(p.diagram.ar, p.nameAr, UI.ar.noImage)}</div></div>
<div class="card"><h2>${both(te.steps, ta.steps)}</h2>
<div lang="en">${stepTable(p.steps.en, 'en')}</div><div lang="ar" dir="rtl">${stepTable(p.steps.ar, 'ar')}</div></div>
<div class="card"><h2>${both(te.documents, ta.documents)}</h2>
${
  p.documents.length
    ? `<ul>${p.documents.map((d) => `<li>${d.code ? `<span class="code">${esc(d.code)}</span> ` : ''}${both(d.nameEn, d.nameAr)}</li>`).join('')}</ul>`
    : `<p class="muted">${both(te.noDocuments, ta.noDocuments)}</p>`
}
${
  p.pages.length
    ? `<h2>${both(UI.en.linkedPages, UI.ar.linkedPages)}</h2><ul>${p.pages
        .map((pg) => `<li><a href="../${pageFile(pg)}">${both(pg.titleEn, pg.titleAr)}</a></li>`)
        .join('')}</ul>`
    : ''
}</div>`;
  return shell(site, { en: `${p.code} ${p.nameEn}`, ar: `${p.code} ${p.nameAr}` }, body, 1);
}

function wikiPage(site: SiteInput, p: SitePage): string {
  const body = `
<p><a href="../index.html">${both(UI.en.back, UI.ar.back)}</a></p>
<div class="card"><h1>${both(p.titleEn, p.titleAr)}</h1>
<div class="rich" lang="en">${p.htmlEn || esc(p.textEn)}</div>
<div class="rich" lang="ar" dir="rtl">${p.htmlAr || p.htmlEn || esc(p.textAr)}</div></div>`;
  return shell(site, { en: p.titleEn, ar: p.titleAr }, body, 1);
}

/** JSON for an inline <script>: no `</script>` or HTML comment can end it early. */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function indexPage(site: SiteInput): string {
  const index = [
    ...site.processes.map((p) => ({
      u: processFile(p),
      c: p.code,
      te: p.nameEn,
      ta: p.nameAr,
      t: `${p.code} ${p.nameEn} ${p.nameAr}`,
      x: [...p.steps.en, ...p.steps.ar]
        .map((s) => s.name)
        .join(' ')
        .slice(0, 4000),
    })),
    ...site.pages.map((p) => ({
      u: pageFile(p),
      c: '',
      te: p.titleEn,
      ta: p.titleAr,
      t: `${p.titleEn} ${p.titleAr}`,
      x: `${p.textEn} ${p.textAr}`.slice(0, 4000),
    })),
  ];
  const body = `
<div class="card"><h1>${both(site.titleEn, site.titleAr)}</h1>
<input class="search" type="search" aria-label="${esc(UI.en.search)}" placeholder="${esc(UI.en.searchPlaceholder)} / ${esc(UI.ar.searchPlaceholder)}">
<div id="results" data-none-en="${esc(UI.en.noResults)}" data-none-ar="${esc(UI.ar.noResults)}"></div></div>
${
  site.overview
    ? `<div class="card"><div class="diagram" lang="en">${image(site.overview.en, site.titleEn, UI.en.noImage)}</div><div class="diagram" lang="ar" dir="rtl">${image(site.overview.ar, site.titleAr, UI.ar.noImage)}</div></div>`
    : ''
}
${
  site.processes.length
    ? `<div class="card"><h2>${both(UI.en.processes, UI.ar.processes)}</h2>${tree(
        site.processes,
        (p) => `<span class="code">${esc(p.code)}</span> ${both(p.nameEn, p.nameAr)}`,
        processFile,
      )}</div>`
    : ''
}
${
  site.pages.length
    ? `<div class="card"><h2>${both(UI.en.pages, UI.ar.pages)}</h2>${tree(site.pages, (p) => both(p.titleEn, p.titleAr), pageFile)}</div>`
    : ''
}`;
  return shell(
    site,
    { en: site.titleEn, ar: site.titleAr },
    body,
    0,
    `<script type="application/json" id="ph-index">${inlineJson(index)}</script>`,
  );
}

/** All files of the site (paths relative to the ZIP root). */
export function buildSite(site: SiteInput): Map<string, string> {
  const files = new Map<string, string>();
  files.set('index.html', indexPage(site));
  for (const p of site.processes) files.set(processFile(p), processPage(site, p));
  for (const p of site.pages) files.set(pageFile(p), wikiPage(site, p));
  files.set(
    'README.txt',
    `${site.titleEn}\n${site.titleAr}\n\nOpen index.html in a web browser. This offline copy needs no network.\n` +
      `افتح الملف index.html في متصفح الويب. لا تحتاج هذه النسخة إلى اتصال بالشبكة.\n`,
  );
  return files;
}
