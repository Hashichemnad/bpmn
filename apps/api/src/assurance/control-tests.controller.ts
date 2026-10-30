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
  ATTACHMENT_MAX_BYTES,
  PERMISSIONS,
  assuranceCommentSchema,
  controlTestListQuerySchema,
  createControlTestSchema,
  createTestPlanSchema,
  testResultsSchema,
  testReviewSchema,
  updateTestPlanSchema,
  type AssuranceCommentInput,
  type ControlTestListQuery,
  type CreateControlTestInput,
  type CreateTestPlanInput,
  type TestResultsInput,
  type TestReviewInput,
  type UpdateTestPlanInput,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { ControlTestsService } from './control-tests.service';

const planQuery = z.object({ controlId: z.guid().optional() });
/** Testers and reviewers reach their assigned tests without the GRC registers (checked in the service). */
const INVOLVED = [
  PERMISSIONS.GRC_READ,
  PERMISSIONS.CONTROLS_TEST,
  PERMISSIONS.CONTROLS_REVIEW,
] as const;

/** Control testing (Phase 4.2, D-099): plans, tests, execution, review, evidence. */
@ApiTags('control-tests')
@Controller('control-tests')
export class ControlTestsController {
  constructor(private readonly tests: ControlTestsService) {}

  @Get('plans')
  @RequirePermissions(PERMISSIONS.GRC_READ)
  plans(@Query(new ZodPipe(planQuery)) q: { controlId?: string }) {
    return this.tests.plans(q.controlId);
  }

  @Post('plans')
  @RequirePermissions(PERMISSIONS.GRC_EDIT)
  createPlan(
    @Body(new ZodPipe(createTestPlanSchema)) body: CreateTestPlanInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tests.createPlan(body, user, meta);
  }

  @Patch('plans/:id')
  @RequirePermissions(PERMISSIONS.GRC_EDIT)
  updatePlan(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateTestPlanSchema)) body: UpdateTestPlanInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tests.updatePlan(id, body, user, meta);
  }

  @Delete('plans/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.GRC_EDIT)
  async removePlan(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.tests.removePlan(id, user, meta);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.GRC_READ)
  list(
    @Query(new ZodPipe(controlTestListQuerySchema)) q: ControlTestListQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tests.list(q, user);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.GRC_EDIT)
  create(
    @Body(new ZodPipe(createControlTestSchema)) body: CreateControlTestInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tests.create(body, user, meta);
  }

  @Get(':id')
  @RequireAnyPermission(...INVOLVED)
  get(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.tests.get(id, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.GRC_EDIT)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.tests.remove(id, user, meta);
  }

  @Post(':id/start')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONTROLS_TEST)
  start(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tests.start(id, user, meta);
  }

  @Put(':id/results')
  @RequirePermissions(PERMISSIONS.CONTROLS_TEST)
  results(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(testResultsSchema)) body: TestResultsInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tests.saveResults(id, body, user, meta);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONTROLS_TEST)
  submit(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tests.submit(id, user, meta);
  }

  @Post(':id/review')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CONTROLS_REVIEW)
  review(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(testReviewSchema)) body: TestReviewInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tests.review(id, body, user, meta);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequireAnyPermission(PERMISSIONS.GRC_EDIT, PERMISSIONS.CONTROLS_REVIEW)
  close(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tests.close(id, user, meta);
  }

  @Post(':id/comments')
  @RequireAnyPermission(...INVOLVED)
  comment(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(assuranceCommentSchema)) body: AssuranceCommentInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tests.comment(id, body.body, user, meta);
  }

  /** Evidence: same allow-list, content check and size limit as page attachments. */
  @Post(':id/files')
  @RequirePermissions(PERMISSIONS.CONTROLS_TEST)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 } }),
  )
  upload(
    @Param('id', UuidPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.tests.upload(id, file, user, meta);
  }
}
