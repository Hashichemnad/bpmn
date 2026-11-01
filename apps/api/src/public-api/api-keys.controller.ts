import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  apiKeyCreateSchema,
  apiKeyUpdateSchema,
  apiKeyUsageQuerySchema,
  apiSettingsSchema,
  type ApiKeyCreateInput,
  type ApiKeyUpdateInput,
  type ApiKeyUsageQuery,
  type ApiSettings,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { RendererService } from '../renderer/renderer.service';
import { ApiKeysService } from './api-keys.service';

/**
 * Settings → Integrations → API keys: Super Admins manage keys (settings.manage); Admins see them
 * and their call log (integrations.read). The secret is returned once (create / rotate).
 */
@ApiTags('integrations')
@Controller('integrations')
export class ApiKeysController {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly renderer: RendererService,
  ) {}

  @Get('api-keys')
  @RequireAnyPermission(PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.INTEGRATIONS_READ)
  list() {
    return this.keys.list();
  }

  @Get('api-keys/:id')
  @RequireAnyPermission(PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.INTEGRATIONS_READ)
  get(@Param('id', UuidPipe()) id: string) {
    return this.keys.get(id);
  }

  @Get('api-keys/:id/usage')
  @RequireAnyPermission(PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.INTEGRATIONS_READ)
  usage(
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(apiKeyUsageQuerySchema)) q: ApiKeyUsageQuery,
  ) {
    return this.keys.usage(id, q.status === 'errors');
  }

  @Post('api-keys')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  create(
    @Body(new ZodPipe(apiKeyCreateSchema)) body: ApiKeyCreateInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.keys.create(body, user, meta);
  }

  @Patch('api-keys/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(apiKeyUpdateSchema)) body: ApiKeyUpdateInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.keys.update(id, body, user, meta);
  }

  @Post('api-keys/:id/rotate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  rotate(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.keys.rotate(id, user, meta);
  }

  @Post('api-keys/:id/revoke')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  revoke(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.keys.revoke(id, user, meta);
  }

  @Get('api-settings')
  @RequireAnyPermission(PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.INTEGRATIONS_READ)
  settings() {
    return this.keys.settings();
  }

  @Put('api-settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  updateSettings(
    @Body(new ZodPipe(apiSettingsSchema)) body: ApiSettings,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.keys.updateSettings(body, user, meta);
  }

  /** Whether the diagram renderer answers (exports, report e-mails). */
  @Get('renderer')
  @RequireAnyPermission(PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.INTEGRATIONS_READ)
  async rendererStatus() {
    return { status: await this.renderer.health() };
  }
}
