import { Module } from '@nestjs/common';
import { DiagramsController } from './diagrams.controller';
import { DiagramsService } from './diagrams.service';
import { DiagramFactsService } from './diagram-facts.service';
import { OrgChartService } from './org-chart.service';
import { EpcConversionService } from './epc-conversion.service';
import { ProcessesModule } from '../processes/processes.module';
import { ModelsModule } from '../models/models.module';
import { GrcModule } from '../grc/grc.module';
import { KpiModule } from '../kpi/kpi.module';

@Module({
  imports: [GrcModule, KpiModule, ProcessesModule, ModelsModule],
  controllers: [DiagramsController],
  providers: [DiagramsService, DiagramFactsService, OrgChartService, EpcConversionService],
  exports: [DiagramsService],
})
export class DiagramsModule {}
