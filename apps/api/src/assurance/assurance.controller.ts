import { Controller, Delete, Get, HttpCode, Param, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Authenticated, CurrentUser, ReqMeta } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe } from '../common/zod.pipe';
import { AssuranceTasksService } from './assurance-tasks.service';
import { AssuranceFilesService } from './assurance-files.service';

@ApiTags('assurance')
@Controller('assurance')
export class AssuranceController {
  constructor(
    private readonly tasks: AssuranceTasksService,
    private readonly files: AssuranceFilesService,
  ) {}

  /** The caller's own assurance tasks (each list is filtered by the caller's permissions). */
  @Get('tasks')
  @Authenticated()
  myTasks(@CurrentUser() user: AuthUser) {
    return this.tasks.myTasks(user);
  }

  /**
   * Evidence download: allowed when the caller may read the record the file belongs to (checked
   * per owner type in the service; 404 otherwise). Never rendered as active content.
   */
  @Get('files/:id')
  @Authenticated()
  async file(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, stream } = await this.files.open(id, user);
    res.set({
      'Content-Type': file.contentType,
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename="file"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(stream);
  }

  @Delete('files/:id')
  @HttpCode(204)
  @Authenticated()
  async removeFile(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.files.remove(id, user, meta);
  }
}
