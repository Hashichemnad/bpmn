import { Injectable } from '@nestjs/common';
import {
  AI_DOCUMENT_MAX_CHARS,
  type AiSummariseInput,
  type AiSummaryDto,
  type ContentType,
  type Locale,
} from '@processhub/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { badRequest, notFound } from '../../common/app-exception';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { htmlToText } from '../../docs/rich-text';
import { ContentService } from '../../governance/content.service';
import { AiContextService } from '../ai-context.service';
import { AiGatewayService, type AiSession } from '../ai-gateway.service';
import { describeProcess, diffStructures } from '../bpmn/describe';
import type { ProcessStructure } from '../bpmn/process-structure';
import { diffLines } from '../text-diff';
import { CHANGES_SYSTEM, SUMMARISE_SYSTEM, userLanguage } from '../prompts';
import type { SseChannel } from '../sse';
import type { AiJob } from './process-ai.service';

const EMPTY: ProcessStructure = {
  nameEn: '',
  nameAr: '',
  descriptionEn: '',
  descriptionAr: '',
  explanation: '',
  lanes: [],
  nodes: [],
  flows: [],
};

interface PageText {
  title: string;
  text: string;
}

/**
 * Feature 6: a short summary of a process or page, or a plain-language summary of what changed
 * between two saved versions (also for reviewers: the review's version against the published one).
 * Changes are computed by the server (structural BPMN diff / line diff); the model only explains them.
 */
@Injectable()
export class SummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGatewayService,
    private readonly content: ContentService,
    private readonly context: AiContextService,
  ) {}

  async prepare(
    input: AiSummariseInput,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<AiJob<AiSummaryDto>> {
    let type: ContentType = input.type;
    let id = input.id;
    let range = input.compare ?? null;
    if (input.reviewId) {
      const review = await this.prisma.review.findUnique({ where: { id: input.reviewId } });
      if (!review) throw notFound('Review');
      type = review.entityType as ContentType;
      id = review.entityId;
      const published = await this.prisma.publication.findFirst({
        where: { entityType: type, entityId: id, current: true },
        select: { versionNumber: true },
      });
      // Like the review page: against the published version, or everything is new.
      const from =
        published && published.versionNumber < review.versionNumber ? published.versionNumber : 0;
      range = { from, to: review.versionNumber };
    }
    // 404 unless the user may read the item (pages: space restrictions apply).
    await this.content.load(type, id, user);
    if (range && range.from >= range.to) throw badRequest('INVALID_RANGE');
    const material =
      type === 'PROCESS'
        ? await this.processMaterial(id, range)
        : await this.pageMaterial(id, range, input.language);
    const session = await this.gateway.begin(user, meta);
    return (ch) => this.run(session, input, type, id, range, material, ch);
  }

  private async processMaterial(id: string, range: { from: number; to: number } | null) {
    if (!range) {
      const ctx = await this.context.process(id);
      return {
        changes: null,
        text: describeProcess(ctx.structure, ctx.links),
        title: ctx.process.nameEn,
      };
    }
    const to = await this.context.process(id, { kind: 'version', versionNumber: range.to });
    const from = range.from
      ? (await this.context.process(id, { kind: 'version', versionNumber: range.from })).structure
      : EMPTY;
    return {
      changes: diffStructures(from, to.structure),
      text: describeProcess(to.structure, to.links),
      title: to.process.nameEn,
    };
  }

  private async pageVersionText(id: string, version: number, language: Locale): Promise<PageText> {
    const v = await this.prisma.pageVersion.findUnique({
      where: { pageId_versionNumber: { pageId: id, versionNumber: version } },
    });
    if (!v) throw notFound('Version');
    return pageText(v, language);
  }

  private async pageMaterial(
    id: string,
    range: { from: number; to: number } | null,
    language: Locale,
  ) {
    if (!range) {
      const page = await this.prisma.page.findUniqueOrThrow({ where: { id } });
      const t = pageText(page, language);
      return { changes: null, text: t.text, title: t.title };
    }
    const to = await this.pageVersionText(id, range.to, language);
    const from = range.from
      ? await this.pageVersionText(id, range.from, language)
      : { title: '', text: '' };
    const changes = diffLines(from.text, to.text);
    if (from.title !== to.title) changes.unshift(`Title: ${from.title || '—'} → ${to.title}`);
    return { changes, text: to.text, title: to.title };
  }

  private async run(
    session: AiSession,
    input: AiSummariseInput,
    type: ContentType,
    id: string,
    range: { from: number; to: number } | null,
    material: { changes: string[] | null; text: string; title: string },
    ch: SseChannel,
  ): Promise<AiSummaryDto> {
    const kind = range ? 'CHANGES' : 'SUMMARY';
    if (range && !material.changes?.length)
      return { kind, text: '', noChanges: true, from: range.from, to: range.to };
    const what = type === 'PROCESS' ? 'process' : 'document';
    const lang = userLanguage(input.language);
    const prompt = range
      ? [
          `Explain in ${lang} what changed in the ${what} "${material.title}" from version ${range.from || '(none — first version)'} to version ${range.to}.`,
          input.instructions ? `<request>\n${input.instructions}\n</request>` : '',
          `Changes computed by the system:\n<content>\n${material.changes!.join('\n').slice(0, AI_DOCUMENT_MAX_CHARS)}\n</content>`,
          `The new version for context:\n<content>\n${material.text.slice(0, AI_DOCUMENT_MAX_CHARS / 2)}\n</content>`,
        ]
      : [
          `Summarise this ${what} in ${lang}.`,
          input.instructions ? `<request>\n${input.instructions}\n</request>` : '',
          `<content>\nTitle: ${material.title}\n${material.text.slice(0, AI_DOCUMENT_MAX_CHARS)}\n</content>`,
        ];
    const text = await this.gateway.call(session, {
      feature: 'SUMMARISE',
      fast: !range,
      system: range ? CHANGES_SYSTEM : SUMMARISE_SYSTEM,
      messages: [{ role: 'user', text: prompt.filter(Boolean).join('\n\n') }],
      maxTokens: 4000,
      effort: 'low',
      entity: { type, id },
      onText: ch.delta,
      signal: ch.signal,
    });
    return { kind, text: text.trim(), noChanges: false, ...(range ? range : {}) };
  }
}

/** Title and plain text of a page (or version) in the language, falling back to the other one. */
function pageText(
  p: { titleEn: string; titleAr: string; contentEn: string; contentAr: string },
  language: Locale,
): PageText {
  const en = { title: p.titleEn, text: htmlToText(p.contentEn) };
  const ar = { title: p.titleAr, text: htmlToText(p.contentAr) };
  const [first, second] = language === 'ar' ? [ar, en] : [en, ar];
  return first.text || first.title
    ? { title: first.title || second.title, text: first.text || second.text }
    : second;
}
