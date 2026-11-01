import { z } from 'zod';

/**
 * Import Center (module M15, D-155 – D-158): every import is a batch — upload → parse (background
 * job) → preview with mapping and validation → dry run → apply → result report → undo.
 */

// ---------- Kinds ----------

export const IMPORT_KINDS = [
  // Structure (step 2)
  'PROCESS_HOUSE',
  'DEPARTMENTS',
  'USERS',
  // Diagrams (step 3)
  'BPMN',
  'VISIO',
  'ARIS',
  'DMN',
  // Documents (step 4)
  'WORD',
  'PDF',
  'CONFLUENCE',
  'MARKDOWN',
  // Full export package (step 7)
  'PACKAGE',
  // Existing per-module Excel imports, reused unchanged (D-156)
  'GRC_RISKS',
  'GRC_CONTROLS',
  'GRC_REQUIREMENTS',
  'EA_APPLICATIONS',
  'EA_INTERFACES',
  'EA_DATA_OBJECTS',
  'EA_CAPABILITIES',
  'KPI_KPIS',
  'KPI_OBJECTIVES',
  'KPI_MEASUREMENTS',
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_GROUPS = ['STRUCTURE', 'DIAGRAMS', 'DOCUMENTS', 'LIBRARY', 'PACKAGE'] as const;
export type ImportGroup = (typeof IMPORT_GROUPS)[number];

/** Option fields a kind shows in the batch (the web renders a widget per key). */
export const IMPORT_OPTION_KEYS = [
  'defaultOwnerId',
  'updateExisting',
  'sendInvitations',
  'parentProcessId',
  'processCategory',
  'attachTo',
  'visioLayout',
  'vendorExtensions',
  'autoLayout',
  'spaceId',
  'parentPageId',
  'pageTemplate',
  'splitByHeading',
  'linkProcesses',
] as const;
export type ImportOptionKey = (typeof IMPORT_OPTION_KEYS)[number];

export interface ImportKindInfo {
  group: ImportGroup;
  /** Accepted file extensions (lower case, without the dot). */
  extensions: readonly string[];
  /** More than one file per batch. */
  multiple: boolean;
  /** An Excel template can be downloaded. */
  template: boolean;
  /** Excel / CSV with a column mapping step. */
  tabular: boolean;
  /** Per-entity undo (the module imports keep their own history, D-156). */
  undo: boolean;
  options: readonly ImportOptionKey[];
  /** Module permission needed in addition to `import.manage` (existing module imports). */
  permission?: string;
  /** Super Admin only (full package). */
  superAdmin?: boolean;
  /** Process Owners (`import.own`) may run it for their own processes / editable spaces. */
  ownerAllowed?: boolean;
}

const EXCEL = ['xlsx'] as const;
const EXCEL_CSV = ['xlsx', 'csv'] as const;
const LEGACY = (permission: string): ImportKindInfo => ({
  group: 'LIBRARY',
  extensions: EXCEL,
  multiple: false,
  template: true,
  tabular: false,
  undo: false,
  options: [],
  permission,
});

export const IMPORT_KIND_INFO: Record<ImportKind, ImportKindInfo> = {
  PROCESS_HOUSE: {
    group: 'STRUCTURE',
    extensions: EXCEL_CSV,
    multiple: false,
    template: true,
    tabular: true,
    undo: true,
    options: ['defaultOwnerId', 'updateExisting'],
  },
  DEPARTMENTS: {
    group: 'STRUCTURE',
    extensions: EXCEL_CSV,
    multiple: false,
    template: true,
    tabular: true,
    undo: true,
    options: ['updateExisting'],
  },
  USERS: {
    group: 'STRUCTURE',
    extensions: EXCEL_CSV,
    multiple: false,
    template: true,
    tabular: true,
    undo: true,
    options: ['updateExisting', 'sendInvitations'],
  },
  BPMN: {
    ownerAllowed: true,
    group: 'DIAGRAMS',
    extensions: ['bpmn', 'xml', 'zip'],
    multiple: true,
    template: false,
    tabular: false,
    undo: true,
    options: [
      'defaultOwnerId',
      'attachTo',
      'parentProcessId',
      'processCategory',
      'vendorExtensions',
      'autoLayout',
      'updateExisting',
    ],
  },
  VISIO: {
    ownerAllowed: true,
    group: 'DIAGRAMS',
    extensions: ['vsdx', 'vsd'],
    multiple: true,
    template: false,
    tabular: false,
    undo: true,
    options: [
      'defaultOwnerId',
      'attachTo',
      'parentProcessId',
      'processCategory',
      'visioLayout',
      'updateExisting',
    ],
  },
  ARIS: {
    group: 'DIAGRAMS',
    extensions: ['xml', 'aml'],
    multiple: true,
    template: false,
    tabular: false,
    undo: true,
    options: ['defaultOwnerId', 'parentProcessId', 'updateExisting'],
  },
  DMN: {
    group: 'DIAGRAMS',
    extensions: ['dmn', 'xml', 'zip'],
    multiple: true,
    template: false,
    tabular: false,
    undo: true,
    options: ['defaultOwnerId', 'parentProcessId', 'updateExisting'],
  },
  WORD: {
    ownerAllowed: true,
    group: 'DOCUMENTS',
    extensions: ['docx', 'docm', 'zip'],
    multiple: true,
    template: false,
    tabular: false,
    undo: true,
    options: [
      'defaultOwnerId',
      'spaceId',
      'parentPageId',
      'pageTemplate',
      'splitByHeading',
      'linkProcesses',
      'updateExisting',
    ],
  },
  PDF: {
    ownerAllowed: true,
    group: 'DOCUMENTS',
    extensions: ['pdf', 'zip'],
    multiple: true,
    template: false,
    tabular: false,
    undo: true,
    options: ['defaultOwnerId', 'spaceId', 'parentPageId', 'linkProcesses', 'updateExisting'],
  },
  CONFLUENCE: {
    ownerAllowed: true,
    group: 'DOCUMENTS',
    extensions: ['zip'],
    multiple: false,
    template: false,
    tabular: false,
    undo: true,
    options: ['defaultOwnerId', 'spaceId', 'parentPageId', 'linkProcesses', 'updateExisting'],
  },
  MARKDOWN: {
    ownerAllowed: true,
    group: 'DOCUMENTS',
    extensions: ['md', 'markdown', 'zip'],
    multiple: true,
    template: false,
    tabular: false,
    undo: true,
    options: ['defaultOwnerId', 'spaceId', 'parentPageId', 'linkProcesses', 'updateExisting'],
  },
  PACKAGE: {
    group: 'PACKAGE',
    extensions: ['zip'],
    multiple: false,
    template: false,
    tabular: false,
    undo: false,
    options: [],
    superAdmin: true,
  },
  GRC_RISKS: LEGACY('grc.edit'),
  GRC_CONTROLS: LEGACY('grc.edit'),
  GRC_REQUIREMENTS: LEGACY('grc.edit'),
  EA_APPLICATIONS: LEGACY('ea.edit'),
  EA_INTERFACES: LEGACY('ea.edit'),
  EA_DATA_OBJECTS: LEGACY('ea.edit'),
  EA_CAPABILITIES: LEGACY('ea.edit'),
  KPI_KPIS: LEGACY('kpi.edit'),
  KPI_OBJECTIVES: LEGACY('kpi.edit'),
  KPI_MEASUREMENTS: LEGACY('kpi.edit'),
};

/** Whether a user (permission keys + roles) may run imports of this kind. */
export function canImportKind(
  kind: ImportKind,
  permissions: ReadonlySet<string> | readonly string[],
  roles: readonly string[],
): boolean {
  const has = (p: string) =>
    Array.isArray(permissions)
      ? permissions.includes(p)
      : (permissions as ReadonlySet<string>).has(p);
  const info = IMPORT_KIND_INFO[kind];
  if (!has('import.manage')) return !!info.ownerAllowed && has('import.own');
  if (info.superAdmin && !roles.includes('SUPER_ADMIN')) return false;
  return !info.permission || has(info.permission);
}

// ---------- Limits (D-157) ----------

export const IMPORT_LIMITS = {
  /** One uploaded file. */
  fileBytes: 100 * 1024 * 1024,
  /** All files of one batch. */
  batchBytes: 200 * 1024 * 1024,
  files: 50,
  /** ZIP archives: entries, total uncompressed size, compression ratio per entry. */
  zipEntries: 2000,
  zipUncompressedBytes: 200 * 1024 * 1024,
  zipRatio: 100,
  /** One XML document inside an archive or upload. */
  xmlBytes: 20 * 1024 * 1024,
  /** Rows of an Excel / CSV import. */
  rows: 5000,
  /** Preview items of one batch. */
  items: 5000,
} as const;

// ---------- Statuses ----------

export const IMPORT_BATCH_STATUSES = [
  'UPLOADED',
  'PARSING',
  'READY',
  'APPLYING',
  'APPLIED',
  'FAILED',
  'CANCELLED',
  'UNDONE',
] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const IMPORT_ACTIONS = ['CREATE', 'UPDATE', 'SKIP'] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];

export const IMPORT_ITEM_OUTCOMES = ['CREATED', 'UPDATED', 'SKIPPED', 'FAILED', 'UNDONE'] as const;
export type ImportItemOutcome = (typeof IMPORT_ITEM_OUTCOMES)[number];

export const IMPORT_ENTITIES = [
  'PROCESS',
  'PROCESS_MODEL',
  'DEPARTMENT',
  'USER',
  'DIAGRAM',
  'PAGE',
  'ATTACHMENT',
  'REPO_OBJECT',
  'PAGE_LINK',
  'OBJECT_LINK',
  'MODULE_ROWS',
] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const IMPORT_MATCH_BY = ['CODE', 'EMAIL', 'EXTERNAL_ID', 'FILE_NAME', 'NAME'] as const;
export type ImportMatchBy = (typeof IMPORT_MATCH_BY)[number];

// ---------- Options ----------

export const PAGE_TEMPLATE_KEYS = ['NONE', 'SOP', 'POLICY', 'GUIDE'] as const;
export type PageTemplateKey = (typeof PAGE_TEMPLATE_KEYS)[number];

export const importOptionsSchema = z.object({
  defaultOwnerId: z.uuid().nullable().optional(),
  /** Matched items are updated (otherwise skipped). */
  updateExisting: z.boolean().optional(),
  /** Users: send an invitation e-mail (password set-up link) to new users. */
  sendInvitations: z.boolean().optional(),
  /** Diagrams: parent of new processes / diagrams. */
  parentProcessId: z.uuid().nullable().optional(),
  processCategory: z.enum(['MANAGEMENT', 'CORE', 'SUPPORT']).optional(),
  /** BPMN / Visio: attach to an existing process by code or file name, or always create new ones. */
  attachTo: z.enum(['MATCH_OR_CREATE', 'CREATE']).optional(),
  /** Visio: draw with the shared auto-layout (default) or keep the Visio shape positions. */
  visioLayout: z.enum(['AUTO', 'KEEP']).optional(),
  vendorExtensions: z.enum(['STRIP', 'KEEP']).optional(),
  autoLayout: z.enum(['MISSING', 'ALWAYS']).optional(),
  spaceId: z.uuid().nullable().optional(),
  parentPageId: z.uuid().nullable().optional(),
  pageTemplate: z.enum(PAGE_TEMPLATE_KEYS).optional(),
  /** Word: one page per document or one per Heading 1. */
  splitByHeading: z.boolean().optional(),
  /** Documents: suggest links to processes found in the file name, title or text. */
  linkProcesses: z.boolean().optional(),
  /** Tabular kinds: field key → column header of the file (empty = not imported). */
  mapping: z.record(z.string().max(60), z.string().max(200)).optional(),
  /** Visio: shape master name (lower case) → BPMN type (overrides the defaults). */
  shapeMapping: z.record(z.string().max(100), z.string().max(40)).optional(),
});
export type ImportOptions = z.infer<typeof importOptionsSchema>;

export const createImportSchema = z.object({
  kind: z.enum(IMPORT_KINDS),
  options: importOptionsSchema.default({}),
  note: z.string().trim().max(500).optional(),
});
export type CreateImportInput = z.infer<typeof createImportSchema>;

export const importDecisionSchema = z.object({
  skip: z.boolean().optional(),
  /** Accepted / rejected suggestions by id. */
  suggestions: z.record(z.string().max(80), z.boolean()).optional(),
});
export type ImportDecisionInput = z.infer<typeof importDecisionSchema>;

export const importListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  kind: z.enum(IMPORT_KINDS).optional(),
  status: z.enum(IMPORT_BATCH_STATUSES).optional(),
});
export type ImportListQuery = z.infer<typeof importListQuerySchema>;

export const IMPORT_ITEM_FILTERS = [
  'all',
  'errors',
  'warnings',
  'create',
  'update',
  'skip',
  'suggestions',
] as const;
export type ImportItemFilter = (typeof IMPORT_ITEM_FILTERS)[number];

export const importItemsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  filter: z.enum(IMPORT_ITEM_FILTERS).default('all'),
  q: z.string().trim().max(200).optional(),
});
export type ImportItemsQuery = z.infer<typeof importItemsQuerySchema>;

// ---------- Preview ----------

export type ImportIssueLevel = 'ERROR' | 'WARNING';

export interface ImportIssue {
  level: ImportIssueLevel;
  /** Translation key under `imports:issue.*`. */
  code: string;
  params?: Record<string, string | number>;
}

export const IMPORT_SUGGESTION_KINDS = ['ROLE', 'TERM', 'PROCESS', 'SYSTEM', 'PARENT'] as const;
export type ImportSuggestionKind = (typeof IMPORT_SUGGESTION_KINDS)[number];

/** Something the importer proposes (lane → Role, label → term, document → process); accepted on apply. */
export interface ImportSuggestion {
  id: string;
  kind: ImportSuggestionKind;
  /** What was found in the file (lane name, label, text). */
  source: string;
  targetId: string;
  targetLabelEn: string;
  targetLabelAr: string;
  /** Where it was found (element id, "title", "text"). */
  at?: string;
  accepted: boolean;
}

export interface ImportChange {
  field: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

export interface ImportPreviewItem {
  /** Stable reference within the batch ("row:5", "file:a.bpmn", "file:a.bpmn#Process_1"). */
  ref: string;
  entity: ImportEntity;
  /** Code, e-mail or file name. */
  key: string;
  nameEn: string;
  nameAr: string;
  action: ImportAction;
  matchId: string | null;
  matchBy: ImportMatchBy | null;
  /** File (and row / page) the item comes from. */
  source: string;
  issues: ImportIssue[];
  changes: ImportChange[];
  suggestions: ImportSuggestion[];
  /** Excluded by the user in the preview. */
  skip: boolean;
  /** Short facts for the preview (elements, lanes, pages, words …). */
  facts?: Record<string, string | number>;
}

/** Detected column of a tabular file and the field it is mapped to. */
export interface ImportColumnDto {
  header: string;
  field: string | null;
  sample: string;
}

export interface ImportFieldDto {
  key: string;
  required: boolean;
}

export interface ImportSummaryDto {
  items: number;
  create: number;
  update: number;
  skip: number;
  errors: number;
  warnings: number;
  /** Items with errors that are not skipped (apply is blocked while > 0). */
  blocking: number;
  suggestions: number;
}

export interface ImportResultDto {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  undone: number;
  /** Counts returned by an existing module import (GRC / EA / KPI). */
  module?: { rows: number; created: number; updated: number; pending?: number };
}

export interface ImportFileDto {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface ImportBatchDto {
  id: string;
  number: string;
  kind: ImportKind;
  status: ImportBatchStatus;
  note: string;
  options: ImportOptions;
  files: ImportFileDto[];
  progress: number;
  message: string;
  jobId: string | null;
  error: string | null;
  /** Batch-level issues (file could not be read, unsupported format …). */
  issues: ImportIssue[];
  columns: ImportColumnDto[];
  fields: ImportFieldDto[];
  summary: ImportSummaryDto | null;
  result: ImportResultDto | null;
  createdBy: { id: string; nameEn: string; nameAr: string } | null;
  createdAt: string;
  parsedAt: string | null;
  appliedAt: string | null;
  undoneAt: string | null;
  canUndo: boolean;
}

export interface ImportBatchSummaryDto {
  id: string;
  number: string;
  kind: ImportKind;
  status: ImportBatchStatus;
  note: string;
  fileNames: string[];
  progress: number;
  summary: ImportSummaryDto | null;
  result: ImportResultDto | null;
  createdBy: { id: string; nameEn: string; nameAr: string } | null;
  createdAt: string;
  appliedAt: string | null;
}

/** An entity written by an applied batch. */
export interface ImportItemRecordDto {
  id: string;
  ref: string;
  entity: ImportEntity;
  entityId: string | null;
  outcome: ImportItemOutcome;
  key: string;
  nameEn: string;
  nameAr: string;
  source: string;
  error: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Link in the web app (process, page, diagram, user …). */
  href: string | null;
}

export interface ImportUndoCheckDto {
  canUndo: boolean;
  items: number;
  blockers: { entity: ImportEntity; key: string; nameEn: string; nameAr: string; reason: string }[];
}

export interface ImportKindDto {
  kind: ImportKind;
  info: ImportKindInfo;
}

/** Web href of an imported entity. */
export function importEntityHref(
  entity: ImportEntity,
  id: string | null,
  spaceId?: string | null,
): string | null {
  if (!id) return null;
  switch (entity) {
    case 'PROCESS':
    case 'PROCESS_MODEL':
      return `/processes/${id}`;
    case 'DIAGRAM':
      return `/diagrams/${id}`;
    case 'PAGE':
      return spaceId ? `/docs/${spaceId}/pages/${id}` : null;
    case 'USER':
      return '/admin/users';
    case 'DEPARTMENT':
      return '/admin/departments';
    case 'REPO_OBJECT':
      return `/library/objects/${id}`;
    default:
      return null;
  }
}

/** Summary counts of preview items. */
export function summariseImport(items: ImportPreviewItem[]): ImportSummaryDto {
  const s: ImportSummaryDto = {
    items: items.length,
    create: 0,
    update: 0,
    skip: 0,
    errors: 0,
    warnings: 0,
    blocking: 0,
    suggestions: 0,
  };
  for (const i of items) {
    const errors = i.issues.filter((x) => x.level === 'ERROR').length;
    s.errors += errors;
    s.warnings += i.issues.length - errors;
    s.suggestions += i.suggestions.length;
    if (i.skip || i.action === 'SKIP') s.skip++;
    else if (errors) {
      s.blocking++;
    } else if (i.action === 'CREATE') s.create++;
    else s.update++;
  }
  return s;
}

/** Whether the item passes the item filter of the preview table. */
export function matchesImportFilter(i: ImportPreviewItem, f: ImportItemFilter): boolean {
  switch (f) {
    case 'errors':
      return i.issues.some((x) => x.level === 'ERROR');
    case 'warnings':
      return i.issues.some((x) => x.level === 'WARNING');
    case 'create':
      return !i.skip && i.action === 'CREATE';
    case 'update':
      return !i.skip && i.action === 'UPDATE';
    case 'skip':
      return i.skip || i.action === 'SKIP';
    case 'suggestions':
      return i.suggestions.length > 0;
    default:
      return true;
  }
}

/** Arabic script share of a text (labels with ≥ 30 % Arabic letters count as Arabic). */
export function isArabicText(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return false;
  const arabic = letters.filter((c) => /[؀-ۿݐ-ݿࢠ-ࣿ]/.test(c)).length;
  return arabic / letters.length >= 0.3;
}

/** Splits a label into the English / Arabic slot by its script. */
export function labelByScript(text: string): { nameEn: string; nameAr: string } {
  const t = text.trim();
  return isArabicText(t) ? { nameEn: '', nameAr: t } : { nameEn: t, nameAr: '' };
}

/** Process codes like "C.02.03" or "M.1" found in a text (file name, title, body). */
export const PROCESS_CODE_RE = /\b([A-Z]{1,4}(?:[.-]\d{1,3}){1,4})\b/g;

export function findProcessCodes(text: string): string[] {
  return [...new Set([...text.matchAll(PROCESS_CODE_RE)].map((m) => m[1].replace(/-/g, '.')))];
}

/** Label of an import kind's group, for sorting the kind cards. */
export const importKindsByGroup = (): Record<ImportGroup, ImportKind[]> => {
  const out = Object.fromEntries(IMPORT_GROUPS.map((g) => [g, [] as ImportKind[]])) as Record<
    ImportGroup,
    ImportKind[]
  >;
  for (const k of IMPORT_KINDS) out[IMPORT_KIND_INFO[k].group].push(k);
  return out;
};

// ---------- User invitations (users imported without a password) ----------

export const INVITATION_TTL_DAYS = 7;

export const acceptInvitationSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/),
  password: z.string().min(1).max(256),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export interface InvitationInfoDto {
  email: string;
  nameEn: string;
  nameAr: string;
  locale: 'en' | 'ar';
  expiresAt: string;
}

// ---------- Visio shape mapping (M15 step 3) ----------

/** What a Visio master can become; `startEnd` = start or end event by its connections. */
export const VISIO_SHAPE_TYPES = [
  'task',
  'userTask',
  'manualTask',
  'serviceTask',
  'subProcess',
  'callActivity',
  'exclusiveGateway',
  'parallelGateway',
  'inclusiveGateway',
  'startEvent',
  'endEvent',
  'intermediateThrowEvent',
  'startEnd',
  'flow',
  'lane',
  'ignore',
] as const;
export type VisioShapeType = (typeof VISIO_SHAPE_TYPES)[number];

/** Default mapping of Visio master names (lower case): basic flowchart, cross-functional and BPMN stencils. */
export const DEFAULT_VISIO_MAPPING: Record<string, VisioShapeType> = {
  process: 'task',
  task: 'task',
  activity: 'task',
  'user task': 'userTask',
  'manual task': 'manualTask',
  'manual operation': 'manualTask',
  'service task': 'serviceTask',
  'predefined process': 'callActivity',
  subprocess: 'subProcess',
  'sub-process': 'subProcess',
  'collapsed sub-process': 'subProcess',
  'expanded sub-process': 'subProcess',
  decision: 'exclusiveGateway',
  gateway: 'exclusiveGateway',
  'exclusive gateway': 'exclusiveGateway',
  'parallel gateway': 'parallelGateway',
  'inclusive gateway': 'inclusiveGateway',
  'start/end': 'startEnd',
  terminator: 'startEnd',
  'start event': 'startEvent',
  start: 'startEvent',
  'end event': 'endEvent',
  end: 'endEvent',
  'intermediate event': 'intermediateThrowEvent',
  'dynamic connector': 'flow',
  connector: 'flow',
  'sequence flow': 'flow',
  'line-curve connector': 'flow',
  'straight connector': 'flow',
  swimlane: 'lane',
  'swimlane (vertical)': 'lane',
  'functional band': 'lane',
  lane: 'lane',
  'pool / lane': 'lane',
  'cff container': 'ignore',
  'phase list': 'ignore',
  separator: 'ignore',
  'vertical separator': 'ignore',
  title: 'ignore',
  'text annotation': 'ignore',
  annotation: 'ignore',
  text: 'ignore',
};

/** "Imported" flag of a process, page or diagram: the batch that created it and the source file. */
export interface ImportOriginDto {
  batchId: string;
  number: string;
  source: string;
}

// ---------- AI-assisted migration (M15 step 5, proposals only) ----------

export const MIGRATION_PROPOSAL_KINDS = ['SOP_TO_BPMN', 'EXTRACT_GRC', 'TRANSLATE'] as const;
export type MigrationProposalKind = (typeof MIGRATION_PROPOSAL_KINDS)[number];
export const MIGRATION_PROPOSAL_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'FAILED'] as const;
export type MigrationProposalStatus = (typeof MIGRATION_PROPOSAL_STATUSES)[number];
export const MIGRATION_SOURCE_TYPES = ['PAGE', 'PROCESS', 'DIAGRAM'] as const;
export type MigrationSourceType = (typeof MIGRATION_SOURCE_TYPES)[number];

/** Items per AI run (each one is one AI request, counted against the usage limits). */
export const MIGRATION_AI_MAX_ITEMS = 50;

export const migrationAiRunSchema = z
  .object({
    kind: z.enum(MIGRATION_PROPOSAL_KINDS),
    /** Everything the batch created (pages for SOP / GRC; processes, pages, diagrams to translate). */
    batchId: z.uuid().optional(),
    sources: z
      .array(z.object({ type: z.enum(MIGRATION_SOURCE_TYPES), id: z.uuid() }))
      .max(MIGRATION_AI_MAX_ITEMS)
      .optional(),
    language: z.enum(['en', 'ar']).default('en'),
    /** The user confirmed that the text is sent to the external AI provider (D-164). */
    confirmExternal: z.literal(true),
  })
  .refine((v) => !!v.batchId || !!v.sources?.length, { message: 'SOURCES_REQUIRED' });
export type MigrationAiRunInput = z.infer<typeof migrationAiRunSchema>;

export const migrationProposalQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  kind: z.enum(MIGRATION_PROPOSAL_KINDS).optional(),
  status: z.enum(MIGRATION_PROPOSAL_STATUSES).optional(),
  batchId: z.uuid().optional(),
});
export type MigrationProposalQuery = z.infer<typeof migrationProposalQuerySchema>;

export const acceptProposalSchema = z.object({
  /** SOP → BPMN: put the model into this (draft) process instead of creating a new one. */
  processId: z.uuid().nullable().optional(),
  parentProcessId: z.uuid().nullable().optional(),
  /** GRC extraction: indexes of the risks / controls to create (default: all). */
  risks: z.array(z.number().int().min(0).max(99)).max(100).optional(),
  controls: z.array(z.number().int().min(0).max(99)).max(100).optional(),
});
export type AcceptProposalInput = z.infer<typeof acceptProposalSchema>;

export interface ExtractedRisk {
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  likelihood: number;
  impact: number;
  quote: string;
}
export interface ExtractedControl {
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  /** Indexes of the risks this control mitigates. */
  risks: number[];
  quote: string;
}

export interface TranslationField {
  /** `nameEn`, `descriptionAr`, `titleAr`, `contentAr`, `label:<elementId>:ar` … */
  key: string;
  from: string;
  to: string;
}

export type MigrationProposalPayload =
  | {
      kind: 'SOP_TO_BPMN';
      bpmnXml: string;
      nameEn: string;
      nameAr: string;
      explanation: string;
      warnings: string[];
      /** A process linked to the page that has no diagram yet (suggested target). */
      suggestedProcessId: string | null;
    }
  | { kind: 'EXTRACT_GRC'; risks: ExtractedRisk[]; controls: ExtractedControl[] }
  | { kind: 'TRANSLATE'; target: 'en' | 'ar'; fields: TranslationField[] };

export interface MigrationProposalDto {
  id: string;
  kind: MigrationProposalKind;
  status: MigrationProposalStatus;
  sourceType: MigrationSourceType;
  sourceId: string;
  /** Link to the source in the web app. */
  sourceHref: string | null;
  titleEn: string;
  titleAr: string;
  batchId: string | null;
  error: string | null;
  payload: MigrationProposalPayload | null;
  resultHref: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: { id: string; nameEn: string; nameAr: string } | null;
}

export interface MigrationAiRunDto {
  jobId: string;
  items: number;
}

// ---------- Migration tracker and review queue (M15 step 6) ----------

export const MIGRATION_PROBLEMS = [
  'NO_OWNER',
  'MISSING_EN',
  'MISSING_AR',
  'CONVENTIONS',
  'NO_MODEL',
] as const;
export type MigrationProblem = (typeof MIGRATION_PROBLEMS)[number];
export const MIGRATION_ITEM_TYPES = ['PROCESS', 'PAGE', 'DIAGRAM'] as const;
export type MigrationItemType = (typeof MIGRATION_ITEM_TYPES)[number];
export const MIGRATION_SCOPES = ['IMPORTED', 'ALL'] as const;
export type MigrationScope = (typeof MIGRATION_SCOPES)[number];

export interface MigrationCounts {
  total: number;
  draft: number;
  inReview: number;
  approved: number;
  published: number;
  archived: number;
  noOwner: number;
  missingEn: number;
  missingAr: number;
  conventions: number;
}

export interface MigrationGroupDto {
  /** Department or process-house branch id (null: none / not linked). */
  id: string | null;
  code: string;
  nameEn: string;
  nameAr: string;
  counts: MigrationCounts;
  byType: Record<MigrationItemType, MigrationCounts>;
}

export interface MigrationDashboardDto {
  scope: MigrationScope;
  totals: MigrationCounts;
  byType: Record<MigrationItemType, MigrationCounts>;
  departments: MigrationGroupDto[];
  branches: MigrationGroupDto[];
  batches: { total: number; applied: number; undone: number; failed: number };
  proposalsPending: number;
}

export const migrationQuerySchema = z.object({
  scope: z.enum(MIGRATION_SCOPES).default('IMPORTED'),
});

export const migrationItemsQuerySchema = z.object({
  scope: z.enum(MIGRATION_SCOPES).default('IMPORTED'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  type: z.enum(MIGRATION_ITEM_TYPES).optional(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED']).optional(),
  problem: z.enum(MIGRATION_PROBLEMS).optional(),
  departmentId: z.string().max(40).optional(),
  branchId: z.string().max(40).optional(),
  ownerId: z.uuid().optional(),
  batchId: z.uuid().optional(),
  q: z.string().trim().max(200).optional(),
});
export type MigrationItemsQuery = z.infer<typeof migrationItemsQuerySchema>;

export interface MigrationItemDto {
  type: MigrationItemType;
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  status: string;
  owner: { id: string; nameEn: string; nameAr: string } | null;
  department: { id: string; nameEn: string; nameAr: string } | null;
  branch: { id: string; code: string; nameEn: string; nameAr: string } | null;
  batch: { id: string; number: string } | null;
  problems: MigrationProblem[];
  href: string;
  updatedAt: string;
}

export const MIGRATION_BULK_ACTIONS = [
  'ASSIGN_OWNER',
  'APPLY_THEME',
  'VALIDATE',
  'SUBMIT',
] as const;
export type MigrationBulkAction = (typeof MIGRATION_BULK_ACTIONS)[number];

export const migrationBulkSchema = z
  .object({
    action: z.enum(MIGRATION_BULK_ACTIONS),
    items: z
      .array(z.object({ type: z.enum(MIGRATION_ITEM_TYPES), id: z.uuid() }))
      .min(1)
      .max(200),
    ownerId: z.uuid().optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.action !== 'ASSIGN_OWNER' || !!v.ownerId, { message: 'OWNER_REQUIRED' });
export type MigrationBulkInput = z.infer<typeof migrationBulkSchema>;

export interface MigrationBulkResultDto {
  action: MigrationBulkAction;
  done: number;
  unchanged: number;
  failed: { type: MigrationItemType; id: string; code: string }[];
  /** VALIDATE: the checks each item fails. */
  issues: { type: MigrationItemType; id: string; problems: string[] }[];
}

// ---------- Import settings (Setting `imports`, product owner answers D-164) ----------

export const importSettingsSchema = z.object({
  /** SSO-only sign-in: e-mail imported users a welcome message with the sign-in link (else no e-mail). */
  ssoWelcomeEmail: z.boolean(),
  /**
   * AI on imported documents (SOP → BPMN, risks / controls, translation): the text leaves the
   * country with the AI provider — off until DOF approves it, independent of the general AI switch.
   */
  allowAiOnImportedDocuments: z.boolean(),
});
export type ImportSettings = z.infer<typeof importSettingsSchema>;
export const DEFAULT_IMPORT_SETTINGS: ImportSettings = {
  ssoWelcomeEmail: true,
  allowAiOnImportedDocuments: false,
};
