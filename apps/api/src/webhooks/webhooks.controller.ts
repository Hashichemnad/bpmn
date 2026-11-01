import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  PERMISSIONS,
  WEBHOOK_KINDS,
  webhookCreateSchema,
  webhookDeliveryQuerySchema,
  webhookSettingsSchema,
  webhookUpdateSchema,
  type WebhookCreateInput,
  type WebhookDeliveryQuery,
  type WebhookSettings,
  type WebhookUpdateInput,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { WebhookSettingsService } from './webhook-settings.service';
import { WebhooksService } from './webhooks.service';

const listQuery = z.object({ kind: z.enum(WEBHOOK_KINDS).optional() });
const READ = [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.INTEGRATIONS_READ] as const;

/**
 * Settings → Integrations → Webhooks / Microsoft Teams (D-174, D-176): Super Admins manage
 * destinations (settings.manage); Admins see them and their delivery log (integrations.read).
 */
@ApiTags('integrations')
@Controller('integrations')
export class WebhooksController {
  constructor(
    private readonly hooks: WebhooksService,
    private readonly settings: WebhookSettingsService,
  ) {}

  @Get('webhooks')
  @RequireAnyPermission(...READ)
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.hooks.list(q.kind);
  }

  @Get('webhooks/:id')
  @RequireAnyPermission(...READ)
  get(@Param('id', UuidPipe()) id: string) {
    return this.hooks.get(id);
  }

  @Get('webhooks/:id/deliveries')
  @RequireAnyPermission(...READ)
  deliveries(
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(webhookDeliveryQuerySchema)) q: WebhookDeliveryQuery,
  ) {
    return this.hooks.deliveries(id, q);
  }

  @Post('webhooks')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  create(
    @Body(new ZodPipe(webhookCreateSchema)) body: WebhookCreateInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.hooks.create(body, user, meta);
  }

  @Patch('webhooks/:id')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(webhookUpdateSchema)) body: WebhookUpdateInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.hooks.update(id, body, user, meta);
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.hooks.remove(id, user, meta);
  }

  @Post('webhooks/:id/secret')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  rotateSecret(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.hooks.rotateSecret(id, user, meta);
  }

  @Post('webhooks/:id/test')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  test(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.hooks.sendTest(id, user);
  }

  @Post('webhooks/:id/deliveries/:deliveryId/resend')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  resend(
    @Param('id', UuidPipe()) id: string,
    @Param('deliveryId', UuidPipe()) deliveryId: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.hooks.resend(id, deliveryId, user, meta);
  }

  @Get('webhook-settings')
  @RequireAnyPermission(...READ)
  getSettings() {
    return this.settings.get();
  }

  @Put('webhook-settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  updateSettings(
    @Body(new ZodPipe(webhookSettingsSchema)) body: WebhookSettings,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.settings.update(body, user, meta);
  }
}
