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
import {
  ATTACHMENT_MAX_BYTES,
  PERMISSIONS,
  assuranceCommentSchema,
  assuranceSettingsSchema,
  createIssueSchema,
  issueActionSchema,
  issueListQuerySchema,
  issueTransitionSchema,
  updateIssueSchema,
  type AssuranceCommentInput,
  type AssuranceSettings,
  type CreateIssueInput,
  type IssueActionInput,
  type IssueListQuery,
  type IssueTransitionInput,
  type UpdateIssueInput,
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
import { IssuesService } from './issues.service';
import { AssuranceSettingsService } from './assurance-settings.service';

const upload = FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 } });

/** Settings → Risk & Compliance → Issues (severity scale, reminders, escalation). */
@ApiTags('assurance')
@Controller('assurance/settings')
export class AssuranceSettingsController {
  constructor(private readonly settings: AssuranceSettingsService) {}

  @Get()
  @RequireAnyPermission(PERMISSIONS.GRC_READ, PERMISSIONS.ISSUES_MANAGE, PERMISSIONS.AUDIT_MANAGE)
  get() {
    return this.settings.get();
  }

  @Put()
  @RequirePermissions(PERMISSIONS.GRC_ADMIN)
  set(
    @Body(new ZodPipe(assuranceSettingsSchema)) body: AssuranceSettings,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.settings.set(body, user, meta);
  }
}

/**
 * Issues and action plans (D-100). Lists need the GRC registers; owners of an issue or an action
 * reach their own items (checked in the service, 404 otherwise).
 */
@ApiTags('issues')
@Controller('issues')
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Get()
  @RequireAnyPermission(PERMISSIONS.GRC_READ, PERMISSIONS.ISSUES_MANAGE)
  list(@Query(new ZodPipe(issueListQuerySchema)) q: IssueListQuery, @CurrentUser() user: AuthUser) {
    return this.issues.list(q, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ISSUES_MANAGE)
  async create(
    @Body(new ZodPipe(createIssueSchema)) body: CreateIssueInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.issues.get(await this.issues.create(body, user, meta), user);
  }

  @Get(':id')
  @Authenticated()
  get(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.issues.get(id, user);
  }

  @Patch(':id')
  @Authenticated()
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateIssueSchema)) body: UpdateIssueInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.issues.update(id, body, user, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.ISSUES_MANAGE, PERMISSIONS.GRC_ADMIN)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.issues.remove(id, user, meta);
  }

  @Post(':id/transition')
  @HttpCode(200)
  @Authenticated()
  transition(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(issueTransitionSchema)) body: IssueTransitionInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.issues.transition(id, body, user, meta);
  }

  @Post(':id/actions')
  @Authenticated()
  addAction(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(issueActionSchema)) body: IssueActionInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.issues.addAction(id, body, user, meta);
  }

  @Patch('actions/:id')
  @Authenticated()
  updateAction(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(issueActionSchema)) body: IssueActionInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.issues.updateAction(id, body, user, meta);
  }

  @Delete('actions/:id')
  @Authenticated()
  removeAction(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.issues.removeAction(id, user, meta);
  }

  @Post(':id/comments')
  @Authenticated()
  comment(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(assuranceCommentSchema)) body: AssuranceCommentInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.issues.comment(id, body.body, user, meta);
  }

  @Post(':id/files')
  @Authenticated()
  @UseInterceptors(upload)
  uploadIssueFile(
    @Param('id', UuidPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.issues.uploadIssueFile(id, file, user, meta);
  }

  @Post('actions/:id/files')
  @Authenticated()
  @UseInterceptors(upload)
  uploadActionFile(
    @Param('id', UuidPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.issues.uploadActionFile(id, file, user, meta);
  }
}
