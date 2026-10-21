import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  AI_FINDING_KINDS,
  PERMISSIONS,
  type AiAnalyseInput,
  type AiAnalysisDto,
} from '@processhub/shared';
import { forbidden } from '../../common/app-exception';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { AiContextService } from '../ai-context.service';
import { AiGatewayService, AiOutputInvalid } from '../ai-gateway.service';
import { describeProcess } from '../bpmn/describe';
import { ANALYSE_SYSTEM, userLanguage } from '../prompts';
import type { AiJob } from './process-ai.service';

const SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;

const analysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings', 'warnings'],
  properties: {
    summary: { type: 'string', description: 'Two or three sentences: overall assessment' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'severity', 'title', 'explanation', 'suggestion', 'elementIds'],
        properties: {
          kind: { type: 'string', enum: [...AI_FINDING_KINDS] },
          severity: { type: 'string', enum: [...SEVERITIES] },
          title: { type: 'string' },
          explanation: { type: 'string' },
          suggestion: { type: 'string' },
          elementIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    warnings: {
      type: 'array',
      description: 'One entry per validation warning received, in the same order',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'elementId', 'explanation'],
        properties: {
          code: { type: 'string' },
          elementId: { type: 'string', description: 'Element id, or empty' },
          explanation: { type: 'string' },
        },
      },
    },
  },
};

const analysisSchema = z.object({
  summary: z.string().max(4000),
  findings: z
    .array(
      z.object({
        kind: z.enum(AI_FINDING_KINDS),
        severity: z.enum(SEVERITIES),
        title: z.string().min(1).max(300),
        explanation: z.string().max(2000),
        suggestion: z.string().max(2000),
        elementIds: z.array(z.string().max(100)).max(30),
      }),
    )
    .max(25),
  warnings: z
    .array(
      z.object({
        code: z.string().max(50),
        elementId: z.string().max(200),
        explanation: z.string().max(2000),
      }),
    )
    .max(50),
});

/**
 * Feature 5: findings on a process (missing steps, unclear responsibilities, bottlenecks, risks,
 * controls) with explanations, and plain-language explanations of its validation warnings.
 */
@Injectable()
export class AnalyseService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly context: AiContextService,
  ) {}

  async prepare(
    input: AiAnalyseInput,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<AiJob<AiAnalysisDto>> {
    if (!user.permissions.has(PERMISSIONS.PROCESSES_READ))
      throw forbidden('You cannot read processes');
    // The modeler sends the diagram as shown (it may have unsaved changes).
    const ctx = input.bpmnXml
      ? await this.context.processWithXml(input.processId, input.bpmnXml)
      : await this.context.process(input.processId);
    const structure = ctx.structure;
    const ids = new Set([...structure.nodes.map((n) => n.id), ...structure.lanes.map((l) => l.id)]);
    const session = await this.gateway.begin(user, meta);
    return async (ch) => {
      const parse = (value: unknown): AiAnalysisDto => {
        const res = analysisSchema.safeParse(value);
        if (!res.success)
          throw new AiOutputInvalid(
            res.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`),
          );
        return {
          summary: res.data.summary,
          // Element ids that do not exist in the diagram are dropped, never shown as links.
          findings: res.data.findings.map((f) => ({
            ...f,
            elementIds: f.elementIds.filter((id) => ids.has(id)),
          })),
          warnings: res.data.warnings.map((w) => ({
            ...w,
            elementId: w.elementId && ids.has(w.elementId) ? w.elementId : null,
          })),
        };
      };
      const warnings = input.warnings.map(
        (w) =>
          `- ${w.code}${w.elementId ? ` on [${w.elementId}]${w.elementName ? ` "${w.elementName}"` : ''}` : ''}`,
      );
      return this.gateway.call(session, {
        feature: 'ANALYSE',
        system: ANALYSE_SYSTEM,
        messages: [
          {
            role: 'user',
            text: [
              `Analyse this process. Write in ${userLanguage(input.language)}.`,
              input.focus ? `Focus:\n<request>\n${input.focus}\n</request>` : '',
              `<process>\nProcess: ${ctx.process.code} ${structure.nameEn} / ${structure.nameAr}\n${structure.descriptionEn}\n${describeProcess(structure, ctx.links)}\n</process>`,
              warnings.length
                ? `Validation warnings of the modeler (codes: NO_START_EVENT, NO_END_EVENT, UNCONNECTED_ELEMENT, MISSING_INCOMING, MISSING_OUTGOING, UNNAMED_ACTIVITY, GATEWAY_NOT_BRANCHING, CALL_ACTIVITY_UNLINKED):\n${warnings.join('\n')}`
                : 'There are no validation warnings.',
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        maxTokens: 16_000,
        effort: 'medium',
        output: { schema: analysisJsonSchema, parse },
        entity: { type: 'PROCESS', id: input.processId },
        onProgress: ch.progress,
        signal: ch.signal,
      });
    };
  }
}
