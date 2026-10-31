/**
 * Full export package (M15 step 7, D-163): the tables copied as JSON (`data/<Model>.json`, the
 * source of truth for a restore) in foreign-key order, with how each one is read and written.
 */
export const PACKAGE_FORMAT = 'processhub-export';
export const PACKAGE_VERSION = 1;

export interface PackageTable {
  /** Prisma model name (also the file name). */
  model: string;
  /** Self-reference to sort parents before children. */
  parentField?: string;
  /** Columns left out of the export (secrets, runtime state). */
  omit?: string[];
  /** Columns set to null on import (references to tables that are not exported). */
  nullOnImport?: string[];
  /** Rows to export (Prisma `where`). */
  where?: Record<string, unknown>;
  /** Matching existing rows in the target by a natural key (mapped instead of inserted). */
  matchBy?: string;
}

export const PACKAGE_TABLES: PackageTable[] = [
  { model: 'Department', parentField: 'parentId' },
  {
    model: 'User',
    // Never passwords, 2FA secrets, SSO links or lockout state: users sign in again (invitation / SSO).
    omit: [
      'passwordHash',
      'totpSecretSealed',
      'totpPendingSealed',
      'totpEnabledAt',
      'totpLastStep',
      'ssoIssuer',
      'ssoSubject',
      'failedLoginCount',
      'lockedUntil',
      'lastLoginAt',
      'passwordChangedAt',
    ],
    matchBy: 'email',
  },
  { model: 'Workflow', matchBy: 'nameEn' },
  { model: 'RepoObject', omit: ['importBatchId'] },
  { model: 'UserJobRole' },
  { model: 'Process', parentField: 'parentId', omit: ['importBatchId'] },
  { model: 'ProcessModel' },
  { model: 'ProcessVersion' },
  { model: 'ObjectLink' },
  { model: 'Risk' },
  { model: 'Control' },
  { model: 'Requirement', parentField: 'parentId' },
  { model: 'RiskControl' },
  { model: 'RequirementControl' },
  { model: 'Application' },
  { model: 'DataObject' },
  { model: 'AppInterface' },
  { model: 'InterfaceDataObject' },
  { model: 'DataObjectUsage' },
  { model: 'Capability', parentField: 'parentId' },
  { model: 'CapabilityProcess' },
  { model: 'CapabilityApplication' },
  { model: 'StrategicObjective', parentField: 'parentId' },
  { model: 'Kpi', nullOnImport: ['miningLogId'] },
  { model: 'KpiObjective' },
  { model: 'KpiCapability' },
  { model: 'KpiRisk' },
  { model: 'KpiPeriodTarget' },
  { model: 'KpiMeasurement' },
  { model: 'Space' },
  { model: 'SpaceGrant' },
  { model: 'PageTemplate', where: { isSystem: false } },
  { model: 'Page', parentField: 'parentId', omit: ['importBatchId'] },
  { model: 'PageVersion' },
  { model: 'PageLink' },
  { model: 'Attachment' },
  { model: 'Diagram', omit: ['importBatchId'] },
  { model: 'DiagramVersion' },
  { model: 'DiagramLink' },
  { model: 'Publication', nullOnImport: ['reviewId'] },
  { model: 'PublishedLink' },
  {
    model: 'Setting',
    // Content settings only: never secrets (e-mail, SSO, AI keys, integrations).
    where: {
      key: {
        in: [
          'org.nameEn',
          'org.nameAr',
          'branding.diagramTheme',
          'modeling.conventions',
          'grc',
          'assurance',
          'kpi',
          'portal',
          'governance',
        ],
      },
    },
  },
];

/** User role assignments travel by role key (role ids differ between installations). */
export const USER_ROLES_FILE = 'data/UserRole.json';

export const delegate = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

/** Rows ordered so that parents come before their children. */
export function parentsFirst<T extends Record<string, unknown>>(rows: T[], field?: string): T[] {
  if (!field) return rows;
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const depth = new Map<string, number>();
  const depthOf = (r: T, seen = new Set<string>()): number => {
    const id = r.id as string;
    if (depth.has(id)) return depth.get(id)!;
    const parent = r[field] as string | null;
    const d =
      parent && byId.has(parent) && !seen.has(id)
        ? depthOf(byId.get(parent)!, seen.add(id)) + 1
        : 0;
    depth.set(id, d);
    return d;
  };
  return [...rows].sort((a, b) => depthOf(a) - depthOf(b));
}
