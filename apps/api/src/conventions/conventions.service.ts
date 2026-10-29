import { Injectable } from '@nestjs/common';
import {
  SETTING_KEYS,
  blockingIssues,
  checkConventions,
  graphLabel,
  parseBpmnGraph,
  resolveConventions,
  type ConventionIssue,
  type ModelingConventions,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { badRequest } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';

/** A failed rule as the client shows it: the rule, the element and its labels. */
export interface ConventionViolation extends ConventionIssue {
  nameEn?: string;
  nameAr?: string;
}

/** Modeling conventions (D-088): the Admin's house rules and the check before a submission. */
@Injectable()
export class ConventionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<ModelingConventions> {
    const row = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.MODELING_CONVENTIONS },
    });
    return resolveConventions(row?.value);
  }

  async set(input: ModelingConventions, actor: AuthUser, meta: RequestMeta) {
    const key = SETTING_KEYS.MODELING_CONVENTIONS;
    const before = await this.get();
    await this.prisma.$transaction(async (tx) => {
      const value = { ...input };
      await tx.setting.upsert({
        where: { key },
        create: { key, value, updatedById: actor.id },
        update: { value, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Setting',
          entityId: key,
          userId: actor.id,
          summary: { before, after: input },
          meta,
        },
        tx,
      );
    });
    return this.get();
  }

  /** Mandatory rules a diagram fails (empty: it may be submitted). */
  async violations(bpmnXml: string): Promise<ConventionViolation[]> {
    const graph = parseBpmnGraph(bpmnXml);
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    return blockingIssues(checkConventions(graph, await this.get())).map((i) => {
      const n = i.elementId ? nodes.get(i.elementId) : undefined;
      return n ? { ...i, nameEn: graphLabel(n, 'en'), nameAr: graphLabel(n, 'ar') } : i;
    });
  }

  /** Throws `CONVENTIONS_NOT_MET` (with the failed rules) when a mandatory rule fails. */
  async assertMandatory(bpmnXml: string) {
    const failed = await this.violations(bpmnXml);
    if (failed.length) {
      throw badRequest(
        'CONVENTIONS_NOT_MET',
        'The process does not meet the mandatory modeling conventions',
        { count: failed.length, issues: failed.slice(0, 50) },
      );
    }
  }
}
