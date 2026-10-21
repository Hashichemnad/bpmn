import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  createUserSchema,
  resetPasswordSchema,
  updateUserSchema,
  userDirectoryQuerySchema,
  userListQuerySchema,
  type CreateUserInput,
  type UserDirectoryQuery,
  type ResetPasswordInput,
  type UpdateUserInput,
  type UserListQuery,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { UsersService } from './users.service';
import { MfaService } from '../auth/mfa.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly mfa: MfaService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  list(@Query(new ZodPipe(userListQuerySchema)) q: UserListQuery) {
    return this.users.list(q);
  }

  /** Names and emails of active users, for @mentions and workflow assignees. */
  @Get('directory')
  @RequireAnyPermission(PERMISSIONS.COMMENTS_WRITE, PERMISSIONS.GOVERNANCE_MANAGE)
  directory(@Query(new ZodPipe(userDirectoryQuerySchema)) q: UserDirectoryQuery) {
    return this.users.directory(q.q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  get(@Param('id', UuidPipe()) id: string) {
    return this.users.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  create(
    @Body(new ZodPipe(createUserSchema)) body: CreateUserInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.users.create(body, user, meta);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateUserSchema)) body: UpdateUserInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.users.update(id, body, user, meta);
  }

  @Post(':id/reset-password')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @HttpCode(204)
  async resetPassword(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.users.resetPassword(id, body, user, meta);
  }

  @Post(':id/unlock')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @HttpCode(200)
  unlock(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.users.unlock(id, user, meta);
  }

  /** Removes the user's two-factor authentication (lost phone) and ends their sessions. */
  @Post(':id/mfa/reset')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @HttpCode(204)
  async resetMfa(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.mfa.reset(id, user, meta);
  }
}
