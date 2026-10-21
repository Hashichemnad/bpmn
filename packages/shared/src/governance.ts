import {
  PERMISSIONS,
  type ApprovalRule,
  type ContentStatus,
  type GovernanceAction,
  type Permission,
  type PortalAccessMode,
  type ReviewDateState,
  type ReviewTaskStatus,
  type SystemRoleKey,
} from './constants';
import { grantMatches, type SpaceAccessInfo, type SpaceAccessUser } from './space-access';

/**
 * Lifecycle: Draft → In Review → Approved → Published → Archived.
 * "Changes requested" and "Rejected" end a review and return the item to Draft.
 * Editing an approved or published item starts a new working copy (Draft); a published
 * version stays live in the portal until the new one is published.
 */
export const TRANSITIONS: Record<GovernanceAction, { from: ContentStatus[]; to: ContentStatus }> = {
  SUBMIT: { from: ['DRAFT'], to: 'IN_REVIEW' },
  WITHDRAW: { from: ['IN_REVIEW'], to: 'DRAFT' },
  APPROVE: { from: ['IN_REVIEW'], to: 'APPROVED' },
  REQUEST_CHANGES: { from: ['IN_REVIEW'], to: 'DRAFT' },
  REJECT: { from: ['IN_REVIEW'], to: 'DRAFT' },
  PUBLISH: { from: ['APPROVED'], to: 'PUBLISHED' },
  ARCHIVE: { from: ['DRAFT', 'APPROVED', 'PUBLISHED'], to: 'ARCHIVED' },
  RESTORE: { from: ['ARCHIVED'], to: 'DRAFT' },
  EDIT: { from: ['DRAFT', 'APPROVED', 'PUBLISHED'], to: 'DRAFT' },
};

/** Status after `action`, or null when the transition is not allowed from `status`. */
export function nextStatus(status: ContentStatus, action: GovernanceAction): ContentStatus | null {
  const t = TRANSITIONS[action];
  return t.from.includes(status) ? t.to : null;
}

export const canTransition = (status: ContentStatus, action: GovernanceAction) =>
  nextStatus(status, action) !== null;

/** Why content cannot be edited in this status (null = editable). */
export function editBlockedReason(
  status: ContentStatus,
): 'ITEM_IN_REVIEW' | 'ITEM_ARCHIVED' | null {
  if (status === 'IN_REVIEW') return 'ITEM_IN_REVIEW';
  if (status === 'ARCHIVED') return 'ITEM_ARCHIVED';
  return null;
}

// ---------- Review steps ----------

export interface StepTaskState {
  assigneeId: string;
  status: ReviewTaskStatus;
}

export type StepOutcome = 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

/**
 * Outcome of one step from its tasks. Any "changes requested" or "reject" ends the review;
 * ANY completes on the first approval, ALL needs every assignee's approval.
 */
export function stepOutcome(rule: ApprovalRule, tasks: StepTaskState[]): StepOutcome {
  if (tasks.some((t) => t.status === 'REJECTED')) return 'REJECTED';
  if (tasks.some((t) => t.status === 'CHANGES_REQUESTED')) return 'CHANGES_REQUESTED';
  const approved = tasks.filter((t) => t.status === 'APPROVED').length;
  if (rule === 'ANY') return approved > 0 ? 'APPROVED' : 'PENDING';
  const relevant = tasks.filter((t) => t.status !== 'SKIPPED').length;
  return relevant > 0 && approved === relevant ? 'APPROVED' : 'PENDING';
}

/**
 * Assignees of a step when `submitterId` submits: the submitter never reviews their own
 * work unless they are the only possible approver, in which case the step counts as approved
 * by submitting (e.g. a process owner submitting their own process for an owner step).
 */
export function stepAssignees(
  candidates: readonly string[],
  submitterId: string,
): { assigneeIds: string[]; approvedBySubmitter: boolean } {
  const unique = [...new Set(candidates)];
  const others = unique.filter((id) => id !== submitterId);
  if (others.length) return { assigneeIds: others, approvedBySubmitter: false };
  if (unique.includes(submitterId)) return { assigneeIds: [], approvedBySubmitter: true };
  return { assigneeIds: [], approvedBySubmitter: false };
}

// ---------- Review dates ----------

/** Adds calendar months, clamping to the last day of the target month (31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

/** NONE (no date), OK, DUE (within the reminder window) or OVERDUE. */
export function reviewDateState(
  nextReviewAt: Date | string | null | undefined,
  now: Date,
  reminderDays: number,
): ReviewDateState {
  if (!nextReviewAt) return 'NONE';
  const at = new Date(nextReviewAt);
  if (at.getTime() <= now.getTime()) return 'OVERDUE';
  if (at.getTime() <= addDays(now, reminderDays).getTime()) return 'DUE';
  return 'OK';
}

// ---------- Mentions ----------

const MENTION =
  /@\[([^\]\n]{1,200})\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

/** Comments store mentions as `@[Display name](user-uuid)`. */
export function mentionToken(name: string, userId: string): string {
  return `@[${name.replace(/[[\]\n]/g, ' ').trim()}](${userId})`;
}

/** Ids of users mentioned in a comment body (unique, lower-case). */
export function parseMentions(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(MENTION)) ids.add(m[2].toLowerCase());
  return [...ids];
}

export type CommentSegment =
  { type: 'text'; text: string } | { type: 'mention'; name: string; userId: string };

/** Splits a comment body into text and mention segments for rendering (never as HTML). */
export function commentSegments(body: string): CommentSegment[] {
  const out: CommentSegment[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION)) {
    if (m.index! > last) out.push({ type: 'text', text: body.slice(last, m.index) });
    out.push({ type: 'mention', name: m[1], userId: m[2].toLowerCase() });
    last = m.index! + m[0].length;
  }
  if (last < body.length) out.push({ type: 'text', text: body.slice(last) });
  return out;
}

/** Plain text of a comment (mentions as "@Name"), for emails and previews. */
export const commentPlainText = (body: string) =>
  commentSegments(body)
    .map((s) => (s.type === 'text' ? s.text : `@${s.name}`))
    .join('');

// ---------- Knowledge Portal ----------

export interface PortalAccessSettings {
  mode: PortalAccessMode;
  departmentIds: readonly string[];
  roleKeys: readonly SystemRoleKey[];
}

interface PortalUser {
  roles: readonly string[];
  departmentId: string | null;
  permissions: ReadonlySet<Permission> | readonly Permission[];
}

function has(user: PortalUser, p: Permission): boolean {
  const perms = user.permissions;
  return 'has' in perms ? perms.has(p) : perms.includes(p);
}

/**
 * Portal access: everyone with portal.read, or — when restricted — only the listed departments
 * and roles. Portal managers always keep access so they can fix the settings.
 */
export function portalAccessAllowed(user: PortalUser, access: PortalAccessSettings): boolean {
  if (!has(user, PERMISSIONS.PORTAL_READ)) return false;
  if (has(user, PERMISSIONS.PORTAL_MANAGE)) return true;
  if (access.mode === 'ALL') return true;
  return (
    (!!user.departmentId && access.departmentIds.includes(user.departmentId)) ||
    user.roles.some((r) => (access.roleKeys as readonly string[]).includes(r))
  );
}

/**
 * Whether a space's published pages are visible in the portal. Open spaces are visible to all
 * portal users; view-restricted spaces only to the owner, documentation managers and grantees.
 */
export function portalSpaceVisible(user: SpaceAccessUser, space: SpaceAccessInfo): boolean {
  if (!space.viewRestricted) return true;
  const perms = user.permissions;
  const manage =
    'has' in perms ? perms.has(PERMISSIONS.DOCS_MANAGE) : perms.includes(PERMISSIONS.DOCS_MANAGE);
  if (manage || (!!space.ownerId && space.ownerId === user.id)) return true;
  return space.grants.some((g) => grantMatches(user, g));
}

/**
 * Re-parents published items onto their nearest published ancestor, so the portal tree never
 * reveals unpublished items (orphans become roots).
 */
export function publishedForest<T extends { id: string; parentId: string | null }>(
  all: readonly { id: string; parentId: string | null }[],
  published: readonly T[],
): (T & { parentId: string | null })[] {
  const parentOf = new Map(all.map((i) => [i.id, i.parentId]));
  const visible = new Set(published.map((p) => p.id));
  return published.map((p) => {
    let parent = parentOf.get(p.id) ?? null;
    const seen = new Set<string>();
    while (parent && !visible.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      parent = parentOf.get(parent) ?? null;
    }
    return { ...p, parentId: parent && visible.has(parent) ? parent : null };
  });
}
