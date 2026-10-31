import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  eaExportQuerySchema,
  landscapeQuerySchema,
  traceQuerySchema,
  type EaExportQuery,
  type LandscapeQuery,
  type TraceQuery,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { EaViewsService } from './ea-views.service';
import { download } from './ea.controller';

const READ = PERMISSIONS.EA_READ;

/** Architecture views (Phase 4.3 step 2): capability map, landscape, traceability, impact. */
@ApiTags('ea')
@Controller('ea')
export class EaViewsController {
  constructor(private readonly views: EaViewsService) {}

  /** Capabilities with roll-up metrics for the "colour by" views of the map. */
  @Get('capability-map')
  @RequirePermissions(READ)
  capabilityMap(@CurrentUser() user: AuthUser) {
    return this.views.capabilityMap(user);
  }

  /** Applications (nodes) and interfaces (edges), filtered by department, capability, lifecycle. */
  @Get('landscape')
  @RequirePermissions(READ)
  landscape(@Query(new ZodPipe(landscapeQuerySchema)) q: LandscapeQuery) {
    return this.views.landscape(q);
  }

  /** Capability → process → step → application → data object, with the risks and controls. */
  @Get('trace')
  @RequirePermissions(READ)
  trace(@Query(new ZodPipe(traceQuerySchema)) q: TraceQuery, @CurrentUser() user: AuthUser) {
    return this.views.trace(q, user);
  }

  @Get('trace/export')
  @RequirePermissions(READ)
  async traceExport(
    @Query(new ZodPipe(traceQuerySchema)) q: TraceQuery,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.views.traceExport(q, user, meta));
  }

  /** "If this application is retired": processes, steps, controls, risks, interfaces, data. */
  @Get('applications/:id/impact')
  @RequirePermissions(READ)
  impact(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.views.impact(id, user);
  }

  @Get('applications/:id/impact/export')
  @RequirePermissions(READ)
  async impactExport(
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(eaExportQuerySchema)) q: EaExportQuery,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.views.impactExport(id, q.locale, user, meta));
  }
}
