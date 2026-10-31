import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  PERMISSIONS,
  salesforceSettingsSchema,
  type SalesforceSettingsInput,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { SalesforceSettingsService } from './salesforce-settings.service';
import { SalesforceSyncService } from './salesforce-sync.service';

const objectSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/, 'INVALID_API_NAME');

/** Settings → Integrations → Salesforce (Phase 4.3, D-114): Super Admin only (`settings.manage`). */
@ApiTags('integrations')
@Controller('integrations/salesforce')
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
export class SalesforceController {
  constructor(
    private readonly settings: SalesforceSettingsService,
    private readonly sync: SalesforceSyncService,
  ) {}

  @Get()
  async get() {
    return this.settings.toDto(await this.settings.get());
  }

  @Put()
  save(
    @Body(new ZodPipe(salesforceSettingsSchema)) body: SalesforceSettingsInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.settings.save(body, user, meta);
  }

  /** Signs in with the stored credentials and checks that the mapped objects exist. */
  @Post('test')
  @HttpCode(200)
  test() {
    return this.sync.test();
  }

  /** Fields of a Salesforce object (mapping screen). */
  @Get('describe/:object')
  describe(@Param('object', new ZodPipe(objectSchema)) object: string) {
    return this.sync.describe(object);
  }

  /** What a sync would change (nothing is written). */
  @Post('preview')
  @HttpCode(200)
  preview() {
    return this.sync.preview();
  }

  @Post('sync')
  @HttpCode(200)
  run(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.sync.sync(user, meta);
  }

  @Get('runs')
  runs() {
    return this.sync.runs();
  }

  @Get('runs/:id/warnings')
  warnings(@Param('id', UuidPipe()) id: string) {
    return this.sync.runWarnings(id);
  }
}
