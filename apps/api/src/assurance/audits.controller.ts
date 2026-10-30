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
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ATTACHMENT_MAX_BYTES,
  PERMISSIONS,
  assuranceCommentSchema,
  auditReportQuerySchema,
  createEngagementSchema,
  createFindingSchema,
  engagementListQuerySchema,
  engagementStatusSchema,
  findingResponseSchema,
  updateEngagementSchema,
  updateFindingSchema,
  workItemSchema,
  type AssuranceCommentInput,
  type CreateEngagementInput,
  type CreateFindingInput,
  type EngagementListQuery,
  type EngagementStatusInput,
  type FindingResponseInput,
  type UpdateEngagementInput,
  type UpdateFindingInput,
  type WorkItemInput,
} from '@processhub/shared';
import {
  Authenticated,
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { AuditsService } from './audits.service';
import { AuditReportService } from './audit-report.service';

/** Audit content is more sensitive than the registers: not every `grc.read` holder sees it. */
const READ = [PERMISSIONS.AUDIT_MANAGE, PERMISSIONS.GRC_EDIT, PERMISSIONS.AUDIT_READ] as const;
const MANAGE = PERMISSIONS.AUDIT_MANAGE;
const upload = FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 } });
const universeQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100) });

/** Audit management (Phase 4.2, D-101). */
@ApiTags('audits')
@Controller('audits')
export class AuditsController {
  constructor(
    private readonly audits: AuditsService,
    private readonly reports: AuditReportService,
  ) {}

  @Get('universe')
  @RequireAnyPermission(...READ)
  universe(@Query(new ZodPipe(universeQuery)) q: { year: number }, @CurrentUser() user: AuthUser) {
    return this.audits.universe(q.year, user);
  }

  @Get()
  @RequireAnyPermission(...READ)
  list(
    @Query(new ZodPipe(engagementListQuerySchema)) q: EngagementListQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.audits.list(q, user);
  }

  @Post()
  @RequirePermissions(MANAGE)
  create(
    @Body(new ZodPipe(createEngagementSchema)) body: CreateEngagementInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.audits.create(body, user, meta);
  }

  /** Response owners open their finding without the audit workspace (checked in the service). */
  @Get('findings/:id')
  @Authenticated()
  finding(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.audits.getFinding(id, user);
  }

  @Patch('findings/:id')
  @RequirePermissions(MANAGE)
  updateFinding(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateFindingSchema)) body: UpdateFindingInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.audits.updateFinding(id, body, user, meta);
  }

  @Delete('findings/:id')
  @RequirePermissions(MANAGE)
  removeFinding(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.audits.removeFinding(id, user, meta);
  }

  @Post('findings/:id/response')
  @HttpCode(200)
  @Authenticated()
  respond(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(findingResponseSchema)) body: FindingResponseInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.audits.respond(id, body, user, meta);
  }

  @Post('findings/:id/files')
  @RequirePermissions(MANAGE)
  @UseInterceptors(upload)
  findingFile(
    @Param('id', UuidPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.audits.uploadFindingFile(id, file, user, meta);
  }

  @Patch('items/:id')
  @RequirePermissions(MANAGE)
  updateItem(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(workItemSchema)) body: WorkItemInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.audits.updateItem(id, body, user, meta);
  }

  @Delete('items/:id')
  @RequirePermissions(MANAGE)
  removeItem(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.audits.removeItem(id, user, meta);
  }

  @Post('items/:id/files')
  @RequirePermissions(MANAGE)
  @UseInterceptors(upload)
  itemFile(
    @Param('id', UuidPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.audits.uploadItemFile(id, file, user, meta);
  }

  @Get(':id')
  @RequireAnyPermission(...READ)
  get(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.audits.get(id, user);
  }

  @Patch(':id')
  @RequirePermissions(MANAGE)
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateEngagementSchema)) body: UpdateEngagementInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.audits.update(id, body, user, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(MANAGE)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.audits.remove(id, user, meta);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  status(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(engagementStatusSchema)) body: EngagementStatusInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.audits.setStatus(id, body, user, meta);
  }

  @Post(':id/comments')
  @RequirePermissions(MANAGE)
  comment(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(assuranceCommentSchema)) body: AssuranceCommentInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.audits.comment(id, body.body, user, meta);
  }

  @Post(':id/items')
  @RequirePermissions(MANAGE)
  addItem(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(workItemSchema)) body: WorkItemInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.audits.addItem(id, body, user, meta);
  }

  @Post(':id/findings')
  @RequirePermissions(MANAGE)
  addFinding(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(createFindingSchema)) body: CreateFindingInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.audits.addFinding(id, body, user, meta);
  }

  /** Audit report (Word), English or Arabic (right-to-left). */
  @Get(':id/report')
  @RequireAnyPermission(...READ)
  async report(
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(auditReportQuerySchema)) q: { locale: 'en' | 'ar' },
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.reports.build(id, q.locale, user, meta);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Length': String(file.data.length),
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(file.data);
  }
}
