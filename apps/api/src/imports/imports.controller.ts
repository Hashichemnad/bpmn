import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  IMPORT_KINDS,
  IMPORT_LIMITS,
  LOCALES,
  PERMISSIONS,
  createImportSchema,
  importDecisionSchema,
  importItemsQuerySchema,
  importListQuerySchema,
  importOptionsSchema,
  type ImportDecisionInput,
  type ImportItemsQuery,
  type ImportKind,
  type ImportListQuery,
  type ImportOptions,
  type Locale,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { badRequest } from '../common/app-exception';
import { download } from '../ea/ea.controller';
import { ImportsService } from './imports.service';

const MANAGE = PERMISSIONS.IMPORT_MANAGE;

/** Multipart fields: kind, options (JSON string), note. */
const uploadFields = z.object({
  kind: z.enum(IMPORT_KINDS),
  options: z
    .string()
    .max(20_000)
    .optional()
    .transform((s, ctx) => {
      if (!s) return {};
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid JSON' });
        return z.NEVER;
      }
    }),
  note: z.string().max(500).optional(),
});

const localeQuery = z.object({ locale: z.enum(LOCALES).default('en') });
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const allSuggestions = z.object({ accepted: z.boolean() });

/** Import Center (M15): batches of uploaded files — preview, apply, undo, report. */
@ApiTags('imports')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('kinds')
  @RequirePermissions(MANAGE)
  kinds(@CurrentUser() user: AuthUser) {
    return this.imports.kinds(user);
  }

  @Get('templates/:kind')
  @RequirePermissions(MANAGE)
  async template(
    @Param('kind', new ZodPipe(z.enum(IMPORT_KINDS))) kind: ImportKind,
    @Query(new ZodPipe(localeQuery)) q: { locale: Locale },
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.imports.template(kind, q.locale, user));
  }

  @Get()
  @RequirePermissions(MANAGE)
  list(@Query(new ZodPipe(importListQuerySchema)) q: ImportListQuery) {
    return this.imports.list(q);
  }

  @Post()
  @RequirePermissions(MANAGE)
  @UseInterceptors(
    FilesInterceptor('files', IMPORT_LIMITS.files, {
      limits: { fileSize: IMPORT_LIMITS.fileBytes, files: IMPORT_LIMITS.files, fields: 10 },
    }),
  )
  async create(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body(new ZodPipe(uploadFields)) body: z.infer<typeof uploadFields>,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    const parsed = createImportSchema.safeParse({
      kind: body.kind,
      options: body.options,
      note: body.note,
    });
    if (!parsed.success) throw badRequest('VALIDATION_ERROR', 'Invalid import options');
    return this.imports.create(
      parsed.data.kind,
      files ?? [],
      parsed.data.options,
      parsed.data.note,
      user,
      meta,
    );
  }

  @Get(':id')
  @RequirePermissions(MANAGE)
  get(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.imports.get(id, user);
  }

  @Get(':id/items')
  @RequirePermissions(MANAGE)
  items(
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(importItemsQuerySchema)) q: ImportItemsQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.imports.items(id, q, user);
  }

  @Get(':id/records')
  @RequirePermissions(MANAGE)
  records(
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(pageQuery)) q: z.infer<typeof pageQuery>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.imports.records(id, user, q.page, q.pageSize);
  }

  @Put(':id/options')
  @RequirePermissions(MANAGE)
  options(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(importOptionsSchema)) body: ImportOptions,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.imports.updateOptions(id, body, user, meta);
  }

  @Put(':id/items/:ref')
  @RequirePermissions(MANAGE)
  decide(
    @Param('id', UuidPipe()) id: string,
    @Param('ref', new ZodPipe(z.string().min(1).max(500))) ref: string,
    @Body(new ZodPipe(importDecisionSchema)) body: ImportDecisionInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.imports.decide(id, ref, body, user);
  }

  @Put(':id/suggestions')
  @RequirePermissions(MANAGE)
  decideAll(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(allSuggestions)) body: { accepted: boolean },
    @CurrentUser() user: AuthUser,
  ) {
    return this.imports.decideAll(id, body.accepted, user);
  }

  @Post(':id/apply')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  apply(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.imports.apply(id, user, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  cancel(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.imports.cancel(id, user);
  }

  @Get(':id/undo')
  @RequirePermissions(MANAGE)
  undoCheck(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.imports.undoCheck(id, user);
  }

  @Post(':id/undo')
  @HttpCode(200)
  @RequirePermissions(MANAGE)
  undo(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.imports.undo(id, user, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(MANAGE)
  async discard(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.imports.discard(id, user, meta);
  }

  @Get(':id/report')
  @RequirePermissions(MANAGE)
  async report(
    @Param('id', UuidPipe()) id: string,
    @Query(new ZodPipe(localeQuery)) q: { locale: Locale },
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.imports.report(id, q.locale, user, meta));
  }

  /** The original uploaded file (download only, never rendered inline). */
  @Get(':id/files/:fileId')
  @RequirePermissions(MANAGE)
  async file(
    @Param('id', UuidPipe()) id: string,
    @Param('fileId', UuidPipe()) fileId: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, stream } = await this.imports.file(id, fileId, user);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(stream);
  }
}
