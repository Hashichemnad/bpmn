import { Module } from '@nestjs/common';
import { DiagramsController } from './diagrams.controller';
import { DiagramsService } from './diagrams.service';
import { DiagramFactsService } from './diagram-facts.service';
import { OrgChartService } from './org-chart.service';
import { GrcModule } from '../grc/grc.module';
import { KpiModule } from '../kpi/kpi.module';

@Module({
  imports: [GrcModule, KpiModule],
  controllers: [DiagramsController],
  providers: [DiagramsService, DiagramFactsService, OrgChartService],
  exports: [DiagramsService],
})
export class DiagramsModule {}
