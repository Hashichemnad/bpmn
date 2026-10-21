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
