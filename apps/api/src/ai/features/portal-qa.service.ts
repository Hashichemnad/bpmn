import { GrcSettingsService } from '../../grc/grc-settings.service';
import { Injectable } from '@nestjs/common';
import {
  portalHiddenTypes,
  type AiAnswerDto,
  type AiPortalQuestionInput,
  type AiSourceDto,
  type Locale,
} from '@processhub/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { PortalAccessService } from '../../governance/portal-access.service';
import { toAnyTsQuery } from '../../search/search-query';
import { AiGatewayService } from '../ai-gateway.service';
import { describeProcess, type ElementLinks } from '../bpmn/describe';
import { readBpmn } from '../bpmn/read-bpmn';
import { PORTAL_QA_SYSTEM, userLanguage } from '../prompts';
import type { AiJob } from './process-ai.service';

/** Sources passed to the model per question, and characters of each. */
const MAX_SOURCES = 6;
const SOURCE_CHARS = 7000;
export const NOT_FOUND_MARKER = '[[NOT_FOUND]]';

type Pub = Awaited<ReturnType<PortalAccessService['publications']>>[number];

/**
 * Feature 7: questions in the Knowledge Portal, answered only from current publications the
 * user may see (portal access, space restrictions). Retrieval is PostgreSQL full-text search over
 * the publication read model (D-045); processes contribute the outline of their *published*
 * version, never the working copy. The answer cites its sources, which are returned as links.
 */
@Injectable()
export class PortalQaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGatewayService,
    private readonly portal: PortalAccessService,
    private readonly grcSettings: GrcSettingsService,
  ) {}

  async prepare(
    input: AiPortalQuestionInput,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<AiJob<AiAnswerDto>> {
    await this.portal.assertAccess(user);
    const session = await this.gateway.begin(user, meta);
    return async (ch) => {
      // Follow-up questions ("and who approves it?") also search with the previous question.
      const lastQuestion = [...input.history].reverse().find((h) => h.role === 'user')?.text ?? '';
      const pubs = await this.retrieve(user, `${input.question} ${lastQuestion}`);
      if (!pubs.length) return { answer: '', answered: false, sources: [] };
      const blocks = await Promise.all(
        pubs.map((p, i) => this.sourceBlock(p, i + 1, input.language)),
      );
      const text = await this.gateway.call(session, {
        feature: 'PORTAL_QA',
        system: PORTAL_QA_SYSTEM,
        messages: [
          ...input.history.map((h) => ({ role: h.role, text: h.text })),
          {
            role: 'user',
            text: [
              `Answer in ${userLanguage(input.language)}.`,
              blocks.join('\n\n'),
              `Question:\n<request>\n${input.question}\n</request>`,
            ].join('\n\n'),
          },
        ],
        maxTokens: 4000,
        effort: 'low',
        onText: ch.delta,
        signal: ch.signal,
      });
      const answered = !text.includes(NOT_FOUND_MARKER);
      const cited = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))].filter(
        (n) => n >= 1 && n <= pubs.length,
      );
      return {
        answer: text.replace(NOT_FOUND_MARKER, '').trim(),
        answered,
        sources: answered ? cited.map((n) => toSource(pubs[n - 1], n)) : [],
      };
    };
  }

  /** Best-matching visible current publications for the question (any-term full-text search). */
  private async retrieve(user: AuthUser, question: string): Promise<Pub[]> {
    const tsq = toAnyTsQuery(question);
    if (!tsq) return [];
    const visible = await this.portal.publications(user);
    if (!visible.length) return [];
    const ids = visible.map((p) => p.id);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH q AS (SELECT to_tsquery('english', ${tsq}) || to_tsquery('arabic', ${tsq}) AS query)
      SELECT p."id" FROM "Publication" p, q
      WHERE p."id" = ANY(${ids}::uuid[]) AND p."searchVector" @@ query
      ORDER BY ts_rank_cd(p."searchVector", query) DESC, p."publishedAt" DESC
      LIMIT ${MAX_SOURCES}`;
    const byId = new Map(visible.map((p) => [p.id, p]));
    // Full published text only for the few sources sent to the model.
    return this.portal.withText(rows.map((r) => byId.get(r.id)!).filter(Boolean), true);
  }

  /** One numbered <source> block: the published text (pages) or published outline (processes). */
  private async sourceBlock(p: Pub, n: number, language: Locale): Promise<string> {
    const title = [p.code, language === 'ar' ? p.titleAr || p.titleEn : p.titleEn || p.titleAr]
      .filter(Boolean)
      .join(' ');
    const head = `<source n="${n}" type="${p.entityType === 'PROCESS' ? 'process' : p.entityType === 'DIAGRAM' ? 'diagram' : 'document'}" title="${title.replace(/"/g, "'")}"${p.versionLabel ? ` version="${p.versionLabel}"` : ''}>`;
    let body: string;
    if (p.entityType === 'PROCESS') body = await this.publishedProcess(p);
    else {
      const [first, second] = language === 'ar' ? [p.textAr, p.textEn] : [p.textEn, p.textAr];
      body = (first || second).slice(0, SOURCE_CHARS);
    }
    return `${head}\n${body}\n</source>`;
  }

  private async publishedProcess(p: Pub): Promise<string> {
    const description = [p.descriptionEn, p.descriptionAr].filter(Boolean).join(' / ');
    const version = await this.prisma.processVersion.findUnique({
      where: { processId_versionNumber: { processId: p.entityId, versionNumber: p.versionNumber } },
      select: { bpmnXml: true },
    });
    if (!version) return description;
    const hidden = portalHiddenTypes((await this.grcSettings.get()).portalVisibility);
    const links = await this.prisma.publishedLink.findMany({
      where: { publicationId: p.id, repoObject: { deletedAt: null, type: { notIn: hidden } } },
      select: {
        bpmnElementId: true,
        relation: true,
        repoObject: { select: { type: true, nameEn: true, nameAr: true } },
      },
    });
    const byElement: ElementLinks = {};
    for (const l of links)
      (byElement[l.bpmnElementId] ??= []).push({ ...l.repoObject, relation: l.relation });
    try {
      const outline = describeProcess(readBpmn(version.bpmnXml).structure, byElement);
      return `${description}\n${outline}`.slice(0, SOURCE_CHARS);
    } catch {
      return description;
    }
  }
}

const toSource = (p: Pub, ref: number): AiSourceDto => ({
  ref,
  type: p.entityType,
  id: p.entityId,
  code: p.code,
  titleEn: p.titleEn,
  titleAr: p.titleAr,
  versionLabel: p.versionLabel,
});
