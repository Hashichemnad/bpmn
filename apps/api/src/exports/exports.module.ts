import { Module } from '@nestjs/common';
import { GovernanceModule } from '../governance/governance.module';
import { DocsModule } from '../docs/docs.module';
import { GrcModule } from '../grc/grc.module';
import { ReportsModule } from '../reports/reports.module';
import { ExportDataService } from './export-data.service';
import { ExportsController } from './exports.controller';
import { HtmlExportService } from './html-export.service';
import { PptxExportService } from './pptx-export.service';

/** Static HTML and PowerPoint exports (Phase 4.4, D-177, D-178). */
@Module({
  imports: [GovernanceModule, DocsModule, GrcModule, ReportsModule],
  controllers: [ExportsController],
  providers: [ExportDataService, HtmlExportService, PptxExportService],
  exports: [ExportDataService, PptxExportService],
})
export class ExportsModule {}
