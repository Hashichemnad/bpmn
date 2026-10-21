import { z } from 'zod';
import {
  DEFAULT_PAGE_SIZE,
  LINK_RELATIONS,
  LOCALES,
  MAX_PAGE_SIZE,
  OBJECT_TYPES,
  PROCESS_CATEGORIES,
  PROCESS_STATUSES,
  SYSTEM_ROLE_KEYS,
  USER_STATUSES,
  AUDIT_ACTIONS,
  GIT_PROVIDERS,
  GIT_SYNC_TRIGGERS,
  PAGE_CONTENT_MAX_CHARS,
  PAGE_LINK_TARGETS,
  SEARCH_TYPES,
  SPACE_ACCESS_LEVELS,
  SPACE_ICONS,
  SPACE_PRINCIPAL_TYPES,
  TEXT_DIRECTIONS,
  APPROVAL_RULES,
  COMMENT_MAX_CHARS,
  CONTENT_TYPES,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  MAX_WORKFLOW_STEPS,
  NOTIFICATION_TYPES,
  PORTAL_ACCESS_MODES,
  PORTAL_MAX_FEATURED,
  PORTAL_MAX_QUICK_LINKS,
  PORTAL_SEARCH_TYPES,
  REVIEW_DECISIONS,
} from './constants';

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : (v ?? '')));

export const uuidSchema = z.string().uuid();
export const localeSchema = z.enum(LOCALES);

/** Bilingual name/description fields; at least one name must be provided (fallback rule). */
export const bilingualFields = {
  nameEn: optionalText(200),
  nameAr: optionalText(200),
  descriptionEn: optionalText(5000),
  descriptionAr: optionalText(5000),
};

function requireOneName(v: { nameEn?: string; nameAr?: string }, ctx: z.RefinementCtx) {
  if (!v.nameEn && !v.nameAr) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nameEn'], message: 'NAME_REQUIRED' });
  }
}

// ---------- Pagination ----------
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: trimmed(50).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  q: trimmed(200).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------- Auth ----------
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordSchema = z.string().min(1).max(256);

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateProfileSchema = z.object({
  locale: localeSchema.optional(),
  nameEn: optionalText(200),
  nameAr: optionalText(200),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ---------- Users ----------
export const createUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    nameEn: optionalText(200),
    nameAr: optionalText(200),
    password: passwordSchema,
    locale: localeSchema.default('en'),
    departmentId: uuidSchema.nullable().optional(),
    roles: z.array(z.enum(SYSTEM_ROLE_KEYS)).min(1),
  })
  .superRefine(requireOneName);
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  nameEn: optionalText(200),
  nameAr: optionalText(200),
  locale: localeSchema.optional(),
  departmentId: uuidSchema.nullable().optional(),
  status: z.enum(USER_STATUSES).optional(),
  roles: z.array(z.enum(SYSTEM_ROLE_KEYS)).min(1).optional(),
  /** Job roles from the Roles library ("My processes" in the portal). */
  jobRoleIds: z.array(uuidSchema).max(20).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({ newPassword: passwordSchema });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const userListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(USER_STATUSES).optional(),
  departmentId: uuidSchema.optional(),
  role: z.enum(SYSTEM_ROLE_KEYS).optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

// ---------- Departments ----------
export const createDepartmentSchema = z
  .object({
    nameEn: optionalText(200),
    nameAr: optionalText(200),
    code: trimmed(50).optional().nullable(),
    parentId: uuidSchema.nullable().optional(),
  })
  .superRefine(requireOneName);
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  nameEn: optionalText(200),
  nameAr: optionalText(200),
  code: trimmed(50).optional().nullable(),
  parentId: uuidSchema.nullable().optional(),
});
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

// ---------- Audit ----------
export const auditListQuerySchema = paginationQuerySchema.extend({
  action: z.enum(AUDIT_ACTIONS).optional(),
  entityType: trimmed(50).optional(),
  entityId: trimmed(100).optional(),
  userId: uuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

// ---------- Settings ----------
export const updateSettingsSchema = z.object({
  orgNameEn: trimmed(200).optional(),
  orgNameAr: trimmed(200).optional(),
  defaultLocale: localeSchema.optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

// ---------- Processes ----------
/** Process code such as "C.02.03": letters/digits separated by dots or dashes. */
export const processCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z0-9]+([.-][A-Za-z0-9]+)*$/, 'INVALID_CODE');

export const createProcessSchema = z
  .object({
    code: processCodeSchema,
    ...bilingualFields,
    category: z.enum(PROCESS_CATEGORIES).optional(),
    parentId: uuidSchema.nullable().optional(),
    ownerId: uuidSchema.nullable().optional(),
    departmentId: uuidSchema.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    requireOneName(v, ctx);
    if (!v.parentId && !v.category) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['category'],
        message: 'CATEGORY_REQUIRED',
      });
    }
  });
export type CreateProcessInput = z.infer<typeof createProcessSchema>;

export const updateProcessSchema = z.object({
  code: processCodeSchema.optional(),
  ...bilingualFields,
  category: z.enum(PROCESS_CATEGORIES).optional(),
  ownerId: uuidSchema.nullable().optional(),
  departmentId: uuidSchema.nullable().optional(),
  // Status changes are handled by the governance workflow (Phase 3).
});
export type UpdateProcessInput = z.infer<typeof updateProcessSchema>;

export const moveProcessSchema = z.object({
  parentId: uuidSchema.nullable(),
  /** Target position among the new siblings (0-based). */
  index: z.number().int().min(0),
  /** Required when moving to the top level of a different band. */
  category: z.enum(PROCESS_CATEGORIES).optional(),
});
export type MoveProcessInput = z.infer<typeof moveProcessSchema>;

export const processListQuerySchema = paginationQuerySchema.extend({
  category: z.enum(PROCESS_CATEGORIES).optional(),
  parentId: z.union([uuidSchema, z.literal('root')]).optional(),
  ownerId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  status: z.enum(PROCESS_STATUSES).optional(),
});
export type ProcessListQuery = z.infer<typeof processListQuerySchema>;

// ---------- Models & versions ----------
export const saveModelSchema = z.object({
  bpmnXml: z
    .string()
    .min(1)
    .max(5 * 1024 * 1024),
});
export type SaveModelInput = z.infer<typeof saveModelSchema>;

export const createVersionSchema = z.object({
  bpmnXml: z
    .string()
    .min(1)
    .max(5 * 1024 * 1024),
  changeNote: trimmed(1000).min(1),
});
export type CreateVersionInput = z.infer<typeof createVersionSchema>;

// ---------- Object repository ----------
export const objectAttributesSchema = z
  .record(
    z.string().trim().min(1).max(100),
    z.union([z.string().max(2000), z.number(), z.boolean()]),
  )
  .refine((v) => Object.keys(v).length <= 50, 'TOO_MANY_ATTRIBUTES');

export const createObjectSchema = z
  .object({
    type: z.enum(OBJECT_TYPES),
    code: trimmed(50).optional().nullable(),
    ...bilingualFields,
    attributes: objectAttributesSchema.default({}),
  })
  .superRefine(requireOneName);
export type CreateObjectInput = z.infer<typeof createObjectSchema>;

export const updateObjectSchema = z.object({
  code: trimmed(50).optional().nullable(),
  ...bilingualFields,
  attributes: objectAttributesSchema.optional(),
});
export type UpdateObjectInput = z.infer<typeof updateObjectSchema>;

export const objectListQuerySchema = paginationQuerySchema.extend({
  type: z.enum(OBJECT_TYPES).optional(),
});
export type ObjectListQuery = z.infer<typeof objectListQuerySchema>;

export const createLinkSchema = z.object({
  bpmnElementId: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z_][\w.-]*$/, 'INVALID_ELEMENT_ID'),
  repoObjectId: uuidSchema,
  relation: z.enum(LINK_RELATIONS).optional(),
});
export type CreateLinkInput = z.infer<typeof createLinkSchema>;

// ---------- Versions (processes and pages) ----------
export const versionLabelSchema = z.object({
  /** Empty or null removes the label. */
  label: trimmed(100).nullable(),
});
export type VersionLabelInput = z.infer<typeof versionLabelSchema>;

export const restoreVersionSchema = z.object({
  changeNote: trimmed(1000).optional(),
});
export type RestoreVersionInput = z.infer<typeof restoreVersionSchema>;

// ---------- Documentation: spaces ----------
/** Short space key such as "QM": used in Git paths, so it never changes after creation. */
export const spaceKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'INVALID_SPACE_KEY');

const spaceFields = {
  ...bilingualFields,
  icon: z.enum(SPACE_ICONS).optional(),
  ownerId: uuidSchema.nullable().optional(),
  departmentId: uuidSchema.nullable().optional(),
};

export const createSpaceSchema = z
  .object({ key: spaceKeySchema, ...spaceFields })
  .superRefine(requireOneName);
export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;

export const updateSpaceSchema = z.object(spaceFields);
export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>;

export const spaceGrantSchema = z
  .object({
    principalType: z.enum(SPACE_PRINCIPAL_TYPES),
    principalId: z.string().trim().min(1).max(100),
    access: z.enum(SPACE_ACCESS_LEVELS),
  })
  .superRefine((g, ctx) => {
    const ok =
      g.principalType === 'ROLE'
        ? (SYSTEM_ROLE_KEYS as readonly string[]).includes(g.principalId)
        : uuidSchema.safeParse(g.principalId).success;
    if (!ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['principalId'],
        message: 'INVALID_PRINCIPAL',
      });
    }
  });
export type SpaceGrantInput = z.infer<typeof spaceGrantSchema>;

export const spacePermissionsSchema = z.object({
  /** When true only the space owner, documentation managers and listed principals can view. */
  viewRestricted: z.boolean(),
  /** When true only the owner, managers and principals with EDIT access can edit. */
  editRestricted: z.boolean(),
  grants: z.array(spaceGrantSchema).max(200),
});
export type SpacePermissionsInput = z.infer<typeof spacePermissionsSchema>;

// ---------- Documentation: pages ----------
const pageHtml = z.string().max(PAGE_CONTENT_MAX_CHARS);
const pageTitle = optionalText(300);

function requireOneTitle(v: { titleEn?: string; titleAr?: string }, ctx: z.RefinementCtx) {
  if (!v.titleEn && !v.titleAr) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['titleEn'], message: 'TITLE_REQUIRED' });
  }
}

export const createPageSchema = z
  .object({
    parentId: uuidSchema.nullable().optional(),
    titleEn: pageTitle,
    titleAr: pageTitle,
    templateId: uuidSchema.nullable().optional(),
  })
  .superRefine(requireOneTitle);
export type CreatePageInput = z.infer<typeof createPageSchema>;

const pageContentFields = {
  titleEn: pageTitle,
  titleAr: pageTitle,
  contentEn: pageHtml.default(''),
  contentAr: pageHtml.default(''),
  dirEn: z.enum(TEXT_DIRECTIONS).default('ltr'),
  dirAr: z.enum(TEXT_DIRECTIONS).default('rtl'),
};

/** Explicit save: always creates a new version. */
export const savePageSchema = z
  .object({
    ...pageContentFields,
    changeNote: trimmed(1000).min(1),
    /** Version the editor started from; a newer version on the server is reported as PAGE_CHANGED. */
    baseVersion: z.number().int().min(0).optional(),
  })
  .superRefine(requireOneTitle);
export type SavePageInput = z.infer<typeof savePageSchema>;

/** Autosave draft (per user, never creates a version). */
export const pageDraftSchema = z.object({
  ...pageContentFields,
  baseVersion: z.number().int().min(0).optional(),
});
export type PageDraftInput = z.infer<typeof pageDraftSchema>;

export const movePageSchema = z.object({
  parentId: uuidSchema.nullable(),
  index: z.number().int().min(0),
});
export type MovePageInput = z.infer<typeof movePageSchema>;

export const createPageLinkSchema = z.object({
  targetType: z.enum(PAGE_LINK_TARGETS),
  targetId: uuidSchema,
});
export type CreatePageLinkInput = z.infer<typeof createPageLinkSchema>;

// ---------- Documentation: templates ----------
export const templateSchema = z
  .object({
    ...bilingualFields,
    contentEn: pageHtml.default(''),
    contentAr: pageHtml.default(''),
  })
  .superRefine(requireOneName);
export type TemplateInput = z.infer<typeof templateSchema>;

// ---------- Search ----------
export const searchQuerySchema = z.object({
  q: trimmed(200).min(1),
  type: z.enum(SEARCH_TYPES).default('all'),
  spaceId: uuidSchema.optional(),
  authorId: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

// ---------- Git integration ----------
/** "owner/repo" (GitHub) or "group/subgroup/project" (GitLab). */
export const gitRepositorySchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^[\w.-]+(\/[\w.-]+)+$/, 'INVALID_REPOSITORY');

export const gitBranchSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^(?!\/|.*\/\/|.*\.\.|.*\/$|.*\.lock$)[\w./-]+$/, 'INVALID_BRANCH');

/** Folder inside the repository ('' = repository root). */
export const gitFolderSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^[\w./ -]*$/, 'INVALID_FOLDER')
  .refine((v) => !v.split('/').some((s) => s === '..' || s === '.'), 'INVALID_FOLDER')
  .transform((v) => v.replace(/^\/+|\/+$/g, ''));

export const gitSettingsSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(GIT_PROVIDERS),
    /** API base for self-hosted GitLab (e.g. https://gitlab.example.com). Empty = gitlab.com / github.com. */
    baseUrl: z
      .string()
      .trim()
      .max(300)
      .refine((v) => v === '' || /^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(v), 'INVALID_URL')
      .transform((v) => v.replace(/\/+$/, ''))
      .default(''),
    repository: z.union([gitRepositorySchema, z.literal('')]).default(''),
    branch: z.union([gitBranchSchema, z.literal('')]).default('main'),
    folder: gitFolderSchema.default(''),
    /** Write-only. Omit or send an empty string to keep the stored token. */
    token: z.string().max(500).optional(),
    clearToken: z.boolean().optional(),
    syncProcesses: z.boolean().default(true),
    syncPages: z.boolean().default(true),
    trigger: z.enum(GIT_SYNC_TRIGGERS).default('ON_VERSION'),
    /** Export only the published version of each process/page (nothing for unpublished items). */
    publishedOnly: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.enabled && !v.repository) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['repository'], message: 'REQUIRED' });
    }
    if (v.enabled && !v.branch) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['branch'], message: 'REQUIRED' });
    }
  });
export type GitSettingsInput = z.infer<typeof gitSettingsSchema>;

export const gitSyncNowSchema = z.object({
  scope: z.enum(['all', 'processes', 'pages']).default('all'),
});
export type GitSyncNowInput = z.infer<typeof gitSyncNowSchema>;

// ---------- Governance ----------
export const contentTypeSchema = z.enum(CONTENT_TYPES);

export const workflowAssigneeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('USER'), userId: uuidSchema }),
  z.object({
    type: z.literal('ROLE'),
    roleKey: z.enum(SYSTEM_ROLE_KEYS),
    /** Only users of this department (null = any department). */
    departmentId: uuidSchema.nullable().optional(),
  }),
  z.object({ type: z.literal('OWNER') }),
]);
export type WorkflowAssigneeInput = z.infer<typeof workflowAssigneeSchema>;

export const workflowStepSchema = z
  .object({
    nameEn: optionalText(200),
    nameAr: optionalText(200),
    rule: z.enum(APPROVAL_RULES).default('ANY'),
    assignees: z.array(workflowAssigneeSchema).min(1).max(20),
  })
  .superRefine(requireOneName);
export type WorkflowStepInput = z.infer<typeof workflowStepSchema>;

export const workflowSchema = z
  .object({
    ...bilingualFields,
    steps: z.array(workflowStepSchema).min(1).max(MAX_WORKFLOW_STEPS),
    /** Publish automatically when the last step approves. */
    autoPublish: z.boolean().default(false),
  })
  .superRefine(requireOneName);
export type WorkflowInput = z.infer<typeof workflowSchema>;

export const governanceSettingsSchema = z.object({
  /** Months between publication and the next periodic review. */
  reviewIntervalMonths: z.number().int().min(1).max(60),
  /** Reminder this many days before the next review date. */
  reminderDays: z.number().int().min(0).max(90),
  /** Reviewers have this many days to decide before the review is overdue. */
  reviewDueDays: z.number().int().min(1).max(60),
  defaultWorkflowId: uuidSchema.nullable(),
  categoryWorkflows: z.object({
    MANAGEMENT: uuidSchema.nullable(),
    CORE: uuidSchema.nullable(),
    SUPPORT: uuidSchema.nullable(),
  }),
});
export type GovernanceSettingsInput = z.infer<typeof governanceSettingsSchema>;

/** Per-item governance settings (any field may be omitted). */
export const itemGovernanceSchema = z.object({
  /** Workflow template for this item only (null = inherit from category / space / default). */
  workflowId: uuidSchema.nullable().optional(),
  /** Custom steps for this item only; replaces `workflowId`. Send null to drop them. */
  customWorkflow: workflowSchema.nullable().optional(),
  nextReviewAt: z.coerce.date().nullable().optional(),
  /** Pages only (processes keep their owner on the process itself). */
  ownerId: uuidSchema.nullable().optional(),
});
export type ItemGovernanceInput = z.infer<typeof itemGovernanceSchema>;

export const submitReviewSchema = z.object({
  note: trimmed(1000).optional(),
  dueAt: z.coerce.date().optional(),
});
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;

export const reviewDecisionSchema = z
  .object({
    decision: z.enum(REVIEW_DECISIONS),
    comment: trimmed(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision !== 'APPROVE' && !v.comment) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['comment'], message: 'COMMENT_REQUIRED' });
    }
  });
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;

export const publishSchema = z.object({
  /** Optional label for the published version, e.g. "v2.0". */
  versionLabel: trimmed(100).optional(),
});
export type PublishInput = z.infer<typeof publishSchema>;

export const archiveSchema = z.object({ reason: trimmed(1000).optional() });
export type ArchiveInput = z.infer<typeof archiveSchema>;

export const reviewListQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum(['IN_PROGRESS', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'WITHDRAWN'])
    .optional(),
  entityType: contentTypeSchema.optional(),
  entityId: uuidSchema.optional(),
});
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;

// ---------- Comments ----------
export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(COMMENT_MAX_CHARS),
  /** Reply to a thread (the root comment). */
  parentId: uuidSchema.nullable().optional(),
  /** Attach the thread to a BPMN element (processes only). */
  bpmnElementId: z
    .string()
    .trim()
    .max(255)
    .regex(/^[A-Za-z_][\w.-]*$/, 'INVALID_ELEMENT_ID')
    .nullable()
    .optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z.object({
  body: z.string().trim().min(1).max(COMMENT_MAX_CHARS),
});
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

// ---------- Notifications ----------
export const notificationListQuerySchema = z.object({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const notificationPrefSchema = z.object({ inApp: z.boolean(), email: z.boolean() });
export const notificationPrefsSchema = z.object({
  prefs: z.record(z.enum(NOTIFICATION_TYPES), notificationPrefSchema),
});
export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>;

export const emailSettingsSchema = z
  .object({
    enabled: z.boolean(),
    host: trimmed(255).default(''),
    port: z.number().int().min(1).max(65535).default(587),
    /** TLS from the start (port 465); otherwise STARTTLS is used when offered. */
    secure: z.boolean().default(false),
    username: trimmed(255).default(''),
    /** Write-only. Omit or send an empty string to keep the stored password. */
    password: z.string().max(500).optional(),
    clearPassword: z.boolean().optional(),
    fromAddress: z.union([z.string().trim().email().max(254), z.literal('')]).default(''),
    fromName: trimmed(200).default(''),
  })
  .superRefine((v, ctx) => {
    if (v.enabled && !v.host) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['host'], message: 'REQUIRED' });
    }
    if (v.enabled && !v.fromAddress) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fromAddress'], message: 'REQUIRED' });
    }
  });
export type EmailSettingsInput = z.infer<typeof emailSettingsSchema>;

export const testEmailSchema = z.object({ to: z.string().trim().toLowerCase().email().max(254) });
export type TestEmailInput = z.infer<typeof testEmailSchema>;

// ---------- Knowledge Portal ----------
/** Quick links: http(s) URLs or in-app paths. */
export const portalLinkUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => /^https?:\/\/[^\s]+$/i.test(v) || (/^\/[^\s]*$/.test(v) && !v.startsWith('//')),
    'INVALID_URL',
  );

export const portalSettingsSchema = z.object({
  nameEn: trimmed(200).default(''),
  nameAr: trimmed(200).default(''),
  taglineEn: trimmed(300).default(''),
  taglineAr: trimmed(300).default(''),
  access: z.object({
    mode: z.enum(PORTAL_ACCESS_MODES),
    departmentIds: z.array(uuidSchema).max(200).default([]),
    roleKeys: z.array(z.enum(SYSTEM_ROLE_KEYS)).default([]),
  }),
  quickLinks: z
    .array(
      z
        .object({
          titleEn: optionalText(100),
          titleAr: optionalText(100),
          url: portalLinkUrlSchema,
        })
        .superRefine((v, ctx) => {
          if (!v.titleEn && !v.titleAr) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['titleEn'],
              message: 'TITLE_REQUIRED',
            });
          }
        }),
    )
    .max(PORTAL_MAX_QUICK_LINKS)
    .default([]),
  featured: z
    .array(z.object({ entityType: contentTypeSchema, entityId: uuidSchema }))
    .max(PORTAL_MAX_FEATURED)
    .default([]),
});
export type PortalSettingsInput = z.infer<typeof portalSettingsSchema>;

export const portalSearchQuerySchema = z.object({
  q: trimmed(200).min(1),
  type: z.enum(PORTAL_SEARCH_TYPES).default('all'),
  category: z.enum(PROCESS_CATEGORIES).optional(),
  spaceId: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type PortalSearchQuery = z.infer<typeof portalSearchQuerySchema>;

export const createFeedbackSchema = z.object({
  entityType: contentTypeSchema,
  entityId: uuidSchema,
  kind: z.enum(FEEDBACK_KINDS),
  message: z.string().trim().min(1).max(3000),
});
export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;

export const updateFeedbackSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  reply: trimmed(3000).optional(),
});
export type UpdateFeedbackInput = z.infer<typeof updateFeedbackSchema>;

export const feedbackListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  /** mine = sent by me; assigned = routed to me; all = every item (governance managers). */
  scope: z.enum(['mine', 'assigned', 'all']).default('mine'),
});
export type FeedbackListQuery = z.infer<typeof feedbackListQuerySchema>;

export const userDirectoryQuerySchema = z.object({ q: trimmed(100).default('') });
export type UserDirectoryQuery = z.infer<typeof userDirectoryQuerySchema>;
