import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  createObjectSchema,
  dictionarySuggestQuerySchema,
  rejectTermSchema,
  renameObjectSchema,
  renamePreviewSchema,
  updateObjectSchema,
  type CreateObjectInput,
  type UpdateObjectInput,
  type DictionarySuggestQuery,
  type RejectTermInput,
  type RenameObjectInput,
  type RenamePreviewInput,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { badRequest } from '../common/app-exception';
import { ObjectsService } from '../objects/objects.service';
import { DictionaryService } from './dictionary.service';

/** Dictionary (Modeler design B2, D-083): label autocomplete, term proposals, rename. */
@ApiTags('dictionary')
@Controller('dictionary')
export class DictionaryController {
  constructor(
    private readonly dictionary: DictionaryService,
    private readonly objects: ObjectsService,
  ) {}

  /** Approved terms, roles and IT systems matching a label being typed (active language first). */
  @Get('suggest')
  @RequirePermissions(PERMISSIONS.OBJECTS_READ)
  suggest(
    @Query(new ZodPipe(dictionarySuggestQuerySchema)) q: DictionarySuggestQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dictionary.suggest(q, user.locale);
  }

  /** Propose a term: a draft until an approver approves it (approvers may create it approved). */
  @Post('terms')
  @RequirePermissions(PERMISSIONS.DICTIONARY_PROPOSE)
  propose(
    @Body(new ZodPipe(createObjectSchema)) body: CreateObjectInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    if (body.type !== 'TERM') throw badRequest('NOT_A_TERM');
    return this.objects.create(body, user, meta);
  }

  /** Edit a term: drafts by any proposer, approved terms only by approvers (checked in the service). */
  @Patch('terms/:id')
  @RequirePermissions(PERMISSIONS.DICTIONARY_PROPOSE)
  async updateTerm(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateObjectSchema)) body: UpdateObjectInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    if ((await this.objects.findActive(id)).type !== 'TERM') throw badRequest('NOT_A_TERM');
    return this.objects.update(id, body, user, meta);
  }

  @Post('terms/:id/approve')
  @RequirePermissions(PERMISSIONS.DICTIONARY_APPROVE)
  @HttpCode(200)
  approve(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.objects.approve(id, user, meta);
  }

  @Post('terms/:id/reject')
  @RequirePermissions(PERMISSIONS.DICTIONARY_APPROVE)
  @HttpCode(204)
  async reject(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(rejectTermSchema)) body: RejectTermInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.objects.reject(id, body.reason, user, meta);
  }

  /** Labels that a rename would change, per process, and whether the user may update each. */
  @Post('objects/:id/rename-preview')
  @RequirePermissions(PERMISSIONS.OBJECTS_READ, PERMISSIONS.PROCESSES_READ)
  @HttpCode(200)
  renamePreview(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(renamePreviewSchema)) body: RenamePreviewInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.dictionary.renamePreview(id, body, user);
  }

  /** Renames the object and (optionally) its linked labels: one new version per process. */
  @Post('objects/:id/rename')
  @RequirePermissions(PERMISSIONS.OBJECTS_READ, PERMISSIONS.PROCESSES_READ)
  @HttpCode(200)
  rename(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(renameObjectSchema)) body: RenameObjectInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.dictionary.rename(id, body, user, meta);
  }
}
