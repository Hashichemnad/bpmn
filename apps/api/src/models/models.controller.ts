import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  createLinkSchema,
  createVersionSchema,
  saveModelSchema,
  type CreateLinkInput,
  type CreateVersionInput,
  type SaveModelInput,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { ModelsService } from './models.service';

const EDIT = [PERMISSIONS.MODELS_EDIT, PERMISSIONS.MODELS_EDIT_OWN] as const;

@ApiTags('models')
@Controller('processes/:id')
export class ModelsController {
  constructor(private readonly models: ModelsService) {}

  @Get('model')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  getModel(@Param('id', UuidPipe()) id: string) {
    return this.models.getModel(id);
  }

  @Put('model')
  @RequireAnyPermission(...EDIT)
  saveModel(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(saveModelSchema)) body: SaveModelInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.models.saveModel(id, body.bpmnXml, user, meta);
  }

  @Get('versions')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  listVersions(@Param('id', UuidPipe()) id: string) {
    return this.models.listVersions(id);
  }

  @Get('versions/:versionId')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  getVersion(
    @Param('id', UuidPipe()) id: string,
    @Param('versionId', UuidPipe()) versionId: string,
  ) {
    return this.models.getVersion(id, versionId);
  }

  @Post('versions')
  @RequireAnyPermission(...EDIT)
  createVersion(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(createVersionSchema)) body: CreateVersionInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.models.createVersion(id, body, user, meta);
  }

  @Get('links')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  listLinks(@Param('id', UuidPipe()) id: string) {
    return this.models.listLinks(id);
  }

  @Post('links')
  @RequireAnyPermission(...EDIT)
  createLink(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(createLinkSchema)) body: CreateLinkInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.models.createLink(id, body, user, meta);
  }

  @Delete('links/:linkId')
  @RequireAnyPermission(...EDIT)
  @HttpCode(200)
  deleteLink(
    @Param('id', UuidPipe()) id: string,
    @Param('linkId', UuidPipe()) linkId: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.models.deleteLink(id, linkId, user, meta);
  }
}
