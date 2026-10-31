import { Module } from '@nestjs/common';
import { MiningModule } from '../mining/mining.module';
import { GrcModule } from '../grc/grc.module';
import { EaModule } from '../ea/ea.module';
import { KpiModule } from '../kpi/kpi.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { MigrationAiController } from './migration-ai.controller';
import { MigrationAiService } from './migration-ai.service';
import { AiModule } from '../ai/ai.module';
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
];

/** Import tools / migration (module M15, D-155 – ). */
@Module({
  imports: [MiningModule, GrcModule, EaModule, KpiModule, UsersModule, ModelsModule, AiModule],
  controllers: [ImportsController, MigrationAiController],
  providers: [
    ...IMPORTERS,
    {
      provide: IMPORTER,
      useFactory: (...importers: Importer[]) => importers,
      inject: IMPORTERS,
    },
    ImportsService,
    MigrationAiService,
  ],
  exports: [ImportsService],
})
export class ImportsModule {}
