import { Module } from '@nestjs/common';
import { GovernanceModule } from '../governance/governance.module';
import { DocsModule } from '../docs/docs.module';
import { ObjectsModule } from '../objects/objects.module';
import { ReportDataService } from './report-data.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [GovernanceModule, DocsModule, ObjectsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportDataService],
  exports: [ReportDataService],
})
export class ReportsModule {}
