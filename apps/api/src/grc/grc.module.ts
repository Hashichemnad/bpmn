import { Module } from '@nestjs/common';
import { GrcController } from './grc.controller';
import { GrcService } from './grc.service';
import { GrcSettingsService } from './grc-settings.service';
import { GrcExcelService } from './grc-excel.service';
import { GrcDashboardService } from './grc-dashboard.service';

@Module({
  controllers: [GrcController],
  providers: [GrcService, GrcSettingsService, GrcExcelService, GrcDashboardService],
  exports: [GrcService, GrcSettingsService],
})
export class GrcModule {}
