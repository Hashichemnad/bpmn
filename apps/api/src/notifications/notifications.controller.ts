import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  emailSettingsSchema,
  notificationListQuerySchema,
  notificationPrefsSchema,
  testEmailSchema,
  type EmailSettingsInput,
  type NotificationListQuery,
  type NotificationPrefsInput,
  type TestEmailInput,
} from '@processhub/shared';
import { Authenticated, CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from './notifications.service';
import { EmailSettingsService } from './email-settings.service';

/** Every user's own notification centre and preferences. */
@ApiTags('notifications')
@Controller('notifications')
@Authenticated()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Query(new ZodPipe(notificationListQuerySchema)) q: NotificationListQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notifications.list(user, q);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.notifications.markRead(id, user);
  }

  @Get('preferences')
  prefs(@CurrentUser() user: AuthUser) {
    return this.notifications.getPrefs(user);
  }

  @Put('preferences')
  setPrefs(
    @Body(new ZodPipe(notificationPrefsSchema)) body: NotificationPrefsInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notifications.setPrefs(user, body);
  }
}

/** SMTP settings: Super Admin only. The password is write-only. */
@ApiTags('settings')
@Controller('settings/email')
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
export class EmailSettingsController {
  constructor(private readonly email: EmailSettingsService) {}

  @Get()
  get() {
    return this.email.getDto();
  }

  @Put()
  update(
    @Body(new ZodPipe(emailSettingsSchema)) body: EmailSettingsInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.email.update(body, user, meta);
  }

  @Post('test')
  @HttpCode(200)
  test(
    @Body(new ZodPipe(testEmailSchema)) body: TestEmailInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.email.sendTest(body, user, meta);
  }
}
