import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  extractBpmnLabels,
  type AiTranslateInput,
  type AiTranslationDto,
  type Locale,
} from '@processhub/shared';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { assertSafeBpmnXml } from '../../models/bpmn-xml';
import { sanitizeRichText } from '../../docs/rich-text';
import { AiGatewayService, AiOutputInvalid, type AiSession } from '../ai-gateway.service';
import { AiLibraryService } from '../ai-library.service';
import { TRANSLATE_PAGE_SYSTEM, TRANSLATE_SYSTEM } from '../prompts';
import type { SseChannel } from '../sse';
import type { AiJob } from './process-ai.service';

const LANG = { en: 'English', ar: 'Arabic' } as const;
const other = (l: Locale): Locale => (l === 'en' ? 'ar' : 'en');

/** Labels of at most this many BPMN elements are translated in one request. */
const MAX_ELEMENTS = 300;

const listSchema = (description: string) => ({
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      description,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'description'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string', description: 'Translated label / text' },
          description: {
            type: 'string',
            description: 'Translated description; empty if none was given',
          },
        },
      },
    },
  },
});

const itemsSchema = z.object({
  items: z.array(
    z.object({ id: z.string(), text: z.string().max(10_000), description: z.string().max(5000) }),
  ),
});

/** Parser that requires a translation for every requested id. */
const itemsParser = (ids: string[]) => (value: unknown) => {
  const res = itemsSchema.safeParse(value);
  if (!res.success)
    throw new AiOutputInvalid(res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  const got = new Map(res.data.items.map((i) => [i.id, i]));
  const missing = ids.filter((id) => !got.get(id)?.text.trim() && !got.get(id)?.description.trim());
  if (missing.length)
    throw new AiOutputInvalid([`Missing translations for: ${missing.slice(0, 30).join(', ')}`]);
  return got;
};

const pageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'html'],
  properties: { title: { type: 'string' }, html: { type: 'string' } },
};
const pageParser = (value: unknown) => {
  const res = z.object({ title: z.string().max(300), html: z.string() }).safeParse(value);
  if (!res.success) throw new AiOutputInvalid(['Return an object with "title" and "html"']);
  return res.data;
};

/**
 * Feature 4: EN ↔ AR translation of form fields, BPMN labels (only those missing in the target
 * language) and wiki pages, with the organisation's approved terminology as a glossary. Results
 * are returned for review; nothing is saved here.
 */
@Injectable()
export class TranslateService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly library: AiLibraryService,
  ) {}

  async prepare(
    input: AiTranslateInput,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<AiJob<AiTranslationDto>> {
    if (input.kind === 'bpmn') assertSafeBpmnXml(input.bpmnXml);
    const session = await this.gateway.begin(user, meta);
    return (ch) => {
      if (input.kind === 'fields') return this.fields(session, input, ch);
      if (input.kind === 'bpmn') return this.bpmn(session, input, ch);
      return this.page(session, input, ch);
    };
  }

  private async prompt(source: Locale, target: Locale, text: string, intro: string) {
    const glossary = await this.library.glossary(text, source);
    return [
      `Translate from ${LANG[source]} into ${LANG[target]}.`,
      glossary.length
        ? `Glossary (${LANG[source]} → ${LANG[target]}):\n${glossary.join('\n')}`
        : 'Glossary: (none)',
      '',
      intro,
    ].join('\n');
  }

  private async fields(
    session: AiSession,
    input: Extract<AiTranslateInput, { kind: 'fields' }>,
    ch: SseChannel,
  ): Promise<AiTranslationDto> {
    const items = input.fields.filter((f) => f.text.trim());
    if (!items.length) return { kind: 'fields', target: input.target, fields: {} };
    const source = other(input.target);
    const content = JSON.stringify(items.map((f) => ({ id: f.key, text: f.text })));
    const got = await this.gateway.call(session, {
      feature: 'TRANSLATE',
      fast: true,
      system: TRANSLATE_SYSTEM,
      messages: [
        {
          role: 'user',
          text: await this.prompt(
            source,
            input.target,
            content,
            `Translate each item (put "" in description):\n<content>\n${content}\n</content>`,
          ),
        },
      ],
      maxTokens: 8000,
      effort: 'low',
      output: {
        schema: listSchema('One entry per input item, same id'),
        parse: itemsParser(items.map((i) => i.key)),
      },
      onProgress: ch.progress,
      signal: ch.signal,
    });
    return {
      kind: 'fields',
      target: input.target,
      fields: Object.fromEntries(items.map((f) => [f.key, got.get(f.key)?.text.trim() ?? ''])),
    };
  }

  private async bpmn(
    session: AiSession,
    input: Extract<AiTranslateInput, { kind: 'bpmn' }>,
    ch: SseChannel,
  ): Promise<AiTranslationDto> {
    const source = other(input.target);
    const todo: { id: string; text: string; description: string }[] = [];
    for (const [id, l] of extractBpmnLabels(input.bpmnXml)) {
      const srcName = source === 'en' ? l.nameEn || (l.nameAr ? '' : l.name) : l.nameAr;
      const tgtName = input.target === 'en' ? l.nameEn || (l.nameAr ? '' : l.name) : l.nameAr;
      const srcDesc = source === 'en' ? l.descriptionEn : l.descriptionAr;
      const tgtDesc = input.target === 'en' ? l.descriptionEn : l.descriptionAr;
      const text = srcName && !tgtName ? srcName : '';
      const description = srcDesc && !tgtDesc ? srcDesc : '';
      if (text || description) todo.push({ id, text, description });
    }
    if (!todo.length) return { kind: 'bpmn', target: input.target, elements: [] };
    const batch = todo.slice(0, MAX_ELEMENTS);
    const content = JSON.stringify(batch);
    const got = await this.gateway.call(session, {
      feature: 'TRANSLATE',
      fast: true,
      system: TRANSLATE_SYSTEM,
      messages: [
        {
          role: 'user',
          text: await this.prompt(
            source,
            input.target,
            batch.map((b) => `${b.text} ${b.description}`).join('\n'),
            `These are labels ("text") and step descriptions of a BPMN process diagram. Translate each; keep "" where the input is "":\n<content>\n${content}\n</content>`,
          ),
        },
      ],
      maxTokens: 16_000,
      effort: 'low',
      output: {
        schema: listSchema('One entry per input element, same id'),
        parse: itemsParser(batch.map((b) => b.id)),
      },
      onProgress: ch.progress,
      signal: ch.signal,
    });
    return {
      kind: 'bpmn',
      target: input.target,
      elements: batch.map((b) => ({
        id: b.id,
        source: b.text || b.description,
        name: b.text ? (got.get(b.id)?.text.trim() ?? '') : '',
        description: b.description ? (got.get(b.id)?.description.trim() ?? '') : '',
      })),
    };
  }

  private async page(
    session: AiSession,
    input: Extract<AiTranslateInput, { kind: 'page' }>,
    ch: SseChannel,
  ): Promise<AiTranslationDto> {
    const source = other(input.target);
    const html = sanitizeRichText(input.html);
    const res = await this.gateway.call(session, {
      feature: 'TRANSLATE',
      system: TRANSLATE_PAGE_SYSTEM,
      messages: [
        {
          role: 'user',
          text: await this.prompt(
            source,
            input.target,
            `${input.title}\n${html.replace(/<[^>]+>/g, ' ')}`,
            `Translate the page title and the HTML page content:\n<content>\nTitle: ${input.title}\n\n${html}\n</content>`,
          ),
        },
      ],
      maxTokens: 64_000,
      effort: 'low',
      output: { schema: pageSchema, parse: pageParser },
      onProgress: ch.progress,
      signal: ch.signal,
    });
    // Never trust generated markup: same sanitiser as every saved page.
    return {
      kind: 'page',
      target: input.target,
      title: res.title.trim(),
      html: sanitizeRichText(res.html),
    };
  }
}
