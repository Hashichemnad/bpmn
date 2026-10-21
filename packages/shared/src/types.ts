import type {
  AuditAction,
  GitEntityType,
  GitErrorCode,
  GitProvider,
  GitSyncStatus,
  GitSyncTrigger,
  PageLinkTarget,
  SpaceAccessLevel,
  SpaceIcon,
  SpacePrincipalType,
  TextDirection,
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
  /** Summary for the settings page; details via /integrations/git. */
  integrations: { git: { enabled: boolean; provider: GitProvider } };
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
  label: string | null;
  /** Version this one was restored from, if any. */
  restoredFrom: number | null;
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

// ---------- Documentation wiki ----------

export interface SpaceGrantDto {
  principalType: SpacePrincipalType;
  principalId: string;
  access: SpaceAccessLevel;
  /** Display name of the user / role / department. */
  label: { nameEn: string; nameAr: string; email?: string } | null;
}

export interface SpaceDto {
  id: string;
  key: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  icon: SpaceIcon;
  owner: UserRef | null;
  department: DepartmentRef | null;
  viewRestricted: boolean;
  editRestricted: boolean;
  pageCount: number;
  canEdit: boolean;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SpacePermissionsDto {
  viewRestricted: boolean;
  editRestricted: boolean;
  grants: SpaceGrantDto[];
}

export interface PageSummaryDto {
  id: string;
  spaceId: string;
  parentId: string | null;
  sortOrder: number;
  titleEn: string;
  titleAr: string;
  /** Languages with content. */
  hasEn: boolean;
  hasAr: boolean;
  updatedAt: string;
}

export interface PageRefDto {
  id: string;
  titleEn: string;
  titleAr: string;
}

export interface PageDto extends PageSummaryDto {
  space: Pick<SpaceDto, 'id' | 'key' | 'nameEn' | 'nameAr' | 'icon'>;
  contentEn: string;
  contentAr: string;
  dirEn: TextDirection;
  dirAr: TextDirection;
  version: number;
  ancestors: PageRefDto[];
  children: PageRefDto[];
  createdBy: UserRef | null;
  updatedBy: UserRef | null;
  createdAt: string;
  canEdit: boolean;
  canManage: boolean;
}

export interface PageDraftDto {
  titleEn: string;
  titleAr: string;
  contentEn: string;
  contentAr: string;
  dirEn: TextDirection;
  dirAr: TextDirection;
  baseVersion: number | null;
  updatedAt: string;
}

export interface PageVersionDto {
  id: string;
  versionNumber: number;
  changeNote: string;
  label: string | null;
  restoredFrom: number | null;
  titleEn: string;
  titleAr: string;
  createdAt: string;
  createdBy: UserRef | null;
}

export interface PageVersionDetailDto extends PageVersionDto {
  contentEn: string;
  contentAr: string;
  dirEn: TextDirection;
  dirAr: TextDirection;
}

export interface TrashedPageDto {
  id: string;
  titleEn: string;
  titleAr: string;
  deletedAt: string;
  deletedBy: UserRef | null;
  /** Number of sub-pages deleted together with this page. */
  descendantCount: number;
}

export interface PageTemplateDto {
  id: string;
  key: string | null;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  contentEn: string;
  contentAr: string;
  isSystem: boolean;
  updatedAt: string;
}

export interface AttachmentDto {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  isImage: boolean;
  url: string;
  createdAt: string;
  createdBy: UserRef | null;
}

export interface PageLinkDto {
  id: string;
  targetType: PageLinkTarget;
  /** Set for PROCESS links. */
  process: Pick<ProcessSummaryDto, 'id' | 'code' | 'nameEn' | 'nameAr' | 'category'> | null;
  /** Set for OBJECT links. */
  object: Pick<RepoObjectDto, 'id' | 'type' | 'code' | 'nameEn' | 'nameAr'> | null;
  /** True when the link was created because the page embeds the process diagram. */
  embedded: boolean;
}

/** A page shown on a process or object ("Related documentation"). */
export interface RelatedPageDto extends PageRefDto {
  space: Pick<SpaceDto, 'id' | 'key' | 'nameEn' | 'nameAr' | 'icon'>;
  updatedAt: string;
}

// ---------- Search ----------
export interface SearchHitDto {
  type: 'page' | 'process';
  id: string;
  titleEn: string;
  titleAr: string;
  /** Snippet with matches wrapped in HIGHLIGHT_START / HIGHLIGHT_END. */
  snippet: string;
  /** Pages: space; processes: code and category. */
  space?: Pick<SpaceDto, 'id' | 'key' | 'nameEn' | 'nameAr'>;
  code?: string;
  author?: UserRef | null;
  updatedAt: string;
  rank: number;
}

export interface SearchResultDto {
  items: SearchHitDto[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------- Git integration ----------
export interface GitSettingsDto {
  enabled: boolean;
  provider: GitProvider;
  baseUrl: string;
  repository: string;
  branch: string;
  folder: string;
  /** The token itself is never returned. */
  hasToken: boolean;
  syncProcesses: boolean;
  syncPages: boolean;
  trigger: GitSyncTrigger;
  /** False when INTEGRATIONS_ENCRYPTION_KEY is not configured (tokens cannot be stored). */
  encryptionAvailable: boolean;
}

export interface GitTestResultDto {
  ok: boolean;
  code: GitErrorCode | null;
  message: string | null;
  /** Default branch reported by the provider, when available. */
  defaultBranch: string | null;
}

export interface GitSyncItemDto {
  id: string;
  entityType: GitEntityType;
  entityId: string;
  title: { nameEn: string; nameAr: string; code?: string; spaceId?: string } | null;
  status: GitSyncStatus;
  version: number | null;
  paths: string[];
  errorCode: GitErrorCode | null;
  errorMessage: string | null;
  commitSha: string | null;
  commitUrl: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
}

export interface GitSyncStatusDto {
  enabled: boolean;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  running: boolean;
  counts: Record<GitSyncStatus, number>;
  items: GitSyncItemDto[];
}
