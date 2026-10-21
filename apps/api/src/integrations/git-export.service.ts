import { posix } from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  embeddedProcessIds,
  frontMatter,
  pageCommitMessage,
  pageFilePath,
  processCommitMessage,
  processFilePaths,
  type GitEntityType,
  type Locale,
  type PagePathNode,
  type ProcessCategory,
  type ProcessPathNode,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { htmlToMarkdown } from '../docs/markdown';
import { htmlToText } from '../docs/rich-text';

export interface ExportFile {
  path: string;
  content: string;
}

/** What one process or page looks like in the repository. */
export interface ExportItem {
  entityType: GitEntityType;
  entityId: string;
  version: number;
  title: string;
  files: ExportFile[];
  message: string;
  authorId: string | null;
}

/** Builds repository files: processes as .bpmn + .json, pages as Markdown with front-matter. */
@Injectable()
export class GitExportService {
  constructor(private readonly prisma: PrismaService) {}

  private async processChain(id: string): Promise<(ProcessPathNode & { category: string })[]> {
    const chain: (ProcessPathNode & { category: string })[] = [];
    const seen = new Set<string>();
    let current: string | null = id;
    while (current && !seen.has(current)) {
      seen.add(current);
      const p: {
        code: string;
        nameEn: string;
        nameAr: string;
        category: string;
        parentId: string | null;
      } | null = await this.prisma.process.findUnique({
        where: { id: current },
        select: { code: true, nameEn: true, nameAr: true, category: true, parentId: true },
      });
      if (!p) break;
      chain.unshift(p);
      current = p.parentId;
    }
    return chain;
  }

  async processPaths(id: string, root: string) {
    const chain = await this.processChain(id);
    if (!chain.length) return null;
    return processFilePaths(root, chain[0].category as ProcessCategory, chain);
  }

  /** Version number to export: the latest, or the published one (null = nothing to export). */
  private async exportedVersion(
    type: GitEntityType,
    id: string,
    publishedOnly: boolean,
  ): Promise<number | null | undefined> {
    if (!publishedOnly) return undefined;
    const pub = await this.prisma.publication.findFirst({
      where: { entityType: type, entityId: id, current: true },
      select: { versionNumber: true },
    });
    return pub?.versionNumber ?? null;
  }

  async process(id: string, root: string, publishedOnly = false): Promise<ExportItem | null> {
    const published = await this.exportedVersion('PROCESS', id, publishedOnly);
    if (published === null) return null;
    const p = await this.prisma.process.findFirst({
      where: { id, deletedAt: null },
      include: {
        owner: { select: { email: true, nameEn: true, nameAr: true } },
        department: { select: { nameEn: true, nameAr: true } },
      },
    });
    if (!p) return null;
    const version = await this.prisma.processVersion.findFirst({
      where: { processId: id, ...(published ? { versionNumber: published } : {}) },
      orderBy: { versionNumber: 'desc' },
    });
    if (!version) return null;
    const paths = (await this.processPaths(id, root))!;
    const author = version.createdById
      ? await this.prisma.user.findUnique({
          where: { id: version.createdById },
          select: { email: true, nameEn: true, nameAr: true },
        })
      : null;
    const metadata = {
      id: p.id,
      code: p.code,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      descriptionEn: p.descriptionEn,
      descriptionAr: p.descriptionAr,
      category: p.category,
      status: published ? 'PUBLISHED' : p.status,
      owner: p.owner,
      department: p.department,
      version: version.versionNumber,
      versionLabel: version.label,
      changeNote: version.changeNote,
      versionCreatedAt: version.createdAt.toISOString(),
      versionAuthor: author,
      bpmnFile: posix.basename(paths.bpmn),
    };
    return {
      entityType: 'PROCESS',
      entityId: id,
      version: version.versionNumber,
      title: `${p.code} ${p.nameEn || p.nameAr}`,
      files: [
        { path: paths.bpmn, content: version.bpmnXml },
        { path: paths.json, content: `${JSON.stringify(metadata, null, 2)}\n` },
      ],
      message: processCommitMessage({
        code: p.code,
        name: p.nameEn || p.nameAr,
        version: version.versionNumber,
        changeNote: version.changeNote,
      }),
      authorId: version.createdById,
    };
  }

  private async pageChain(id: string): Promise<PagePathNode[]> {
    const chain: PagePathNode[] = [];
    const seen = new Set<string>();
    let current: string | null = id;
    while (current && !seen.has(current)) {
      seen.add(current);
      const p: { id: string; titleEn: string; titleAr: string; parentId: string | null } | null =
        await this.prisma.page.findUnique({
          where: { id: current },
          select: { id: true, titleEn: true, titleAr: true, parentId: true },
        });
      if (!p) break;
      chain.unshift(p);
      current = p.parentId;
    }
    return chain;
  }

  /**
   * Pages of view-restricted spaces are never exported: the repository may be readable by
   * people who cannot see the space.
   */
  async page(id: string, root: string, publishedOnly = false): Promise<ExportItem | null> {
    const published = await this.exportedVersion('PAGE', id, publishedOnly);
    if (published === null) return null;
    const row = await this.prisma.page.findFirst({
      where: { id, deletedAt: null, space: { deletedAt: null, viewRestricted: false } },
      include: { space: { select: { key: true } } },
    });
    if (!row) return null;
    const version = await this.prisma.pageVersion.findFirst({
      where: { pageId: id, ...(published ? { versionNumber: published } : {}) },
      orderBy: { versionNumber: 'desc' },
    });
    // With "published only" the content and title come from the published version.
    const page =
      published && version
        ? {
            ...row,
            titleEn: version.titleEn,
            titleAr: version.titleAr,
            contentEn: version.contentEn,
            contentAr: version.contentAr,
            textEn: htmlToText(version.contentEn),
            textAr: htmlToText(version.contentAr),
            version: version.versionNumber,
            updatedAt: version.createdAt,
            updatedById: version.createdById,
          }
        : row;
    const author = page.updatedById
      ? await this.prisma.user.findUnique({
          where: { id: page.updatedById },
          select: { email: true, nameEn: true, nameAr: true },
        })
      : null;
    const chain = await this.pageChain(id);
    if (published && chain.length) {
      chain[chain.length - 1] = {
        ...chain[chain.length - 1],
        titleEn: page.titleEn,
        titleAr: page.titleAr,
      };
    }
    const diagramPaths = new Map<string, { path: string; label: string }>();
    for (const pid of embeddedProcessIds(page.contentEn + page.contentAr)) {
      const proc = await this.prisma.process.findUnique({
        where: { id: pid },
        select: { code: true, nameEn: true, nameAr: true },
      });
      const paths = proc ? await this.processPaths(pid, root) : null;
      if (proc && paths) {
        diagramPaths.set(pid, {
          path: paths.bpmn,
          label: `${proc.code} ${proc.nameEn || proc.nameAr}`,
        });
      }
    }
    const files: ExportFile[] = [];
    const languages: [Locale, string, string, string][] = [
      ['en', page.titleEn, page.contentEn, page.textEn],
      ['ar', page.titleAr, page.contentAr, page.textAr],
    ];
    for (const [lang, title, html, text] of languages) {
      if (!title.trim() && !text.trim()) continue;
      const path = pageFilePath(root, page.space.key, chain, lang);
      const heading = title || page.titleEn || page.titleAr;
      const markdown = htmlToMarkdown(html, {
        diagram: (pid) => {
          const d = diagramPaths.get(pid);
          return d ? { label: d.label, href: posix.relative(posix.dirname(path), d.path) } : null;
        },
      });
      files.push({
        path,
        content:
          frontMatter({
            id: page.id,
            title: heading,
            space: page.space.key,
            language: lang,
            version: page.version,
            author: author ? author.nameEn || author.nameAr || author.email : null,
            updated: page.updatedAt.toISOString(),
          }) + `# ${heading}\n\n${markdown}`,
      });
    }
    const title = page.titleEn || page.titleAr;
    return {
      entityType: 'PAGE',
      entityId: id,
      version: page.version,
      title,
      files,
      message: pageCommitMessage({
        spaceKey: page.space.key,
        title,
        version: page.version,
        changeNote: version?.changeNote ?? '',
      }),
      authorId: version?.createdById ?? page.updatedById,
    };
  }
}
