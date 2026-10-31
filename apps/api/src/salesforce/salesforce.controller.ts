import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  PERMISSIONS,
  salesforceSettingsSchema,
  type SalesforceSettingsInput,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { SalesforceSettingsService } from './salesforce-settings.service';
import { SalesforceSyncService } from './salesforce-sync.service';

const objectSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/, 'INVALID_API_NAME');

/**
 * Settings → Integrations → Salesforce (Phase 4.3, D-114): the Super Admin (`settings.manage`)
 * configures the link; Performance Officers (`kpi.sync`, D-118) also see the settings without
 * secrets, preview, run the sync and review the sync log.
 */
const SYNC = [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.KPI_SYNC] as const;

@ApiTags('integrations')
@Controller('integrations/salesforce')
export class SalesforceController {
  constructor(
    private readonly settings: SalesforceSettingsService,
    private readonly sync: SalesforceSyncService,
  ) {}

  @Get()
  @RequireAnyPermission(...SYNC)
  async get() {
    return this.settings.toDto(await this.settings.get());
  }

  @Put()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  save(
    @Body(new ZodPipe(salesforceSettingsSchema)) body: SalesforceSettingsInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.settings.save(body, user, meta);
  }

  /** Signs in with the stored credentials and checks that the mapped objects exist. */
  @Post('test')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @HttpCode(200)
  test() {
    return this.sync.test();
  }

  /** Fields of a Salesforce object (mapping screen). */
  @Get('describe/:object')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  describe(@Param('object', new ZodPipe(objectSchema)) object: string) {
    return this.sync.describe(object);
  }

  /** What a sync would change (nothing is written). */
  @Post('preview')
  @RequireAnyPermission(...SYNC)
  @HttpCode(200)
  preview() {
    return this.sync.preview();
  }

  @Post('sync')
  @RequireAnyPermission(...SYNC)
  @HttpCode(200)
  run(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.sync.sync(user, meta);
  }

  @Get('runs')
  @RequireAnyPermission(...SYNC)
  runs() {
    return this.sync.runs();
  }

  @Get('runs/:id/warnings')
  @RequireAnyPermission(...SYNC)
  warnings(@Param('id', UuidPipe()) id: string) {
    return this.sync.runWarnings(id);
  }
}
