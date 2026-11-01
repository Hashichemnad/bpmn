import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  publicBpmnQuerySchema,
  publicCaseQuerySchema,
  publicDiagramQuerySchema,
  publicListQuerySchema,
  publicObjectQuerySchema,
  publicPageContentQuerySchema,
  publicPageQuerySchema,
  publicProcessQuerySchema,
  publicSvgQuerySchema,
} from '@processhub/shared';
import type { z } from 'zod';
import { RequireApiScope } from '../common/decorators';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import type { ApiRequest } from './api-key.guard';
import { sendConditional } from './conditional';
import { PublicApiService } from './public-api.service';

type ListQ = z.infer<typeof publicListQuerySchema>;

const LIST_QUERIES = [
  ApiQuery({ name: 'page', required: false, type: Number }),
  ApiQuery({ name: 'pageSize', required: false, type: Number, description: '1–200, default 50' }),
  ApiQuery({
    name: 'updatedSince',
    required: false,
    description: 'ISO date-time: only items changed after it',
  }),
  ApiQuery({ name: 'q', required: false, description: 'Text search in code / names' }),
];
const List = (): MethodDecorator => (target, key, desc) => {
  for (const d of LIST_QUERIES) d(target, key, desc);
};

/**
 * Public REST API, version 1 (Phase 4.4, D-173): read-only, API key in `X-API-Key` or
 * `Authorization: Bearer`, one scope per endpoint. Lists are paged (`page`, `pageSize` ≤ 200)
 * and filterable; every response carries ETag / Last-Modified for conditional requests.
 */
@ApiTags('public')
@ApiSecurity('apiKey')
@Controller('api/public/v1')
export class PublicApiController {
  constructor(private readonly api: PublicApiService) {}

  @Get('me')
  @RequireApiScope(null)
  @ApiOperation({ summary: 'The calling key: name, scopes, content and department filter' })
  me(@Req() req: ApiRequest) {
    const k = req.apiKey!;
    return {
      name: k.name,
      scopes: [...k.scopes].sort(),
      content: k.content,
      departmentIds: k.departmentIds,
      rateLimitPerMinute: k.rateLimitPerMinute,
    };
  }

  // ---------- Processes ----------

  @Get('processes')
  @RequireApiScope('processes:read')
  @List()
  @ApiQuery({ name: 'category', required: false, enum: ['MANAGEMENT', 'CORE', 'SUPPORT'] })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'status', required: false, description: 'Workspace keys only' })
  @ApiOperation({ summary: 'Processes (published version, or drafts for workspace keys)' })
  async processes(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Query(new ZodPipe(publicProcessQuerySchema)) q: z.infer<typeof publicProcessQuerySchema>,
  ) {
    sendConditional(req, res, await this.api.processes(req.apiKey!, q));
  }

  @Get('process-house')
  @RequireApiScope('processes:read')
  @ApiOperation({ summary: 'Process house: the process tree per category' })
  async house(@Req() req: ApiRequest, @Res() res: Response) {
    sendConditional(req, res, await this.api.processHouse(req.apiKey!));
  }

  @Get('processes/:id')
  @RequireApiScope('processes:read')
  @ApiParam({ name: 'id', format: 'uuid' })
  async process(@Req() req: ApiRequest, @Res() res: Response, @Param('id', UuidPipe()) id: string) {
    sendConditional(req, res, await this.api.process(req.apiKey!, id));
  }

  @Get('processes/:id/versions')
  @RequireApiScope('processes:read')
  @ApiOperation({ summary: 'Published versions (all saved versions for workspace keys)' })
  async versions(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Param('id', UuidPipe()) id: string,
  ) {
    sendConditional(req, res, await this.api.processVersions(req.apiKey!, id));
  }

  @Get('processes/:id/bpmn')
  @RequireApiScope('processes:read')
  @ApiProduces('application/xml')
  @ApiQuery({ name: 'version', required: false, type: Number })
  @ApiOperation({ summary: 'BPMN 2.0 XML of the published (or given) version' })
  async bpmn(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(publicBpmnQuerySchema)) q: z.infer<typeof publicBpmnQuerySchema>,
  ) {
    const dated = await this.api.processBpmn(req.apiKey!, id, q.version);
    sendConditional(req, res, { body: dated.body.xml, lastModified: dated.lastModified }, 'xml');
  }

  @Get('processes/:id/svg')
  @RequireApiScope('processes:read')
  @ApiProduces('image/svg+xml')
  @ApiQuery({ name: 'lang', required: false, enum: ['en', 'ar'] })
  @ApiQuery({ name: 'version', required: false, type: Number })
  @ApiOperation({ summary: 'Diagram image (SVG, labels in the chosen language)' })
  async svg(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(publicSvgQuerySchema)) q: z.infer<typeof publicSvgQuerySchema>,
  ) {
    sendConditional(req, res, await this.api.processSvg(req.apiKey!, id, q.lang, q.version), 'svg');
  }

  // ---------- Wiki ----------

  @Get('spaces')
  @RequireApiScope('pages:read')
  @List()
  @ApiOperation({ summary: 'Documentation spaces (view-restricted spaces are never listed)' })
  async spaces(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Query(new ZodPipe(publicListQuerySchema)) q: ListQ,
  ) {
    sendConditional(req, res, await this.api.spaces(req.apiKey!, q));
  }

  @Get('pages')
  @RequireApiScope('pages:read')
  @List()
  @ApiQuery({ name: 'spaceId', required: false })
  async pages(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Query(new ZodPipe(publicPageQuerySchema)) q: z.infer<typeof publicPageQuerySchema>,
  ) {
    sendConditional(req, res, await this.api.pages(req.apiKey!, q));
  }

  @Get('pages/:id')
  @RequireApiScope('pages:read')
  @ApiQuery({ name: 'format', required: false, enum: ['html', 'text'] })
  @ApiOperation({ summary: 'Page content in both languages (sanitised HTML or plain text)' })
  async page(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(publicPageContentQuerySchema))
    q: z.infer<typeof publicPageContentQuerySchema>,
  ) {
    sendConditional(req, res, await this.api.pageContent(req.apiKey!, id, q.format));
  }

  // ---------- Diagrams ----------

  @Get('diagrams')
  @RequireApiScope('diagrams:read')
  @List()
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['VALUE_CHAIN', 'ORG_CHART', 'DMN', 'EPC', 'SIPOC'],
  })
  async diagrams(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Query(new ZodPipe(publicDiagramQuerySchema)) q: z.infer<typeof publicDiagramQuerySchema>,
  ) {
    sendConditional(req, res, await this.api.diagrams(req.apiKey!, q));
  }

  @Get('diagrams/:id')
  @RequireApiScope('diagrams:read')
  @ApiOperation({ summary: 'Diagram content (DMN XML or JSON)' })
  async diagram(@Req() req: ApiRequest, @Res() res: Response, @Param('id', UuidPipe()) id: string) {
    sendConditional(req, res, await this.api.diagram(req.apiKey!, id));
  }

  @Get('diagrams/:id/svg')
  @RequireApiScope('diagrams:read')
  @ApiProduces('image/svg+xml')
  @ApiQuery({ name: 'lang', required: false, enum: ['en', 'ar'] })
  async diagramSvg(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(publicSvgQuerySchema)) q: z.infer<typeof publicSvgQuerySchema>,
  ) {
    sendConditional(req, res, await this.api.diagramSvg(req.apiKey!, id, q.lang), 'svg');
  }

  // ---------- Library ----------

  @Get('objects')
  @RequireApiScope('objects:read')
  @List()
  @ApiQuery({ name: 'type', required: false, enum: ['ROLE', 'SYSTEM', 'DOCUMENT', 'TERM'] })
  @ApiOperation({ summary: 'Library objects: roles, IT systems, documents, dictionary terms' })
  async objects(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Query(new ZodPipe(publicObjectQuerySchema)) q: z.infer<typeof publicObjectQuerySchema>,
  ) {
    sendConditional(req, res, await this.api.objects(req.apiKey!, q));
  }

  // ---------- GRC ----------

  @Get('risks')
  @RequireApiScope('grc:read')
  @List()
  async risks(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Query(new ZodPipe(publicListQuerySchema)) q: ListQ,
  ) {
    sendConditional(req, res, await this.api.risks(req.apiKey!, q));
  }

  @Get('controls')
  @RequireApiScope('grc:read')
  @List()
  async controls(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Query(new ZodPipe(publicListQuerySchema)) q: ListQ,
  ) {
    sendConditional(req, res, await this.api.controls(req.apiKey!, q));
  }

  @Get('requirements')
  @RequireApiScope('grc:read')
  @List()
  async requirements(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Query(new ZodPipe(publicListQuerySchema)) q: ListQ,
  ) {
    sendConditional(req, res, await this.api.requirements(req.apiKey!, q));
  }

  // ---------- Enterprise architecture ----------

  @Get('applications')
  @RequireApiScope('ea:read')
  @List()
  async applications(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Query(new ZodPipe(publicListQuerySchema)) q: ListQ,
  ) {
    sendConditional(req, res, await this.api.applications(req.apiKey!, q));
  }

  @Get('capabilities')
  @RequireApiScope('ea:read')
  @List()
  async capabilities(
    @Req() req: Request,
    @Res() res: Response,
    @Query(new ZodPipe(publicListQuerySchema)) q: ListQ,
  ) {
    sendConditional(req, res, await this.api.capabilities(q));
  }

  // ---------- KPIs ----------

  @Get('kpis')
  @RequireApiScope('kpis:read')
  @List()
  @ApiOperation({ summary: 'KPIs with their latest value' })
  async kpis(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Query(new ZodPipe(publicListQuerySchema)) q: ListQ,
  ) {
    sendConditional(req, res, await this.api.kpis(req.apiKey!, q));
  }

  @Get('kpis/:id/measurements')
  @RequireApiScope('kpis:read')
  @List()
  async measurements(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(publicListQuerySchema)) q: ListQ,
  ) {
    sendConditional(req, res, await this.api.kpiMeasurements(req.apiKey!, id, q));
  }

  // ---------- Workflow ----------

  @Get('workflow/statistics')
  @RequireApiScope('workflow:read')
  @ApiOperation({ summary: 'Case counts and durations per executable process (aggregated)' })
  async workflowStatistics(@Req() req: ApiRequest, @Res() res: Response) {
    sendConditional(req, res, await this.api.workflowStatistics(req.apiKey!));
  }

  @Get('workflow/cases')
  @RequireApiScope('workflow:cases:read')
  @List()
  @ApiQuery({ name: 'processId', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['RUNNING', 'COMPLETED', 'CANCELLED', 'WITHDRAWN'],
  })
  @ApiOperation({ summary: 'Cases (personal data: initiator) — needs workflow:cases:read' })
  async workflowCases(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Query(new ZodPipe(publicCaseQuerySchema)) q: z.infer<typeof publicCaseQuerySchema>,
  ) {
    sendConditional(req, res, await this.api.workflowCases(req.apiKey!, q));
  }
}
