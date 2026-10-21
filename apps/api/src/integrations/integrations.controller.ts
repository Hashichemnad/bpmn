import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  gitSettingsSchema,
  gitSyncNowSchema,
  type GitSettingsInput,
  type GitSyncNowInput,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { GitSettingsService } from './git-settings.service';
import { GitSyncService } from './git-sync.service';

/** Git integration: Super Admin only (settings.manage). The token is write-only. */
@ApiTags('integrations')
@Controller('integrations/git')
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
export class IntegrationsController {
  constructor(
    private readonly settings: GitSettingsService,
    private readonly sync: GitSyncService,
  ) {}

  @Get()
  get() {
    return this.settings.getDto();
  }

  @Put()
  update(
    @Body(new ZodPipe(gitSettingsSchema)) body: GitSettingsInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.settings.update(body, user, meta);
  }

  @Post('test')
  @HttpCode(200)
  test(@Body(new ZodPipe(gitSettingsSchema)) body: GitSettingsInput) {
    return this.settings.test(body);
  }

  @Get('status')
  status() {
    return this.sync.status();
  }

  @Post('sync')
  @HttpCode(202)
  syncNow(
    @Body(new ZodPipe(gitSyncNowSchema)) body: GitSyncNowInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sync.syncNow(body, user);
  }

  @Post('items/:id/retry')
  @HttpCode(202)
  retry(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.sync.retry(id, user);
  }
}
