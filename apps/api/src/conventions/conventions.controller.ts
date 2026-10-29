import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  modelingConventionsSchema,
  type ModelingConventions,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { ConventionsService } from './conventions.service';

@ApiTags('settings')
@Controller('settings/modeling-conventions')
export class ConventionsController {
  constructor(private readonly conventions: ConventionsService) {}

  /** Everyone who works in the modeler sees the rules (Validation panel). */
  @Get()
  @RequirePermissions(PERMISSIONS.PROCESSES_READ)
  get() {
    return this.conventions.get();
  }

  @Put()
  @RequirePermissions(PERMISSIONS.CONVENTIONS_MANAGE)
  set(
    @Body(new ZodPipe(modelingConventionsSchema)) body: ModelingConventions,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.conventions.set(body, user, meta);
  }
}
