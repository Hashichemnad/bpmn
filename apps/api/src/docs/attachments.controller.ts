import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ATTACHMENT_MAX_BYTES, PERMISSIONS } from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe } from '../common/zod.pipe';
import { AttachmentsService } from './attachments.service';

@ApiTags('docs')
@Controller()
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get('pages/:id/attachments')
  @RequirePermissions(PERMISSIONS.DOCS_READ)
  list(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.attachments.list(id, user);
  }

  @Post('pages/:id/attachments')
  @RequirePermissions(PERMISSIONS.DOCS_READ, PERMISSIONS.DOCS_EDIT)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 } }),
  )
  upload(
    @Param('id', UuidPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.attachments.upload(id, file, user, meta);
  }

  /** Files are never rendered as active content: sandboxed CSP, nosniff, downloads for non-images. */
  @Get('attachments/:id/content')
  @RequirePermissions(PERMISSIONS.DOCS_READ)
  async content(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.attachments.content(id, user);
    const disposition = f.isImage ? 'inline' : 'attachment';
    res.set({
      'Content-Type': f.contentType,
      'Content-Length': String(f.size),
      'Content-Disposition': `${disposition}; filename="file"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    });
    return new StreamableFile(f.stream);
  }

  @Delete('attachments/:id')
  @RequirePermissions(PERMISSIONS.DOCS_READ, PERMISSIONS.DOCS_EDIT)
  @HttpCode(204)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.attachments.remove(id, user, meta);
  }
}
