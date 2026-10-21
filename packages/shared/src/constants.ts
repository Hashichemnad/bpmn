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
  /** Read documentation spaces and pages (subject to per-space restrictions). */
  DOCS_READ: 'docs.read',
  /** Create and edit pages in spaces where editing is allowed. */
  DOCS_EDIT: 'docs.edit',
  /** Create and manage spaces, space permissions, templates and the trash. */
  DOCS_MANAGE: 'docs.manage',
  /** Comment on processes and pages (and @mention colleagues). */
  COMMENTS_WRITE: 'comments.write',
  /** Approve, reject or request changes when assigned to a review step (read-only roles never are). */
  REVIEWS_DECIDE: 'reviews.decide',
  /** Configure approval workflows and act on any item's lifecycle (publish, archive, withdraw). */
  GOVERNANCE_MANAGE: 'governance.manage',
  /** See the governance dashboard (status counts, reviews in progress, overdue reviews). */
  GOVERNANCE_DASHBOARD: 'governance.dashboard',
  /** Read published content in the Knowledge Portal. */
  PORTAL_READ: 'portal.read',
  /** Portal name, branding, quick links, featured items and access. */
  PORTAL_MANAGE: 'portal.manage',
  /** See the AI usage report (requests and tokens per user, feature and month). */
  AI_USAGE_READ: 'ai.usage.read',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const SYSTEM_ROLE_KEYS = [
  'SUPER_ADMIN',
  'ADMIN',
  'PROCESS_OWNER',
  'MODELER',
  'REVIEWER',
  'AUDITOR',
  'VIEWER',
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

const P = PERMISSIONS;
const READ_REPOSITORY: Permission[] = [
  P.PROCESSES_READ,
  P.OBJECTS_READ,
  P.DEPARTMENTS_READ,
  P.DOCS_READ,
  P.COMMENTS_WRITE,
  P.PORTAL_READ,
  P.REVIEWS_DECIDE,
];

/** System roles that only read: never offered as workflow approvers. */
export const READ_ONLY_ROLE_KEYS: readonly SystemRoleKey[] = ['AUDITOR', 'VIEWER'];

/** Default permission bundle of each system role (see CLAUDE.md §6). */
export const SYSTEM_ROLES: Record<
  SystemRoleKey,
  { nameEn: string; nameAr: string; permissions: Permission[] }
> = {
  SUPER_ADMIN: {
    nameEn: 'Super Admin',
    nameAr: 'مسؤول النظام الأعلى',
    permissions: ALL_PERMISSIONS,
  },
  ADMIN: {
    nameEn: 'Admin',
    nameAr: 'مسؤول',
    permissions: ALL_PERMISSIONS.filter((p) => p !== P.SETTINGS_MANAGE),
  },
  PROCESS_OWNER: {
    nameEn: 'Process Owner',
    nameAr: 'مالك العملية',
    permissions: [
      ...READ_REPOSITORY,
      P.USERS_READ,
      P.PROCESSES_EDIT_OWN,
      P.MODELS_EDIT_OWN,
      P.DOCS_EDIT,
      P.GOVERNANCE_DASHBOARD,
    ],
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
      P.DOCS_EDIT,
    ],
  },
  REVIEWER: {
    nameEn: 'Reviewer',
    nameAr: 'مراجع',
    permissions: [...READ_REPOSITORY, P.USERS_READ],
  },
  AUDITOR: {
    nameEn: 'Auditor',
    nameAr: 'مدقق',
    // Read-only workspace: drafts, history, reviews and the audit log; no edit, approve,
    // publish or comment rights.
    permissions: [
      P.PROCESSES_READ,
      P.OBJECTS_READ,
      P.DEPARTMENTS_READ,
      P.DOCS_READ,
      P.PORTAL_READ,
      P.USERS_READ,
      P.AUDIT_READ,
      P.GOVERNANCE_DASHBOARD,
      P.AI_USAGE_READ,
    ],
  },
  VIEWER: {
    nameEn: 'Viewer',
    nameAr: 'مشاهد',
    // Knowledge Portal only: published content, read-only (D-028).
    permissions: [P.PORTAL_READ],
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
/** Object types that have a library UI (documents since Phase 3: linked to steps in the portal). */
export const PHASE1_OBJECT_TYPES: ObjectType[] = ['ROLE', 'SYSTEM', 'DOCUMENT'];

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
  'RESTORE',
  'LABEL',
  'PURGE',
  'SYNC',
  'SUBMIT',
  'WITHDRAW',
  'APPROVE',
  'REQUEST_CHANGES',
  'REJECT',
  'ARCHIVE',
  'UNARCHIVE',
  'REVIEW_CONFIRMED',
  'RESOLVE',
  'REOPEN',
  'EMAIL_TEST',
  'AI_REQUEST',
  'MFA_ENABLE',
  'MFA_DISABLE',
  'MFA_RESET',
  'MFA_RECOVERY_CODES',
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
  'Space',
  'Page',
  'PageVersion',
  'PageTemplate',
  'PageLink',
  'Attachment',
  'Integration',
  'Workflow',
  'Review',
  'Comment',
  'Feedback',
  'AI',
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const SETTING_KEYS = {
  ORG_NAME_EN: 'org.nameEn',
  ORG_NAME_AR: 'org.nameAr',
  DEFAULT_LOCALE: 'org.defaultLocale',
  LOGO: 'branding.logo',
  GIT_INTEGRATION: 'integrations.git',
  GOVERNANCE: 'governance',
  PORTAL: 'portal',
  EMAIL: 'email',
  AI: 'ai',
  AUTH: 'auth',
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

// ---------- Documentation wiki (M5) ----------

/** Icons a space can use (mapped to Ant Design icons in the web client). */
export const SPACE_ICONS = [
  'book',
  'safety',
  'team',
  'setting',
  'database',
  'cloud',
  'bank',
  'tool',
  'rocket',
  'heart',
  'audit',
  'global',
] as const;
export type SpaceIcon = (typeof SPACE_ICONS)[number];

export const SPACE_ACCESS_LEVELS = ['VIEW', 'EDIT'] as const;
export type SpaceAccessLevel = (typeof SPACE_ACCESS_LEVELS)[number];

export const SPACE_PRINCIPAL_TYPES = ['USER', 'ROLE', 'DEPARTMENT'] as const;
export type SpacePrincipalType = (typeof SPACE_PRINCIPAL_TYPES)[number];

export const TEXT_DIRECTIONS = ['ltr', 'rtl'] as const;
export type TextDirection = (typeof TEXT_DIRECTIONS)[number];

/** Built-in page templates (bilingual, editable by admins). */
export const SYSTEM_TEMPLATE_KEYS = [
  'SOP',
  'POLICY',
  'WORK_INSTRUCTION',
  'GUIDE',
  'MEETING_NOTES',
  'BLANK',
] as const;
export type SystemTemplateKey = (typeof SYSTEM_TEMPLATE_KEYS)[number];

export const PAGE_LINK_TARGETS = ['PROCESS', 'OBJECT'] as const;
export type PageLinkTarget = (typeof PAGE_LINK_TARGETS)[number];

/** Maximum size of one language version of a page (HTML characters). */
export const PAGE_CONTENT_MAX_CHARS = 1_000_000;

/** Attachments: allowed file types and limits. Types are verified from the file content on the server. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;
export const ATTACHMENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  bpmn: 'application/xml',
};

// ---------- Search ----------
export const SEARCH_TYPES = ['all', 'pages', 'processes'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];
/** Markers around highlighted words in search snippets (private-use characters, never in content). */
export const HIGHLIGHT_START = '\uE000';
export const HIGHLIGHT_END = '\uE001';

// ---------- Git integration (M7) ----------
export const GIT_PROVIDERS = ['github', 'gitlab'] as const;
export type GitProvider = (typeof GIT_PROVIDERS)[number];

export const GIT_SYNC_TRIGGERS = ['ON_VERSION', 'MANUAL'] as const;
export type GitSyncTrigger = (typeof GIT_SYNC_TRIGGERS)[number];

export const GIT_SYNC_STATUSES = ['PENDING', 'SUCCESS', 'FAILED'] as const;
export type GitSyncStatus = (typeof GIT_SYNC_STATUSES)[number];

export const GIT_ENTITY_TYPES = ['PROCESS', 'PAGE'] as const;
export type GitEntityType = (typeof GIT_ENTITY_TYPES)[number];

/** Machine-readable sync errors; translated in the web client (errors.json). */
export const GIT_ERROR_CODES = [
  'GIT_AUTH_FAILED',
  'GIT_REPO_NOT_FOUND',
  'GIT_BRANCH_NOT_FOUND',
  'GIT_NO_PUSH_ACCESS',
  'GIT_RATE_LIMITED',
  'GIT_CONFLICT',
  'GIT_NETWORK',
  /** The Git server is on an internal address that is not in OUTBOUND_ALLOWED_HOSTS. */
  'GIT_HOST_BLOCKED',
  'GIT_NOT_CONFIGURED',
  'GIT_SOURCE_MISSING',
  'GIT_UNKNOWN',
] as const;
export type GitErrorCode = (typeof GIT_ERROR_CODES)[number];

// ---------- Governance (M8) ----------

/** Items that go through the review workflow. */
export const CONTENT_TYPES = ['PROCESS', 'PAGE'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** Lifecycle of processes and pages (same values as PROCESS_STATUSES). */
export const CONTENT_STATUSES = PROCESS_STATUSES;
export type ContentStatus = ProcessStatus;

/** Lifecycle actions; valid transitions are in governance.ts. */
export const GOVERNANCE_ACTIONS = [
  'SUBMIT',
  'WITHDRAW',
  'APPROVE',
  'REQUEST_CHANGES',
  'REJECT',
  'PUBLISH',
  'ARCHIVE',
  'RESTORE',
  'EDIT',
] as const;
export type GovernanceAction = (typeof GOVERNANCE_ACTIONS)[number];

export const REVIEW_STATUSES = [
  'IN_PROGRESS',
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_TASK_STATUSES = [
  'PENDING',
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'SKIPPED',
] as const;
export type ReviewTaskStatus = (typeof REVIEW_TASK_STATUSES)[number];

export const REVIEW_DECISIONS = ['APPROVE', 'REQUEST_CHANGES', 'REJECT'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** ANY: one approval completes the step; ALL: every assignee must approve. */
export const APPROVAL_RULES = ['ANY', 'ALL'] as const;
export type ApprovalRule = (typeof APPROVAL_RULES)[number];

/** USER: a named user; ROLE: users with a system role (optionally in one department); OWNER: the item owner. */
export const ASSIGNEE_TYPES = ['USER', 'ROLE', 'OWNER'] as const;
export type AssigneeType = (typeof ASSIGNEE_TYPES)[number];

/** Where an item's approval workflow comes from. */
export const WORKFLOW_SOURCES = ['ITEM', 'CATEGORY', 'SPACE', 'DEFAULT', 'NONE'] as const;
export type WorkflowSource = (typeof WORKFLOW_SOURCES)[number];

export const REVIEW_DATE_STATES = ['NONE', 'OK', 'DUE', 'OVERDUE'] as const;
export type ReviewDateState = (typeof REVIEW_DATE_STATES)[number];

export const MAX_WORKFLOW_STEPS = 10;
export const COMMENT_MAX_CHARS = 5000;

// ---------- Notifications ----------
export const NOTIFICATION_TYPES = [
  'REVIEW_REQUESTED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'APPROVED',
  'PUBLISHED',
  'MENTIONED',
  'COMMENT_REPLY',
  'REVIEW_OVERDUE',
  'REVIEW_DUE',
  'FEEDBACK_RECEIVED',
  'FEEDBACK_UPDATED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const EMAIL_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

// ---------- Knowledge Portal (M9) ----------
export const PORTAL_ACCESS_MODES = ['ALL', 'RESTRICTED'] as const;
export type PortalAccessMode = (typeof PORTAL_ACCESS_MODES)[number];

export const FEEDBACK_KINDS = ['IMPROVEMENT', 'OUTDATED'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Why an item appears under "My processes". */
export const INVOLVEMENT_REASONS = ['OWNER', 'DEPARTMENT', 'ROLE'] as const;
export type InvolvementReason = (typeof INVOLVEMENT_REASONS)[number];

export const PORTAL_SEARCH_TYPES = ['all', 'processes', 'pages'] as const;
export type PortalSearchType = (typeof PORTAL_SEARCH_TYPES)[number];

export const PORTAL_MAX_QUICK_LINKS = 12;
export const PORTAL_MAX_FEATURED = 12;
