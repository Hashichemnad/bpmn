import { Controller, Get, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSIONS } from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { RepositoryExportService } from './repository-export.service';

/** Full export package of the repository (M15 step 7; Super Admin, `export.full`). */
@ApiTags('imports')
@Controller('repository-export')
export class RepositoryExportController {
  constructor(private readonly exporter: RepositoryExportService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EXPORT_FULL)
  async download(
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.exporter.build(user, meta);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Length': String(file.data.length),
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(file.data);
  }
}
