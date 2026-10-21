import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  createSpaceSchema,
  spacePermissionsSchema,
  updateSpaceSchema,
  type CreateSpaceInput,
  type SpacePermissionsInput,
  type UpdateSpaceInput,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { SpacesService } from './spaces.service';

/** Space owners may manage their own space; that finer check happens in the service. */
@ApiTags('docs')
@Controller('spaces')
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.DOCS_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.spaces.list(user);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.DOCS_READ)
  get(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.spaces.get(id, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.DOCS_MANAGE)
  create(
    @Body(new ZodPipe(createSpaceSchema)) body: CreateSpaceInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.spaces.create(body, user, meta);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.DOCS_READ)
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateSpaceSchema)) body: UpdateSpaceInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.spaces.update(id, body, user, meta);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DOCS_MANAGE)
  @HttpCode(204)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.spaces.remove(id, user, meta);
  }

  @Get(':id/permissions')
  @RequirePermissions(PERMISSIONS.DOCS_READ)
  getPermissions(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.spaces.getPermissions(id, user);
  }

  @Put(':id/permissions')
  @RequirePermissions(PERMISSIONS.DOCS_READ)
  setPermissions(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(spacePermissionsSchema)) body: SpacePermissionsInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.spaces.setPermissions(id, body, user, meta);
  }
}
