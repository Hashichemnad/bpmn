import { Module } from '@nestjs/common';
import { MiningModule } from '../mining/mining.module';
import { GrcModule } from '../grc/grc.module';
import { EaModule } from '../ea/ea.module';
import { KpiModule } from '../kpi/kpi.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { MigrationAiController } from './migration-ai.controller';
import { MigrationController } from './migration.controller';
import { MigrationService } from './migration.service';
import { GovernanceModule } from '../governance/governance.module';
import { ConventionsModule } from '../conventions/conventions.module';
import { MigrationAiService } from './migration-ai.service';
import { AiModule } from '../ai/ai.module';
import { DocsModule } from '../docs/docs.module';
import { IMPORTER, type Importer } from './importer';
import { ModuleExcelImporter } from './importers/module-excel.importer';
import { ProcessHouseImporter } from './importers/process-house.importer';
import { DepartmentsImporter } from './importers/departments.importer';
import { UsersImporter } from './importers/users.importer';
import { UsersModule } from '../users/users.module';
import { ModelsModule } from '../models/models.module';
import { BpmnImporter } from './importers/bpmn.importer';
import { VisioImporter } from './importers/visio.importer';
import { ArisImporter } from './importers/aris.importer';
import { DmnImporter } from './importers/dmn.importer';
import { DocumentsImporter } from './importers/documents.importer';
import { PackageImporter } from './importers/package.importer';
import { RepositoryExportController } from './repository-export.controller';
import { RepositoryExportService } from './repository-export.service';

const IMPORTERS = [
  ModuleExcelImporter,
  ProcessHouseImporter,
  DepartmentsImporter,
  UsersImporter,
  BpmnImporter,
  VisioImporter,
  ArisImporter,
  DmnImporter,
  DocumentsImporter,
  PackageImporter,
];

/** Import tools / migration (module M15, D-155 – D-163). */
@Module({
  imports: [
    MiningModule,
    GrcModule,
    EaModule,
    KpiModule,
    UsersModule,
    ModelsModule,
    AiModule,
    GovernanceModule,
    ConventionsModule,
    DocsModule,
  ],
  controllers: [
    ImportsController,
    MigrationAiController,
    MigrationController,
    RepositoryExportController,
  ],
  providers: [
    ...IMPORTERS,
    {
      provide: IMPORTER,
      useFactory: (...importers: Importer[]) => importers,
      inject: IMPORTERS,
    },
    ImportsService,
    MigrationAiService,
    MigrationService,
    RepositoryExportService,
  ],
  exports: [ImportsService],
})
export class ImportsModule {}
