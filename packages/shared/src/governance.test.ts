import { describe, expect, it } from 'vitest';
import {
  addMonths,
  commentPlainText,
  commentSegments,
  editBlockedReason,
  mentionToken,
  nextStatus,
  parseMentions,
  portalAccessAllowed,
  portalSpaceVisible,
  publishedForest,
  reviewDateState,
  stepAssignees,
  stepOutcome,
} from './governance';
import { PERMISSIONS, PROCESS_STATUSES, GOVERNANCE_ACTIONS } from './constants';
import { reviewDecisionSchema, workflowSchema, portalSettingsSchema } from './schemas';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('lifecycle transitions', () => {
  it('follows Draft → In Review → Approved → Published → Archived', () => {
    expect(nextStatus('DRAFT', 'SUBMIT')).toBe('IN_REVIEW');
    expect(nextStatus('IN_REVIEW', 'APPROVE')).toBe('APPROVED');
    expect(nextStatus('APPROVED', 'PUBLISH')).toBe('PUBLISHED');
    expect(nextStatus('PUBLISHED', 'ARCHIVE')).toBe('ARCHIVED');
    expect(nextStatus('ARCHIVED', 'RESTORE')).toBe('DRAFT');
  });

  it('changes requested, reject and withdraw return to Draft', () => {
    for (const a of ['REQUEST_CHANGES', 'REJECT', 'WITHDRAW'] as const) {
      expect(nextStatus('IN_REVIEW', a)).toBe('DRAFT');
    }
  });

  it('rejects invalid transitions', () => {
    expect(nextStatus('DRAFT', 'PUBLISH')).toBeNull();
    expect(nextStatus('DRAFT', 'APPROVE')).toBeNull();
    expect(nextStatus('PUBLISHED', 'SUBMIT')).toBeNull();
    expect(nextStatus('IN_REVIEW', 'ARCHIVE')).toBeNull();
    expect(nextStatus('ARCHIVED', 'EDIT')).toBeNull();
    // Every action is valid from at least one status.
    for (const a of GOVERNANCE_ACTIONS) {
      expect(PROCESS_STATUSES.some((s) => nextStatus(s, a))).toBe(true);
    }
  });

  it('editing a published or approved item starts a new draft; in review it is locked', () => {
    expect(nextStatus('PUBLISHED', 'EDIT')).toBe('DRAFT');
    expect(nextStatus('APPROVED', 'EDIT')).toBe('DRAFT');
    expect(editBlockedReason('IN_REVIEW')).toBe('ITEM_IN_REVIEW');
    expect(editBlockedReason('ARCHIVED')).toBe('ITEM_ARCHIVED');
    expect(editBlockedReason('PUBLISHED')).toBeNull();
  });
});

describe('review steps', () => {
  it('ANY completes on the first approval', () => {
    expect(
      stepOutcome('ANY', [
        { assigneeId: U1, status: 'PENDING' },
        { assigneeId: U2, status: 'APPROVED' },
      ]),
    ).toBe('APPROVED');
    expect(stepOutcome('ANY', [{ assigneeId: U1, status: 'PENDING' }])).toBe('PENDING');
  });

  it('ALL needs every approval; one rejection or change request ends the step', () => {
    const two = (a: string, b: string) =>
      [
        { assigneeId: U1, status: a },
        { assigneeId: U2, status: b },
      ] as never;
    expect(stepOutcome('ALL', two('APPROVED', 'PENDING'))).toBe('PENDING');
    expect(stepOutcome('ALL', two('APPROVED', 'APPROVED'))).toBe('APPROVED');
    expect(stepOutcome('ALL', two('APPROVED', 'CHANGES_REQUESTED'))).toBe('CHANGES_REQUESTED');
    expect(stepOutcome('ANY', two('PENDING', 'REJECTED'))).toBe('REJECTED');
  });

  it('the submitter never reviews their own work (four-eyes principle)', () => {
    expect(stepAssignees([U1, U2, U2], U1)).toEqual({ assigneeIds: [U2], onlySubmitter: false });
    expect(stepAssignees([U1], U1)).toEqual({ assigneeIds: [], onlySubmitter: true });
    expect(stepAssignees([], U1)).toEqual({ assigneeIds: [], onlySubmitter: false });
  });

  it('decisions other than approve need a comment', () => {
    expect(reviewDecisionSchema.safeParse({ decision: 'APPROVE' }).success).toBe(true);
    expect(reviewDecisionSchema.safeParse({ decision: 'REJECT' }).success).toBe(false);
    expect(
      reviewDecisionSchema.safeParse({ decision: 'REQUEST_CHANGES', comment: '  ' }).success,
    ).toBe(false);
    expect(
      reviewDecisionSchema.safeParse({ decision: 'REQUEST_CHANGES', comment: 'Fix step 2' })
        .success,
    ).toBe(true);
  });

  it('validates workflow definitions', () => {
    const ok = workflowSchema.safeParse({
      nameEn: 'Two-step',
      steps: [
        { nameEn: 'Review', rule: 'ANY', assignees: [{ type: 'ROLE', roleKey: 'REVIEWER' }] },
        { nameEn: 'Owner', assignees: [{ type: 'OWNER' }] },
      ],
    });
    expect(ok.success).toBe(true);
    expect(workflowSchema.safeParse({ nameEn: 'x', steps: [] }).success).toBe(false);
    expect(
      workflowSchema.safeParse({ nameEn: 'x', steps: [{ nameEn: 'a', assignees: [] }] }).success,
    ).toBe(false);
  });
});

describe('review dates', () => {
  it('adds months and clamps to the end of the month', () => {
    expect(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T10:00:00.000Z',
    );
    expect(addMonths(new Date('2026-10-21T00:00:00Z'), 12).toISOString()).toBe(
      '2027-10-21T00:00:00.000Z',
    );
  });

  it('classifies the next review date', () => {
    const now = new Date('2026-10-21T00:00:00Z');
    expect(reviewDateState(null, now, 14)).toBe('NONE');
    expect(reviewDateState('2026-10-20T00:00:00Z', now, 14)).toBe('OVERDUE');
    expect(reviewDateState('2026-10-30T00:00:00Z', now, 14)).toBe('DUE');
    expect(reviewDateState('2027-01-01T00:00:00Z', now, 14)).toBe('OK');
  });
});

describe('mentions', () => {
  it('parses and renders mention tokens', () => {
    const body = `Hi ${mentionToken('Sara [QA]', U1)}, see ${mentionToken('Omar', U2)} and ${mentionToken('Sara', U1)}`;
    expect(parseMentions(body)).toEqual([U1, U2]);
    expect(commentPlainText(body)).toBe('Hi @Sara  QA, see @Omar and @Sara');
    expect(commentSegments('plain')).toEqual([{ type: 'text', text: 'plain' }]);
    expect(parseMentions('@[x](not-a-uuid)')).toEqual([]);
  });
});

describe('portal access', () => {
  const user = (roles: string[], departmentId: string | null, perms: string[]) => ({
    id: U1,
    roles,
    departmentId,
    permissions: perms as never,
  });

  it('allows everyone with portal.read in ALL mode', () => {
    const u = user(['VIEWER'], null, [PERMISSIONS.PORTAL_READ]);
    expect(portalAccessAllowed(u, { mode: 'ALL', departmentIds: [], roleKeys: [] })).toBe(true);
    expect(
      portalAccessAllowed(user([], null, []), { mode: 'ALL', departmentIds: [], roleKeys: [] }),
    ).toBe(false);
  });

  it('restricts to departments or roles; managers always pass', () => {
    const access = {
      mode: 'RESTRICTED' as const,
      departmentIds: [U2],
      roleKeys: ['REVIEWER' as const],
    };
    expect(portalAccessAllowed(user(['VIEWER'], null, [PERMISSIONS.PORTAL_READ]), access)).toBe(
      false,
    );
    expect(portalAccessAllowed(user(['VIEWER'], U2, [PERMISSIONS.PORTAL_READ]), access)).toBe(true);
    expect(portalAccessAllowed(user(['REVIEWER'], null, [PERMISSIONS.PORTAL_READ]), access)).toBe(
      true,
    );
    expect(
      portalAccessAllowed(
        user(['ADMIN'], null, [PERMISSIONS.PORTAL_READ, PERMISSIONS.PORTAL_MANAGE]),
        access,
      ),
    ).toBe(true);
  });

  it('shows restricted spaces only to grantees', () => {
    const u = user(['VIEWER'], U2, [PERMISSIONS.PORTAL_READ]);
    const space = { ownerId: null, viewRestricted: true, editRestricted: false, grants: [] };
    expect(portalSpaceVisible(u, { ...space, viewRestricted: false })).toBe(true);
    expect(portalSpaceVisible(u, space)).toBe(false);
    expect(
      portalSpaceVisible(u, {
        ...space,
        grants: [{ principalType: 'DEPARTMENT', principalId: U2, access: 'VIEW' }],
      }),
    ).toBe(true);
  });

  it('attaches published items to their nearest published ancestor', () => {
    const all = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: 'x' },
    ];
    const forest = publishedForest(all, [
      { id: 'a', parentId: null },
      { id: 'c', parentId: 'b' },
      { id: 'd', parentId: 'x' },
    ]);
    expect(forest.map((f) => [f.id, f.parentId])).toEqual([
      ['a', null],
      ['c', 'a'],
      ['d', null],
    ]);
  });

  it('accepts only safe quick links', () => {
    const base = { access: { mode: 'ALL' } };
    const parse = (url: string) =>
      portalSettingsSchema.safeParse({ ...base, quickLinks: [{ titleEn: 'x', url }] }).success;
    expect(parse('https://intranet.example.com/hr')).toBe(true);
    expect(parse('/portal/search?q=leave')).toBe(true);
    expect(parse('javascript:alert(1)')).toBe(false);
    expect(parse('//evil.example')).toBe(false);
  });
});
