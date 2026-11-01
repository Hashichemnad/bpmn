import { Injectable } from '@nestjs/common';
import JSZip from 'jszip';
import type { HtmlExportInput, Locale, UserRef } from '@processhub/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import type { ReportProcess } from '../reports/report-data.service';
import { reportSteps } from '../reports/report-steps';
import { categoryText, reportTexts } from '../reports/report-i18n';
import { ExportDataService, type ExportPage } from './export-data.service';
import { buildSite, type SitePage, type SiteProcess } from './html-site';

export interface ExportFile {
  fileName: string;
  contentType: string;
  data: Buffer;
}

/** ASCII file / folder names (browsers, ZIP tools and mail gateways handle them everywhere). */
const safeName = (s: string) =>
  s
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80) || 'export';

const fmt = (d: Date | null, l: Locale) =>
  d ? new Intl.DateTimeFormat(l === 'ar' ? 'ar' : 'en-GB', { dateStyle: 'medium' }).format(d) : '—';

const userName = (u: UserRef | null | undefined, l: Locale) =>
  u ? (l === 'ar' ? u.nameAr || u.nameEn : u.nameEn || u.nameAr) || u.email : '—';

/**
 * Static HTML export (Phase 4.4, D-177): a process, a process-house branch, a value chain with its
 * processes, or a wiki space as an offline website in a ZIP. Published content by default; drafts
 * only for users with workspace access (watermarked). Audited (EXPORT).
 */
@Injectable()
export class HtmlExportService {
  constructor(
    private readonly audit: AuditService,
    private readonly data: ExportDataService,
  ) {}

  async export(input: HtmlExportInput, user: AuthUser, meta: RequestMeta): Promise<ExportFile> {
    const branding = await this.data.branding();
    let titleEn = '';
    let titleAr = '';
    let processes: ReportProcess[] = [];
    let pages: ExportPage[] = [];
    let overview: { en: string | null; ar: string | null } | null = null;
    let entityType: 'Process' | 'Diagram' | 'Space' = 'Process';

    if (input.scope === 'PROCESS' || input.scope === 'BRANCH') {
      processes = await this.data.processes(input.id, input.scope === 'BRANCH', user, input.drafts);
      titleEn = `${processes[0].code} ${processes[0].nameEn}`;
      titleAr = `${processes[0].code} ${processes[0].nameAr || processes[0].nameEn}`;
    } else if (input.scope === 'VALUE_CHAIN') {
      entityType = 'Diagram';
      const vc = await this.data.valueChain(input.id, user, input.drafts);
      processes = vc.processes;
      titleEn = vc.diagram.nameEn || vc.diagram.nameAr;
      titleAr = vc.diagram.nameAr || vc.diagram.nameEn;
      const [en, ar] = await Promise.all(
        (['en', 'ar'] as const).map((l) =>
          this.data.graphImage(vc.content, l, 'svg', branding.theme),
        ),
      );
      overview = {
        en: en ? ExportDataService.dataUri(en.data, en.contentType) : null,
        ar: ar ? ExportDataService.dataUri(ar.data, ar.contentType) : null,
      };
    } else {
      entityType = 'Space';
      const s = await this.data.spacePages(input.id, user, input.drafts);
      pages = s.pages;
      titleEn = s.space.nameEn || s.space.nameAr;
      titleAr = s.space.nameAr || s.space.nameEn;
    }

    // SOP / documentation pages linked to the processes.
    const linkedIds = [...new Set(processes.flatMap((p) => p.pages.map((pg) => pg.id)))].filter(
      (id) => !pages.some((p) => p.id === id),
    );
    pages = [...pages, ...(await this.data.linkedPages(linkedIds, user, input.drafts))];

    const siteProcesses: SiteProcess[] = [];
    for (const p of processes) siteProcesses.push(await this.siteProcess(p, processes));
    const sitePages: SitePage[] = [];
    for (const p of pages) {
      const [htmlEn, htmlAr] = await Promise.all([
        this.data.offlineHtml(p.id, p.htmlEn),
        this.data.offlineHtml(p.id, p.htmlAr),
      ]);
      sitePages.push({
        id: p.id,
        parentId: p.parentId,
        titleEn: p.titleEn,
        titleAr: p.titleAr,
        htmlEn,
        htmlAr,
        textEn: ExportDataService.text(htmlEn),
        textAr: ExportDataService.text(htmlAr),
      });
    }

    const files = buildSite({
      titleEn,
      titleAr,
      branding: {
        orgNameEn: branding.orgNameEn,
        orgNameAr: branding.orgNameAr,
        logo: branding.logo
          ? ExportDataService.dataUri(branding.logo.data, branding.logo.contentType)
          : null,
        primary: branding.template.primaryColor,
        accent: branding.template.accentColor,
      },
      generatedAt: new Date(),
      generatedByEn: user.nameEn || user.email,
      generatedByAr: user.nameAr || user.nameEn || user.email,
      draft: input.drafts,
      overview,
      processes: siteProcesses,
      pages: sitePages,
    });
    const zip = new JSZip();
    const folder = safeName(titleEn);
    for (const [path, content] of files) zip.file(`${folder}/${path}`, content);
    const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    await this.audit.log({
      action: 'EXPORT',
      entityType,
      entityId: input.id,
      userId: user.id,
      summary: {
        format: 'html',
        scope: input.scope,
        drafts: input.drafts,
        processes: siteProcesses.length,
        pages: sitePages.length,
      },
      meta,
    });
    return {
      fileName: `${folder}${input.drafts ? '_DRAFT' : ''}.zip`,
      contentType: 'application/zip',
      data,
    };
  }

  private async siteProcess(p: ReportProcess, all: ReportProcess[]): Promise<SiteProcess> {
    const [svgEn, svgAr] = await Promise.all(
      (['en', 'ar'] as const).map((l) => this.data.bpmnImage(p.bpmnXml, l, 'svg')),
    );
    const te = reportTexts('en');
    const ta = reportTexts('ar');
    const fact = (labelEn: string, labelAr: string, valueEn: string, valueAr = valueEn) => ({
      labelEn,
      labelAr,
      valueEn,
      valueAr,
    });
    const version = p.versionNumber
      ? `${p.versionNumber}${p.versionLabel ? ` (${p.versionLabel})` : ''}`
      : '—';
    return {
      id: p.id,
      code: p.code,
      parentId: p.parentId && all.some((x) => x.id === p.parentId) ? p.parentId : null,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      descriptionEn: p.descriptionEn,
      descriptionAr: p.descriptionAr,
      category: p.category,
      facts: [
        fact(
          te.category,
          ta.category,
          categoryText('en', p.category),
          categoryText('ar', p.category),
        ),
        fact(te.owner, ta.owner, userName(p.owner, 'en'), userName(p.owner, 'ar')),
        fact(
          te.department,
          ta.department,
          p.department?.nameEn || p.department?.nameAr || '—',
          p.department?.nameAr || p.department?.nameEn || '—',
        ),
        fact(te.version, ta.version, version),
        fact(te.approvedAt, ta.approvedAt, fmt(p.approvedAt, 'en'), fmt(p.approvedAt, 'ar')),
        fact(
          te.approvedBy,
          ta.approvedBy,
          p.approvedBy.map((u) => userName(u, 'en')).join(', ') || '—',
          p.approvedBy.map((u) => userName(u, 'ar')).join('، ') || '—',
        ),
        fact(te.publishedAt, ta.publishedAt, fmt(p.publishedAt, 'en'), fmt(p.publishedAt, 'ar')),
      ],
      diagram: {
        en: svgEn ? ExportDataService.dataUri(svgEn.data, svgEn.contentType) : null,
        ar: svgAr ? ExportDataService.dataUri(svgAr.data, svgAr.contentType) : null,
      },
      steps: { en: reportSteps(p, 'en'), ar: reportSteps(p, 'ar') },
      documents: p.links
        .filter((l) => l.object.type === 'DOCUMENT')
        .map((l) => l.object)
        .filter((o, i, list) => list.findIndex((x) => x.id === o.id) === i),
      pages: p.pages.map((pg) => ({ id: pg.id, titleEn: pg.titleEn, titleAr: pg.titleAr })),
    };
  }
}
