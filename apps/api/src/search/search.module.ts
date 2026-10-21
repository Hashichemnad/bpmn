import { Module } from '@nestjs/common';
import { DocsModule } from '../docs/docs.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [DocsModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
