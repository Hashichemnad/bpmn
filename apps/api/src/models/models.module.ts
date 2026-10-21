import { Module } from '@nestjs/common';
import { ProcessesModule } from '../processes/processes.module';
import { ModelsController } from './models.controller';
import { ModelsService } from './models.service';

@Module({ imports: [ProcessesModule], controllers: [ModelsController], providers: [ModelsService] })
export class ModelsModule {}
