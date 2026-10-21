import {
  PERMISSIONS,
  type Permission,
  type SpaceAccessLevel,
  type SpacePrincipalType,
} from './constants';

export interface SpaceAccessUser {
  id: string;
  roles: readonly string[];
  departmentId: string | null;
  permissions: ReadonlySet<Permission> | readonly Permission[];
}

export interface SpaceAccessGrant {
  principalType: SpacePrincipalType;
  principalId: string;
  access: SpaceAccessLevel;
}

export interface SpaceAccessInfo {
  ownerId: string | null;
  viewRestricted: boolean;
  editRestricted: boolean;
  grants: readonly SpaceAccessGrant[];
}

export interface SpaceAccess {
  canView: boolean;
  canEdit: boolean;
  /** Edit the space itself, its permissions and its trash. */
  canManage: boolean;
}

function has(user: SpaceAccessUser, p: Permission): boolean {
  const perms = user.permissions;
  return 'has' in perms ? perms.has(p) : perms.includes(p);
}

export function grantMatches(user: SpaceAccessUser, g: SpaceAccessGrant): boolean {
  switch (g.principalType) {
    case 'USER':
      return g.principalId === user.id;
    case 'ROLE':
      return user.roles.includes(g.principalId);
    case 'DEPARTMENT':
      return !!user.departmentId && g.principalId === user.departmentId;
  }
}

/**
 * Per-space permissions on top of the global roles:
 *  - docs.manage holders and the space owner can do everything in the space.
 *  - Viewing needs docs.read and, for restricted spaces, a VIEW or EDIT grant.
 *  - Editing needs docs.edit, view access and, for edit-restricted spaces, an EDIT grant.
 */
export function spaceAccess(user: SpaceAccessUser, space: SpaceAccessInfo): SpaceAccess {
  const read = has(user, PERMISSIONS.DOCS_READ);
  const canManage =
    has(user, PERMISSIONS.DOCS_MANAGE) || (read && !!space.ownerId && space.ownerId === user.id);
  if (canManage) return { canView: true, canEdit: true, canManage: true };
  const matching = space.grants.filter((g) => grantMatches(user, g));
  const canView = read && (!space.viewRestricted || matching.length > 0);
  const canEdit =
    canView &&
    has(user, PERMISSIONS.DOCS_EDIT) &&
    (!space.editRestricted || matching.some((g) => g.access === 'EDIT'));
  return { canView, canEdit, canManage: false };
}
