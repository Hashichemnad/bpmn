import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  CONTROL_GAP_ACTIONS,
  CONTROL_GAP_KINDS,
  PERMISSIONS,
  PROCESS_ELEMENT_ID,
  type AiControlGapsInput,
  type ControlGapsDto,
} from '@processhub/shared';
import { forbidden } from '../../common/app-exception';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import { PrismaService } from '../../prisma/prisma.service';
import { GrcService } from '../../grc/grc.service';
import { AiContextService } from '../ai-context.service';
import { AiGatewayService, AiOutputInvalid } from '../ai-gateway.service';
import { describeProcess } from '../bpmn/describe';
import { CONTROL_GAPS_SYSTEM, userLanguage } from '../prompts';
import type { AiJob } from './process-ai.service';

const SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;

const gapsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string', description: 'Two or three sentences: overall control assessment' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'kind',
          'severity',
          'title',
          'explanation',
          'suggestion',
          'elementIds',
          'itemIds',
          'action',
        ],
        properties: {
          kind: { type: 'string', enum: [...CONTROL_GAP_KINDS] },
          severity: { type: 'string', enum: [...SEVERITIES] },
          title: { type: 'string' },
          explanation: { type: 'string' },
          suggestion: { type: 'string' },
          elementIds: { type: 'array', items: { type: 'string' } },
          itemIds: { type: 'array', items: { type: 'string' } },
          action: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'controlId', 'nameEn', 'nameAr', 'elementId'],
            properties: {
              type: { type: 'string', enum: [...CONTROL_GAP_ACTIONS] },
              controlId: { type: 'string', description: 'Existing control id, or empty' },
              nameEn: { type: 'string' },
              nameAr: { type: 'string' },
              elementId: { type: 'string', description: 'Step id, or empty' },
            },
          },
        },
      },
    },
  },
};

const gapsSchema = z.object({
  summary: z.string().max(4000),
  findings: z
    .array(
      z.object({
        kind: z.enum(CONTROL_GAP_KINDS),
        severity: z.enum(SEVERITIES),
        title: z.string().min(1).max(300),
        explanation: z.string().max(2000),
        suggestion: z.string().max(2000),
        elementIds: z.array(z.string().max(200)).max(30),
        itemIds: z.array(z.string().max(100)).max(30),
        action: z.object({
          type: z.enum(CONTROL_GAP_ACTIONS),
          controlId: z.string().max(100),
          nameEn: z.string().max(300),
          nameAr: z.string().max(300),
          elementId: z.string().max(200),
        }),
      }),
    )
    .max(30),
});

/**
 * AI control-gap check (Phase 4.1, D-095): the rule gaps of a process plus its linked risks,
 * controls and requirements go to the model, which explains each gap, adds others it sees and
 * proposes a fix (link an existing control or create a new one). Suggestions are only proposals:
 * the user accepts (the client then calls the normal link / create endpoints) or dismisses them.
 */
@Injectable()
export class ControlGapsService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly context: AiContextService,
    private readonly grc: GrcService,
    private readonly prisma: PrismaService,
  ) {}

  async prepare(
    input: AiControlGapsInput,
    user: AuthUser,
    meta: RequestMeta,
  ): Promise<AiJob<ControlGapsDto>> {
    if (
      !user.permissions.has(PERMISSIONS.PROCESSES_READ) ||
      !user.permissions.has(PERMISSIONS.GRC_READ)
    )
      throw forbidden('You cannot read risks and controls');
    const ctx = input.bpmnXml
      ? await this.context.processWithXml(input.processId, input.bpmnXml)
      : await this.context.process(input.processId);
    const view = await this.grc.gaps(input.processId, ctx.xml ?? undefined);
    const controls = await this.prisma.repoObject.findMany({
      where: { type: 'CONTROL', deletedAt: null, control: { status: { not: 'RETIRED' } } },
      select: { id: true, code: true, nameEn: true, nameAr: true, descriptionEn: true },
      orderBy: { code: 'asc' },
      take: 200,
    });
    const structure = ctx.structure;
    const elementIds = new Set([
      ...structure.nodes.map((n) => n.id),
      ...structure.lanes.map((l) => l.id),
    ]);
    const itemIds = new Set(view.items.map((i) => i.id));
    const controlIds = new Set(controls.map((c) => c.id));
    const session = await this.gateway.begin(user, meta);

    const linked = view.items.map((i) => {
      const at = i.bpmnElementId === PROCESS_ELEMENT_ID ? 'whole process' : `[${i.bpmnElementId}]`;
      const detail = i.rating
        ? `residual ${i.rating.residualScore} (${i.rating.residualBand ?? ''})${i.effectivelyControlled ? ', effectively controlled' : ', no effective control'}`
        : i.effectiveness
          ? `effectiveness ${i.effectiveness}${i.keyControl ? ', key control' : ''}${i.overdue ? ', review overdue' : ''}`
          : '';
      return `- ${i.type} id=${i.id} ${i.code ?? ''} "${i.nameEn || i.nameAr}" at ${at}${detail ? ` — ${detail}` : ''}`;
    });
    const rules = view.gaps.map(
      (g) =>
        `- kind=${g.kind} severity=${g.severity} elementIds=${JSON.stringify(g.elementIds)} itemIds=${JSON.stringify(g.itemIds)}`,
    );
    const library = controls.map(
      (c) =>
        `- id=${c.id} ${c.code ?? ''} "${c.nameEn || c.nameAr}"${c.descriptionEn ? `: ${c.descriptionEn.slice(0, 160)}` : ''}`,
    );

    return async (ch) => {
      const parse = (value: unknown): ControlGapsDto => {
        const res = gapsSchema.safeParse(value);
        if (!res.success)
          throw new AiOutputInvalid(
            res.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`),
          );
        return {
          summary: res.data.summary,
          // Ids the model invented are dropped; an action without a valid target becomes NONE.
          findings: res.data.findings.map((f) => {
            const elementId = elementIds.has(f.action.elementId) ? f.action.elementId : null;
            const type =
              f.action.type === 'LINK_CONTROL' &&
              (!controlIds.has(f.action.controlId) || !elementId)
                ? 'NONE'
                : f.action.type === 'CREATE_CONTROL' && !elementId
                  ? 'NONE'
                  : f.action.type;
            return {
              ...f,
              elementIds: f.elementIds.filter((id) => elementIds.has(id)),
              itemIds: f.itemIds.filter((id) => itemIds.has(id)),
              action: {
                type,
                controlId: type === 'LINK_CONTROL' ? f.action.controlId : null,
                nameEn: type === 'CREATE_CONTROL' ? f.action.nameEn : '',
                nameAr: type === 'CREATE_CONTROL' ? f.action.nameAr : '',
                elementId: type === 'NONE' ? null : elementId,
              },
            };
          }),
        };
      };
      return this.gateway.call(session, {
        feature: 'CONTROL_GAPS',
        system: CONTROL_GAPS_SYSTEM,
        messages: [
          {
            role: 'user',
            text: [
              `Check the controls of this process. Write in ${userLanguage(input.language)}.`,
              `<process>\nProcess: ${ctx.process.code} ${structure.nameEn} / ${structure.nameAr}\n${describeProcess(structure, ctx.links)}\n</process>`,
              `<linked_items>\n${linked.join('\n') || '(none)'}\n</linked_items>`,
              `<rule_gaps>\n${rules.join('\n') || '(none)'}\n</rule_gaps>`,
              `<control_library>\n${library.join('\n') || '(empty)'}\n</control_library>`,
            ].join('\n\n'),
          },
        ],
        maxTokens: 12_000,
        effort: 'medium',
        output: { schema: gapsJsonSchema, parse },
        entity: { type: 'PROCESS', id: input.processId },
        onProgress: ch.progress,
        signal: ch.signal,
      });
    };
  }
}
