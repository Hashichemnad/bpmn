import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  PERMISSIONS,
  reportSettingsSchema,
  reportSubscriptionSchema,
  unsubscribeSchema,
  type ReportSettings,
  type ReportSubscriptionInput,
} from '@processhub/shared';
import type { z } from 'zod';
import {
  Authenticated,
  CurrentUser,
  Public,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { getConfig } from '../config/config';
import { SubscriptionsService } from './subscriptions.service';

const loginLimit = () => ({
  default: {
    limit: getConfig().LOGIN_RATE_LIMIT_MAX,
    ttl: getConfig().RATE_LIMIT_TTL_SECONDS * 1000,
  },
});

/**
 * Scheduled report e-mails (Phase 4.4, D-179). Every signed-in user manages their own
 * subscriptions (the service checks the report's permission); role / department audiences need
 * users.manage. The unsubscribe endpoint is public (signed token from the e-mail).
 */
@ApiTags('reports')
@Controller('report-subscriptions')
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get()
  @Authenticated()
  list(@CurrentUser() user: AuthUser) {
    return this.subs.list(user);
  }

  @Get('settings')
  @RequireAnyPermission(PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.INTEGRATIONS_READ)
  settings() {
    return this.subs.settings();
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  updateSettings(
    @Body(new ZodPipe(reportSettingsSchema)) body: ReportSettings,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.subs.updateSettings(body, user, meta);
  }

  /** Secure link of a report e-mail: the recipient downloads the generated file. */
  @Get('deliveries/:id/file')
  @Authenticated()
  async file(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.subs.download(id, user, meta);
    res.set({
      'Content-Type': f.contentType,
      'Content-Length': String(f.data.length),
      'Content-Disposition': `attachment; filename="report"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(f.data);
  }

  @Post('unsubscribe')
  @HttpCode(200)
  @Public()
  @Throttle(loginLimit())
  unsubscribe(@Body(new ZodPipe(unsubscribeSchema)) body: z.infer<typeof unsubscribeSchema>) {
    return this.subs.unsubscribe(body.token);
  }

  @Post()
  @Authenticated()
  create(
    @Body(new ZodPipe(reportSubscriptionSchema)) body: ReportSubscriptionInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.subs.create(body, user, meta);
  }

  @Put(':id')
  @Authenticated()
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(reportSubscriptionSchema)) body: ReportSubscriptionInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.subs.update(id, body, user, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @Authenticated()
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.subs.remove(id, user, meta);
  }

  @Get(':id/deliveries')
  @Authenticated()
  deliveries(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.subs.deliveries(id, user);
  }

  @Post(':id/send-now')
  @HttpCode(200)
  @Authenticated()
  sendNow(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.subs.sendNow(id, user);
  }

  @Post(':id/resubscribe')
  @HttpCode(204)
  @Authenticated()
  async resubscribe(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    await this.subs.resubscribe(id, user);
  }
}
