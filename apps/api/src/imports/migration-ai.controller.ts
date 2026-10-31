import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  acceptProposalSchema,
  migrationAiRunSchema,
  migrationProposalQuerySchema,
  type AcceptProposalInput,
  type MigrationAiRunInput,
  type MigrationProposalQuery,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { MigrationAiService } from './migration-ai.service';

const MANAGE = PERMISSIONS.IMPORT_MANAGE;

/** AI-assisted migration (M15 step 5): runs over imported items and the proposal review queue. */
@ApiTags('imports')
@Controller('migration-ai')
export class MigrationAiController {
  constructor(private readonly ai: MigrationAiService) {}

  @Post('run')
  @HttpCode(202)
  @RequirePermissions(MANAGE)
  run(
    @Body(new ZodPipe(migrationAiRunSchema)) body: MigrationAiRunInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.ai.start(body, user, meta);
  }

  @Get('proposals')
  @RequirePermissions(MANAGE)
  list(@Query(new ZodPipe(migrationProposalQuerySchema)) q: MigrationProposalQuery) {
    return this.ai.list(q);
  }

  @Get('proposals/:id')
  @RequirePermissions(MANAGE)
  get(@Param('id', UuidPipe()) id: string) {
    return this.ai.get(id);
  }

  @Post('proposals/:id/accept')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  accept(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(acceptProposalSchema)) body: AcceptProposalInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.ai.accept(id, body, user, meta);
  }

  @Post('proposals/:id/reject')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  reject(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.ai.reject(id, user, meta);
  }
}
