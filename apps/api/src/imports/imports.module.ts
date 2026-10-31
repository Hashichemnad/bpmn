import { Module } from '@nestjs/common';
import { MiningModule } from '../mining/mining.module';
import { GrcModule } from '../grc/grc.module';
import { EaModule } from '../ea/ea.module';
import { KpiModule } from '../kpi/kpi.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { IMPORTER, type Importer } from './importer';
import { ModuleExcelImporter } from './importers/module-excel.importer';
import { ProcessHouseImporter } from './importers/process-house.importer';
import { DepartmentsImporter } from './importers/departments.importer';
import { UsersImporter } from './importers/users.importer';
import { UsersModule } from '../users/users.module';

const IMPORTERS = [ModuleExcelImporter, ProcessHouseImporter, DepartmentsImporter, UsersImporter];

/** Import tools / migration (module M15, D-155 – ). */
@Module({
  imports: [MiningModule, GrcModule, EaModule, KpiModule, UsersModule],
  controllers: [ImportsController],
  providers: [
    ...IMPORTERS,
    {
      provide: IMPORTER,
      useFactory: (...importers: Importer[]) => importers,
      inject: IMPORTERS,
    },
    ImportsService,
  ],
  exports: [ImportsService],
})
export class ImportsModule {}
