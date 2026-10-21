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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  PERMISSIONS,
  createPageLinkSchema,
  createPageSchema,
  localeSchema,
  movePageSchema,
  pageDraftSchema,
  restoreVersionSchema,
  savePageSchema,
  versionLabelSchema,
  type CreatePageInput,
  type CreatePageLinkInput,
  type Locale,
  type MovePageInput,
  type PageDraftInput,
  type RestoreVersionInput,
  type SavePageInput,
  type VersionLabelInput,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { PagesService } from './pages.service';

const R = PERMISSIONS.DOCS_READ;
const E = PERMISSIONS.DOCS_EDIT;

/** Space-level access (restricted spaces, owners) is checked in the service. */
@ApiTags('docs')
@Controller()
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Get('spaces/:spaceId/pages')
  @RequirePermissions(R)
  tree(@Param('spaceId', UuidPipe()) spaceId: string, @CurrentUser() user: AuthUser) {
    return this.pages.tree(spaceId, user);
  }

  @Post('spaces/:spaceId/pages')
  @RequirePermissions(R, E)
  create(
    @Param('spaceId', UuidPipe()) spaceId: string,
    @Body(new ZodPipe(createPageSchema)) body: CreatePageInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.pages.create(spaceId, body, user, meta);
  }

  @Get('spaces/:spaceId/trash')
  @RequirePermissions(R, E)
  trash(@Param('spaceId', UuidPipe()) spaceId: string, @CurrentUser() user: AuthUser) {
    return this.pages.trash(spaceId, user);
  }

  @Get('pages/:id')
  @RequirePermissions(R)
  get(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.pages.get(id, user);
  }

  /** Explicit save: creates a new version with the change note. */
  @Put('pages/:id')
  @RequirePermissions(R, E)
  save(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(savePageSchema)) body: SavePageInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.pages.save(id, body, user, meta);
  }

  @Post('pages/:id/move')
  @RequirePermissions(R, E)
  @HttpCode(200)
  move(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(movePageSchema)) body: MovePageInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.pages.move(id, body, user, meta);
  }

  /** Soft delete (with sub-pages) into the space trash. */
  @Delete('pages/:id')
  @RequirePermissions(R, E)
  @HttpCode(204)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.pages.remove(id, user, meta);
  }

  @Post('pages/:id/restore')
  @RequirePermissions(R, E)
  @HttpCode(200)
  restore(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.pages.restore(id, user, meta);
  }

  /** Permanent deletion from the trash: administrators only. */
  @Delete('pages/:id/purge')
  @RequirePermissions(R, PERMISSIONS.DOCS_MANAGE)
  @HttpCode(204)
  async purge(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.pages.purge(id, user, meta);
  }

  // ---------- Drafts ----------

  @Get('pages/:id/draft')
  @RequirePermissions(R, E)
  getDraft(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.pages.getDraft(id, user);
  }

  @Put('pages/:id/draft')
  @RequirePermissions(R, E)
  saveDraft(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(pageDraftSchema)) body: PageDraftInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pages.saveDraft(id, body, user);
  }

  @Delete('pages/:id/draft')
  @RequirePermissions(R, E)
  @HttpCode(204)
  async deleteDraft(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    await this.pages.deleteDraft(id, user);
  }

  // ---------- Versions ----------

  @Get('pages/:id/versions')
  @RequirePermissions(R)
  versions(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.pages.listVersions(id, user);
  }

  @Get('pages/:id/versions/:versionId')
  @RequirePermissions(R)
  version(
    @Param('id', UuidPipe()) id: string,
    @Param('versionId', UuidPipe()) versionId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.pages.getVersion(id, versionId, user);
  }

  @Post('pages/:id/versions/:versionId/restore')
  @RequirePermissions(R, E)
  @HttpCode(200)
  restoreVersion(
    @Param('id', UuidPipe()) id: string,
    @Param('versionId', UuidPipe()) versionId: string,
    @Body(new ZodPipe(restoreVersionSchema)) body: RestoreVersionInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.pages.restoreVersion(id, versionId, body, user, meta);
  }

  @Patch('pages/:id/versions/:versionId')
  @RequirePermissions(R, E)
  labelVersion(
    @Param('id', UuidPipe()) id: string,
    @Param('versionId', UuidPipe()) versionId: string,
    @Body(new ZodPipe(versionLabelSchema)) body: VersionLabelInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.pages.labelVersion(id, versionId, body, user, meta);
  }

  // ---------- Links ----------

  @Get('pages/:id/links')
  @RequirePermissions(R)
  links(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.pages.listLinks(id, user);
  }

  @Post('pages/:id/links')
  @RequirePermissions(R, E)
  addLink(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(createPageLinkSchema)) body: CreatePageLinkInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.pages.addLink(id, body, user, meta);
  }

  @Delete('pages/:id/links/:linkId')
  @RequirePermissions(R, E)
  @HttpCode(200)
  removeLink(
    @Param('id', UuidPipe()) id: string,
    @Param('linkId', UuidPipe()) linkId: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.pages.removeLink(id, linkId, user, meta);
  }

  // ---------- Related documentation & export ----------

  @Get('processes/:id/pages')
  @RequirePermissions(R, PERMISSIONS.PROCESSES_READ)
  forProcess(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.pages.related({ processId: id }, user);
  }

  @Get('objects/:id/pages')
  @RequirePermissions(R, PERMISSIONS.OBJECTS_READ)
  forObject(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.pages.related({ repoObjectId: id }, user);
  }

  @Get('pages/:id/export/markdown')
  @RequirePermissions(R)
  async markdown(
    @Param('id', UuidPipe()) id: string,
    @Query('lang', new ZodPipe(localeSchema.default('en'))) lang: Locale,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body, fileName } = await this.pages.exportMarkdown(id, lang, user);
    res.set({
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="page.md"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'X-Content-Type-Options': 'nosniff',
    });
    return body;
  }
}
