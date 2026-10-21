import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSIONS, type AiGenerateDocInput, type AiGeneratedDocDto } from '@processhub/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { forbidden } from '../../common/app-exception';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { sanitizeRichText } from '../../docs/rich-text';
import { AiContextService } from '../ai-context.service';
import { AiGatewayService, AiOutputInvalid } from '../ai-gateway.service';
import { describeProcess } from '../bpmn/describe';
import { GENERATE_DOC_SYSTEM } from '../prompts';
import type { AiJob } from './process-ai.service';

const docSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['titleEn', 'titleAr', 'htmlEn', 'htmlAr'],
  properties: {
    titleEn: { type: 'string', description: 'Page title in English' },
    titleAr: { type: 'string', description: 'Page title in Arabic' },
    htmlEn: { type: 'string', description: 'English document body (HTML)' },
    htmlAr: { type: 'string', description: 'Arabic document body (HTML)' },
  },
};
const docParser = (value: unknown) => {
  const res = z
    .object({
      titleEn: z.string().trim().min(1).max(300),
      titleAr: z.string().trim().min(1).max(300),
      htmlEn: z.string().min(20),
      htmlAr: z.string().min(20),
    })
    .safeParse(value);
  if (!res.success)
    throw new AiOutputInvalid(res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  return res.data;
};

/** Embedded, read-only diagram of the process (also links the page to the process). */
const diagramEmbed = (processId: string) =>
  `<div data-type="bpmn-diagram" data-process-id="${processId}"></div>`;

/**
 * Feature 3a: an SOP or Work Instruction page (English and Arabic) from a process, its roles,
 * systems and documents. Returned for preview; the page is created by the user.
 */
@Injectable()
export class DocAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AiGatewayService,
    private readonly context: AiContextService,
  ) {}

  async prepare(
    input: AiGenerateDocInput,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<AiJob<AiGeneratedDocDto>> {
    if (
      !user.permissions.has(PERMISSIONS.PROCESSES_READ) ||
      !user.permissions.has(PERMISSIONS.DOCS_EDIT)
    )
      throw forbidden('You cannot create documentation');
    const ctx = await this.context.process(input.processId);
    const session = await this.gateway.begin(user, meta);
    return async (ch) => {
      const template = await this.prisma.pageTemplate.findUnique({
        where: { key: input.template },
        select: { nameEn: true, contentEn: true, contentAr: true },
      });
      const p = ctx.process;
      const facts = [
        `Process: ${p.code} ${p.nameEn} / ${p.nameAr}`,
        p.descriptionEn || p.descriptionAr
          ? `Description: ${p.descriptionEn} / ${p.descriptionAr}`
          : '',
        p.owner ? `Process owner: ${p.owner.nameEn || p.owner.email} / ${p.owner.nameAr}` : '',
        p.department ? `Department: ${p.department.nameEn} / ${p.department.nameAr}` : '',
      ].filter(Boolean);
      const res = await this.gateway.call(session, {
        feature: 'GENERATE_DOC',
        system: GENERATE_DOC_SYSTEM,
        messages: [
          {
            role: 'user',
            text: [
              `Write a ${template?.nameEn ?? input.template} for this process.`,
              template
                ? `Template sections (English):\n<content>\n${template.contentEn}\n</content>\nTemplate sections (Arabic):\n<content>\n${template.contentAr}\n</content>`
                : '',
              input.instructions
                ? `Instructions:\n<request>\n${input.instructions}\n</request>`
                : '',
              `<process>\n${facts.join('\n')}\n${describeProcess(ctx.structure, ctx.links)}\n</process>`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        maxTokens: 48_000,
        effort: 'medium',
        output: { schema: docSchema, parse: docParser },
        entity: { type: 'PROCESS', id: input.processId },
        onProgress: ch.progress,
        signal: ch.signal,
      });
      // Never trust generated markup: the same sanitiser as every saved page.
      return {
        titleEn: res.titleEn,
        titleAr: res.titleAr,
        contentEn: diagramEmbed(p.id) + sanitizeRichText(res.htmlEn),
        contentAr: diagramEmbed(p.id) + sanitizeRichText(res.htmlAr),
        template: input.template,
        processId: p.id,
      };
    };
  }
}
