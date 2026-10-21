/** Supported UI / content languages. */
export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const RTL_LOCALES: readonly Locale[] = ['ar'];

/**
 * Fine-grained permissions. Roles are bundles of permissions; the server checks
 * permissions (never role names) on every request.
 */
export const PERMISSIONS = {
  USERS_READ: 'users.read',
  USERS_MANAGE: 'users.manage',
  DEPARTMENTS_READ: 'departments.read',
  DEPARTMENTS_MANAGE: 'departments.manage',
  ROLES_READ: 'roles.read',
  AUDIT_READ: 'audit.read',
  SETTINGS_MANAGE: 'settings.manage',
  PROCESSES_READ: 'processes.read',
  PROCESSES_CREATE: 'processes.create',
  /** Edit any process. */
  PROCESSES_EDIT: 'processes.edit',
  /** Edit only processes the user owns. */
  PROCESSES_EDIT_OWN: 'processes.edit_own',
  PROCESSES_DELETE: 'processes.delete',
  MODELS_EDIT: 'models.edit',
  MODELS_EDIT_OWN: 'models.edit_own',
  OBJECTS_READ: 'objects.read',
  OBJECTS_MANAGE: 'objects.manage',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const SYSTEM_ROLE_KEYS = [
  'SUPER_ADMIN',
  'ADMIN',
  'PROCESS_OWNER',
  'MODELER',
  'REVIEWER',
  'VIEWER',
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

const P = PERMISSIONS;
const READ_REPOSITORY: Permission[] = [P.PROCESSES_READ, P.OBJECTS_READ, P.DEPARTMENTS_READ];

/** Default permission bundle of each system role (see CLAUDE.md §6). */
export const SYSTEM_ROLES: Record<
  SystemRoleKey,
  { nameEn: string; nameAr: string; permissions: Permission[] }
> = {
  SUPER_ADMIN: { nameEn: 'Super Admin', nameAr: 'مسؤول النظام الأعلى', permissions: ALL_PERMISSIONS },
  ADMIN: {
    nameEn: 'Admin',
    nameAr: 'مسؤول',
    permissions: ALL_PERMISSIONS.filter((p) => p !== P.SETTINGS_MANAGE),
  },
  PROCESS_OWNER: {
    nameEn: 'Process Owner',
    nameAr: 'مالك العملية',
    permissions: [...READ_REPOSITORY, P.USERS_READ, P.PROCESSES_EDIT_OWN, P.MODELS_EDIT_OWN],
  },
  MODELER: {
    nameEn: 'Modeler / Editor',
    nameAr: 'مصمم / محرر',
    permissions: [
      ...READ_REPOSITORY,
      P.USERS_READ,
      P.PROCESSES_CREATE,
      P.PROCESSES_EDIT,
      P.MODELS_EDIT,
      P.OBJECTS_MANAGE,
    ],
  },
  REVIEWER: {
    nameEn: 'Reviewer',
    nameAr: 'مراجع',
    permissions: [...READ_REPOSITORY, P.USERS_READ],
  },
  VIEWER: {
    nameEn: 'Viewer',
    nameAr: 'مشاهد',
    // Phase 1: read-only repository access. Restricted to published content in Phase 3 (Portal).
    permissions: READ_REPOSITORY,
  },
};

export const PROCESS_CATEGORIES = ['MANAGEMENT', 'CORE', 'SUPPORT'] as const;
export type ProcessCategory = (typeof PROCESS_CATEGORIES)[number];

export const PROCESS_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'ARCHIVED',
] as const;
export type ProcessStatus = (typeof PROCESS_STATUSES)[number];

export const OBJECT_TYPES = ['ROLE', 'SYSTEM', 'DOCUMENT', 'RISK', 'CONTROL', 'KPI'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];
/** Object types that have a library UI in Phase 1. */
export const PHASE1_OBJECT_TYPES: ObjectType[] = ['ROLE', 'SYSTEM'];

export const LINK_RELATIONS = [
  'PERFORMS',
  'SUPPORTS',
  'INPUT',
  'OUTPUT',
  'MITIGATES',
  'MEASURES',
] as const;
export type LinkRelation = (typeof LINK_RELATIONS)[number];

/** Default relation used when linking an object of a given type to a BPMN element. */
export const DEFAULT_RELATION_FOR_TYPE: Record<ObjectType, LinkRelation> = {
  ROLE: 'PERFORMS',
  SYSTEM: 'SUPPORTS',
  DOCUMENT: 'INPUT',
  RISK: 'MITIGATES',
  CONTROL: 'MITIGATES',
  KPI: 'MEASURES',
};

export const USER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'LOCKOUT',
  'PASSWORD_CHANGE',
  'PASSWORD_RESET',
  'MOVE',
  'VERSION',
  'PUBLISH',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
  'User',
  'Department',
  'Process',
  'ProcessModel',
  'ProcessVersion',
  'RepoObject',
  'ObjectLink',
  'Setting',
  'Auth',
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const SETTING_KEYS = {
  ORG_NAME_EN: 'org.nameEn',
  ORG_NAME_AR: 'org.nameAr',
  DEFAULT_LOCALE: 'org.defaultLocale',
  LOGO: 'branding.logo',
} as const;

/** Logo upload limits. */
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;

/** BPMN import limit. */
export const BPMN_MAX_BYTES = 5 * 1024 * 1024;

export const CSRF_COOKIE = 'ph_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const ACCESS_COOKIE = 'ph_access';
export const REFRESH_COOKIE = 'ph_refresh';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
