import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  AI_DOCUMENT_MAX_CHARS,
  PERMISSIONS,
  type AiDocToProcessInput,
  type AiGenerateProcessInput,
  type AiGeneratedProcessDto,
  type AiRefineProcessInput,
} from '@processhub/shared';
import { forbidden } from '../../common/app-exception';
import { assertSafeBpmnXml } from '../../models/bpmn-xml';
import { DocsAccessService } from '../../docs/docs-access.service';
import { htmlToText } from '../../docs/rich-text';
import { AiContextService } from '../ai-context.service';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { ProcessesService, canEditModel } from '../../processes/processes.service';
import { AiGatewayService, type AiSession } from '../ai-gateway.service';
import { AiLibraryService } from '../ai-library.service';
import { AiError } from '../providers/types';
import type { SseChannel } from '../sse';
import {
  DOC_TO_PROCESS_SYSTEM,
  GENERATE_PROCESS_SYSTEM,
  REFINE_PROCESS_SYSTEM,
  userLanguage,
} from '../prompts';
import {
  isActivity,
  isEvent,
  isGateway,
  parseStructure,
  structureJsonSchema,
  type ProcessStructure,
} from '../bpmn/process-structure';
import { structureToBpmn, type BuildOptions } from '../bpmn/structure-to-bpmn';
import { bpmnWarnings, readBpmn } from '../bpmn/read-bpmn';

export type AiJob<T> = (channel: SseChannel) => Promise<T>;

/** Output budget for a whole structured process (bilingual labels and descriptions). */
const PROCESS_MAX_TOKENS = 32_000;

/**
 * Turns a validated structure into the preview the user confirms: BPMN XML with auto-layout,
 * suggested links to the library and validation warnings. The XML is read back to prove it parses.
 */
export function buildProcessResult(
  s: ProcessStructure,
  catalog: Awaited<ReturnType<AiLibraryService['catalog']>>,
  opts: Omit<BuildOptions, 'key'> = {},
): AiGeneratedProcessDto {
  const bpmnXml = structureToBpmn(s, { key: randomBytes(4).toString('hex'), ...opts });
  const back = readBpmn(bpmnXml);
  if (
    back.structure.nodes.length !== s.nodes.length ||
    back.structure.flows.length !== s.flows.length
  ) {
    throw new AiError('AI_INVALID_OUTPUT', 'The generated diagram does not round-trip');
  }
  return {
    bpmnXml,
    nameEn: s.nameEn,
    nameAr: s.nameAr,
    descriptionEn: s.descriptionEn,
    descriptionAr: s.descriptionAr,
    explanation: s.explanation,
    ...AiLibraryService.suggestLinks(s, catalog),
    warnings: bpmnWarnings(bpmnXml),
    dropped: 0,
    counts: {
      lanes: s.lanes.length,
      tasks: s.nodes.filter((n) => isActivity(n.type)).length,
      gateways: s.nodes.filter((n) => isGateway(n.type)).length,
      events: s.nodes.filter((n) => isEvent(n.type)).length,
      flows: s.flows.length,
    },
  };
}

@Injectable()
export class ProcessAiService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly library: AiLibraryService,
    private readonly processes: ProcessesService,
    private readonly context: AiContextService,
    private readonly docsAccess: DocsAccessService,
  ) {}

  /** Edit rights on the model of an existing process (404 when it does not exist). */
  async assertCanEditModel(processId: string, user: AuthUser) {
    const p = await this.processes.findActive(processId);
    if (!canEditModel(user, p)) throw forbidden('You cannot edit this model');
    return p;
  }

  /** Feature 1: a process from a description (modeler or "New process" dialog). */
  async prepareGenerate(
    input: AiGenerateProcessInput,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<AiJob<AiGeneratedProcessDto>> {
    if (input.processId) await this.assertCanEditModel(input.processId, user);
    else if (!user.permissions.has(PERMISSIONS.PROCESSES_CREATE))
      throw forbidden('You cannot create processes');
    const session = await this.gateway.begin(user, meta);
    return (ch) => this.generate(session, input, ch);
  }

  private async generate(session: AiSession, input: AiGenerateProcessInput, ch: SseChannel) {
    const [catalog, theme] = await Promise.all([
      this.library.catalog(),
      this.context.diagramTheme(),
    ]);
    const structure = await this.gateway.call(session, {
      feature: 'GENERATE_PROCESS',
      system: GENERATE_PROCESS_SYSTEM,
      messages: [
        {
          role: 'user',
          text: [
            AiLibraryService.catalogPrompt(catalog),
            '',
            `The user writes in ${userLanguage(input.language)}. Model this process:`,
            `<request>\n${input.description}\n</request>`,
          ].join('\n'),
        },
      ],
      maxTokens: PROCESS_MAX_TOKENS,
      effort: 'medium',
      output: { schema: structureJsonSchema, parse: parseStructure },
      entity: input.processId ? { type: 'PROCESS', id: input.processId } : undefined,
      onProgress: ch.progress,
      signal: ch.signal,
    });
    return buildProcessResult(structure, catalog, { theme });
  }

  /** Feature 2: change the diagram on request; the proposal is reviewed before it is applied. */
  async prepareRefine(
    input: AiRefineProcessInput,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<AiJob<AiGeneratedProcessDto>> {
    const p = await this.assertCanEditModel(input.processId, user);
    assertSafeBpmnXml(input.bpmnXml);
    const current = this.context.fromXml(input.bpmnXml, p);
    const session = await this.gateway.begin(user, meta);
    return async (ch) => {
      const [catalog, links, theme] = await Promise.all([
        this.library.catalog(),
        this.context.links(input.processId),
        this.context.diagramTheme(),
      ]);
      const structure = await this.gateway.call(session, {
        feature: 'REFINE_PROCESS',
        system: REFINE_PROCESS_SYSTEM,
        messages: [
          ...input.history.map((h) => ({ role: h.role, text: h.text })),
          {
            role: 'user',
            text: [
              AiLibraryService.catalogPrompt(catalog),
              '',
              'Current process model (JSON):',
              `<process>\n${JSON.stringify(current.structure)}\n</process>`,
              '',
              `Instruction (written in ${userLanguage(input.language)}):`,
              `<request>\n${input.instruction}\n</request>`,
            ].join('\n'),
          },
        ],
        maxTokens: PROCESS_MAX_TOKENS,
        effort: 'medium',
        output: { schema: structureJsonSchema, parse: parseStructure },
        entity: { type: 'PROCESS', id: input.processId },
        onProgress: ch.progress,
        signal: ch.signal,
      });
      const result = buildProcessResult(structure, catalog, {
        preserve: current.preserve,
        flowIds: current.flowIds,
        containers: current.containers,
        theme,
      });
      // Propose links only for new elements; existing links stay attached to kept ids.
      const before = new Set(current.structure.nodes.map((n) => n.id));
      result.suggestedLinks = result.suggestedLinks.filter(
        (l) => !before.has(l.elementId) && !(links[l.elementId] ?? []).length,
      );
      result.dropped = current.dropped;
      return result;
    };
  }

  /** Feature 3b: a process draft from a wiki page (the user creates the process from it). */
  async prepareDocToProcess(
    input: AiDocToProcessInput,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<AiJob<AiGeneratedProcessDto>> {
    if (!user.permissions.has(PERMISSIONS.PROCESSES_CREATE))
      throw forbidden('You cannot create processes');
    const { page } = await this.docsAccess.page(input.pageId, user, 'view');
    await this.context.assertAllowedOn('PAGE', page.id);
    const pick = (l: 'en' | 'ar') =>
      l === 'en'
        ? { title: page.titleEn, html: page.contentEn }
        : { title: page.titleAr, html: page.contentAr };
    const primary = pick(input.language);
    const doc = htmlToText(primary.html).trim()
      ? primary
      : pick(input.language === 'en' ? 'ar' : 'en');
    const text = htmlToText(doc.html).slice(0, AI_DOCUMENT_MAX_CHARS);
    const session = await this.gateway.begin(user, meta);
    return async (ch) => {
      const [catalog, theme] = await Promise.all([
        this.library.catalog(),
        this.context.diagramTheme(),
      ]);
      const structure = await this.gateway.call(session, {
        feature: 'DOC_TO_PROCESS',
        system: DOC_TO_PROCESS_SYSTEM,
        messages: [
          {
            role: 'user',
            text: [
              AiLibraryService.catalogPrompt(catalog),
              '',
              `Write the explanation in ${userLanguage(input.language)}.`,
              input.instructions
                ? `Additional instructions:\n<request>\n${input.instructions}\n</request>`
                : '',
              `Document "${doc.title}":`,
              `<document>\n${text}\n</document>`,
            ].join('\n'),
          },
        ],
        maxTokens: PROCESS_MAX_TOKENS,
        effort: 'medium',
        output: { schema: structureJsonSchema, parse: parseStructure },
        entity: { type: 'PAGE', id: input.pageId },
        onProgress: ch.progress,
        signal: ch.signal,
      });
      return buildProcessResult(structure, catalog, { theme });
    };
  }
}
