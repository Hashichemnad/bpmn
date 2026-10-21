import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLES } from './constants';
import { spaceAccess, type SpaceAccessInfo, type SpaceAccessUser } from './space-access';

const user = (
  role: keyof typeof SYSTEM_ROLES,
  extra: Partial<SpaceAccessUser> = {},
): SpaceAccessUser => ({
  id: 'u1',
  roles: [role],
  departmentId: 'd1',
  permissions: new Set(SYSTEM_ROLES[role].permissions),
  ...extra,
});

const open: SpaceAccessInfo = {
  ownerId: null,
  viewRestricted: false,
  editRestricted: false,
  grants: [],
};

describe('spaceAccess', () => {
  it('open spaces: readers view, editors edit, admins manage', () => {
    expect(spaceAccess(user('VIEWER'), open)).toEqual({
      canView: true,
      canEdit: false,
      canManage: false,
    });
    expect(spaceAccess(user('MODELER'), open)).toEqual({
      canView: true,
      canEdit: true,
      canManage: false,
    });
    expect(spaceAccess(user('ADMIN'), open)).toEqual({
      canView: true,
      canEdit: true,
      canManage: true,
    });
  });

  it('the owner manages the space', () => {
    expect(spaceAccess(user('VIEWER'), { ...open, ownerId: 'u1' }).canManage).toBe(true);
  });

  it('view-restricted spaces need a matching grant', () => {
    const s: SpaceAccessInfo = {
      ...open,
      viewRestricted: true,
      grants: [{ principalType: 'DEPARTMENT', principalId: 'd2', access: 'VIEW' }],
    };
    expect(spaceAccess(user('MODELER'), s).canView).toBe(false);
    expect(spaceAccess(user('MODELER', { departmentId: 'd2' }), s)).toEqual({
      canView: true,
      canEdit: true,
      canManage: false,
    });
    expect(spaceAccess(user('ADMIN'), s).canView).toBe(true);
  });

  it('edit-restricted spaces need an EDIT grant and docs.edit', () => {
    const s: SpaceAccessInfo = {
      ...open,
      editRestricted: true,
      grants: [
        { principalType: 'ROLE', principalId: 'MODELER', access: 'EDIT' },
        { principalType: 'USER', principalId: 'u1', access: 'EDIT' },
      ],
    };
    expect(spaceAccess(user('MODELER', { id: 'x' }), s).canEdit).toBe(true);
    expect(spaceAccess(user('PROCESS_OWNER', { id: 'x' }), s).canEdit).toBe(false);
    // A grant does not replace the global permission: viewers cannot edit.
    expect(spaceAccess(user('VIEWER'), s).canEdit).toBe(false);
  });

  it('users without docs.read see nothing', () => {
    const u: SpaceAccessUser = { id: 'u1', roles: [], departmentId: null, permissions: [] };
    expect(spaceAccess(u, open).canView).toBe(false);
    expect(spaceAccess(u, { ...open, ownerId: 'u1' }).canManage).toBe(false);
  });
});
