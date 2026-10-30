import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  grcChangeDecisionSchema,
  grcChangeListQuerySchema,
  type GrcChangeDecisionInput,
  type GrcChangeListQuery,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { GrcChangesService } from './grc-changes.service';

/** Proposed changes of active risks and controls and their approval (D-098). */
@ApiTags('grc')
@Controller('grc/changes')
export class GrcChangesController {
  constructor(private readonly changes: GrcChangesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.GRC_READ)
  list(
    @Query(new ZodPipe(grcChangeListQuerySchema)) q: GrcChangeListQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.changes.list(q, user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.GRC_READ)
  get(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.changes.get(id, user);
  }

  /** Approve or reject (only the assignees of the current step; checked in the service). */
  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.GRC_READ, PERMISSIONS.REVIEWS_DECIDE)
  decide(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(grcChangeDecisionSchema)) body: GrcChangeDecisionInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.changes.decide(id, body, user, meta);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.GRC_EDIT)
  withdraw(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.changes.withdraw(id, user, meta);
  }
}
