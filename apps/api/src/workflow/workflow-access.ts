import type { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@processhub/shared';
import type { AuthUser } from '../common/auth-user';
import { canEditProcess } from '../processes/processes.service';

/**
 * Who may do what with executable processes and cases (D-149). Pure helpers; the services load the
 * rows and call these, and every endpoint checks on the server.
 */

const P = PERMISSIONS;

/** Execution settings and deployment: `workflow.design` plus edit rights on the process. */
export function canDesignWorkflow(user: AuthUser, process: { ownerId: string | null }): boolean {
  return (
    user.permissions.has(P.WORKFLOW_ADMIN) ||
    (user.permissions.has(P.WORKFLOW_DESIGN) && canEditProcess(user, process))
  );
}

export const isWorkflowAdmin = (user: AuthUser) => user.permissions.has(P.WORKFLOW_ADMIN);

/** Read-only monitors of every process: Auditors (audit log + workflow monitor). */
export const isGlobalMonitor = (user: AuthUser) =>
  isWorkflowAdmin(user) ||
  (user.permissions.has(P.WORKFLOW_MONITOR) && user.permissions.has(P.AUDIT_READ));

export interface StartRights {
  startMode: string;
  startRoles: string[];
  startDepartmentIds: string[];
}

/** Start rights of one process: everyone with `workflow.start`, or only some roles / departments. */
export function canStartProcess(user: AuthUser, cfg: StartRights): boolean {
  if (!user.permissions.has(P.WORKFLOW_START)) return false;
  if (cfg.startMode !== 'RESTRICTED') return true;
  if (user.roles.some((r) => cfg.startRoles.includes(r))) return true;
  return !!user.departmentId && cfg.startDepartmentIds.includes(user.departmentId);
}

export interface CaseAccessInput {
  initiatorId: string | null;
  process: { ownerId: string | null; departmentId: string | null };
  monitorUserIds: string[];
  /** Users who are or were assignee / candidate / performer of a task of the case. */
  involvedUserIds: Iterable<string>;
}

/** Monitor rights on a process: admin, Auditor, or `workflow.monitor` for its department / named monitor. */
export function canMonitorProcess(
  user: AuthUser,
  process: { ownerId: string | null; departmentId: string | null },
  monitorUserIds: string[],
): boolean {
  if (isGlobalMonitor(user)) return true;
  if (process.ownerId === user.id) return true;
  if (!user.permissions.has(P.WORKFLOW_MONITOR)) return false;
  return (
    (!!process.departmentId && process.departmentId === user.departmentId) ||
    monitorUserIds.includes(user.id)
  );
}

/** Case visibility (D-149). */
export function canSeeCase(user: AuthUser, c: CaseAccessInput): boolean {
  if (c.initiatorId === user.id) return true;
  for (const id of c.involvedUserIds) if (id === user.id) return true;
  return canMonitorProcess(user, c.process, c.monitorUserIds);
}

/** Prisma filter of the cases a user may monitor (null = all). */
export function monitorCaseWhere(user: AuthUser): Prisma.WorkflowCaseWhereInput | null {
  if (isGlobalMonitor(user)) return null;
  const or: Prisma.WorkflowCaseWhereInput[] = [{ process: { ownerId: user.id } }];
  if (user.permissions.has(P.WORKFLOW_MONITOR)) {
    if (user.departmentId) or.push({ process: { departmentId: user.departmentId } });
    or.push({ process: { workflowConfig: { monitorUserIds: { has: user.id } } } });
  }
  return { OR: or };
}

/** Prisma filter of the processes a user may monitor (null = all). */
export function monitorProcessWhere(user: AuthUser): Prisma.ProcessWhereInput | null {
  if (isGlobalMonitor(user)) return null;
  const or: Prisma.ProcessWhereInput[] = [{ ownerId: user.id }];
  if (user.permissions.has(P.WORKFLOW_MONITOR)) {
    if (user.departmentId) or.push({ departmentId: user.departmentId });
    or.push({ workflowConfig: { monitorUserIds: { has: user.id } } });
  }
  return { OR: or };
}

/** Cases a user may see in lists: own, involved, or monitored. */
export function visibleCaseWhere(user: AuthUser): Prisma.WorkflowCaseWhereInput {
  const monitor = monitorCaseWhere(user);
  if (!monitor) return {};
  return {
    OR: [
      { initiatorId: user.id },
      {
        tasks: {
          some: {
            OR: [
              { assigneeId: user.id },
              { completedById: user.id },
              { onBehalfOfId: user.id },
              { candidates: { some: { userId: user.id } } },
            ],
          },
        },
      },
      monitor,
    ],
  };
}
