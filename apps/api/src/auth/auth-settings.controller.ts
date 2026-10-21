import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, authSettingsSchema, type AuthSettingsInput } from '@processhub/shared';
import { CurrentUser, Public, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { AuthSettingsService } from './auth-settings.service';

/** Settings → Authentication (Super Admin). The client secret is write-only. */
@ApiTags('auth')
@Controller()
export class AuthSettingsController {
  constructor(private readonly settings: AuthSettingsService) {}

  /** Sign-in options for the login page (SSO button, whether password sign-in is offered). */
  @Get('auth/options')
  @Public()
  options() {
    return this.settings.getPublic();
  }

  @Get('settings/auth')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  get() {
    return this.settings.getDto();
  }

  @Put('settings/auth')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  update(
    @Body(new ZodPipe(authSettingsSchema)) body: AuthSettingsInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.settings.update(body, user, meta);
  }
}
