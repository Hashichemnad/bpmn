import type { SsoGroupMapping, SsoProvider, SystemRoleKey } from '@processhub/shared';

/** What ProcessHub takes from a verified ID token. */
export interface SsoIdentity {
  subject: string;
  email: string | null;
  /** The provider says the address is not verified (generic OIDC `email_verified: false`). */
  emailUnverified: boolean;
  name: string;
  groups: string[];
  /** Entra ID left the groups out because the user is in too many (more than 200). */
  groupsOverage: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Reads the identity from ID-token claims. Entra ID often has no `email` claim; its
 * `preferred_username` / `upn` is the sign-in address (user principal name).
 */
export function identityFromClaims(
  claims: Record<string, unknown>,
  provider: SsoProvider,
  groupsClaim: string,
): SsoIdentity {
  const candidates = [str(claims.email)];
  if (provider === 'ENTRA') candidates.push(str(claims.preferred_username), str(claims.upn));
  const email = candidates.find((c) => EMAIL.test(c))?.toLowerCase() ?? null;
  const rawGroups = claims[groupsClaim];
  const groups = Array.isArray(rawGroups)
    ? rawGroups.filter((g): g is string => typeof g === 'string' && g.length > 0).slice(0, 1000)
    : typeof rawGroups === 'string' && rawGroups
      ? [rawGroups]
      : [];
  const claimNames = claims._claim_names as Record<string, unknown> | undefined;
  const name =
    str(claims.name) ||
    [str(claims.given_name), str(claims.family_name)].filter(Boolean).join(' ') ||
    (email ? email.split('@')[0] : '');
  return {
    subject: str(claims.sub),
    email,
    emailUnverified: claims.email_verified === false,
    name: name.slice(0, 200),
    groups,
    groupsOverage: !!claimNames?.groups || claims.hasgroups === true || claims.hasgroups === 'true',
  };
}

export function domainAllowed(email: string, allowedDomains: readonly string[]): boolean {
  const domain = email.split('@').pop()!.toLowerCase();
  return allowedDomains.includes(domain);
}

/**
 * Roles and department from the group mappings. Roles of every matching mapping are combined;
 * the department of the first matching mapping that has one wins. `matched` is false when no
 * mapping applies (the caller then uses the default role).
 */
export function mapGroups(
  groups: readonly string[],
  mappings: readonly SsoGroupMapping[],
): { matched: boolean; roles: SystemRoleKey[]; departmentId: string | null } {
  const lower = new Set(groups.map((g) => g.toLowerCase()));
  const hits = mappings.filter((m) => lower.has(m.group.toLowerCase()));
  return {
    matched: hits.length > 0,
    roles: [...new Set(hits.flatMap((m) => m.roles))],
    departmentId: hits.find((m) => m.departmentId)?.departmentId ?? null,
  };
}

/** Only paths inside the app (no scheme, no `//host`, no backslashes) are accepted as return targets. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\s]/.test(value)) return '/';
  if (value.startsWith('/api/') || value.startsWith('/login')) return '/';
  return value;
}
