import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  createCommentSchema,
  updateCommentSchema,
  type ContentType,
  type CreateCommentInput,
  type UpdateCommentInput,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { ContentTypePipe } from '../governance/governance.controller';
import { CommentsService } from './comments.service';

/** Reading needs read access to the item (checked in the service); writing needs comments.write. */
@ApiTags('comments')
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('comments/:type/:id')
  @RequireAnyPermission(PERMISSIONS.PROCESSES_READ, PERMISSIONS.DOCS_READ)
  list(
    @Param('type', ContentTypePipe()) type: ContentType,
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.comments.list(type, id, user);
  }

  @Post('comments/:type/:id')
  @RequirePermissions(PERMISSIONS.COMMENTS_WRITE)
  create(
    @Param('type', ContentTypePipe()) type: ContentType,
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(createCommentSchema)) body: CreateCommentInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.comments.create(type, id, body, user, meta);
  }

  @Patch('comments/:commentId')
  @RequirePermissions(PERMISSIONS.COMMENTS_WRITE)
  update(
    @Param('commentId', UuidPipe()) commentId: string,
    @Body(new ZodPipe(updateCommentSchema)) body: UpdateCommentInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.comments.update(commentId, body, user, meta);
  }

  @Delete('comments/:commentId')
  @RequirePermissions(PERMISSIONS.COMMENTS_WRITE)
  @HttpCode(200)
  remove(
    @Param('commentId', UuidPipe()) commentId: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.comments.remove(commentId, user, meta);
  }

  @Post('comments/:commentId/resolve')
  @RequirePermissions(PERMISSIONS.COMMENTS_WRITE)
  @HttpCode(200)
  resolve(
    @Param('commentId', UuidPipe()) commentId: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.comments.setResolved(commentId, true, user, meta);
  }

  @Post('comments/:commentId/reopen')
  @RequirePermissions(PERMISSIONS.COMMENTS_WRITE)
  @HttpCode(200)
  reopen(
    @Param('commentId', UuidPipe()) commentId: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.comments.setResolved(commentId, false, user, meta);
  }
}
