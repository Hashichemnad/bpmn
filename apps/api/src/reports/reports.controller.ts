import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  PERMISSIONS,
  handbookPlanSchema,
  handbookSchema,
  reportQuerySchema,
  type HandbookInput,
  type HandbookPlanInput,
  type ReportQuery,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { ReportsService, type ReportFile } from './reports.service';

/** Sends a generated file as a download (never rendered inline). */
function download(res: Response, file: ReportFile) {
  res.set({
    'Content-Type': file.contentType,
    'Content-Length': String(file.data.length),
    'Content-Disposition': `attachment; filename="report"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  return new StreamableFile(file.data);
}

/** Reports and exports (Modeler design B2, D-087). */
@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Processes of a handbook with the diagram XML to render (workspace or portal users). */
  @Post('handbook/plan')
  @HttpCode(200)
  @RequireAnyPermission(PERMISSIONS.PROCESSES_READ, PERMISSIONS.PORTAL_READ)
  plan(
    @Body(new ZodPipe(handbookPlanSchema)) body: HandbookPlanInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reports.handbookPlan(body, user);
  }

  /** Process handbook (.docx) of a process or a branch; diagram images from the browser. */
  @Post('handbook')
  @HttpCode(200)
  @RequireAnyPermission(PERMISSIONS.PROCESSES_READ, PERMISSIONS.PORTAL_READ)
  async handbook(
    @Body(new ZodPipe(handbookSchema)) body: HandbookInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.reports.handbook(body, user, meta));
  }

  /** RACI / responsibility matrix (.xlsx) of one process. */
  @Get('raci/:processId')
  @RequireAnyPermission(PERMISSIONS.PROCESSES_READ, PERMISSIONS.PORTAL_READ)
  async raci(
    @Param('processId', UuidPipe()) processId: string,
    @Query(new ZodPipe(reportQuerySchema)) q: ReportQuery,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.reports.raci(processId, q, user, meta));
  }

  /** Every process and step where a role, IT system or term is used (.xlsx). */
  @Get('objects/:id')
  @RequirePermissions(PERMISSIONS.OBJECTS_READ, PERMISSIONS.PROCESSES_READ)
  async object(
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(reportQuerySchema)) q: ReportQuery,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.reports.objectReport(id, q.locale, user, meta));
  }
}
