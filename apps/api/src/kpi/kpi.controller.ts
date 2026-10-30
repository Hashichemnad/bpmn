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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiTags } from '@nestjs/swagger';
import {
  ATTACHMENT_MAX_BYTES,
  KPI_IMPORT_KINDS,
  PERMISSIONS,
  createKpiSchema,
  createObjectiveSchema,
  eaImportQuerySchema,
  kpiExportQuerySchema,
  kpiListQuerySchema,
  kpiSettingsSchema,
  measurementSchema,
  updateKpiSchema,
  updateObjectiveSchema,
  type CreateKpiInput,
  type CreateObjectiveInput,
  type EaImportQuery,
  type KpiExportQuery,
  type KpiImportKind,
  type KpiListQuery,
  type KpiSettings,
  type MeasurementInput,
  type UpdateKpiInput,
  type UpdateObjectiveInput,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { EXCEL_IMPORT_MAX_BYTES } from '../common/excel';
import { download } from '../ea/ea.controller';
import { AssuranceFilesService } from '../assurance/assurance-files.service';
import { KpiService } from './kpi.service';
import { KpiExcelService } from './kpi-excel.service';
import { KpiSettingsService } from './kpi-settings.service';

const kindSchema = z.enum(KPI_IMPORT_KINDS);
const READ = PERMISSIONS.KPI_READ;
const EDIT = PERMISSIONS.KPI_EDIT;
const MEASURE = [PERMISSIONS.KPI_EDIT, PERMISSIONS.KPI_MEASURE] as const;

/** KPIs (Phase 4.3, M12): catalogue, objectives, measurements, evidence, Excel, settings. */
@ApiTags('kpis')
@Controller('kpis')
export class KpiController {
  constructor(
    private readonly kpis: KpiService,
    private readonly excel: KpiExcelService,
    private readonly settings: KpiSettingsService,
    private readonly files: AssuranceFilesService,
  ) {}

  // ---------- Settings, tasks, process view ----------

  @Get('settings')
  @RequireAnyPermission(READ, PERMISSIONS.PORTAL_MANAGE)
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  @RequirePermissions(EDIT)
  setSettings(
    @Body(new ZodPipe(kpiSettingsSchema)) body: KpiSettings,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.settings.set(body, user, meta);
  }

  /** KPIs of the signed-in owner whose value of the last completed period is missing. */
  @Get('tasks')
  @RequireAnyPermission(...MEASURE)
  tasks(@CurrentUser() user: AuthUser) {
    return this.kpis.myTasks(user);
  }

  /** KPIs of a process and its steps, with the KPIs calculated from the step attributes. */
  @Get('processes/:processId')
  @RequirePermissions(READ)
  forProcess(@Param('processId', UuidPipe()) processId: string) {
    return this.kpis.forProcess(processId);
  }

  // ---------- Objectives ----------

  @Get('objectives')
  @RequirePermissions(READ)
  objectives() {
    return this.kpis.objectives();
  }

  @Post('objectives')
  @RequirePermissions(EDIT)
  createObjective(
    @Body(new ZodPipe(createObjectiveSchema)) body: CreateObjectiveInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.kpis.createObjective(body, user, meta);
  }

  @Patch('objectives/:id')
  @RequirePermissions(EDIT)
  updateObjective(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateObjectiveSchema)) body: UpdateObjectiveInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.kpis.updateObjective(id, body, user, meta);
  }

  @Delete('objectives/:id')
  @HttpCode(204)
  @RequirePermissions(EDIT)
  async removeObjective(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.kpis.removeObjective(id, user, meta);
  }

  // ---------- Excel ----------

  @Get('export/:kind')
  @RequirePermissions(READ)
  async export(
    @Param('kind', new ZodPipe(kindSchema)) kind: KpiImportKind,
    @Query(new ZodPipe(kpiExportQuerySchema)) q: KpiExportQuery,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.excel.export(kind, q.locale, user, meta));
  }

  @Get('template/:kind')
  @RequireAnyPermission(...MEASURE)
  async template(
    @Param('kind', new ZodPipe(kindSchema)) kind: KpiImportKind,
    @Query(new ZodPipe(kpiExportQuerySchema)) q: KpiExportQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.excel.template(kind, q.locale));
  }

  /** KPIs and objectives: KPI editors; measurements: editors and owners (their own KPIs). */
  @Post('import/:kind')
  @HttpCode(200)
  @RequireAnyPermission(...MEASURE)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: EXCEL_IMPORT_MAX_BYTES, files: 1 } }),
  )
  import(
    @Param('kind', new ZodPipe(kindSchema)) kind: KpiImportKind,
    @Query(new ZodPipe(eaImportQuerySchema)) q: EaImportQuery,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.excel.import(kind, file, q.dryRun, user, meta);
  }

  // ---------- Measurement evidence ----------

  @Post('measurements/:measurementId/files')
  @RequireAnyPermission(...MEASURE)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 } }),
  )
  async upload(
    @Param('measurementId', UuidPipe()) measurementId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    const kpiId = await this.kpis.kpiOfMeasurement(measurementId);
    await this.kpis.assertMayMeasure(kpiId, user);
    return this.files.upload('KPI_MEASUREMENT', measurementId, file, user, meta, 'KpiMeasurement');
  }

  // ---------- KPIs ----------

  @Get()
  @RequirePermissions(READ)
  list(@Query(new ZodPipe(kpiListQuerySchema)) q: KpiListQuery) {
    return this.kpis.list(q);
  }

  @Get(':id')
  @RequirePermissions(READ)
  get(@Param('id', UuidPipe()) id: string) {
    return this.kpis.get(id);
  }

  @Post()
  @RequirePermissions(EDIT)
  create(
    @Body(new ZodPipe(createKpiSchema)) body: CreateKpiInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.kpis.create(body, user, meta);
  }

  @Patch(':id')
  @RequirePermissions(EDIT)
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateKpiSchema)) body: UpdateKpiInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.kpis.update(id, body, user, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(EDIT)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.kpis.remove(id, user, meta);
  }

  /** Enters (or corrects) the actual value of one period. */
  @Put(':id/measurements')
  @RequireAnyPermission(...MEASURE)
  async measure(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(measurementSchema)) body: MeasurementInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.kpis.measure(id, body, user, meta);
    return this.kpis.get(id);
  }

  @Delete(':id/measurements/:measurementId')
  @HttpCode(204)
  @RequireAnyPermission(...MEASURE)
  async removeMeasurement(
    @Param('id', UuidPipe()) id: string,
    @Param('measurementId', UuidPipe()) measurementId: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.kpis.removeMeasurement(id, measurementId, user, meta);
  }

  /** Calculated KPIs: records the current value of the working model for the due period. */
  @Post(':id/recalculate')
  @HttpCode(200)
  @RequirePermissions(EDIT)
  recalculate(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.kpis.recalculate(id, user, meta);
  }
}
