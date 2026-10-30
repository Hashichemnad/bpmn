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
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiTags } from '@nestjs/swagger';
import {
  GRC_IMPORT_KINDS,
  GRC_IMPORT_MAX_BYTES,
  PERMISSIONS,
  grcExportQuerySchema,
  grcImportQuerySchema,
  type GrcExportQuery,
  type GrcImportKind,
  type GrcImportQuery,
  controlListQuerySchema,
  createControlSchema,
  createRequirementSchema,
  createRiskSchema,
  grcCommentSchema,
  grcSettingsSchema,
  requirementListQuerySchema,
  riskListQuerySchema,
  updateControlSchema,
  updateRequirementSchema,
  updateRiskSchema,
  type ControlListQuery,
  type CreateControlInput,
  type CreateRequirementInput,
  type CreateRiskInput,
  type GrcCommentInput,
  type GrcSettings,
  type RequirementListQuery,
  type RiskListQuery,
  type UpdateControlInput,
  type UpdateRequirementInput,
  type UpdateRiskInput,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { GrcService } from './grc.service';
import { GrcSettingsService } from './grc-settings.service';
import { GrcExcelService, type GrcFile } from './grc-excel.service';

const kindSchema = z.enum(GRC_IMPORT_KINDS);

function download(res: Response, file: GrcFile) {
  res.set({
    'Content-Type': file.contentType,
    'Content-Length': String(file.data.length),
    'Content-Disposition': `attachment; filename="${file.fileName}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  return new StreamableFile(file.data);
}

const READ = PERMISSIONS.GRC_READ;
/** Proposers create drafts and change their own drafts; editors anything (checked in the service). */
const WRITE = [PERMISSIONS.GRC_EDIT, PERMISSIONS.GRC_PROPOSE] as const;

@ApiTags('grc')
@Controller('grc')
export class GrcController {
  constructor(
    private readonly grc: GrcService,
    private readonly settings: GrcSettingsService,
    private readonly excel: GrcExcelService,
  ) {}

  // ---------- Excel ----------

  @Get('export/:kind')
  @RequirePermissions(READ)
  async export(
    @Param('kind', new ZodPipe(kindSchema)) kind: GrcImportKind,
    @Query(new ZodPipe(grcExportQuerySchema)) q: GrcExportQuery,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.excel.export(kind, q.locale, user, meta));
  }

  @Get('template/:kind')
  @RequirePermissions(PERMISSIONS.GRC_EDIT)
  async template(
    @Param('kind', new ZodPipe(kindSchema)) kind: GrcImportKind,
    @Query(new ZodPipe(grcExportQuerySchema)) q: GrcExportQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.excel.template(kind, q.locale));
  }

  /** Validates (dryRun, default) or imports an Excel register; nothing is imported on errors. */
  @Post('import/:kind')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.GRC_EDIT)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: GRC_IMPORT_MAX_BYTES, files: 1 } }),
  )
  import(
    @Param('kind', new ZodPipe(kindSchema)) kind: GrcImportKind,
    @Query(new ZodPipe(grcImportQuerySchema)) q: GrcImportQuery,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.excel.import(kind, file, q.dryRun, user, meta);
  }

  // ---------- Settings ----------

  /** Categories, matrix labels and bands: needed by everyone who sees ratings. */
  @Get('settings')
  @RequireAnyPermission(READ, PERMISSIONS.PROCESSES_READ)
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.GRC_ADMIN)
  setSettings(
    @Body(new ZodPipe(grcSettingsSchema)) body: GrcSettings,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.settings.set(body, user, meta);
  }

  // ---------- Risks ----------

  @Get('risks')
  @RequirePermissions(READ)
  listRisks(@Query(new ZodPipe(riskListQuerySchema)) q: RiskListQuery) {
    return this.grc.listRisks(q);
  }

  @Get('risks/:id')
  @RequirePermissions(READ)
  getRisk(@Param('id', UuidPipe()) id: string) {
    return this.grc.getRisk(id);
  }

  @Post('risks')
  @RequireAnyPermission(...WRITE)
  createRisk(
    @Body(new ZodPipe(createRiskSchema)) body: CreateRiskInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.grc.createRisk(body, user, meta);
  }

  @Patch('risks/:id')
  @RequireAnyPermission(...WRITE)
  updateRisk(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateRiskSchema)) body: UpdateRiskInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.grc.updateRisk(id, body, user, meta);
  }

  @Delete('risks/:id')
  @RequireAnyPermission(...WRITE)
  @HttpCode(204)
  async removeRisk(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.grc.remove(id, 'RISK', user, meta);
  }

  // ---------- Controls ----------

  @Get('controls')
  @RequirePermissions(READ)
  listControls(@Query(new ZodPipe(controlListQuerySchema)) q: ControlListQuery) {
    return this.grc.listControls(q);
  }

  @Get('controls/:id')
  @RequirePermissions(READ)
  getControl(@Param('id', UuidPipe()) id: string) {
    return this.grc.getControl(id);
  }

  @Post('controls')
  @RequireAnyPermission(...WRITE)
  createControl(
    @Body(new ZodPipe(createControlSchema)) body: CreateControlInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.grc.createControl(body, user, meta);
  }

  @Patch('controls/:id')
  @RequireAnyPermission(...WRITE)
  updateControl(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateControlSchema)) body: UpdateControlInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.grc.updateControl(id, body, user, meta);
  }

  @Delete('controls/:id')
  @RequireAnyPermission(...WRITE)
  @HttpCode(204)
  async removeControl(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.grc.remove(id, 'CONTROL', user, meta);
  }

  // ---------- Requirements (editors only) ----------

  @Get('requirements')
  @RequirePermissions(READ)
  listRequirements(@Query(new ZodPipe(requirementListQuerySchema)) q: RequirementListQuery) {
    return this.grc.listRequirements(q);
  }

  @Get('requirements/:id')
  @RequirePermissions(READ)
  getRequirement(@Param('id', UuidPipe()) id: string) {
    return this.grc.getRequirement(id);
  }

  @Post('requirements')
  @RequirePermissions(PERMISSIONS.GRC_EDIT)
  createRequirement(
    @Body(new ZodPipe(createRequirementSchema)) body: CreateRequirementInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.grc.createRequirement(body, user, meta);
  }

  @Patch('requirements/:id')
  @RequirePermissions(PERMISSIONS.GRC_EDIT)
  updateRequirement(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateRequirementSchema)) body: UpdateRequirementInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.grc.updateRequirement(id, body, user, meta);
  }

  @Delete('requirements/:id')
  @RequirePermissions(PERMISSIONS.GRC_ADMIN)
  @HttpCode(204)
  async removeRequirement(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.grc.remove(id, 'REQUIREMENT', user, meta);
  }

  // ---------- Timeline, comments, process view ----------

  @Get('items/:id/timeline')
  @RequirePermissions(READ)
  timeline(@Param('id', UuidPipe()) id: string) {
    return this.grc.timeline(id);
  }

  @Post('items/:id/comments')
  @RequirePermissions(READ, PERMISSIONS.COMMENTS_WRITE)
  comment(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(grcCommentSchema)) body: GrcCommentInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.grc.comment(id, body.body, user, meta);
  }

  /** Linked risks / controls / requirements per step of a process (modeler side panel, badges). */
  @Get('processes/:id')
  @RequirePermissions(READ, PERMISSIONS.PROCESSES_READ)
  forProcess(@Param('id', UuidPipe()) id: string) {
    return this.grc.forProcess(id);
  }
}
