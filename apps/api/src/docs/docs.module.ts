import { Module } from '@nestjs/common';
import { DocsAccessService } from './docs-access.service';
import { SpacesService } from './spaces.service';
import { SpacesController } from './spaces.controller';
import { PagesService } from './pages.service';
import { PagesController } from './pages.controller';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';

@Module({
  controllers: [SpacesController, PagesController, AttachmentsController, TemplatesController],
  providers: [DocsAccessService, SpacesService, PagesService, AttachmentsService, TemplatesService],
  exports: [DocsAccessService, PagesService],
})
export class DocsModule {}
