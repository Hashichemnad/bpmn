import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  LOGO_MAX_BYTES,
  PERMISSIONS,
  updateSettingsSchema,
  type UpdateSettingsInput,
} from '@processhub/shared';
import { CurrentUser, Public, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Branding needed before login (org name, default language, logo flag). */
  @Get('public')
  @Public()
  getPublic() {
    return this.settings.getPublic();
  }

  @Get('logo')
  @Public()
  async logo(@Res({ passthrough: true }) res: Response) {
    const { stream, contentType } = await this.settings.getLogo();
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(stream);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  getAll() {
    return this.settings.getAll();
  }

  @Patch()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  update(
    @Body(new ZodPipe(updateSettingsSchema)) body: UpdateSettingsInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.settings.update(body, user, meta);
  }

  @Post('logo')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES, files: 1 } }))
  uploadLogo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.settings.uploadLogo(file, user, meta);
  }

  @Delete('logo')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  removeLogo(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.settings.removeLogo(user, meta);
  }
}
