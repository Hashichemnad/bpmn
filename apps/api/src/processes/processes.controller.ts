import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  createProcessSchema,
  moveProcessSchema,
  processListQuerySchema,
  updateProcessSchema,
  type CreateProcessInput,
  type MoveProcessInput,
  type ProcessListQuery,
  type UpdateProcessInput,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { ProcessesService } from './processes.service';

@ApiTags('processes')
@Controller('processes')
export class ProcessesController {
  constructor(private readonly processes: ProcessesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  list(@Query(new ZodPipe(processListQuerySchema)) q: ProcessListQuery) {
    return this.processes.list(q);
  }

  @Get('tree')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  tree() {
    return this.processes.tree();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  get(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.processes.get(id, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PROCESSES_CREATE)
  create(
    @Body(new ZodPipe(createProcessSchema)) body: CreateProcessInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.processes.create(body, user, meta);
  }

  /** Ownership is checked in the service for users holding only processes.edit_own. */
  @Patch(':id')
  @RequireAnyPermission(PERMISSIONS.PROCESSES_EDIT, PERMISSIONS.PROCESSES_EDIT_OWN)
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateProcessSchema)) body: UpdateProcessInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.processes.update(id, body, user, meta);
  }

  /** Re-ordering / re-parenting changes the house structure, so it requires full edit rights. */
  @Post(':id/move')
  @RequirePermissions(PERMISSIONS.PROCESSES_EDIT)
  @HttpCode(200)
  move(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(moveProcessSchema)) body: MoveProcessInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.processes.move(id, body, user, meta);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PROCESSES_DELETE)
  @HttpCode(204)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.processes.remove(id, user, meta);
  }
}
