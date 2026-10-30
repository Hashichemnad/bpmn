import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
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
  EA_IMPORT_KINDS,
  PERMISSIONS,
  applicationListQuerySchema,
  createApplicationSchema,
  createCapabilitySchema,
  createDataObjectSchema,
  createInterfaceSchema,
  dataObjectListQuerySchema,
  eaExportQuerySchema,
  eaImportQuerySchema,
  interfaceListQuerySchema,
  updateApplicationSchema,
  updateCapabilitySchema,
  updateDataObjectSchema,
  updateInterfaceSchema,
  type ApplicationListQuery,
  type CreateApplicationInput,
  type CreateCapabilityInput,
  type CreateDataObjectInput,
  type CreateInterfaceInput,
  type DataObjectListQuery,
  type EaExportQuery,
  type EaImportKind,
  type EaImportQuery,
  type InterfaceListQuery,
  type UpdateApplicationInput,
  type UpdateCapabilityInput,
  type UpdateDataObjectInput,
  type UpdateInterfaceInput,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { EXCEL_IMPORT_MAX_BYTES, type ExcelFile } from '../common/excel';
import { EaService } from './ea.service';
import { EaExcelService } from './ea-excel.service';

const kindSchema = z.enum(EA_IMPORT_KINDS);

export function download(res: Response, file: ExcelFile) {
  res.set({
    'Content-Type': file.contentType,
    'Content-Length': String(file.data.length),
    'Content-Disposition': `attachment; filename="${file.fileName}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  return new StreamableFile(file.data);
}

const READ = PERMISSIONS.EA_READ;
const EDIT = PERMISSIONS.EA_EDIT;
const ADMIN = PERMISSIONS.EA_ADMIN;

/** Enterprise architecture (Phase 4.3, M11): catalogues, Excel. Views are in EaViewsController. */
@ApiTags('ea')
@Controller('ea')
export class EaController {
  constructor(
    private readonly ea: EaService,
    private readonly excel: EaExcelService,
  ) {}

  // ---------- Excel ----------

  @Get('export/:kind')
  @RequirePermissions(READ)
  async export(
    @Param('kind', new ZodPipe(kindSchema)) kind: EaImportKind,
    @Query(new ZodPipe(eaExportQuerySchema)) q: EaExportQuery,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.excel.export(kind, q.locale, user, meta));
  }

  @Get('template/:kind')
  @RequirePermissions(EDIT)
  async template(
    @Param('kind', new ZodPipe(kindSchema)) kind: EaImportKind,
    @Query(new ZodPipe(eaExportQuerySchema)) q: EaExportQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.excel.template(kind, q.locale));
  }

  /** Validates (dryRun, default) or imports a catalogue; nothing is imported on errors. */
  @Post('import/:kind')
  @HttpCode(200)
  @RequirePermissions(EDIT)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: EXCEL_IMPORT_MAX_BYTES, files: 1 } }),
  )
  import(
    @Param('kind', new ZodPipe(kindSchema)) kind: EaImportKind,
    @Query(new ZodPipe(eaImportQuerySchema)) q: EaImportQuery,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.excel.import(kind, file, q.dryRun, user, meta);
  }

  // ---------- Applications ----------

  @Get('applications')
  @RequirePermissions(READ)
  listApplications(@Query(new ZodPipe(applicationListQuerySchema)) q: ApplicationListQuery) {
    return this.ea.listApplications(q);
  }

  @Get('applications/:id')
  @RequirePermissions(READ)
  getApplication(@Param('id', UuidPipe()) id: string) {
    return this.ea.getApplication(id);
  }

  @Post('applications')
  @RequirePermissions(EDIT)
  createApplication(
    @Body(new ZodPipe(createApplicationSchema)) body: CreateApplicationInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.ea.createApplication(body, user, meta);
  }

  @Patch('applications/:id')
  @RequirePermissions(EDIT)
  updateApplication(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateApplicationSchema)) body: UpdateApplicationInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.ea.updateApplication(id, body, user, meta);
  }

  @Delete('applications/:id')
  @HttpCode(204)
  @RequirePermissions(ADMIN)
  async removeApplication(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.ea.removeApplication(id, user, meta);
  }

  // ---------- Interfaces ----------

  @Get('interfaces')
  @RequirePermissions(READ)
  listInterfaces(@Query(new ZodPipe(interfaceListQuerySchema)) q: InterfaceListQuery) {
    return this.ea.listInterfaces(q);
  }

  @Get('interfaces/:id')
  @RequirePermissions(READ)
  getInterface(@Param('id', UuidPipe()) id: string) {
    return this.ea.getInterface(id);
  }

  @Post('interfaces')
  @RequirePermissions(EDIT)
  createInterface(
    @Body(new ZodPipe(createInterfaceSchema)) body: CreateInterfaceInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.ea.createInterface(body, user, meta);
  }

  @Patch('interfaces/:id')
  @RequirePermissions(EDIT)
  updateInterface(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateInterfaceSchema)) body: UpdateInterfaceInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.ea.updateInterface(id, body, user, meta);
  }

  @Delete('interfaces/:id')
  @HttpCode(204)
  @RequirePermissions(ADMIN)
  async removeInterface(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.ea.removeInterface(id, user, meta);
  }

  // ---------- Data objects ----------

  @Get('data-objects')
  @RequirePermissions(READ)
  listDataObjects(@Query(new ZodPipe(dataObjectListQuerySchema)) q: DataObjectListQuery) {
    return this.ea.listDataObjects(q);
  }

  @Get('data-objects/:id')
  @RequirePermissions(READ)
  getDataObject(@Param('id', UuidPipe()) id: string) {
    return this.ea.getDataObject(id);
  }

  @Post('data-objects')
  @RequirePermissions(EDIT)
  createDataObject(
    @Body(new ZodPipe(createDataObjectSchema)) body: CreateDataObjectInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.ea.createDataObject(body, user, meta);
  }

  @Patch('data-objects/:id')
  @RequirePermissions(EDIT)
  updateDataObject(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateDataObjectSchema)) body: UpdateDataObjectInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.ea.updateDataObject(id, body, user, meta);
  }

  @Delete('data-objects/:id')
  @HttpCode(204)
  @RequirePermissions(ADMIN)
  async removeDataObject(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.ea.removeDataObject(id, user, meta);
  }

  // ---------- Capabilities ----------

  @Get('capabilities')
  @RequirePermissions(READ)
  listCapabilities() {
    return this.ea.listCapabilities();
  }

  @Get('capabilities/:id')
  @RequirePermissions(READ)
  getCapability(@Param('id', UuidPipe()) id: string) {
    return this.ea.getCapability(id);
  }

  @Post('capabilities')
  @RequirePermissions(EDIT)
  createCapability(
    @Body(new ZodPipe(createCapabilitySchema)) body: CreateCapabilityInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.ea.createCapability(body, user, meta);
  }

  @Patch('capabilities/:id')
  @RequirePermissions(EDIT)
  updateCapability(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateCapabilitySchema)) body: UpdateCapabilityInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.ea.updateCapability(id, body, user, meta);
  }

  @Delete('capabilities/:id')
  @HttpCode(204)
  @RequirePermissions(ADMIN)
  async removeCapability(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.ea.removeCapability(id, user, meta);
  }
}
