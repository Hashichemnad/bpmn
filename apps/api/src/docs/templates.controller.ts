import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, templateSchema, type TemplateInput } from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { TemplatesService } from './templates.service';

@ApiTags('docs')
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.DOCS_READ)
  list() {
    return this.templates.list();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.DOCS_READ)
  get(@Param('id', UuidPipe()) id: string) {
    return this.templates.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.DOCS_MANAGE)
  create(
    @Body(new ZodPipe(templateSchema)) body: TemplateInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.templates.create(body, user, meta);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.DOCS_MANAGE)
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(templateSchema)) body: TemplateInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.templates.update(id, body, user, meta);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DOCS_MANAGE)
  @HttpCode(204)
  async remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.templates.remove(id, user, meta);
  }
}
