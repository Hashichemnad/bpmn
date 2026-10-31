import { Module } from '@nestjs/common';
import { GrcModule } from '../grc/grc.module';
import { EaController } from './ea.controller';
import { EaViewsController } from './ea-views.controller';
import { EaService } from './ea.service';
import { EaExcelService } from './ea-excel.service';
import { EaViewsService } from './ea-views.service';

@Module({
  imports: [GrcModule],
  controllers: [EaController, EaViewsController],
  providers: [EaService, EaExcelService, EaViewsService],
  exports: [EaService, EaViewsService, EaExcelService],
})
export class EaModule {}
