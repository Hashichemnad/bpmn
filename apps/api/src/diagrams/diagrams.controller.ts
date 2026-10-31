import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  PERMISSIONS,
  createDiagramLinkSchema,
  createDiagramSchema,
  createDiagramVersionSchema,
  diagramListQuerySchema,
  restoreVersionSchema,
  saveDiagramContentSchema,
  updateDiagramSchema,
  uuidSchema,
  versionLabelSchema,
  type CreateDiagramInput,
  type CreateDiagramLinkInput,
  type CreateDiagramVersionInput,
  type DiagramListQuery,
  type RestoreVersionInput,
  type SaveDiagramContentInput,
  type UpdateDiagramInput,
  type VersionLabelInput,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { DiagramsService } from './diagrams.service';
import { DiagramFactsService } from './diagram-facts.service';

const EDIT = [PERMISSIONS.MODELS_EDIT, PERMISSIONS.MODELS_EDIT_OWN] as const;

const factsSchema = z.object({
  ids: z
    .string()
    .max(12000)
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(uuidSchema).max(300)),
});

const whereUsedSchema = z.object({
  processId: uuidSchema.optional(),
  diagramId: uuidSchema.optional(),
  objectId: uuidSchema.optional(),
});

/** Diagrams other than BPMN (D-120). Rights follow processes; ownership is checked in the service. */
@ApiTags('diagrams')
@Controller('diagrams')
export class DiagramsController {
  constructor(
    private readonly diagrams: DiagramsService,
    private readonly facts: DiagramFactsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  list(@Query(new ZodPipe(diagramListQuerySchema)) q: DiagramListQuery) {
    return this.diagrams.list(q);
  }

  @Get('all')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  all() {
    return this.diagrams.all();
  }

  /** Status, department, KPI and risk facts of processes linked from a value chain (D-121). */
  @Get('process-facts')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  processFacts(
    @Query(new ZodPipe(factsSchema)) q: z.infer<typeof factsSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.facts.processFacts(q.ids, user);
  }

  @Get('where-used')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  whereUsed(@Query(new ZodPipe(whereUsedSchema)) q: z.infer<typeof whereUsedSchema>) {
    return this.diagrams.whereUsed(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  get(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.diagrams.get(id, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PROCESSES_CREATE)
  create(
    @Body(new ZodPipe(createDiagramSchema)) body: CreateDiagramInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.diagrams.create(body, user, meta);
  }

  @Patch(':id')
  @RequireAnyPermission(PERMISSIONS.PROCESSES_EDIT, PERMISSIONS.PROCESSES_EDIT_OWN)
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateDiagramSchema)) body: UpdateDiagramInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.diagrams.update(id, body, user, meta);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PROCESSES_DELETE)
  @HttpCode(204)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.diagrams.remove(id, user, meta);
  }

  @Get(':id/content')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  getContent(@Param('id', UuidPipe()) id: string) {
    return this.diagrams.getContent(id);
  }

  @Put(':id/content')
  @RequireAnyPermission(...EDIT)
  saveContent(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(saveDiagramContentSchema)) body: SaveDiagramContentInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.diagrams.saveContent(id, body.content, user, meta, body.aiGenerated);
  }

  @Get(':id/versions')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  listVersions(@Param('id', UuidPipe()) id: string) {
    return this.diagrams.listVersions(id);
  }

  @Get(':id/versions/:versionId')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  getVersion(
    @Param('id', UuidPipe()) id: string,
    @Param('versionId', UuidPipe()) versionId: string,
  ) {
    return this.diagrams.getVersion(id, versionId);
  }

  @Post(':id/versions')
  @RequireAnyPermission(...EDIT)
  createVersion(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(createDiagramVersionSchema)) body: CreateDiagramVersionInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.diagrams.createVersion(id, body, user, meta);
  }

  @Post(':id/versions/:versionId/restore')
  @RequireAnyPermission(...EDIT)
  @HttpCode(200)
  restoreVersion(
    @Param('id', UuidPipe()) id: string,
    @Param('versionId', UuidPipe()) versionId: string,
    @Body(new ZodPipe(restoreVersionSchema)) body: RestoreVersionInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.diagrams.restoreVersion(id, versionId, body, user, meta);
  }

  @Patch(':id/versions/:versionId')
  @RequireAnyPermission(...EDIT)
  labelVersion(
    @Param('id', UuidPipe()) id: string,
    @Param('versionId', UuidPipe()) versionId: string,
    @Body(new ZodPipe(versionLabelSchema)) body: VersionLabelInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.diagrams.labelVersion(id, versionId, body, user, meta);
  }

  @Get(':id/links')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  listLinks(@Param('id', UuidPipe()) id: string) {
    return this.diagrams.listLinks(id);
  }

  @Post(':id/links')
  @RequireAnyPermission(...EDIT, PERMISSIONS.GRC_EDIT)
  createLink(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(createDiagramLinkSchema)) body: CreateDiagramLinkInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.diagrams.createLink(id, body, user, meta);
  }

  @Delete(':id/links/:linkId')
  @RequireAnyPermission(...EDIT, PERMISSIONS.GRC_EDIT)
  @HttpCode(200)
  deleteLink(
    @Param('id', UuidPipe()) id: string,
    @Param('linkId', UuidPipe()) linkId: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.diagrams.deleteLink(id, linkId, user, meta);
  }
}
