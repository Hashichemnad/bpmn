import { Module } from '@nestjs/common';
import { GrcController } from './grc.controller';
import { GrcService } from './grc.service';
import { GrcSettingsService } from './grc-settings.service';
import { GrcExcelService } from './grc-excel.service';

@Module({
  controllers: [GrcController],
  providers: [GrcService, GrcSettingsService, GrcExcelService],
  exports: [GrcService, GrcSettingsService],
})
export class GrcModule {}
