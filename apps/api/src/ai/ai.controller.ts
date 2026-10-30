import { Body, Controller, Get, HttpCode, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  PERMISSIONS,
  aiAnalyseSchema,
  aiControlGapsSchema,
  type AiControlGapsInput,
  aiDocToProcessSchema,
  aiPortalQuestionSchema,
  aiGenerateDocSchema,
  aiGenerateProcessSchema,
  aiRefineProcessSchema,
  aiSettingsSchema,
  aiSummariseSchema,
  aiTranslateSchema,
  aiUsageQuerySchema,
  type AiAnalyseInput,
  type AiDocToProcessInput,
  type AiPortalQuestionInput,
  type AiGenerateDocInput,
  type AiGenerateProcessInput,
  type AiRefineProcessInput,
  type AiSummariseInput,
  type AiSettingsInput,
  type AiTestResultDto,
  type AiTranslateInput,
  type AiUsageQuery,
} from '@processhub/shared';
import { Authenticated, CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { AiSettingsService } from './ai-settings.service';
import { AiGatewayService } from './ai-gateway.service';
import { AiUsageService } from './ai-usage.service';
import { AiError } from './providers/types';
import { streamSse } from './sse';
import { ProcessAiService } from './features/process-ai.service';
import { TranslateService } from './features/translate.service';
import { DocAiService } from './features/doc-ai.service';
import { SummaryService } from './features/summary.service';
import { AnalyseService } from './features/analyse.service';
import { ControlGapsService } from './features/control-gaps.service';
import { PortalQaService } from './features/portal-qa.service';

/** Settings → AI and the usage report. The API key is write-only. */
@ApiTags('ai')
@Controller('ai')
export class AiAdminController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly usage: AiUsageService,
    private readonly gateway: AiGatewayService,
  ) {}

  @Get('settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  get() {
    return this.settings.getDto();
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  update(
    @Body(new ZodPipe(aiSettingsSchema)) body: AiSettingsInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.settings.update(body, user, meta);
  }

  /** Sends a tiny request with the given (possibly unsaved) settings; logged as TEST_CONNECTION. */
  @Post('settings/test')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @HttpCode(200)
  async test(
    @Body(new ZodPipe(aiSettingsSchema)) body: AiSettingsInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ): Promise<AiTestResultDto> {
    const s = await this.settings.forTest(body);
    try {
      const text = await this.gateway.call(
        { user, settings: s, meta },
        {
          feature: 'TEST_CONNECTION',
          system: 'You are a connection test. Reply with the single word OK.',
          messages: [{ role: 'user', text: 'Reply with OK.' }],
          maxTokens: 1000,
          effort: 'low',
        },
      );
      return { ok: true, code: null, message: text.slice(0, 100), model: s.model };
    } catch (err) {
      if (err instanceof AiError)
        return { ok: false, code: err.code, message: err.message, model: s.model };
      throw err;
    }
  }

  @Get('usage')
  @RequirePermissions(PERMISSIONS.AI_USAGE_READ)
  report(@Query(new ZodPipe(aiUsageQuerySchema)) q: AiUsageQuery) {
    return this.usage.report(q);
  }
}

/**
 * The assistant's features. Access (enabled, role, limits) and rights on the item are checked
 * before the response starts (JSON 403 / 429); the work itself is streamed as Server-Sent Events.
 */
@ApiTags('ai')
@Controller('ai')
@Authenticated()
export class AiController {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly processAi: ProcessAiService,
    private readonly translate: TranslateService,
    private readonly docAi: DocAiService,
    private readonly summary: SummaryService,
    private readonly analyse: AnalyseService,
    private readonly controlGaps: ControlGapsService,
    private readonly portalQa: PortalQaService,
  ) {}

  /** What the current user may do (hides every AI button when not available). */
  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.gateway.status(user);
  }

  @Post('generate-process')
  async generateProcess(
    @Body(new ZodPipe(aiGenerateProcessSchema)) body: AiGenerateProcessInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const job = await this.processAi.prepareGenerate(body, user, meta);
    await streamSse(req, res, job);
  }

  @Post('translate')
  async translateText(
    @Body(new ZodPipe(aiTranslateSchema)) body: AiTranslateInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const job = await this.translate.prepare(body, user, meta);
    await streamSse(req, res, job);
  }

  @Post('refine-process')
  async refineProcess(
    @Body(new ZodPipe(aiRefineProcessSchema)) body: AiRefineProcessInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await streamSse(req, res, await this.processAi.prepareRefine(body, user, meta));
  }

  @Post('doc-to-process')
  async docToProcess(
    @Body(new ZodPipe(aiDocToProcessSchema)) body: AiDocToProcessInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await streamSse(req, res, await this.processAi.prepareDocToProcess(body, user, meta));
  }

  @Post('generate-doc')
  async generateDoc(
    @Body(new ZodPipe(aiGenerateDocSchema)) body: AiGenerateDocInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await streamSse(req, res, await this.docAi.prepare(body, user, meta));
  }

  @Post('summarise')
  async summarise(
    @Body(new ZodPipe(aiSummariseSchema)) body: AiSummariseInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await streamSse(req, res, await this.summary.prepare(body, user, meta));
  }

  @Post('analyse')
  async analyseProcess(
    @Body(new ZodPipe(aiAnalyseSchema)) body: AiAnalyseInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await streamSse(req, res, await this.analyse.prepare(body, user, meta));
  }

  /** Risk & Compliance: control gaps of a process with explanations and proposed fixes. */
  @Post('control-gaps')
  async checkControlGaps(
    @Body(new ZodPipe(aiControlGapsSchema)) body: AiControlGapsInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await streamSse(req, res, await this.controlGaps.prepare(body, user, meta));
  }

  /** Knowledge Portal assistant: answers only from published content the user may see. */
  @Post('portal/ask')
  async ask(
    @Body(new ZodPipe(aiPortalQuestionSchema)) body: AiPortalQuestionInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await streamSse(req, res, await this.portalQa.prepare(body, user, meta));
  }
}
