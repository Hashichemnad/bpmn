import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  createDepartmentSchema,
  updateDepartmentSchema,
  type CreateDepartmentInput,
  type UpdateDepartmentInput,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { DepartmentsService } from './departments.service';

@ApiTags('departments')
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_READ)
  list() {
    return this.departments.list();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_MANAGE)
  create(
    @Body(new ZodPipe(createDepartmentSchema)) body: CreateDepartmentInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.departments.create(body, user, meta);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_MANAGE)
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateDepartmentSchema)) body: UpdateDepartmentInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.departments.update(id, body, user, meta);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_MANAGE)
  @HttpCode(204)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.departments.remove(id, user, meta);
  }
}
