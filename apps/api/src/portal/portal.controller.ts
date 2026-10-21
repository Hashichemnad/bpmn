import { Body, Controller, Get, Param, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  PERMISSIONS,
  portalSearchQuerySchema,
  portalSettingsSchema,
  type ContentType,
  type PortalSearchQuery,
  type PortalSettingsInput,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { ContentTypePipe } from '../governance/governance.controller';
import { FeedbackService } from '../governance/feedback.service';
import { PortalAccessService } from '../governance/portal-access.service';
import { PortalService } from './portal.service';

/**
 * Knowledge Portal (read-only, published content only). Every route needs portal.read;
 * the portal access setting (departments / roles) is checked in the service.
 */
@ApiTags('portal')
@Controller('portal')
@RequirePermissions(PERMISSIONS.PORTAL_READ)
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly feedback: FeedbackService,
    private readonly access: PortalAccessService,
  ) {}

  @Get('home')
  home(@CurrentUser() user: AuthUser) {
    return this.portal.home(user);
  }

  @Get('settings')
  @RequirePermissions(PERMISSIONS.PORTAL_MANAGE)
  settings() {
    return this.portal.getSettings();
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.PORTAL_MANAGE)
  updateSettings(
    @Body(new ZodPipe(portalSettingsSchema)) body: PortalSettingsInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.portal.updateSettings(body, user, meta);
  }

  @Get('processes')
  processes(@CurrentUser() user: AuthUser) {
    return this.portal.processTree(user);
  }

  @Get('processes/:id')
  process(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.process(id, user);
  }

  @Get('spaces')
  spaces(@CurrentUser() user: AuthUser) {
    return this.portal.spaces(user);
  }

  @Get('spaces/:id/pages')
  spacePages(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.spacePages(id, user);
  }

  @Get('pages/:id')
  page(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.page(id, user);
  }

  @Get('search')
  search(
    @Query(new ZodPipe(portalSearchQuerySchema)) q: PortalSearchQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.portal.search(q, user);
  }

  @Get('my')
  my(@CurrentUser() user: AuthUser) {
    return this.portal.my(user);
  }

  /** The current user's feedback on one published item. */
  @Get(':type/:id/feedback')
  async itemFeedback(
    @Param('type', ContentTypePipe()) type: ContentType,
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.access.assertAccess(user);
    await this.access.publicationOf(type, id, user);
    return this.feedback.forItem(type, id, user);
  }

  /** Images and files referenced by a published page (same safe headers as the wiki). */
  @Get('attachments/:id/content')
  async attachment(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.portal.attachment(id, user);
    res.set({
      'Content-Type': f.contentType,
      'Content-Length': String(f.size),
      'Content-Disposition': `${f.isImage ? 'inline' : 'attachment'}; filename="file"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    });
    return new StreamableFile(f.stream);
  }
}
