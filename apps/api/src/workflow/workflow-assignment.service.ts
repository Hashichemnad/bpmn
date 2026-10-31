import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Assignment, WfNode } from '@processhub/shared';

type Tx = Prisma.TransactionClient;

export interface AssignmentContext {
  caseId: string;
  processOwnerId: string | null;
  initiatorId: string | null;
  /** Initiator's department when the case started. */
  departmentId: string | null;
  vars: Record<string, unknown>;
}

export interface ResolvedAssignees {
  /** Single assignee (null = group task with candidates). */
  assigneeId: string | null;
  candidateIds: string[];
  /** The user a substitute works for (out of office). */
  onBehalfOfId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Today's date (YYYY-MM-DD) in the organisation's zone, for out-of-office periods. */
const today = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/**
 * Assignment rules (step 2): lane role, role + department, specific user, process owner, initiator,
 * initiator's manager (department head, walking up the tree), previous performer, or a user chosen in a
 * form. One user → assigned task; several → group task to claim. Out-of-office users are replaced by
 * their substitute; with four-eyes the initiator and earlier performers are left out when others remain.
 */
@Injectable()
export class WorkflowAssignmentService {
  async users(
    tx: Tx,
    a: Assignment,
    node: WfNode | null,
    ctx: AssignmentContext,
  ): Promise<string[]> {
    switch (a.type) {
      case 'LANE_ROLE':
      case 'ROLE': {
        const roleId = a.type === 'LANE_ROLE' ? node?.laneRoleId : a.roleId;
        if (!roleId) return [];
        const departmentId =
          a.department === 'INITIATOR'
            ? ctx.departmentId
            : a.department === 'SPECIFIC'
              ? a.departmentId
              : null;
        if (a.department !== 'ANY' && !departmentId) return [];
        const rows = await tx.userJobRole.findMany({
          where: {
            repoObjectId: roleId,
            user: { deletedAt: null, status: 'ACTIVE', ...(departmentId ? { departmentId } : {}) },
          },
          select: { userId: true },
          orderBy: { userId: 'asc' },
        });
        return rows.map((r) => r.userId);
      }
      case 'USER':
        return a.userId ? this.active(tx, [a.userId]) : [];
      case 'PROCESS_OWNER':
        return ctx.processOwnerId ? this.active(tx, [ctx.processOwnerId]) : [];
      case 'INITIATOR':
        return ctx.initiatorId ? this.active(tx, [ctx.initiatorId]) : [];
      case 'INITIATOR_MANAGER': {
        let dep = ctx.departmentId;
        for (let i = 0; dep && i < 10; i++) {
          const d = await tx.department.findUnique({
            where: { id: dep },
            select: { managerId: true, parentId: true },
          });
          if (!d) break;
          // The initiator's own manager; a manager starting a case goes to the next level up.
          if (d.managerId && d.managerId !== ctx.initiatorId) {
            const ok = await this.active(tx, [d.managerId]);
            if (ok.length) return ok;
          }
          dep = d.parentId;
        }
        return [];
      }
      case 'PREVIOUS_PERFORMER': {
        if (!a.elementId) return [];
        const t = await tx.workflowTask.findFirst({
          where: { caseId: ctx.caseId, elementId: a.elementId, status: 'COMPLETED' },
          orderBy: { completedAt: 'desc' },
          select: { completedById: true },
        });
        return t?.completedById ? this.active(tx, [t.completedById]) : [];
      }
      case 'FORM_FIELD': {
        const v = a.fieldKey ? ctx.vars[a.fieldKey] : null;
        return typeof v === 'string' && UUID.test(v) ? this.active(tx, [v]) : [];
      }
    }
  }

  private async active(tx: Tx, ids: string[]) {
    const rows = await tx.user.findMany({
      where: { id: { in: ids }, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Earlier performers of the case and the initiator (four-eyes). */
  async excluded(tx: Tx, ctx: AssignmentContext): Promise<Set<string>> {
    const done = await tx.workflowTask.findMany({
      where: { caseId: ctx.caseId, status: 'COMPLETED', completedById: { not: null } },
      select: { completedById: true },
    });
    return new Set([
      ...(ctx.initiatorId ? [ctx.initiatorId] : []),
      ...done.map((d) => d.completedById!),
    ]);
  }

  /** Users of a task, with four-eyes and out-of-office substitution applied. */
  async resolve(
    tx: Tx,
    node: WfNode,
    ctx: AssignmentContext,
    timeZone: string,
  ): Promise<ResolvedAssignees | null> {
    const a: Assignment = node.exec.assignment ?? {
      type: 'LANE_ROLE',
      roleId: null,
      department: 'ANY',
      departmentId: null,
      userId: null,
      elementId: null,
      fieldKey: null,
    };
    let ids = await this.users(tx, a, node, ctx);
    if (node.exec.fourEyes) {
      const ex = await this.excluded(tx, ctx);
      const rest = ids.filter((i) => !ex.has(i));
      if (rest.length) ids = rest;
    }
    if (!ids.length) return null;
    const subs = await this.substitutes(tx, ids, timeZone);
    if (ids.length === 1) {
      const sub = subs.get(ids[0]);
      return sub
        ? { assigneeId: sub, candidateIds: [], onBehalfOfId: ids[0] }
        : { assigneeId: ids[0], candidateIds: [], onBehalfOfId: null };
    }
    const candidates = [...new Set(ids.map((i) => subs.get(i) ?? i))];
    if (candidates.length === 1)
      return { assigneeId: candidates[0], candidateIds: [], onBehalfOfId: null };
    return { assigneeId: null, candidateIds: candidates, onBehalfOfId: null };
  }

  /** Out of office today → active substitute (one level). */
  async substitutes(tx: Tx, ids: string[], timeZone: string): Promise<Map<string, string>> {
    const day = new Date(`${today(timeZone)}T00:00:00Z`);
    const rows = await tx.user.findMany({
      where: {
        id: { in: ids },
        substituteId: { not: null },
        outOfOfficeFrom: { lte: day },
        outOfOfficeTo: { gte: day },
      },
      select: { id: true, substituteId: true },
    });
    const subIds = await this.active(
      tx,
      rows.map((r) => r.substituteId!),
    );
    return new Map(
      rows
        .filter((r) => subIds.includes(r.substituteId!) && r.substituteId !== r.id)
        .map((r) => [r.id, r.substituteId!]),
    );
  }
}
