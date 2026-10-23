import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, applyThemeSchema, type ApplyThemeInput } from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { ModelsService } from './models.service';

/** Settings → Branding: apply the diagram colour theme to the existing working models. */
@ApiTags('settings')
@Controller('settings/diagram-theme')
export class DiagramThemeController {
  constructor(private readonly models: ModelsService) {}

  @Post('apply')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  apply(
    @Body(new ZodPipe(applyThemeSchema)) body: ApplyThemeInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.models.applyTheme(body.dryRun, user, meta);
  }
}
