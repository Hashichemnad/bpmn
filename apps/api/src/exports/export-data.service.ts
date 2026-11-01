import { HttpStatus, Injectable } from '@nestjs/common';
import { JSDOM } from 'jsdom';
import {
  DEFAULT_EXPORT_TEMPLATE,
  HANDBOOK_MAX_PROCESSES,
  PERMISSIONS,
  SETTING_KEYS,
  exportTemplateSchema,
  resolveDiagramTheme,
  type DiagramTheme,
  type ExportTemplate,
  type Locale,
  type Permission,
} from '@processhub/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { RendererService } from '../renderer/renderer.service';
import { PortalAccessService } from '../governance/portal-access.service';
import { DocsAccessService } from '../docs/docs-access.service';
import { ReportDataService, type ReportProcess } from '../reports/report-data.service';
import { htmlToText, sanitizeRichText } from '../docs/rich-text';
import { sanitizeSvg } from '../settings/image-sniff';
import { streamToBuffer } from '../common/streams';
import { AppException, badRequest, forbidden, notFound } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';

export interface Branding {
  orgNameEn: string;
  orgNameAr: string;
  logo: { data: Buffer; contentType: string } | null;
  template: ExportTemplate;
  theme: DiagramTheme;
}

export interface ExportPage {
  id: string;
  parentId: string | null;
  titleEn: string;
  titleAr: string;
  htmlEn: string;
  htmlAr: string;
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const RASTER = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const ATTACHMENT = /^\/api\/v1\/attachments\/([0-9a-f-]{36})\/content$/i;

/**
 * Collects what exports show, with the rules of the screens (D-177): published content through the
 * Knowledge Portal's visibility (default); workspace drafts only for users with workspace access to
 * the item. Also branding (logo, organisation, export colours) and diagram images from the renderer.
 */
@Injectable()
export class ExportDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly renderer: RendererService,
    private readonly portal: PortalAccessService,
    private readonly docsAccess: DocsAccessService,
    private readonly reports: ReportDataService,
    private readonly audit: AuditService,
  ) {}

  /** Drafts need workspace access; everyone else gets published content. */
  assertDrafts(user: AuthUser, drafts: boolean, perm: Permission = PERMISSIONS.PROCESSES_READ) {
    if (drafts && !user.permissions.has(perm)) throw forbidden('Drafts are not available to you');
  }

  async branding(): Promise<Branding> {
    const rows = await this.prisma.setting.findMany({
      where: {
        key: {
          in: [
            SETTING_KEYS.ORG_NAME_EN,
            SETTING_KEYS.ORG_NAME_AR,
            SETTING_KEYS.LOGO,
            SETTING_KEYS.EXPORT_TEMPLATE,
            SETTING_KEYS.DIAGRAM_THEME,
          ],
        },
      },
    });
    const v = new Map(rows.map((r) => [r.key, r.value]));
    const logoValue = v.get(SETTING_KEYS.LOGO) as
      { key?: string; contentType?: string } | undefined;
    let logo: Branding['logo'] = null;
    if (logoValue?.key && logoValue.contentType) {
      try {
        logo = {
          data: await streamToBuffer(await this.storage.get(logoValue.key)),
          contentType: logoValue.contentType,
        };
      } catch {
        logo = null;
      }
    }
    const template = exportTemplateSchema.safeParse(v.get(SETTING_KEYS.EXPORT_TEMPLATE) ?? {});
    return {
      orgNameEn:
        typeof v.get(SETTING_KEYS.ORG_NAME_EN) === 'string'
          ? (v.get(SETTING_KEYS.ORG_NAME_EN) as string)
          : '',
      orgNameAr:
        typeof v.get(SETTING_KEYS.ORG_NAME_AR) === 'string'
          ? (v.get(SETTING_KEYS.ORG_NAME_AR) as string)
          : '',
      logo,
      template: template.success ? template.data : DEFAULT_EXPORT_TEMPLATE,
      theme: resolveDiagramTheme(v.get(SETTING_KEYS.DIAGRAM_THEME)),
    };
  }

  async updateTemplate(input: ExportTemplate, actor: AuthUser, meta: RequestMeta) {
    const before = (await this.branding()).template;
    const value = input as unknown as Prisma.InputJsonValue;
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.EXPORT_TEMPLATE },
        create: { key: SETTING_KEYS.EXPORT_TEMPLATE, value, updatedById: actor.id },
        update: { value, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: SETTING_KEYS.EXPORT_TEMPLATE,
          userId: actor.id,
          summary: { before, after: input },
          meta,
        },
        tx,
      );
    });
    return input;
  }

  /** data: URI of an image (SVG sanitised). */
  static dataUri(data: Buffer, contentType: string): string {
    const body =
      contentType === 'image/svg+xml' ? Buffer.from(sanitizeSvg(data.toString('utf8'))) : data;
    return `data:${contentType};base64,${body.toString('base64')}`;
  }

  async processes(
    rootId: string,
    branch: boolean,
    user: AuthUser,
    drafts: boolean,
  ): Promise<ReportProcess[]> {
    this.assertDrafts(user, drafts);
    return this.reports.collect(rootId, branch, user, drafts ? 'working' : 'published');
  }

  async bpmnImage(xml: string | null, locale: Locale, format: 'svg' | 'png', maxWidth?: number) {
    if (!xml) return null;
    return this.renderer.diagram({ kind: 'bpmn', source: xml, locale, format, maxWidth });
  }

  async graphImage(
    content: string,
    locale: Locale,
    format: 'svg' | 'png',
    theme: DiagramTheme,
    maxWidth?: number,
  ) {
    return this.renderer.diagram({
      kind: 'graph',
      source: content,
      locale,
      format,
      theme,
      maxWidth,
    });
  }

  /** A value chain (published version or draft) with the processes its elements point to. */
  async valueChain(diagramId: string, user: AuthUser, drafts: boolean) {
    this.assertDrafts(user, drafts);
    const d = await this.prisma.diagram.findFirst({ where: { id: diagramId, deletedAt: null } });
    if (!d || d.type !== 'VALUE_CHAIN') throw notFound('Value chain');
    let content = d.content;
    let versionNumber: number | null = null;
    if (!drafts) {
      await this.portal.assertAccess(user);
      const pub = (
        await this.portal.publications(user, { types: ['DIAGRAM'], ids: { DIAGRAM: [diagramId] } })
      )[0];
      if (!pub) throw new AppException(HttpStatus.NOT_FOUND, 'NOT_PUBLISHED');
      const v = await this.prisma.diagramVersion.findUnique({
        where: { diagramId_versionNumber: { diagramId, versionNumber: pub.versionNumber } },
      });
      if (!v) throw notFound('Version');
      content = v.content;
      versionNumber = v.versionNumber;
    }
    const nodes = (
      (JSON.parse(content) as { nodes?: { processId?: string }[] }).nodes ?? []
    ).filter((n) => !!n.processId);
    const ids = [...new Set(nodes.map((n) => n.processId!))];
    const processes: ReportProcess[] = [];
    for (const id of ids) {
      try {
        processes.push(...(await this.processes(id, false, user, drafts)));
      } catch {
        /* not visible to this user (or not published): left out */
      }
      if (processes.length > HANDBOOK_MAX_PROCESSES) throw badRequest('REPORT_TOO_LARGE');
    }
    return { diagram: d, content, versionNumber, processes };
  }

  /** Pages of a space (published versions or drafts the user may read), tree order. */
  async spacePages(spaceId: string, user: AuthUser, drafts: boolean) {
    const space = await this.prisma.space.findFirst({ where: { id: spaceId, deletedAt: null } });
    if (!space) throw notFound('Space');
    if (drafts) {
      this.assertDrafts(user, true, PERMISSIONS.DOCS_READ);
      if (!(await this.docsAccess.visibleSpaceIds(user)).includes(spaceId)) throw notFound('Space');
      const pages = await this.prisma.page.findMany({
        where: { spaceId, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { titleEn: 'asc' }],
      });
      return {
        space,
        pages: pages.map((p) => ({
          id: p.id,
          parentId: p.parentId,
          titleEn: p.titleEn,
          titleAr: p.titleAr,
          htmlEn: p.contentEn,
          htmlAr: p.contentAr,
        })),
      };
    }
    await this.portal.assertAccess(user);
    const pubs = await this.portal.publications(user, { types: ['PAGE'] });
    const rows = await this.prisma.page.findMany({
      where: { spaceId, deletedAt: null, id: { in: pubs.map((p) => p.entityId) } },
      orderBy: [{ sortOrder: 'asc' }, { titleEn: 'asc' }],
      select: { id: true, parentId: true },
    });
    if (!rows.length) throw new AppException(HttpStatus.NOT_FOUND, 'NOT_PUBLISHED');
    const pubOf = new Map(pubs.map((p) => [p.entityId, p]));
    const versions = await this.prisma.pageVersion.findMany({
      where: {
        OR: rows.map((r) => ({ pageId: r.id, versionNumber: pubOf.get(r.id)!.versionNumber })),
      },
    });
    const vOf = new Map(versions.map((v) => [v.pageId, v]));
    return {
      space,
      pages: rows
        .filter((r) => vOf.has(r.id))
        .map((r) => {
          const v = vOf.get(r.id)!;
          return {
            id: r.id,
            parentId: r.parentId,
            titleEn: v.titleEn,
            titleAr: v.titleAr,
            htmlEn: v.contentEn,
            htmlAr: v.contentAr,
          };
        }),
    };
  }

  /** Published (or readable draft) pages by id, for the SOP links of processes. */
  async linkedPages(ids: string[], user: AuthUser, drafts: boolean): Promise<ExportPage[]> {
    if (!ids.length) return [];
    if (drafts && user.permissions.has(PERMISSIONS.DOCS_READ)) {
      const spaces = await this.docsAccess.visibleSpaceIds(user);
      const pages = await this.prisma.page.findMany({
        where: { id: { in: ids }, deletedAt: null, spaceId: { in: spaces } },
      });
      return pages.map((p) => ({
        id: p.id,
        parentId: null,
        titleEn: p.titleEn,
        titleAr: p.titleAr,
        htmlEn: p.contentEn,
        htmlAr: p.contentAr,
      }));
    }
    const pubs = await this.portal.publications(user, { types: ['PAGE'], ids: { PAGE: ids } });
    if (!pubs.length) return [];
    const versions = await this.prisma.pageVersion.findMany({
      where: { OR: pubs.map((p) => ({ pageId: p.entityId, versionNumber: p.versionNumber })) },
    });
    return versions.map((v) => ({
      id: v.pageId,
      parentId: null,
      titleEn: v.titleEn,
      titleAr: v.titleAr,
      htmlEn: v.contentEn,
      htmlAr: v.contentAr,
    }));
  }

  /**
   * Wiki HTML for an offline copy: sanitised again, attachment images of the page embedded as data:
   * URIs (others removed), in-app links turned into plain text, embedded diagrams replaced by a note.
   */
  async offlineHtml(pageId: string, html: string): Promise<string> {
    const clean = sanitizeRichText(html);
    if (!clean) return '';
    const dom = new JSDOM(`<body>${clean}</body>`);
    const doc = dom.window.document;
    for (const img of [...doc.querySelectorAll('img')]) {
      const m = ATTACHMENT.exec(img.getAttribute('src') ?? '');
      const att = m
        ? await this.prisma.attachment.findFirst({ where: { id: m[1], pageId, deletedAt: null } })
        : null;
      if (
        !att ||
        att.size > MAX_IMAGE_BYTES ||
        !(RASTER.has(att.contentType) || att.contentType === 'image/svg+xml')
      ) {
        img.remove();
        continue;
      }
      try {
        const data = await streamToBuffer(await this.storage.get(att.storageKey));
        img.setAttribute('src', ExportDataService.dataUri(data, att.contentType));
      } catch {
        img.remove();
      }
    }
    for (const a of [...doc.querySelectorAll('a')]) {
      const href = a.getAttribute('href') ?? '';
      if (!/^(https?:\/\/|mailto:)/i.test(href)) {
        a.replaceWith(...[...a.childNodes]);
      } else {
        a.setAttribute('rel', 'noopener noreferrer nofollow');
        a.setAttribute('target', '_blank');
      }
    }
    for (const el of [...doc.querySelectorAll('[data-type="bpmn-diagram"], [data-type="file"]')]) {
      const p = doc.createElement('p');
      p.textContent = '—';
      el.replaceWith(p);
    }
    return doc.body.innerHTML;
  }

  static text(html: string) {
    return htmlToText(html);
  }
}
