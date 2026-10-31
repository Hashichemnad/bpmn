import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  LOCALES,
  MIGRATION_SCOPES,
  PERMISSIONS,
  migrationBulkSchema,
  migrationItemsQuerySchema,
  migrationQuerySchema,
  type Locale,
  type MigrationBulkInput,
  type MigrationItemsQuery,
  type MigrationScope,
} from '@processhub/shared';
import {
  Authenticated,
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { download } from '../ea/ea.controller';
import { MigrationService } from './migration.service';

const exportQuery = z.object({
  scope: z.enum(MIGRATION_SCOPES).default('IMPORTED'),
  locale: z.enum(LOCALES).default('en'),
});

/** Migration tracker and review queue (M15 step 6). */
@ApiTags('imports')
@Controller('migration')
export class MigrationController {
  constructor(private readonly migration: MigrationService) {}

  @Get('dashboard')
  @RequireAnyPermission(PERMISSIONS.IMPORT_MANAGE, PERMISSIONS.GOVERNANCE_DASHBOARD)
  dashboard(@Query(new ZodPipe(migrationQuerySchema)) q: { scope: MigrationScope }) {
    return this.migration.dashboard(q.scope);
  }

  @Get('dashboard/export')
  @RequireAnyPermission(PERMISSIONS.IMPORT_MANAGE, PERMISSIONS.GOVERNANCE_DASHBOARD)
  async export(
    @Query(new ZodPipe(exportQuery)) q: { scope: MigrationScope; locale: Locale },
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.migration.export(q.scope, q.locale, user, meta));
  }

  @Get('items')
  @RequireAnyPermission(PERMISSIONS.IMPORT_MANAGE, PERMISSIONS.GOVERNANCE_DASHBOARD)
  items(@Query(new ZodPipe(migrationItemsQuerySchema)) q: MigrationItemsQuery) {
    return this.migration.list(q);
  }

  @Post('bulk')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.IMPORT_MANAGE)
  bulk(
    @Body(new ZodPipe(migrationBulkSchema)) body: MigrationBulkInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.migration.bulk(body, user, meta);
  }

  /** My tasks: imported drafts the signed-in user owns. */
  @Get('my-drafts')
  @Authenticated()
  myDrafts(@CurrentUser() user: AuthUser) {
    return this.migration.myDrafts(user);
  }
}
