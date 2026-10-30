import { Module } from '@nestjs/common';
import { GrcController } from './grc.controller';
import { GrcService } from './grc.service';
import { GrcSettingsService } from './grc-settings.service';

@Module({
  controllers: [GrcController],
  providers: [GrcService, GrcSettingsService],
  exports: [GrcService, GrcSettingsService],
})
export class GrcModule {}
