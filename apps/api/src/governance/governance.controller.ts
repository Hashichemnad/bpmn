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
  archiveSchema,
  createFeedbackSchema,
  feedbackListQuerySchema,
  governanceSettingsSchema,
  itemGovernanceSchema,
  publishSchema,
  reviewDecisionSchema,
  submitReviewSchema,
  updateFeedbackSchema,
  uuidSchema,
  workflowSchema,
  type ArchiveInput,
  type ContentType,
  type CreateFeedbackInput,
  type FeedbackListQuery,
  type GovernanceSettingsInput,
  type ItemGovernanceInput,
  type PublishInput,
  type ReviewDecisionInput,
  type SubmitReviewInput,
  type UpdateFeedbackInput,
  type WorkflowInput,
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
import { ContentService } from './content.service';
import { ReviewsService } from './reviews.service';
import { WorkflowsService } from './workflows.service';
import { TasksService } from './tasks.service';
import { FeedbackService } from './feedback.service';
import { GovernanceScheduler } from './scheduler.service';

/** `processes` / `pages` in the URL. */
export const ContentTypePipe = () =>
  new ZodPipe(
    z
      .enum(['processes', 'pages'])
      .transform((v): ContentType => (v === 'processes' ? 'PROCESS' : 'PAGE')),
  );

const READERS = [PERMISSIONS.PROCESSES_READ, PERMISSIONS.DOCS_READ] as const;

/** Item lifecycle. Read/edit/manage rights on the item itself are checked in the services. */
@ApiTags('governance')
@Controller('governance')
export class GovernanceController {
  constructor(
    private readonly content: ContentService,
    private readonly reviews: ReviewsService,
    private readonly workflows: WorkflowsService,
    private readonly tasks: TasksService,
    private readonly scheduler: GovernanceScheduler,
  ) {}

  @Get('settings')
  @RequireAnyPermission(PERMISSIONS.GOVERNANCE_MANAGE, ...READERS)
  settings() {
    return this.workflows.settings();
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.GOVERNANCE_MANAGE)
  updateSettings(
    @Body(new ZodPipe(governanceSettingsSchema)) body: GovernanceSettingsInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.workflows.updateSettings(body, user, meta);
  }

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.GOVERNANCE_DASHBOARD)
  dashboard(@CurrentUser() user: AuthUser) {
    return this.tasks.dashboard(user);
  }

  /** Sends due reminders now (normally run by the scheduler). */
  @Post('reminders/run')
  @RequirePermissions(PERMISSIONS.GOVERNANCE_MANAGE)
  @HttpCode(200)
  runReminders() {
    return this.scheduler.runOnce();
  }

  @Put('spaces/:spaceId/workflow')
  @RequireAnyPermission(PERMISSIONS.GOVERNANCE_MANAGE, PERMISSIONS.DOCS_READ)
  spaceWorkflow(
    @Param('spaceId', UuidPipe()) spaceId: string,
    @Body(new ZodPipe(z.object({ workflowId: uuidSchema.nullable() })))
    body: { workflowId: string | null },
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.workflows.setSpaceWorkflow(spaceId, body.workflowId, user, meta);
  }

  @Get(':type/:id')
  @RequireAnyPermission(...READERS)
  info(
    @Param('type', ContentTypePipe()) type: ContentType,
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviews.info(type, id, user);
  }

  @Patch(':type/:id')
  @RequireAnyPermission(...READERS)
  async update(
    @Param('type', ContentTypePipe()) type: ContentType,
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(itemGovernanceSchema)) body: ItemGovernanceInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    const item = await this.content.load(type, id, user);
    await this.workflows.updateItem(item, body, user, meta);
    return this.reviews.info(type, id, user);
  }

  @Get(':type/:id/reviews')
  @RequireAnyPermission(...READERS)
  history(
    @Param('type', ContentTypePipe()) type: ContentType,
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviews.listForItem(type, id, user);
  }

  @Get(':type/:id/publications')
  @RequireAnyPermission(...READERS)
  publications(
    @Param('type', ContentTypePipe()) type: ContentType,
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviews.publicationsForItem(type, id, user);
  }

  @Post(':type/:id/submit')
  @RequireAnyPermission(...READERS)
  @HttpCode(200)
  submit(
    @Param('type', ContentTypePipe()) type: ContentType,
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(submitReviewSchema)) body: SubmitReviewInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.reviews.submit(type, id, body, user, meta);
  }

  @Post(':type/:id/withdraw')
  @RequireAnyPermission(...READERS)
  @HttpCode(200)
  withdraw(
    @Param('type', ContentTypePipe()) type: ContentType,
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.reviews.withdraw(type, id, user, meta);
  }

  @Post(':type/:id/publish')
  @RequireAnyPermission(...READERS)
  @HttpCode(200)
  publish(
    @Param('type', ContentTypePipe()) type: ContentType,
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(publishSchema)) body: PublishInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.reviews.publish(type, id, body, user, meta);
  }

  @Post(':type/:id/archive')
  @RequireAnyPermission(...READERS)
  @HttpCode(200)
  archive(
    @Param('type', ContentTypePipe()) type: ContentType,
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(archiveSchema)) body: ArchiveInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.reviews.archive(type, id, body, user, meta);
  }

  @Post(':type/:id/restore')
  @RequireAnyPermission(...READERS)
  @HttpCode(200)
  restore(
    @Param('type', ContentTypePipe()) type: ContentType,
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.reviews.restore(type, id, user, meta);
  }

  @Post(':type/:id/confirm-review')
  @RequireAnyPermission(...READERS)
  @HttpCode(200)
  confirmReview(
    @Param('type', ContentTypePipe()) type: ContentType,
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.reviews.confirmReview(type, id, user, meta);
  }
}

@ApiTags('governance')
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  /** Templates are listed to everyone who may configure an item's workflow. */
  @Get()
  @RequireAnyPermission(PERMISSIONS.GOVERNANCE_MANAGE, ...READERS)
  list() {
    return this.workflows.list();
  }

  @Get(':id')
  @RequireAnyPermission(PERMISSIONS.GOVERNANCE_MANAGE, ...READERS)
  get(@Param('id', UuidPipe()) id: string) {
    return this.workflows.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.GOVERNANCE_MANAGE)
  create(
    @Body(new ZodPipe(workflowSchema)) body: WorkflowInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.workflows.create(body, user, meta);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.GOVERNANCE_MANAGE)
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(workflowSchema)) body: WorkflowInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.workflows.update(id, body, user, meta);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.GOVERNANCE_MANAGE)
  @HttpCode(204)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.workflows.remove(id, user, meta);
  }
}

/** Reviews: assignees and readers of the item (checked in the service). */
@ApiTags('governance')
@Controller('reviews')
@Authenticated()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get(':id')
  detail(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.reviews.detail(id, user);
  }

  @Post(':id/decision')
  @HttpCode(200)
  decide(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(reviewDecisionSchema)) body: ReviewDecisionInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.reviews.decide(id, body, user, meta);
  }
}

@ApiTags('governance')
@Controller('tasks')
@Authenticated()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.tasks.myTasks(user);
  }
}

@ApiTags('portal')
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.PORTAL_READ)
  create(
    @Body(new ZodPipe(createFeedbackSchema)) body: CreateFeedbackInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.feedback.create(body, user, meta);
  }

  /** mine: sent by me; assigned: routed to me; all: governance managers. */
  @Get()
  @Authenticated()
  list(
    @Query(new ZodPipe(feedbackListQuerySchema)) q: FeedbackListQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.feedback.list(q, user);
  }

  @Patch(':id')
  @Authenticated()
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateFeedbackSchema)) body: UpdateFeedbackInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.feedback.update(id, body, user, meta);
  }
}
