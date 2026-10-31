import { Injectable } from '@nestjs/common';
import type {
  EaImportKind,
  GrcImportKind,
  ImportIssue,
  ImportKind,
  KpiImportKind,
  Locale,
} from '@processhub/shared';
import { GrcExcelService } from '../../grc/grc-excel.service';
import { EaExcelService } from '../../ea/ea-excel.service';
import { KpiExcelService } from '../../kpi/kpi-excel.service';
import type { AuthUser, RequestMeta } from '../../common/auth-user';
import type { ExcelFile } from '../../common/excel';
import type {
  ApplyContext,
  Importer,
  LoadedImportFile,
  ParseContext,
  ParsedItem,
} from '../importer';

type Target =
  | { module: 'grc'; kind: GrcImportKind }
  | { module: 'ea'; kind: EaImportKind }
  | { module: 'kpi'; kind: KpiImportKind };

const TARGETS: Partial<Record<ImportKind, Target>> = {
  GRC_RISKS: { module: 'grc', kind: 'risks' },
  GRC_CONTROLS: { module: 'grc', kind: 'controls' },
  GRC_REQUIREMENTS: { module: 'grc', kind: 'requirements' },
  EA_APPLICATIONS: { module: 'ea', kind: 'applications' },
  EA_INTERFACES: { module: 'ea', kind: 'interfaces' },
  EA_DATA_OBJECTS: { module: 'ea', kind: 'data-objects' },
  EA_CAPABILITIES: { module: 'ea', kind: 'capabilities' },
  KPI_KPIS: { module: 'kpi', kind: 'kpis' },
  KPI_OBJECTIVES: { module: 'kpi', kind: 'objectives' },
  KPI_MEASUREMENTS: { module: 'kpi', kind: 'measurements' },
};

interface ModuleReport {
  rows: number;
  created: number;
  updated: number;
  pending?: number;
  errors: { row: number; column: string; code: string }[];
}

/** The import job has no HTTP request: audit entries carry no IP / user agent. */
const JOB_META: RequestMeta = { ip: null, userAgent: 'import-center' };

const asMulter = (f: LoadedImportFile) =>
  ({
    fieldname: 'file',
    originalname: f.fileName,
    encoding: '7bit',
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: f.data.length,
    buffer: f.data,
  }) as Express.Multer.File;

/**
 * The existing per-module Excel imports (risks, controls, requirements, applications, interfaces,
 * data objects, capabilities, KPIs, objectives, measurements) as Import Center kinds, reused
 * unchanged (D-156): the module's dry run is the preview; apply runs its import.
 */
@Injectable()
export class ModuleExcelImporter implements Importer {
  readonly kinds = Object.keys(TARGETS) as ImportKind[];

  constructor(
    private readonly grc: GrcExcelService,
    private readonly ea: EaExcelService,
    private readonly kpi: KpiExcelService,
  ) {}

  private run(kind: ImportKind, file: LoadedImportFile, dryRun: boolean, actor: AuthUser) {
    const t = TARGETS[kind]!;
    const f = asMulter(file);
    switch (t.module) {
      case 'grc':
        return this.grc.import(t.kind, f, dryRun, actor, JOB_META) as Promise<ModuleReport>;
      case 'ea':
        return this.ea.import(t.kind, f, dryRun, actor, JOB_META) as Promise<ModuleReport>;
      default:
        return this.kpi.import(t.kind, f, dryRun, actor, JOB_META) as Promise<ModuleReport>;
    }
  }

  async parse(ctx: ParseContext) {
    const file = ctx.files[0];
    const report = await this.run(ctx.kind, file, true, ctx.actor);
    const issues: ImportIssue[] = report.errors.map((e) => ({
      level: 'ERROR',
      code: 'MODULE_ROW',
      params: { row: e.row, column: e.column, code: e.code },
    }));
    const item: ParsedItem = {
      ref: `file:${file.fileName}`,
      entity: 'MODULE_ROWS',
      key: file.fileName,
      nameEn: file.fileName,
      nameAr: file.fileName,
      action: report.created ? 'CREATE' : 'UPDATE',
      matchId: null,
      matchBy: null,
      source: file.fileName,
      issues,
      changes: [],
      suggestions: [],
      skip: false,
      facts: {
        rows: report.rows,
        create: report.created,
        update: report.updated,
        ...(report.pending ? { pending: report.pending } : {}),
      },
    };
    return { items: [item] };
  }

  async apply(ctx: ApplyContext, items: ParsedItem[]) {
    const [file] = await ctx.files();
    let module: ModuleReport | undefined;
    for (const item of items)
      await ctx.step(item, async () => {
        module = await this.run(ctx.kind, file, false, ctx.actor);
        if (module.errors.length) throw new Error(`MODULE_IMPORT_ERRORS (${module.errors.length})`);
        return {
          entity: 'MODULE_ROWS',
          entityId: null,
          outcome: module.created ? 'CREATED' : 'UPDATED',
          after: { rows: module.rows, created: module.created, updated: module.updated },
        };
      });
    return module
      ? {
          module: {
            rows: module.rows,
            created: module.created,
            updated: module.updated,
            pending: module.pending,
          },
        }
      : undefined;
  }

  template(kind: ImportKind, locale: Locale): Promise<ExcelFile> {
    const t = TARGETS[kind]!;
    switch (t.module) {
      case 'grc':
        return this.grc.template(t.kind, locale) as Promise<ExcelFile>;
      case 'ea':
        return this.ea.template(t.kind, locale);
      default:
        return this.kpi.template(t.kind, locale);
    }
  }
}
