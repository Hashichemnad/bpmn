import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  assuranceDashboardQuerySchema,
  assuranceExportQuerySchema,
  type AssuranceDashboardQuery,
} from '@processhub/shared';
import { Authenticated, CurrentUser, ReqMeta, RequireAnyPermission } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { AssuranceTasksService } from './assurance-tasks.service';
import { AssuranceFilesService } from './assurance-files.service';
import { AssuranceDashboardService } from './assurance-dashboard.service';

/** Assurance dashboard readers: the GRC registers, internal audit, issue managers. */
const DASHBOARD = [
  PERMISSIONS.GRC_READ,
  PERMISSIONS.AUDIT_MANAGE,
  PERMISSIONS.ISSUES_MANAGE,
] as const;

@ApiTags('assurance')
@Controller('assurance')
export class AssuranceController {
  constructor(
    private readonly tasks: AssuranceTasksService,
    private readonly files: AssuranceFilesService,
    private readonly dashboards: AssuranceDashboardService,
  ) {}

  @Get('dashboard')
  @RequireAnyPermission(...DASHBOARD)
  dashboard(@Query(new ZodPipe(assuranceDashboardQuerySchema)) q: AssuranceDashboardQuery) {
    return this.dashboards.dashboard(q);
  }

  @Get('dashboard/export')
  @RequireAnyPermission(...DASHBOARD)
  async export(
    @Query(new ZodPipe(assuranceExportQuerySchema))
    q: AssuranceDashboardQuery & { locale: 'en' | 'ar' },
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { locale, ...scope } = q;
    const file = await this.dashboards.exportExcel(scope, locale, user, meta);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': String(file.data.length),
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(file.data);
  }

  /** The caller's own assurance tasks (each list is filtered by the caller's permissions). */
  @Get('tasks')
  @Authenticated()
  myTasks(@CurrentUser() user: AuthUser) {
    return this.tasks.myTasks(user);
  }

  /**
   * Evidence download: allowed when the caller may read the record the file belongs to (checked
   * per owner type in the service; 404 otherwise). Never rendered as active content.
   */
  @Get('files/:id')
  @Authenticated()
  async file(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, stream } = await this.files.open(id, user);
    res.set({
      'Content-Type': file.contentType,
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(stream);
  }

  @Delete('files/:id')
  @HttpCode(204)
  @Authenticated()
  async removeFile(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.files.remove(id, user, meta);
  }
}
