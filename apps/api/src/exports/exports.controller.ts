import { Body, Controller, Get, HttpCode, Post, Put, Res, StreamableFile } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { UserRateLimit } from '../common/user-rate-limit.guard';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  PERMISSIONS,
  exportTemplateSchema,
  htmlExportSchema,
  type ExportTemplate,
  pptxExportSchema,
  type HtmlExportInput,
  type PptxExportInput,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { HtmlExportService, type ExportFile } from './html-export.service';
import { PptxExportService } from './pptx-export.service';
import { ExportDataService } from './export-data.service';

function download(res: Response, file: ExportFile) {
  res.set({
    'Content-Type': file.contentType,
    'Content-Length': String(file.data.length),
    'Content-Disposition': `attachment; filename="export"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  return new StreamableFile(file.data);
}

/**
 * Static HTML (offline website, ZIP) and PowerPoint exports (Phase 4.4, D-177, D-178). Readers of
 * the workspace or the portal; the services apply the item-level rules (published content unless
 * drafts are asked for and allowed, GRC / KPI permissions for the summaries).
 */
@ApiTags('exports')
@Controller('exports')
export class ExportsController {
  constructor(
    private readonly html: HtmlExportService,
    private readonly pptx: PptxExportService,
    private readonly data: ExportDataService,
  ) {}

  /** Settings → Branding → export template (colours of slides and offline sites). */
  @Get('template')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async template() {
    return (await this.data.branding()).template;
  }

  @Put('template')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  updateTemplate(
    @Body(new ZodPipe(exportTemplateSchema)) body: ExportTemplate,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.data.updateTemplate(body, user, meta);
  }

  @UseGuards(UserRateLimit('export', 10))
  @Post('html')
  @HttpCode(200)
  @RequireAnyPermission(PERMISSIONS.PROCESSES_READ, PERMISSIONS.PORTAL_READ)
  async exportHtml(
    @Body(new ZodPipe(htmlExportSchema)) body: HtmlExportInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.html.export(body, user, meta));
  }

  @UseGuards(UserRateLimit('export', 10))
  @Post('pptx')
  @HttpCode(200)
  @RequireAnyPermission(
    PERMISSIONS.PROCESSES_READ,
    PERMISSIONS.PORTAL_READ,
    PERMISSIONS.KPI_READ,
    PERMISSIONS.GRC_READ,
  )
  async exportPptx(
    @Body(new ZodPipe(pptxExportSchema)) body: PptxExportInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.pptx.export(body, user, meta));
  }
}
