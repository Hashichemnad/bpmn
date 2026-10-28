import { Module } from '@nestjs/common';
import { ObjectsModule } from '../objects/objects.module';
import { ModelsModule } from '../models/models.module';
import { DictionaryController } from './dictionary.controller';
import { DictionaryService } from './dictionary.service';

@Module({
  imports: [ObjectsModule, ModelsModule],
  controllers: [DictionaryController],
  providers: [DictionaryService],
})
export class DictionaryModule {}
