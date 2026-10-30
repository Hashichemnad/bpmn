import { Module } from '@nestjs/common';
import { EaController } from './ea.controller';
import { EaService } from './ea.service';
import { EaExcelService } from './ea-excel.service';

@Module({
  controllers: [EaController],
  providers: [EaService, EaExcelService],
  exports: [EaService],
})
export class EaModule {}
