import type { Locale, Permission, SystemRoleKey } from '@processhub/shared';

/** The authenticated user attached to each request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  nameEn: string;
  nameAr: string;
  locale: Locale;
  departmentId: string | null;
  roles: SystemRoleKey[];
  permissions: Set<Permission>;
  /** False for accounts created by single sign-on (no local password). */
  hasPassword: boolean;
  ssoLinked: boolean;
  mfaEnabled: boolean;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}
