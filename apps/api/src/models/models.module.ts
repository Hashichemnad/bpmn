import { Module } from '@nestjs/common';
import { ProcessesModule } from '../processes/processes.module';
import { DiagramThemeController } from './diagram-theme.controller';
import { ModelsController } from './models.controller';
import { ModelsService } from './models.service';

@Module({
  imports: [ProcessesModule],
  controllers: [ModelsController, DiagramThemeController],
  providers: [ModelsService],
})
export class ModelsModule {}
