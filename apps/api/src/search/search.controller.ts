import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, searchQuerySchema, type SearchQuery } from '@processhub/shared';
import { CurrentUser, RequireAnyPermission } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Results are limited to what the user may read (processes and/or visible spaces). */
  @Get()
  @RequireAnyPermission(PERMISSIONS.DOCS_READ, PERMISSIONS.PROCESSES_READ)
  find(@Query(new ZodPipe(searchQuerySchema)) q: SearchQuery, @CurrentUser() user: AuthUser) {
    return this.search.search(q, user);
  }
}
