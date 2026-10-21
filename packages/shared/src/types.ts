import type {
  AuditAction,
  LinkRelation,
  Locale,
  ObjectType,
  Permission,
  ProcessCategory,
  ProcessStatus,
  SystemRoleKey,
  UserStatus,
} from './constants';

/** API response shapes shared by web and api. Dates are ISO strings on the wire. */

export interface UserRef {
  id: string;
  email: string;
  nameEn: string;
  nameAr: string;
}

export interface DepartmentRef {
  id: string;
  nameEn: string;
  nameAr: string;
}

export interface CurrentUser extends UserRef {
  locale: Locale;
  roles: SystemRoleKey[];
  permissions: Permission[];
  departmentId: string | null;
}

export interface UserDto extends UserRef {
  locale: Locale;
  status: UserStatus;
  roles: SystemRoleKey[];
  department: DepartmentRef | null;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleDto {
  id: string;
  key: SystemRoleKey;
  nameEn: string;
  nameAr: string;
  permissions: Permission[];
}

export interface DepartmentDto extends DepartmentRef {
  code: string | null;
  parentId: string | null;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogDto {
  id: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  summary: unknown;
  ip: string | null;
  createdAt: string;
  user: UserRef | null;
}

export interface PublicSettingsDto {
  orgNameEn: string;
  orgNameAr: string;
  defaultLocale: Locale;
  hasLogo: boolean;
  /** Changes whenever the logo changes, for cache busting. */
  logoVersion: string | null;
}

export interface SettingsDto extends PublicSettingsDto {
  integrations: { github: { enabled: false }; gitlab: { enabled: false } };
}

export interface ProcessSummaryDto {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  category: ProcessCategory;
  status: ProcessStatus;
  parentId: string | null;
  level: number;
  sortOrder: number;
  ownerId: string | null;
  departmentId: string | null;
}

export interface ProcessDto extends ProcessSummaryDto {
  descriptionEn: string;
  descriptionAr: string;
  owner: UserRef | null;
  department: DepartmentRef | null;
  children: ProcessSummaryDto[];
  ancestors: Pick<ProcessSummaryDto, 'id' | 'code' | 'nameEn' | 'nameAr'>[];
  hasModel: boolean;
  /** Whether the current user may edit this process / its model. */
  canEdit: boolean;
  canEditModel: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessModelDto {
  processId: string;
  bpmnXml: string | null;
  updatedAt: string | null;
  updatedBy: UserRef | null;
}

export interface ProcessVersionDto {
  id: string;
  versionNumber: number;
  changeNote: string;
  createdAt: string;
  createdBy: UserRef | null;
}

export interface RepoObjectDto {
  id: string;
  type: ObjectType;
  code: string | null;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  attributes: Record<string, string | number | boolean>;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Label of the BPMN element a link points to (from the current working model). */
export interface ElementLabelDto {
  nameEn: string;
  nameAr: string;
}

export interface ObjectLinkDto {
  id: string;
  processId: string;
  bpmnElementId: string;
  element: ElementLabelDto | null;
  relation: LinkRelation;
  repoObject: Pick<RepoObjectDto, 'id' | 'type' | 'code' | 'nameEn' | 'nameAr'>;
}

export interface ObjectUsageDto {
  linkId: string;
  bpmnElementId: string;
  element: ElementLabelDto | null;
  relation: LinkRelation;
  process: Pick<ProcessSummaryDto, 'id' | 'code' | 'nameEn' | 'nameAr' | 'category'>;
}

export interface ApiErrorBody {
  statusCode: number;
  /** Machine-readable code, translated on the client (e.g. "INVALID_CREDENTIALS"). */
  code: string;
  message: string;
  details?: unknown;
}
