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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  CSV_DELIMITERS,
  MINING_UPLOAD_MAX_MB,
  PERMISSIONS,
  activityMappingSchema,
  createEventLogSchema,
  eventLogListQuerySchema,
  logGrantsSchema,
  mappingTemplateSchema,
  miningMappingSchema,
  miningSettingsSchema,
  processHubLogSchema,
  updateEventLogSchema,
  type ActivityMappingInput,
  type EventLogListQuery,
  type LogGrantsInput,
  type MappingTemplateInput,
  type MiningEventDto,
  type MiningMapping,
  type MiningSettings,
  type ProcessHubLogInput,
  type UpdateEventLogInput,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { forbidden } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { EventLogsService } from './event-logs.service';
import { LogImportService } from './log-import.service';
import { MiningJobsService, toJobDto } from './jobs/mining-jobs.service';
import { MiningSettingsService } from './mining-settings.service';

const READ = PERMISSIONS.MINING_READ;
const MANAGE = PERMISSIONS.MINING_MANAGE;

const previewQuery = z.object({
  delimiter: z.enum(CSV_DELIMITERS).optional(),
  sheet: z.string().trim().max(100).optional(),
});
const waitQuery = z.object({ wait: z.coerce.number().min(0).max(25).default(0) });
/** Multipart fields of the upload (strings; empty = not set). */
const uploadFields = z.preprocess(
  (v) =>
    Object.fromEntries(
      Object.entries((v ?? {}) as Record<string, unknown>).map(([k, x]) => [
        k,
        x === '' ? null : x,
      ]),
    ),
  createEventLogSchema,
);

/** Process mining — event logs, import, jobs, templates, settings (Phase 5.1, M13). */
@ApiTags('mining')
@Controller('mining')
export class MiningController {
  constructor(
    private readonly logs: EventLogsService,
    private readonly importer: LogImportService,
    private readonly jobs: MiningJobsService,
    private readonly settings: MiningSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------- Settings ----------

  @Get('settings')
  @RequireAnyPermission(READ, PERMISSIONS.SETTINGS_MANAGE)
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  setSettings(
    @Body(new ZodPipe(miningSettingsSchema)) body: MiningSettings,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.settings.set(body, user, meta);
  }

  // ---------- Mapping templates ----------

  @Get('templates')
  @RequirePermissions(MANAGE)
  templates() {
    return this.logs.templates();
  }

  @Post('templates')
  @RequirePermissions(MANAGE)
  createTemplate(
    @Body(new ZodPipe(mappingTemplateSchema)) body: MappingTemplateInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.logs.createTemplate(body, user);
  }

  @Delete('templates/:id')
  @HttpCode(204)
  @RequirePermissions(MANAGE)
  deleteTemplate(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.logs.deleteTemplate(id, user);
  }

  // ---------- Jobs ----------

  private async assertJobAccess(jobId: string, user: AuthUser) {
    const job = await this.jobs.get(jobId);
    if (job.createdById === user.id || user.permissions.has(PERMISSIONS.SETTINGS_MANAGE))
      return job;
    if (job.logId) {
      await this.logs.visible(job.logId, user);
      return job;
    }
    throw forbidden();
  }

  @Get('jobs/:id')
  @RequirePermissions(READ)
  async job(
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(waitQuery)) q: { wait: number },
    @CurrentUser() user: AuthUser,
  ) {
    await this.assertJobAccess(id, user);
    return toJobDto(await this.jobs.wait(id, q.wait * 1000));
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(READ)
  async cancel(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    const job = await this.assertJobAccess(id, user);
    if (job.createdById !== user.id && !user.permissions.has(MANAGE)) throw forbidden();
    return toJobDto(await this.jobs.cancel(id));
  }

  // ---------- Logs ----------

  @Get('logs')
  @RequirePermissions(READ)
  list(
    @Query(new ZodPipe(eventLogListQuerySchema)) q: EventLogListQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.logs.list(q, user);
  }

  @Post('logs/upload')
  @RequirePermissions(MANAGE)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: Number(process.env.MINING_UPLOAD_MAX_MB || MINING_UPLOAD_MAX_MB) * 1024 * 1024,
        files: 1,
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodPipe(uploadFields)) body: z.infer<typeof createEventLogSchema>,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    const { id } = await this.importer.upload(file, body, user, meta);
    return this.logs.detail(id, user);
  }

  @Post('logs/processhub')
  @RequirePermissions(MANAGE)
  async fromProcessHub(
    @Body(new ZodPipe(processHubLogSchema)) body: ProcessHubLogInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    const { id } = await this.importer.createFromProcessHub(body, user, meta);
    return this.logs.detail(id, user);
  }

  @Get('logs/:id')
  @RequirePermissions(READ)
  detail(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.logs.detail(id, user);
  }

  @Patch('logs/:id')
  @RequirePermissions(MANAGE)
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateEventLogSchema)) body: UpdateEventLogInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.logs.update(id, body, user, meta);
  }

  @Delete('logs/:id')
  @RequirePermissions(MANAGE)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return toJobDto(await this.importer.remove(id, user, meta));
  }

  @Get('logs/:id/preview')
  @RequirePermissions(MANAGE)
  preview(
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(previewQuery)) q: z.infer<typeof previewQuery>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.importer.preview(id, q, user);
  }

  @Put('logs/:id/mapping')
  @RequirePermissions(MANAGE)
  mapping(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(miningMappingSchema)) body: MiningMapping,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.importer.setMapping(id, body, user, meta);
  }

  @Post('logs/:id/validate')
  @RequirePermissions(MANAGE)
  async validate(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return toJobDto(await this.importer.startValidation(id, user));
  }

  @Post('logs/:id/import')
  @RequirePermissions(MANAGE)
  async import(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return toJobDto(await this.importer.startImport(id, user));
  }

  @Get('logs/:id/activities')
  @RequirePermissions(READ)
  activities(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.logs.activities(id, user);
  }

  @Put('logs/:id/activities')
  @RequirePermissions(MANAGE)
  mapActivities(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(activityMappingSchema)) body: ActivityMappingInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.logs.mapActivities(id, body, user, meta);
  }

  @Post('logs/:id/activities/auto-match')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  async autoMatch(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    await this.logs.manageable(id, user);
    const matched = await this.logs.autoMatch(id);
    await this.logs.invalidate(id);
    return { matched, ...(await this.logs.activities(id, user)) };
  }

  @Get('logs/:id/grants')
  @RequirePermissions(READ)
  grants(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.logs.grants(id, user);
  }

  @Put('logs/:id/grants')
  @RequirePermissions(MANAGE)
  setGrants(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(logGrantsSchema)) body: LogGrantsInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.logs.setGrants(id, body.userIds, user, meta);
  }

  /** Events of one case (drill-down from variants, deviations, bottlenecks). */
  @Get('logs/:id/cases/:caseId')
  @RequirePermissions(READ)
  async caseEvents(
    @Param('id', UuidPipe()) id: string,
    @Param('caseId', new ZodPipe(z.string().max(200))) caseId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<MiningEventDto[]> {
    await this.logs.ready(id, user);
    const rows = await this.prisma.miningEvent.findMany({
      where: { logId: id, caseId },
      orderBy: [{ endAt: 'asc' }, { id: 'asc' }],
      take: 2000,
    });
    return rows.map((r) => ({
      caseId: r.caseId,
      activity: r.activity,
      startAt: r.startAt?.toISOString() ?? null,
      endAt: r.endAt.toISOString(),
      resource: r.resource,
      department: r.department,
      attributes: (r.attributes ?? {}) as Record<string, string>,
    }));
  }
}
