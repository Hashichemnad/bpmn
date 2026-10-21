import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  createObjectSchema,
  objectListQuerySchema,
  updateObjectSchema,
  type CreateObjectInput,
  type ObjectListQuery,
  type UpdateObjectInput,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { ObjectsService } from './objects.service';

@ApiTags('objects')
@Controller('objects')
export class ObjectsController {
  constructor(private readonly objects: ObjectsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.OBJECTS_READ)
  list(@Query(new ZodPipe(objectListQuerySchema)) q: ObjectListQuery) {
    return this.objects.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.OBJECTS_READ)
  get(@Param('id', UuidPipe()) id: string) {
    return this.objects.get(id);
  }

  /** "Where used" report: every process step linked to this object. */
  @Get(':id/usage')
  @RequirePermissions(PERMISSIONS.OBJECTS_READ, PERMISSIONS.PROCESSES_READ)
  usage(@Param('id', UuidPipe()) id: string) {
    return this.objects.usage(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.OBJECTS_MANAGE)
  create(
    @Body(new ZodPipe(createObjectSchema)) body: CreateObjectInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.objects.create(body, user, meta);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.OBJECTS_MANAGE)
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateObjectSchema)) body: UpdateObjectInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.objects.update(id, body, user, meta);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.OBJECTS_MANAGE)
  @HttpCode(204)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.objects.remove(id, user, meta);
  }
}
