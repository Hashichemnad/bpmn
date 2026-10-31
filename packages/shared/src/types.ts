import type { ImportOriginDto } from './imports';
import type { DiagramType } from './diagrams';
import type { GrcReviewTaskDto } from './grc';
import type { DiagramTheme } from './diagram-theme';
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
  LabelSourceType,
  LinkRelation,
  Locale,
  ObjectStatus,
  ObjectType,
  ReportSource,
  Permission,
  ProcessCategory,
  ProcessStatus,
  SystemRoleKey,
  UserStatus,
  ApprovalRule,
  AssigneeType,
  ContentStatus,
  ContentType,
  EmailStatus,
  FeedbackKind,
  FeedbackStatus,
  InvolvementReason,
  NotificationType,
  PortalAccessMode,
  ReviewDateState,
  ReviewStatus,
  ReviewTaskStatus,
  WorkflowSource,
} from './constants';
import type { PortalKpiDto } from './kpi';

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
  /** The account has a local password (SSO-only accounts do not). */
  hasPassword: boolean;
  /** The account is linked to the single sign-on identity provider. */
  ssoLinked: boolean;
  mfaEnabled: boolean;
}

export interface JobRoleRef {
  id: string;
  code: string | null;
  nameEn: string;
  nameAr: string;
}

export interface UserDto extends UserRef {
  locale: Locale;
  status: UserStatus;
  roles: SystemRoleKey[];
  department: DepartmentRef | null;
  /** Job roles from the Roles library. */
  jobRoles: JobRoleRef[];
  lastLoginAt: string | null;
  lockedUntil: string | null;
  mfaEnabled: boolean;
  ssoLinked: boolean;
  /** False for imported users who have not accepted their invitation yet (and SSO-only accounts). */
  hasPassword: boolean;
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
  /** Head of the department (escalation of overdue issues and actions). */
  managerId: string | null;
  manager?: UserRef | null;
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
  /** Colour theme of BPMN diagrams (Settings → Branding); the default when not customised. */
  diagramTheme: DiagramTheme;
  /** False while the shipped default theme is in use. */
  diagramThemeCustomised: boolean;
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
  /** The working model was produced by the AI assistant and not yet edited or approved by a person. */
  /** Set when an Import Center batch created it (M15). */
  importOrigin?: ImportOriginDto | null;
  aiGenerated: boolean;
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
  /** DRAFT = proposed dictionary term waiting for approval; all other objects are APPROVED. */
  status: ObjectStatus;
  category: string | null;
  synonymsEn: string[];
  synonymsAr: string[];
  owner: UserRef | null;
  /** Who created (for terms: proposed) the object. */
  createdBy: UserRef | null;
  approvedAt: string | null;
  approvedBy: UserRef | null;
  createdAt: string;
  updatedAt: string;
}

/** One suggestion of the label autocomplete (dictionary term, role or IT system). */
export interface LabelSuggestionDto {
  id: string;
  type: LabelSourceType;
  code: string | null;
  nameEn: string;
  nameAr: string;
  /** Short definition (terms) or description, in both languages. */
  descriptionEn: string;
  descriptionAr: string;
  /** The synonym that matched, when the match was not on the name. */
  synonym: string | null;
}

/** "Rename and update labels": one element whose label changes. */
export interface RenameElementDto {
  elementId: string;
  before: ElementLabelDto;
  after: ElementLabelDto;
}

/** "Rename and update labels": the effect on one process. */
export interface RenameProcessDto {
  process: Pick<ProcessSummaryDto, 'id' | 'code' | 'nameEn' | 'nameAr' | 'status'>;
  elements: RenameElementDto[];
  /** False when the user may not edit the process or it is locked (in review, archived). */
  canUpdate: boolean;
  reason: 'NO_PERMISSION' | 'ITEM_IN_REVIEW' | 'ITEM_ARCHIVED' | null;
  /** Approved or published processes get a new draft version that must be approved again. */
  newDraft: boolean;
  /** Set by the rename itself: the version created for this process. */
  versionNumber?: number;
}

export interface RenamePreviewDto {
  object: Pick<RepoObjectDto, 'id' | 'type' | 'nameEn' | 'nameAr'>;
  processes: RenameProcessDto[];
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
  /** Default approval workflow of the space's pages. */
  workflowId: string | null;
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
  status: ContentStatus;
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
  /** The saved content was produced by the AI assistant and not yet edited or approved by a person. */
  aiGenerated: boolean;
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
  publishedOnly: boolean;
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

// ---------- Governance ----------

/** Title of a governed item, enough to list and link it. */
export interface ContentRefDto {
  entityType: ContentType;
  entityId: string;
  titleEn: string;
  titleAr: string;
  /** Processes. */
  code?: string;
  /** Pages: the space, for links. */
  spaceId?: string;
  /** Diagrams: the notation (value chain, org chart, DMN, EPC, SIPOC). */
  diagramType?: DiagramType;
}

export interface GovernedItemDto extends ContentRefDto {
  status: ContentStatus;
  owner: UserRef | null;
  nextReviewAt: string | null;
  reviewState: ReviewDateState;
  updatedAt: string;
}

export interface WorkflowAssigneeDto {
  type: AssigneeType;
  userId?: string;
  roleKey?: SystemRoleKey;
  departmentId?: string | null;
  /** Display name of the user / department (roles are translated on the client). */
  label: { nameEn: string; nameAr: string; email?: string } | null;
}

export interface WorkflowStepDto {
  nameEn: string;
  nameAr: string;
  rule: ApprovalRule;
  assignees: WorkflowAssigneeDto[];
}

export interface WorkflowDto {
  id: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  steps: WorkflowStepDto[];
  autoPublish: boolean;
  /** False for custom workflows that belong to one item. */
  isTemplate: boolean;
  /** Where the template is used as a default (categories, spaces, items). */
  usage: number;
  updatedAt: string;
}

export interface GovernanceSettingsDto {
  reviewIntervalMonths: number;
  reminderDays: number;
  reviewDueDays: number;
  defaultWorkflowId: string | null;
  categoryWorkflows: Record<ProcessCategory, string | null>;
}

export interface PublicationDto {
  id: string;
  versionNumber: number;
  versionLabel: string | null;
  publishedAt: string;
  publishedBy: UserRef | null;
  approvedAt: string | null;
  approvedBy: UserRef[];
}

export interface ReviewTaskDto {
  id: string;
  stepIndex: number;
  assignee: UserRef | null;
  status: ReviewTaskStatus;
  comment: string | null;
  decidedAt: string | null;
}

export interface ReviewStepDto {
  index: number;
  nameEn: string;
  nameAr: string;
  rule: ApprovalRule;
  state: 'WAITING' | 'ACTIVE' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED' | 'CANCELLED';
  /** Legacy (before the four-eyes rule): submitting counted as this step's approval. */
  approvedBySubmitter: boolean;
  /** Users who will be asked when the step starts. */
  assignees: UserRef[];
  tasks: ReviewTaskDto[];
}

export interface ReviewSummaryDto {
  id: string;
  item: ContentRefDto;
  versionNumber: number;
  status: ReviewStatus;
  currentStep: number;
  stepCount: number;
  currentStepName: { nameEn: string; nameAr: string } | null;
  workflowName: { nameEn: string; nameAr: string };
  note: string;
  submittedBy: UserRef | null;
  submittedAt: string;
  dueAt: string | null;
  overdue: boolean;
  completedAt: string | null;
  /** Set in "My tasks": the current user's open task. */
  myTaskId?: string | null;
}

export interface PageContentDto {
  titleEn: string;
  titleAr: string;
  contentEn: string;
  contentAr: string;
  dirEn: TextDirection;
  dirAr: TextDirection;
}

/** What the reviewer compares: the version under review against the last published version. */
export type ReviewCompareDto =
  | {
      kind: 'PROCESS';
      baseVersion: number | null;
      baseLabel: string | null;
      baseXml: string | null;
      newXml: string;
    }
  | {
      kind: 'PAGE';
      baseVersion: number | null;
      baseLabel: string | null;
      base: PageContentDto | null;
      next: PageContentDto;
    }
  | {
      kind: 'DIAGRAM';
      diagramType: DiagramType;
      baseVersion: number | null;
      baseLabel: string | null;
      baseContent: string | null;
      newContent: string;
    };

export interface ReviewDetailDto extends ReviewSummaryDto {
  steps: ReviewStepDto[];
  changeNote: string;
  compare: ReviewCompareDto;
  canDecide: boolean;
  canWithdraw: boolean;
}

export interface GovernanceInfoDto {
  entityType: ContentType;
  entityId: string;
  status: ContentStatus;
  /** Last review ended with "changes requested" (the item is back in Draft). */
  changesRequested: boolean;
  rejected: boolean;
  owner: UserRef | null;
  latestVersion: number | null;
  latestVersionLabel: string | null;
  /** Processes: the working model differs from the latest version (save a version first). */
  hasUnversionedChanges: boolean;
  activeReview: ReviewSummaryDto | null;
  lastReview: ReviewSummaryDto | null;
  publication: PublicationDto | null;
  nextReviewAt: string | null;
  reviewState: ReviewDateState;
  workflow: { source: WorkflowSource; workflow: WorkflowDto | null };
  can: {
    submit: boolean;
    withdraw: boolean;
    publish: boolean;
    archive: boolean;
    restore: boolean;
    configure: boolean;
    confirmReview: boolean;
    comment: boolean;
  };
}

export interface PublishedItemDto extends GovernedItemDto {
  versionNumber: number;
  versionLabel: string | null;
  publishedAt: string;
}

export interface MyTasksDto {
  reviews: ReviewSummaryDto[];
  /** Approved items the user can publish. */
  toPublish: GovernedItemDto[];
  /** The user's submissions that came back with changes requested or were rejected. */
  returned: ReviewSummaryDto[];
  /** Items the user owns whose periodic review is due or overdue. */
  dueReviews: GovernedItemDto[];
  mentions: NotificationDto[];
  feedback: FeedbackDto[];
  /** Risks, controls and requirements the user owns whose review is due or overdue (Phase 4.1). */
  grcReviews: GrcReviewTaskDto[];
}

export interface GovernanceDashboardDto {
  counts: Record<ContentType, Record<ContentStatus, number>>;
  inReview: (ReviewSummaryDto & { days: number })[];
  overdueReviews: GovernedItemDto[];
  dueSoon: GovernedItemDto[];
  recentlyPublished: PublishedItemDto[];
  openFeedback: number;
}

// ---------- Comments ----------
export interface CommentDto {
  id: string;
  entityType: ContentType;
  entityId: string;
  parentId: string | null;
  bpmnElementId: string | null;
  /** Label of the BPMN element (current working model). */
  element: ElementLabelDto | null;
  /** Plain text with mentions as `@[Name](userId)`; render as text, never as HTML. */
  body: string;
  author: UserRef | null;
  createdAt: string;
  editedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: UserRef | null;
  canEdit: boolean;
  canResolve: boolean;
  replies: CommentDto[];
}

// ---------- Notifications ----------
export interface NotificationDto {
  id: string;
  type: NotificationType;
  entityType: ContentType | null;
  entityId: string | null;
  /** Values for the translated text (titles, comment preview, …). */
  params: Record<string, string | number>;
  /** In-app path to open. */
  link: string | null;
  actor: UserRef | null;
  readAt: string | null;
  createdAt: string;
  emailStatus: EmailStatus | null;
}

export interface NotificationPrefsDto {
  /** Effective preference for every notification type. */
  prefs: Record<NotificationType, { inApp: boolean; email: boolean }>;
  /** Whether email is configured in Settings at all. */
  emailEnabled: boolean;
}

export interface EmailSettingsDto {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  hasPassword: boolean;
  fromAddress: string;
  fromName: string;
  encryptionAvailable: boolean;
}

// ---------- Feedback ----------
export interface FeedbackDto {
  id: string;
  item: ContentRefDto;
  kind: FeedbackKind;
  message: string;
  status: FeedbackStatus;
  reply: string | null;
  repliedAt: string | null;
  repliedBy: UserRef | null;
  createdBy: UserRef | null;
  assignee: UserRef | null;
  createdAt: string;
  updatedAt: string;
  /** The current user may change the status and reply. */
  canManage: boolean;
}

// ---------- Knowledge Portal ----------
export interface PortalQuickLink {
  titleEn: string;
  titleAr: string;
  url: string;
}

export interface PortalSettingsDto {
  nameEn: string;
  nameAr: string;
  taglineEn: string;
  taglineAr: string;
  access: { mode: PortalAccessMode; departmentIds: string[]; roleKeys: SystemRoleKey[] };
  quickLinks: PortalQuickLink[];
  featured: { entityType: ContentType; entityId: string }[];
  /** Published value chain shown first on the portal home (D-126). */
  startDiagramId: string | null;
}

/** Publication details shown on every portal item. */
export interface PortalMetaDto {
  versionNumber: number;
  versionLabel: string | null;
  publishedAt: string;
  approvedAt: string | null;
  approvedBy: UserRef[];
  owner: UserRef | null;
  nextReviewAt: string | null;
  reviewState: ReviewDateState;
}

export interface PortalItemDto {
  type: ContentType;
  id: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  code?: string;
  category?: ProcessCategory;
  space?: { id: string; key: string; nameEn: string; nameAr: string; icon: SpaceIcon };
  /** Diagrams: the notation. */
  diagramType?: DiagramType;
  versionLabel: string | null;
  versionNumber: number;
  publishedAt: string;
}

export interface PortalHomeDto {
  nameEn: string;
  nameAr: string;
  taglineEn: string;
  taglineAr: string;
  quickLinks: PortalQuickLink[];
  featured: PortalItemDto[];
  recent: PortalItemDto[];
  counts: { processes: number; pages: number; diagrams: number };
  /** The value chain start page (Setting portal.startDiagramId), when it is published. */
  startDiagram: PortalItemDto | null;
  canManage: boolean;
}

export interface PortalProcessNodeDto {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  category: ProcessCategory;
  /** Nearest published ancestor. */
  parentId: string | null;
  sortOrder: number;
}

export interface PortalStepObjectDto {
  id: string;
  type: ObjectType;
  code: string | null;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
}

export interface PortalStepLinkDto {
  bpmnElementId: string;
  relation: LinkRelation;
  object: PortalStepObjectDto;
}

export interface PortalProcessDto extends PortalProcessNodeDto {
  descriptionEn: string;
  descriptionAr: string;
  department: DepartmentRef | null;
  bpmnXml: string | null;
  meta: PortalMetaDto;
  ancestors: Pick<PortalProcessNodeDto, 'id' | 'code' | 'nameEn' | 'nameAr'>[];
  children: PortalProcessNodeDto[];
  links: PortalStepLinkDto[];
  /** Published processes that call activities drill down into. */
  drillTargets: Pick<PortalProcessNodeDto, 'id' | 'code' | 'nameEn' | 'nameAr'>[];
  relatedPages: PortalItemDto[];
  /** KPIs of the process and its steps with their latest status; null when the portal hides KPIs. */
  kpis: PortalKpiDto[] | null;
}

export interface PortalSpaceDto {
  id: string;
  key: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  icon: SpaceIcon;
  pageCount: number;
}

export interface PortalPageNodeDto {
  id: string;
  spaceId: string;
  /** Nearest published ancestor. */
  parentId: string | null;
  sortOrder: number;
  titleEn: string;
  titleAr: string;
  hasEn: boolean;
  hasAr: boolean;
}

export interface PortalPageDto extends PortalPageNodeDto, PageContentDto {
  space: PortalSpaceDto;
  meta: PortalMetaDto;
  ancestors: PageRefDto[];
  children: PageRefDto[];
  relatedProcesses: PortalItemDto[];
}

export interface PortalSearchHitDto extends PortalItemDto {
  snippet: string;
  rank: number;
}

export interface PortalSearchResultDto {
  items: PortalSearchHitDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MyPortalItemDto extends PortalItemDto {
  reasons: InvolvementReason[];
  /** Steps performed by one of the user's job roles. */
  steps: { bpmnElementId: string; nameEn: string; nameAr: string }[];
}

export interface MyPortalDto {
  processes: MyPortalItemDto[];
  pages: MyPortalItemDto[];
  jobRoles: JobRoleRef[];
  department: DepartmentRef | null;
}

// ---------- Reports and exports (Modeler design B2) ----------
/** What a handbook will contain: the diagram of each process is rendered by the browser. */
export interface HandbookPlanDto {
  source: ReportSource;
  processes: { id: string; code: string; nameEn: string; nameAr: string; bpmnXml: string | null }[];
}
