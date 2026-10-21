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
} from './constants';

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v ?? ''));

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
  bpmnXml: z.string().min(1).max(5 * 1024 * 1024),
});
export type SaveModelInput = z.infer<typeof saveModelSchema>;

export const createVersionSchema = z.object({
  bpmnXml: z.string().min(1).max(5 * 1024 * 1024),
  changeNote: trimmed(1000).min(1),
});
export type CreateVersionInput = z.infer<typeof createVersionSchema>;

// ---------- Object repository ----------
export const objectAttributesSchema = z
  .record(z.string().trim().min(1).max(100), z.union([z.string().max(2000), z.number(), z.boolean()]))
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
