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
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ATTACHMENT_MAX_BYTES,
  CAMPAIGN_STATUSES,
  PERMISSIONS,
  SURVEY_PURPOSES,
  createCampaignSchema,
  createQuestionnaireSchema,
  feedbackRequestSchema,
  proposalDecisionSchema,
  saveAnswersSchema,
  updateCampaignSchema,
  updateQuestionnaireSchema,
  type CampaignStatus,
  type CreateCampaignInput,
  type CreateQuestionnaireInput,
  type FeedbackRequestInput,
  type ProposalDecisionInput,
  type SaveAnswersInput,
  type SurveyPurpose,
  type UpdateCampaignInput,
  type UpdateQuestionnaireInput,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { SurveysService } from './surveys.service';

const MANAGE = PERMISSIONS.SURVEYS_MANAGE;
const RESPOND = PERMISSIONS.SURVEYS_RESPOND;
const campaignQuery = z.object({
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  purpose: z.enum(SURVEY_PURPOSES).optional(),
  processId: z.guid().optional(),
});
const exportQuery = z.object({ locale: z.enum(['en', 'ar']).default('en') });
/** Feedback campaigns are also run by the editors of the process (checked in the service). */
const CAMPAIGN_READERS = [MANAGE, PERMISSIONS.PROCESSES_READ] as const;

/** Questionnaires and survey campaigns (Phase 4.2, D-102). */
@ApiTags('surveys')
@Controller('surveys')
export class SurveysController {
  constructor(private readonly surveys: SurveysService) {}

  // ----- Questionnaires -----

  @Get('questionnaires')
  @RequirePermissions(MANAGE)
  questionnaires() {
    return this.surveys.questionnaires();
  }

  @Get('questionnaires/:id')
  @RequirePermissions(MANAGE)
  questionnaire(@Param('id', UuidPipe()) id: string) {
    return this.surveys.questionnaire(id);
  }

  @Post('questionnaires')
  @RequirePermissions(MANAGE)
  createQuestionnaire(
    @Body(new ZodPipe(createQuestionnaireSchema)) body: CreateQuestionnaireInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.surveys.createQuestionnaire(body, user, meta);
  }

  @Patch('questionnaires/:id')
  @RequirePermissions(MANAGE)
  updateQuestionnaire(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateQuestionnaireSchema)) body: UpdateQuestionnaireInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.surveys.updateQuestionnaire(id, body, user, meta);
  }

  @Delete('questionnaires/:id')
  @HttpCode(204)
  @RequirePermissions(MANAGE)
  async removeQuestionnaire(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.surveys.removeQuestionnaire(id, user, meta);
  }

  // ----- Campaigns -----

  @Get('campaigns')
  @RequireAnyPermission(...CAMPAIGN_READERS)
  campaigns(
    @Query(new ZodPipe(campaignQuery))
    q: { status?: CampaignStatus; purpose?: SurveyPurpose; processId?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.surveys.campaigns(q, user);
  }

  @Post('campaigns')
  @RequirePermissions(MANAGE)
  createCampaign(
    @Body(new ZodPipe(createCampaignSchema)) body: CreateCampaignInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.surveys.createCampaign(body, user, meta);
  }

  /** "Request feedback" on a process (editors of the process or survey managers). */
  @Post('feedback-requests')
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  requestFeedback(
    @Body(new ZodPipe(feedbackRequestSchema)) body: FeedbackRequestInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.surveys.requestFeedback(body, user, meta);
  }

  @Get('campaigns/:id')
  @RequireAnyPermission(...CAMPAIGN_READERS)
  campaign(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.surveys.campaign(id, user);
  }

  @Patch('campaigns/:id')
  @RequirePermissions(MANAGE)
  updateCampaign(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateCampaignSchema)) body: UpdateCampaignInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.surveys.updateCampaign(id, body, user, meta);
  }

  @Delete('campaigns/:id')
  @HttpCode(204)
  @RequirePermissions(MANAGE)
  async removeCampaign(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.surveys.removeCampaign(id, user, meta);
  }

  @Post('campaigns/:id/launch')
  @HttpCode(200)
  @RequireAnyPermission(...CAMPAIGN_READERS)
  launch(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.surveys.launch(id, user, meta);
  }

  @Post('campaigns/:id/close')
  @HttpCode(200)
  @RequireAnyPermission(...CAMPAIGN_READERS)
  close(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.surveys.close(id, user, meta);
  }

  @Get('campaigns/:id/results')
  @RequireAnyPermission(...CAMPAIGN_READERS)
  results(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.surveys.results(id, user);
  }

  @Get('campaigns/:id/export')
  @RequireAnyPermission(...CAMPAIGN_READERS)
  async export(
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(exportQuery)) q: { locale: 'en' | 'ar' },
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.surveys.exportExcel(id, q.locale, user, meta);
    res.set({
      'Content-Type': file.contentType,
      'Content-Length': String(file.data.length),
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(file.data);
  }

  @Get('campaigns/:id/proposals')
  @RequireAnyPermission(MANAGE, PERMISSIONS.GRC_EDIT)
  proposals(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.surveys.proposals(id, user);
  }

  @Post('proposals/:id/decision')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.GRC_EDIT)
  decide(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(proposalDecisionSchema)) body: ProposalDecisionInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.surveys.decideProposal(id, body, user, meta);
  }

  // ----- Respondents (own responses only) -----

  @Get('responses/:id')
  @RequirePermissions(RESPOND)
  myResponse(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.surveys.myResponse(id, user);
  }

  @Get('responses/:id/diagram')
  @RequirePermissions(RESPOND)
  diagram(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.surveys.diagram(id, user);
  }

  @Put('responses/:id')
  @RequirePermissions(RESPOND)
  save(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(saveAnswersSchema)) body: SaveAnswersInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.surveys.save(id, body, user, meta);
  }

  @Post('responses/:id/files')
  @RequirePermissions(RESPOND)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 } }),
  )
  upload(
    @Param('id', UuidPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.surveys.uploadAnswerFile(id, file, user, meta);
  }
}
