import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  ATTACHMENT_MAX_BYTES,
  PERMISSIONS,
  caseCommentSchema,
  caseListQuerySchema,
  caseReasonSchema,
  checkInputSchema,
  completeTaskSchema,
  dashboardQuerySchema,
  delegateTaskSchema,
  outOfOfficeSchema,
  reassignSchema,
  saveTaskSchema,
  startCaseSchema,
  taskListQuerySchema,
  uuidSchema,
  workflowConfigInputSchema,
  workflowSettingsSchema,
  type CaseListQuery,
  type CompleteTaskInput,
  type DashboardQuery,
  type OutOfOfficeInput,
  type StartCaseInput,
  type TaskListQuery,
  type WorkflowConfigInput,
  type WorkflowSettings,
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
import { download } from '../ea/ea.controller';
import { WorkflowConfigService } from './workflow-config.service';
import { WorkflowCasesService } from './workflow-cases.service';
import { WorkflowTasksService } from './workflow-tasks.service';
import { WorkflowMonitorService } from './workflow-monitor.service';
import { WorkflowSettingsService } from './workflow-settings.service';

const P = PERMISSIONS;
const upload = FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 } });
const uploadBody = z.object({ caseId: uuidSchema.optional(), taskId: uuidSchema.optional() });
const userQuery = z.object({
  q: z.string().trim().max(100).default(''),
  /** Resolve these ids (comma-separated) instead of searching. */
  ids: z.string().max(2000).optional(),
});
const dashboardExport = dashboardQuerySchema.extend({ locale: z.enum(['en', 'ar']).default('en') });

/** Workflow execution (Phase 5.2, M14): execution settings, deployment, cases, tasks, monitor. */
@ApiTags('workflow')
@Controller('workflow')
export class WorkflowController {
  constructor(
    private readonly config: WorkflowConfigService,
    private readonly cases: WorkflowCasesService,
    private readonly tasks: WorkflowTasksService,
    private readonly monitor: WorkflowMonitorService,
    private readonly settings: WorkflowSettingsService,
  ) {}

  // ---------- Settings ----------

  @Get('settings')
  @RequireAnyPermission(P.WORKFLOW_ADMIN, P.WORKFLOW_DESIGN, P.WORKFLOW_MONITOR)
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  @RequirePermissions(P.WORKFLOW_ADMIN)
  setSettings(
    @Body(new ZodPipe(workflowSettingsSchema)) body: WorkflowSettings,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.settings.set(body, user, meta);
  }

  // ---------- Executable processes ----------

  @Get('processes/:id/config')
  @RequirePermissions(P.PROCESSES_READ)
  getConfig(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.config.get(id, user);
  }

  /** Execution settings (workflow.design + edit rights on the process; checked in the service). */
  @Put('processes/:id/config')
  @RequireAnyPermission(P.WORKFLOW_DESIGN, P.WORKFLOW_ADMIN)
  setConfig(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(workflowConfigInputSchema)) body: WorkflowConfigInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.config.update(id, body, user, meta);
  }

  /** Executable check of the working model (or posted XML) or of the published version. */
  @Post('processes/:id/check')
  @HttpCode(200)
  @RequirePermissions(P.PROCESSES_READ)
  check(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(checkInputSchema)) body: z.output<typeof checkInputSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.config.check(id, body.source, body.xml, user);
  }

  @Post('processes/:id/deploy')
  @HttpCode(200)
  @RequireAnyPermission(P.WORKFLOW_DESIGN, P.WORKFLOW_ADMIN)
  deploy(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.config.deploy(id, user, meta);
  }

  // ---------- Service catalogue and start ----------

  @Get('catalogue')
  @RequirePermissions(P.WORKFLOW_START)
  catalogue(@CurrentUser() user: AuthUser) {
    return this.cases.catalogue(user);
  }

  @Get('catalogue/:processId')
  @RequirePermissions(P.WORKFLOW_START)
  startForm(@Param('processId', UuidPipe()) processId: string, @CurrentUser() user: AuthUser) {
    return this.cases.startForm(processId, user);
  }

  @Post('catalogue/:processId/start')
  @RequirePermissions(P.WORKFLOW_START)
  start(
    @Param('processId', UuidPipe()) processId: string,
    @Body(new ZodPipe(startCaseSchema)) body: StartCaseInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.cases.start(processId, body.data, body.fileIds, user, meta);
  }

  // ---------- Cases ----------

  /** mine / involved for everyone; monitor scope needs workflow.monitor (checked in the service). */
  @Get('cases')
  @Authenticated()
  listCases(
    @Query(new ZodPipe(caseListQuerySchema)) q: CaseListQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.cases.list(q, user);
  }

  /** Visible to the initiator, assignees, the process owner, monitors and Auditors (D-149). */
  @Get('cases/:id')
  @Authenticated()
  getCase(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.cases.detail(id, user);
  }

  @Post('cases/:id/withdraw')
  @HttpCode(204)
  @Authenticated()
  async withdraw(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(caseReasonSchema)) body: { reason: string },
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.cases.withdraw(id, body.reason, user, meta);
  }

  @Post('cases/:id/cancel')
  @HttpCode(204)
  @RequirePermissions(P.WORKFLOW_ADMIN)
  async cancel(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(caseReasonSchema)) body: { reason: string },
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.cases.cancel(id, body.reason, user, meta);
  }

  @Post('cases/:id/retry')
  @HttpCode(204)
  @RequirePermissions(P.WORKFLOW_ADMIN)
  async retry(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.cases.retry(id, user, meta);
  }

  @Post('cases/:id/comments')
  @Authenticated()
  comment(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(caseCommentSchema)) body: { body: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.cases.addComment(id, body.body, user);
  }

  // ---------- Files ----------

  /** Attachment for a case (participants) or for a start form (draft of the uploader). */
  @Post('files')
  @Authenticated()
  @UseInterceptors(upload)
  uploadFile(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodPipe(uploadBody)) body: z.infer<typeof uploadBody>,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.cases.upload(file, body.caseId ?? null, body.taskId ?? null, user, meta);
  }

  /** Download when the caller may see the case (or uploaded the draft); never rendered inline. */
  @Get('files/:id')
  @Authenticated()
  async file(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, stream } = await this.cases.openFile(id, user);
    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(stream);
  }

  // ---------- Tasks ----------

  @Get('tasks')
  @Authenticated()
  listTasks(
    @Query(new ZodPipe(taskListQuerySchema)) q: TaskListQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.list(q, user);
  }

  @Get('tasks/counts')
  @Authenticated()
  counts(@CurrentUser() user: AuthUser) {
    return this.tasks.counts(user);
  }

  @Get('tasks/:id')
  @Authenticated()
  getTask(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.detail(id, user);
  }

  @Post('tasks/:id/claim')
  @HttpCode(200)
  @Authenticated()
  claim(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tasks.claim(id, user, meta);
  }

  @Post('tasks/:id/unclaim')
  @HttpCode(200)
  @Authenticated()
  unclaim(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tasks.unclaim(id, user, meta);
  }

  @Put('tasks/:id/draft')
  @Authenticated()
  saveDraft(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(saveTaskSchema)) body: { data: Record<string, unknown> },
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.save(id, body.data, user);
  }

  @Post('tasks/:id/complete')
  @HttpCode(200)
  @Authenticated()
  complete(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(completeTaskSchema)) body: CompleteTaskInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tasks.complete(id, body, user, meta);
  }

  @Post('tasks/:id/delegate')
  @HttpCode(204)
  @Authenticated()
  async delegate(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(delegateTaskSchema)) body: z.output<typeof delegateTaskSchema>,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.tasks.delegate(id, body.userId, body.comment, user, meta);
  }

  @Post('tasks/:id/reassign')
  @HttpCode(204)
  @RequirePermissions(P.WORKFLOW_ADMIN)
  async reassign(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(reassignSchema)) body: z.output<typeof reassignSchema>,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.tasks.reassign(id, body.userId, body.comment, user, meta);
  }

  // ---------- Out of office and user lookup ----------

  @Get('out-of-office')
  @Authenticated()
  getOutOfOffice(@CurrentUser() user: AuthUser) {
    return this.tasks.outOfOffice(user);
  }

  @Put('out-of-office')
  @Authenticated()
  setOutOfOffice(
    @Body(new ZodPipe(outOfOfficeSchema)) body: OutOfOfficeInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tasks.setOutOfOffice(body, user, meta);
  }

  /** Active users by name / e-mail for delegation, substitutes and mentions (at most 20). */
  @Get('users')
  @Authenticated()
  users(
    @Query(new ZodPipe(userQuery)) q: z.infer<typeof userQuery>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.users(q.q, user, q.ids ? q.ids.split(',').slice(0, 50) : undefined);
  }

  /** Departments for department fields of forms (id and names only). */
  @Get('departments')
  @Authenticated()
  departments() {
    return this.tasks.departments();
  }

  // ---------- Monitor and dashboard ----------

  @Get('monitor')
  @RequireAnyPermission(P.WORKFLOW_MONITOR, P.WORKFLOW_ADMIN)
  getMonitor(@CurrentUser() user: AuthUser) {
    return this.monitor.monitor(user);
  }

  @Get('dashboard')
  @RequireAnyPermission(P.WORKFLOW_MONITOR, P.WORKFLOW_ADMIN)
  dashboard(
    @Query(new ZodPipe(dashboardQuerySchema)) q: DashboardQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.monitor.dashboard(q, user);
  }

  @Get('dashboard/export')
  @RequireAnyPermission(P.WORKFLOW_MONITOR, P.WORKFLOW_ADMIN)
  async exportDashboard(
    @Query(new ZodPipe(dashboardExport)) q: z.output<typeof dashboardExport>,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.monitor.export(q, user, meta, q.locale));
  }
}
