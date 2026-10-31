import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { Injectable } from '@nestjs/common';
import mammoth from 'mammoth';
import { marked } from 'marked';
import {
  PERMISSIONS,
  attachmentUrl,
  type ImportIssue,
  type ImportKind,
  type ImportOptions,
} from '@processhub/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { detectAttachmentType, safeFileName } from '../../docs/attachment-type';
import { preparePageContent } from '../../docs/pages.service';
import type {
  ApplyContext,
  Importer,
  LoadedImportFile,
  ParseContext,
  ParsedItem,
  StepRecord,
} from '../importer';
import {
  ImportFileError,
  checkOfficePackage,
  decodeText,
  extensionOf,
  openSafeZip,
  type SafeZip,
} from '../safe-upload';
import { sourceDocs } from './bpmn.importer';
import {
  ASSET,
  PAGE,
  brokenLinksIssue,
  fragment,
  languageOf,
  markRtl,
  processSuggestions,
  splitByHeading1,
  takeTitle,
  templateGaps,
  textToHtml,
  type AssetRef,
  type PagePayload,
  type ProcessCandidate,
} from './doc-tools';
import { extractPdfText } from './pdf-text';
import { baseName } from './process-target';
import { issue } from './tabular';

const WORD_STYLES = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Titre'] => h1:fresh",
];

interface DraftPage {
  ref: string;
  source: string;
  payload: PagePayload;
  issues: ImportIssue[];
  facts: Record<string, string | number>;
  /** Depth in the imported hierarchy (parents first). */
  depth: number;
}

const factsOf = (html: string) => {
  const root = fragment(html);
  const text = (root.textContent ?? '').trim();
  return {
    words: text ? text.split(/\s+/).length : 0,
    images: root.querySelectorAll('img').length,
    tables: root.querySelectorAll('table').length,
    links: root.querySelectorAll('a[href]').length,
  };
};

/**
 * Documents into the wiki (M15 step 4, D-161): Word (.docx via mammoth), PDF (text via pdf.js in a
 * worker, original attached, scanned files flagged), a Confluence space HTML export and Markdown
 * folders (hierarchy, attachments, internal links rewritten, broken links reported). Every page is
 * a Draft in the chosen space; process codes / names found become link suggestions.
 */
@Injectable()
export class DocumentsImporter implements Importer {
  readonly kinds: ImportKind[] = ['WORD', 'PDF', 'CONFLUENCE', 'MARKDOWN'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ---------- Parse ----------

  async parse(ctx: ParseContext) {
    if (!ctx.options.spaceId) throw new ImportFileError('SPACE_REQUIRED');
    let drafts: DraftPage[];
    switch (ctx.kind) {
      case 'WORD':
        drafts = await this.parseWord(ctx);
        break;
      case 'PDF':
        drafts = await this.parsePdf(ctx);
        break;
      case 'CONFLUENCE':
        drafts = await this.parseConfluence(ctx);
        break;
      default:
        drafts = await this.parseMarkdown(ctx);
    }
    if (!drafts.length) throw new ImportFileError('NO_DOCUMENTS_FOUND');
    const template =
      ctx.options.pageTemplate && ctx.options.pageTemplate !== 'NONE'
        ? await this.prisma.pageTemplate.findFirst({
            where: { key: ctx.options.pageTemplate, deletedAt: null },
          })
        : null;
    const processes: ProcessCandidate[] =
      ctx.options.linkProcesses === false
        ? []
        : await this.prisma.process.findMany({
            where: { deletedAt: null },
            select: { id: true, code: true, nameEn: true, nameAr: true },
          });
    const prev = await ctx.previous(
      'PAGE',
      drafts.map((d) => d.payload.externalKey),
    );
    const matched = await this.prisma.page.findMany({
      where: { id: { in: [...prev.values()] }, deletedAt: null },
      select: { id: true, status: true, spaceId: true },
    });
    const items: ParsedItem[] = [];
    for (const d of drafts) {
      const p = d.payload;
      const issues = [...d.issues];
      if (template && !d.payload.needsManualWork) {
        const gaps = templateGaps(
          p.html,
          p.lang === 'ar' ? template.contentAr : template.contentEn,
        );
        if (gaps.length) {
          p.html += gaps.map((g) => `<h2>${g}</h2><p></p>`).join('');
          issues.push(
            issue('WARNING', 'TEMPLATE_SECTIONS_ADDED', { list: gaps.slice(0, 6).join(', ') }),
          );
        }
      }
      const matchId = prev.get(p.externalKey) ?? null;
      // Process Owners update only pages of the (editable) target space (D-164).
      const manager = ctx.actor.permissions.has(PERMISSIONS.IMPORT_MANAGE);
      const match = matched.find(
        (m) => m.id === matchId && (manager || m.spaceId === ctx.options.spaceId),
      );
      let action: ParsedItem['action'] = match ? 'UPDATE' : 'CREATE';
      if (match) {
        if (ctx.options.updateExisting === false) action = 'SKIP';
        else if (match.status !== 'DRAFT') {
          action = 'SKIP';
          issues.push(issue('WARNING', 'NOT_DRAFT_SKIPPED', { status: match.status }));
        } else if (match.spaceId !== ctx.options.spaceId)
          issues.push(issue('WARNING', 'PAGE_IN_OTHER_SPACE'));
      }
      const text = fragment(p.html).textContent ?? '';
      items.push({
        ref: d.ref,
        entity: 'PAGE',
        key: p.title.slice(0, 120),
        nameEn: p.lang === 'en' ? p.title : '',
        nameAr: p.lang === 'ar' ? p.title : '',
        action,
        matchId: match?.id ?? null,
        matchBy: match ? 'FILE_NAME' : null,
        source: d.source,
        issues,
        changes: [],
        suggestions: processSuggestions(processes, { file: d.source, title: p.title, text }),
        skip: false,
        facts: { ...d.facts, language: p.lang.toUpperCase() },
        order: d.depth,
        data: p,
      });
    }
    return { items };
  }

  private async convertDocx(data: Buffer, file: string, fileId: string) {
    await checkOfficePackage(data, file, 'word/document.xml');
    let index = 0;
    const assets: AssetRef[] = [];
    const res = await mammoth.convertToHtml(
      { buffer: data },
      {
        styleMap: WORD_STYLES,
        convertImage: mammoth.images.imgElement(async (image) => {
          const key = `${fileId}-img${index}`;
          const ext = (image.contentType.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
          assets.push({
            key,
            name: `image-${index + 1}.${ext}`,
            source: { kind: 'docx', fileId, index },
          });
          index++;
          return { src: `${ASSET}${key}` };
        }),
      },
    );
    return {
      html: res.value,
      assets,
      warnings: res.messages.filter((m) => m.type === 'warning').length,
    };
  }

  private async parseWord(ctx: ParseContext): Promise<DraftPage[]> {
    const out: DraftPage[] = [];
    const docs = await sourceDocs(ctx.files, ['docx', 'docm']);
    for (const [n, d] of docs.entries()) {
      await ctx.progress(n / docs.length, d.path);
      const fileKey = baseName(d.path);
      const ref = `file:${d.source}`;
      try {
        if (extensionOf(d.path) === 'docm')
          throw new ImportFileError('MACRO_NOT_ALLOWED', { file: d.path });
        const fileId = ctx.files.find((f) => d.source.startsWith(f.fileName))!.id;
        const conv = await this.convertDocx(await d.read(), d.path, fileId);
        const root = fragment(conv.html);
        markRtl(root);
        const issues: ImportIssue[] = conv.warnings
          ? [issue('WARNING', 'WORD_UNSUPPORTED_CONTENT', { count: conv.warnings })]
          : [];
        const { title, html } = takeTitle(root.innerHTML, fileKey);
        const lang = languageOf(fragment(html).textContent || title);
        const assetsIn = (h: string) => conv.assets.filter((a) => h.includes(`${ASSET}${a.key}`));
        if (!ctx.options.splitByHeading) {
          out.push({
            ref,
            source: d.source,
            payload: {
              externalKey: `word:${fileKey}`,
              lang,
              title,
              html,
              parentRef: null,
              assets: conv.assets,
            },
            issues,
            facts: factsOf(html),
            depth: 0,
          });
          continue;
        }
        const parts = splitByHeading1(html, title);
        const intro = parts[0]?.title === title ? parts.shift()! : { title, html: '' };
        out.push({
          ref,
          source: d.source,
          payload: {
            externalKey: `word:${fileKey}`,
            lang,
            title,
            html: intro.html,
            parentRef: null,
            assets: assetsIn(intro.html),
          },
          issues,
          facts: { ...factsOf(intro.html), pages: parts.length + 1 },
          depth: 0,
        });
        parts.forEach((p, i) =>
          out.push({
            ref: `${ref}#${i + 1}`,
            source: `${d.source} › ${p.title}`,
            payload: {
              externalKey: `word:${fileKey}#${i + 1}`,
              lang: languageOf(fragment(p.html).textContent || p.title),
              title: p.title,
              html: p.html,
              parentRef: ref,
              assets: assetsIn(p.html),
            },
            issues: [],
            facts: factsOf(p.html),
            depth: 1,
          }),
        );
      } catch (e) {
        if (!(e instanceof ImportFileError)) throw e;
        out.push(this.failed(ref, d.source, fileKey, e));
      }
    }
    return out;
  }

  private failed(ref: string, source: string, title: string, e: ImportFileError): DraftPage {
    return {
      ref,
      source,
      payload: { externalKey: '', lang: 'en', title, html: '', parentRef: null, assets: [] },
      issues: [issue('ERROR', e.code, e.params)],
      facts: {},
      depth: 0,
    };
  }

  private async parsePdf(ctx: ParseContext): Promise<DraftPage[]> {
    const out: DraftPage[] = [];
    const docs = await sourceDocs(ctx.files, ['pdf']);
    for (const [n, d] of docs.entries()) {
      await ctx.progress(n / docs.length, d.path);
      const fileKey = baseName(d.path);
      const ref = `file:${d.source}`;
      const file = ctx.files.find((f) => d.source.startsWith(f.fileName))!;
      const data = await d.read();
      if (data.toString('ascii', 0, 5) !== '%PDF-') {
        out.push(
          this.failed(
            ref,
            d.source,
            fileKey,
            new ImportFileError('FILE_TYPE_MISMATCH', { file: d.path }),
          ),
        );
        continue;
      }
      const pages = await extractPdfText(data);
      const original: AssetRef = {
        key: `${file.id}-original-${n}`,
        name: posix.basename(d.path),
        source:
          file.ext === 'zip'
            ? { kind: 'zip', fileId: file.id, path: d.path }
            : { kind: 'file', fileId: file.id },
      };
      if (!pages) {
        out.push(
          this.failed(
            ref,
            d.source,
            fileKey,
            new ImportFileError('PDF_UNREADABLE', { file: d.path }),
          ),
        );
        continue;
      }
      const text = pages.join('\n\n').trim();
      const scanned = text.replace(/\s/g, '').length < 30 * Math.max(1, pages.length);
      const firstLine =
        text
          .split('\n')
          .map((l) => l.trim())
          .find(Boolean) ?? '';
      const title = firstLine && firstLine.length <= 150 ? firstLine : fileKey;
      const body = scanned
        ? ''
        : pages.map((p) => textToHtml(p.replace(firstLine, '').trim())).join('<hr>');
      const html =
        `<div data-type="callout" data-callout="${scanned ? 'warning' : 'info'}"><p>${scanned ? 'Scanned PDF: the text could not be extracted (needs manual work).' : 'Imported from the attached PDF.'}</p></div>` +
        body;
      out.push({
        ref,
        source: d.source,
        payload: {
          externalKey: `pdf:${fileKey}`,
          lang: languageOf(text || title),
          title,
          html,
          parentRef: null,
          assets: [],
          original,
          needsManualWork: scanned,
        },
        issues: scanned ? [issue('WARNING', 'PDF_NEEDS_MANUAL_WORK')] : [],
        facts: { pages: pages.length, words: text ? text.split(/\s+/).length : 0 },
        depth: 0,
      });
    }
    return out;
  }

  /** Confluence space export (HTML ZIP): pages, breadcrumbs → hierarchy, attachments, links. */
  private async parseConfluence(ctx: ParseContext): Promise<DraftPage[]> {
    const file = ctx.files[0];
    const zip = await openSafeZip(file.data, file.fileName);
    const pages = zip.entries.filter(
      (e) => e.path.toLowerCase().endsWith('.html') && !/(^|\/)index\.html$/i.test(e.path),
    );
    const byPath = new Map(pages.map((p) => [p.path, `page:${p.path}`]));
    const out: DraftPage[] = [];
    for (const [n, e] of pages.entries()) {
      await ctx.progress(n / pages.length, e.path);
      const doc = fragment(await zip.readText(e.path));
      const dir = posix.dirname(e.path);
      const titleText =
        doc.querySelector('#title-text')?.textContent?.trim() ||
        doc.querySelector('title')?.textContent?.trim() ||
        baseName(e.path);
      const title = titleText.replace(/^.*?\s:\s/, '').trim() || baseName(e.path);
      const main = doc.querySelector('#main-content') ?? doc.querySelector('body') ?? doc;
      const crumbs = Array.from(doc.querySelectorAll('#breadcrumbs a'))
        .map((a) => posix.normalize(posix.join(dir, a.getAttribute('href') ?? '')))
        .filter((p) => byPath.has(p) && p !== e.path);
      const parentPath = crumbs[crumbs.length - 1] ?? null;
      const { assets, broken } = rewriteLinks(
        main as HTMLElement,
        dir,
        zip,
        file,
        byPath,
        `${file.id}-${n}`,
      );
      markRtl(main as HTMLElement);
      const html = (main as HTMLElement).innerHTML;
      const id = /_(\d+)\.html$/i.exec(e.path)?.[1] ?? e.path;
      out.push({
        ref: `page:${e.path}`,
        source: `${file.fileName} › ${e.path}`,
        payload: {
          externalKey: `confluence:${id}`,
          lang: languageOf(main.textContent || title),
          title,
          html,
          parentRef: parentPath ? byPath.get(parentPath)! : null,
          assets,
        },
        issues: brokenLinksIssue(broken),
        facts: { ...factsOf(html), attachments: assets.length },
        depth: crumbs.length,
      });
    }
    return out;
  }

  /** Markdown files or a ZIP of a folder: folders become parent pages (README / index.md). */
  private async parseMarkdown(ctx: ParseContext): Promise<DraftPage[]> {
    const out: DraftPage[] = [];
    for (const file of ctx.files) {
      const zip = file.ext === 'zip' ? await openSafeZip(file.data, file.fileName) : null;
      const docs = zip
        ? zip.entries.filter(
            (e) =>
              ['md', 'markdown'].includes(extensionOf(e.path)) &&
              !/(^|\/)(__MACOSX|\.)/.test(e.path),
          )
        : [{ path: file.fileName }];
      const isIndex = (p: string) => /^(readme|index)\.(md|markdown)$/i.test(posix.basename(p));
      const folderPage = new Map<string, string>();
      for (const d of docs)
        if (isIndex(d.path)) folderPage.set(posix.dirname(d.path), `md:${file.id}:${d.path}`);
      const byPath = new Map(docs.map((d) => [d.path, `md:${file.id}:${d.path}`]));
      const parentOf = (p: string): string | null => {
        let dir = posix.dirname(p);
        if (isIndex(p)) dir = posix.dirname(dir);
        while (dir && dir !== '.') {
          const page = folderPage.get(dir);
          if (page) return page;
          dir = posix.dirname(dir);
        }
        const rootIndex = folderPage.get('.');
        return rootIndex && !(isIndex(p) && posix.dirname(p) === '.') ? rootIndex : null;
      };
      for (const [n, d] of docs.entries()) {
        await ctx.progress(n / docs.length, d.path);
        const md = zip ? await zip.readText(d.path) : decodeText(file.data);
        const root = fragment(await marked.parse(md, { gfm: true, async: true }));
        const { assets, broken } = rewriteLinks(
          root,
          posix.dirname(d.path),
          zip,
          file,
          byPath,
          `${file.id}-${n}`,
        );
        markRtl(root);
        const { title, html } = takeTitle(root.innerHTML, baseName(d.path));
        const ref = byPath.get(d.path)!;
        const parentRef = parentOf(d.path);
        out.push({
          ref,
          source: zip ? `${file.fileName} › ${d.path}` : file.fileName,
          payload: {
            externalKey: `md:${zip ? d.path : file.fileName}`,
            lang: languageOf(fragment(html).textContent || title),
            title,
            html,
            parentRef: parentRef === ref ? null : parentRef,
            assets,
          },
          issues: brokenLinksIssue(broken),
          facts: factsOf(html),
          depth: d.path.split('/').length - (isIndex(d.path) ? 1 : 0),
        });
      }
    }
    return out;
  }

  // ---------- Apply ----------

  async apply(ctx: ApplyContext, items: ParsedItem[], all: ParsedItem[]) {
    const spaceId = ctx.options.spaceId!;
    const ids = new Map<string, string>();
    for (const i of all) if (i.matchId) ids.set(i.ref, i.matchId);
    for (const i of items) if (i.action === 'CREATE') ids.set(i.ref, randomUUID());
    const loader = new AssetLoader(await ctx.files());
    for (const item of items) {
      const p = item.data as PagePayload;
      const id = ids.get(item.ref)!;
      // Asset bytes are read before the transaction (storage writes are not transactional).
      const assets: { ref: AssetRef; data: Buffer; type: string }[] = [];
      const skipped: string[] = [];
      for (const a of [...p.assets, ...(p.original ? [p.original] : [])]) {
        const data = await loader.load(a).catch(() => null);
        const type = data ? detectAttachmentType(data, safeFileName(a.name)) : null;
        if (data && type) assets.push({ ref: a, data, type });
        else skipped.push(a.name);
      }
      await ctx.step(item, async (tx) => {
        const records: StepRecord[] = [];
        const parentId = p.parentRef
          ? (ids.get(p.parentRef) ?? null)
          : (ctx.options.parentPageId ?? null);
        const parent = parentId
          ? await tx.page.findFirst({
              where: { id: parentId, spaceId, deletedAt: null },
              select: { id: true },
            })
          : null;
        let page;
        if (item.action === 'UPDATE') {
          page = await tx.page.findFirstOrThrow({ where: { id, deletedAt: null } });
          if (page.status !== 'DRAFT') throw new Error('NOT_DRAFT');
        } else {
          const last = await tx.page.aggregate({
            where: { spaceId, parentId: parent?.id ?? null, deletedAt: null },
            _max: { sortOrder: true },
          });
          page = await tx.page.create({
            data: {
              id,
              spaceId,
              parentId: parent?.id ?? null,
              sortOrder: (last._max.sortOrder ?? -1) + 1,
              ownerId: ctx.options.defaultOwnerId ?? ctx.actor.id,
              importBatchId: ctx.batchId,
              createdById: ctx.actor.id,
              updatedById: ctx.actor.id,
            },
          });
        }
        const urls = new Map<string, string>();
        for (const a of assets) {
          const attId = randomUUID();
          const storageKey = `attachments/${page.id}/${attId}`;
          await this.storage.put(storageKey, a.data, a.type);
          await tx.attachment.create({
            data: {
              id: attId,
              pageId: page.id,
              fileName: safeFileName(a.ref.name),
              contentType: a.type,
              size: a.data.length,
              storageKey,
              createdById: ctx.actor.id,
            },
          });
          urls.set(a.ref.key, attachmentUrl(attId));
          records.push({
            entity: 'ATTACHMENT',
            entityId: attId,
            outcome: 'CREATED',
            key: a.ref.name,
          });
        }
        let html = p.html
          .replace(/import-asset:([\w.-]+)/g, (_, k: string) => urls.get(k) ?? '#')
          .replace(/import-page:([^"'\s>]+)/g, (_, r: string) => {
            const target = ids.get(decodeURIComponent(r));
            return target ? `/docs/${spaceId}/pages/${target}` : '#';
          });
        if (p.original && urls.get(p.original.key))
          html = `<p><a href="${urls.get(p.original.key)}">📎 ${p.original.name.replace(/[<>&"]/g, '')}</a></p>${html}`;
        const content = preparePageContent({
          titleEn: p.lang === 'en' ? p.title : '',
          titleAr: p.lang === 'ar' ? p.title : '',
          contentEn: p.lang === 'en' ? html : '',
          contentAr: p.lang === 'ar' ? html : '',
          dirEn: 'ltr',
          dirAr: 'rtl',
        });
        const versionNumber = page.version + 1;
        await tx.page.update({
          where: { id: page.id },
          data: {
            ...content,
            version: versionNumber,
            updatedById: ctx.actor.id,
            aiGenerated: false,
          },
        });
        await tx.pageVersion.create({
          data: {
            pageId: page.id,
            versionNumber,
            titleEn: content.titleEn,
            titleAr: content.titleAr,
            contentEn: content.contentEn,
            contentAr: content.contentAr,
            dirEn: content.dirEn,
            dirAr: content.dirAr,
            changeNote: `Imported from ${item.source} (${ctx.batchNumber})`,
            createdById: ctx.actor.id,
          },
        });
        records.unshift({
          entity: 'PAGE',
          entityId: page.id,
          outcome: item.action === 'UPDATE' ? 'UPDATED' : 'CREATED',
          externalKey: p.externalKey,
          after: {
            version: versionNumber,
            attachments: assets.length,
            skippedAssets: skipped.length,
          },
        });
        for (const s of item.suggestions.filter((x) => x.accepted && x.kind === 'PROCESS')) {
          const exists = await tx.pageLink.findFirst({
            where: { pageId: page.id, processId: s.targetId },
          });
          const process = await tx.process.findFirst({
            where: { id: s.targetId, deletedAt: null },
          });
          if (exists || !process) continue;
          const link = await tx.pageLink.create({
            data: {
              pageId: page.id,
              targetType: 'PROCESS',
              processId: s.targetId,
              createdById: ctx.actor.id,
            },
          });
          records.push({
            entity: 'PAGE_LINK',
            entityId: link.id,
            outcome: 'CREATED',
            key: process.code,
          });
        }
        return records;
      });
    }
  }
}

/** Loads asset bytes for apply: Word images (mammoth again), ZIP entries, whole files. */
class AssetLoader {
  private zips = new Map<string, Promise<SafeZip>>();
  private docx = new Map<string, Promise<Buffer[]>>();

  constructor(private readonly files: LoadedImportFile[]) {}

  private file(id: string) {
    const f = this.files.find((x) => x.id === id);
    if (!f) throw new ImportFileError('FILE_CHANGED');
    return f;
  }

  async load(a: AssetRef): Promise<Buffer> {
    const s = a.source;
    if (s.kind === 'file') return this.file(s.fileId).data;
    if (s.kind === 'zip') {
      const f = this.file(s.fileId);
      if (!this.zips.has(f.id)) this.zips.set(f.id, openSafeZip(f.data, f.fileName));
      return (await this.zips.get(f.id)!).read(s.path);
    }
    const key = `${s.fileId}`;
    if (!this.docx.has(key)) this.docx.set(key, this.wordImages(a));
    const images = await this.docx.get(key)!;
    if (!images[s.index]) throw new Error('missing image');
    return images[s.index];
  }

  /** Images of the Word documents of one uploaded file (or ZIP), in document order. */
  private async wordImages(a: AssetRef): Promise<Buffer[]> {
    const s = a.source as { fileId: string };
    const f = this.file(s.fileId);
    const docs: Buffer[] = [];
    if (f.ext === 'zip') {
      // The asset key carries no entry path for Word in a ZIP: read the entry named by the key.
      const zip = await openSafeZip(f.data, f.fileName);
      for (const e of zip.entries)
        if (extensionOf(e.path) === 'docx') docs.push(await zip.read(e.path));
    } else docs.push(f.data);
    const all: Buffer[] = [];
    for (const d of docs)
      await mammoth.convertToHtml(
        { buffer: d },
        {
          convertImage: mammoth.images.imgElement(async (image) => {
            all.push(await image.read());
            return { src: '' };
          }),
        },
      );
    return all;
  }
}

/**
 * Rewrites links of an exported page: other pages of the export → `import-page:REF`; files of
 * the archive (images, attachments) → `import-asset:KEY`; missing local targets are reported.
 */
function rewriteLinks(
  root: HTMLElement,
  dir: string,
  zip: SafeZip | null,
  file: LoadedImportFile,
  pages: Map<string, string>,
  prefix: string,
): { assets: AssetRef[]; broken: string[] } {
  const assets: AssetRef[] = [];
  const broken: string[] = [];
  const local = (v: string) => !/^(https?:|mailto:|#|\/|data:)/i.test(v);
  const resolve = (v: string) =>
    posix.normalize(posix.join(dir, decodeURIComponent(v.split(/[?#]/)[0])));
  const asset = (path: string) => {
    const existing = assets.find((a) => a.source.kind === 'zip' && a.source.path === path);
    if (existing) return existing.key;
    const key = `${prefix}-a${assets.length}`;
    assets.push({
      key,
      name: posix.basename(path),
      source: { kind: 'zip', fileId: file.id, path },
    });
    return key;
  };
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    if (!local(src) || !zip) continue;
    const path = resolve(src);
    if (zip.has(path)) img.setAttribute('src', `${ASSET}${asset(path)}`);
    else {
      broken.push(src);
      img.remove();
    }
  }
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    if (!local(href)) continue;
    const path = resolve(href);
    const page = pages.get(path);
    if (page) a.setAttribute('href', `${PAGE}${encodeURIComponent(page)}`);
    else if (zip?.has(path) && !/\.(html?|md|markdown)$/i.test(path))
      a.setAttribute('href', `${ASSET}${asset(path)}`);
    else {
      broken.push(href);
      a.removeAttribute('href');
    }
  }
  return { assets, broken };
}

export type { ImportOptions };
