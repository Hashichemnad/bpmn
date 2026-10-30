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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  controlListQuerySchema,
  createControlSchema,
  createRequirementSchema,
  createRiskSchema,
  grcCommentSchema,
  grcSettingsSchema,
  requirementListQuerySchema,
  riskListQuerySchema,
  updateControlSchema,
  updateRequirementSchema,
  updateRiskSchema,
  type ControlListQuery,
  type CreateControlInput,
  type CreateRequirementInput,
  type CreateRiskInput,
  type GrcCommentInput,
  type GrcSettings,
  type RequirementListQuery,
  type RiskListQuery,
  type UpdateControlInput,
  type UpdateRequirementInput,
  type UpdateRiskInput,
} from '@processhub/shared';
import {
  CurrentUser,
  ReqMeta,
  RequireAnyPermission,
  RequirePermissions,
} from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { GrcService } from './grc.service';
import { GrcSettingsService } from './grc-settings.service';

const READ = PERMISSIONS.GRC_READ;
/** Proposers create drafts and change their own drafts; editors anything (checked in the service). */
const WRITE = [PERMISSIONS.GRC_EDIT, PERMISSIONS.GRC_PROPOSE] as const;

@ApiTags('grc')
@Controller('grc')
export class GrcController {
  constructor(
    private readonly grc: GrcService,
    private readonly settings: GrcSettingsService,
  ) {}

  // ---------- Settings ----------

  /** Categories, matrix labels and bands: needed by everyone who sees ratings. */
  @Get('settings')
  @RequireAnyPermission(READ, PERMISSIONS.PROCESSES_READ)
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.GRC_ADMIN)
  setSettings(
    @Body(new ZodPipe(grcSettingsSchema)) body: GrcSettings,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.settings.set(body, user, meta);
  }

  // ---------- Risks ----------

  @Get('risks')
  @RequirePermissions(READ)
  listRisks(@Query(new ZodPipe(riskListQuerySchema)) q: RiskListQuery) {
    return this.grc.listRisks(q);
  }

  @Get('risks/:id')
  @RequirePermissions(READ)
  getRisk(@Param('id', UuidPipe()) id: string) {
    return this.grc.getRisk(id);
  }

  @Post('risks')
  @RequireAnyPermission(...WRITE)
  createRisk(
    @Body(new ZodPipe(createRiskSchema)) body: CreateRiskInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.grc.createRisk(body, user, meta);
  }

  @Patch('risks/:id')
  @RequireAnyPermission(...WRITE)
  updateRisk(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateRiskSchema)) body: UpdateRiskInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.grc.updateRisk(id, body, user, meta);
  }

  @Delete('risks/:id')
  @RequireAnyPermission(...WRITE)
  @HttpCode(204)
  async removeRisk(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.grc.remove(id, 'RISK', user, meta);
  }

  // ---------- Controls ----------

  @Get('controls')
  @RequirePermissions(READ)
  listControls(@Query(new ZodPipe(controlListQuerySchema)) q: ControlListQuery) {
    return this.grc.listControls(q);
  }

  @Get('controls/:id')
  @RequirePermissions(READ)
  getControl(@Param('id', UuidPipe()) id: string) {
    return this.grc.getControl(id);
  }

  @Post('controls')
  @RequireAnyPermission(...WRITE)
  createControl(
    @Body(new ZodPipe(createControlSchema)) body: CreateControlInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.grc.createControl(body, user, meta);
  }

  @Patch('controls/:id')
  @RequireAnyPermission(...WRITE)
  updateControl(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateControlSchema)) body: UpdateControlInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.grc.updateControl(id, body, user, meta);
  }

  @Delete('controls/:id')
  @RequireAnyPermission(...WRITE)
  @HttpCode(204)
  async removeControl(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.grc.remove(id, 'CONTROL', user, meta);
  }

  // ---------- Requirements (editors only) ----------

  @Get('requirements')
  @RequirePermissions(READ)
  listRequirements(@Query(new ZodPipe(requirementListQuerySchema)) q: RequirementListQuery) {
    return this.grc.listRequirements(q);
  }

  @Get('requirements/:id')
  @RequirePermissions(READ)
  getRequirement(@Param('id', UuidPipe()) id: string) {
    return this.grc.getRequirement(id);
  }

  @Post('requirements')
  @RequirePermissions(PERMISSIONS.GRC_EDIT)
  createRequirement(
    @Body(new ZodPipe(createRequirementSchema)) body: CreateRequirementInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.grc.createRequirement(body, user, meta);
  }

  @Patch('requirements/:id')
  @RequirePermissions(PERMISSIONS.GRC_EDIT)
  updateRequirement(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateRequirementSchema)) body: UpdateRequirementInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.grc.updateRequirement(id, body, user, meta);
  }

  @Delete('requirements/:id')
  @RequirePermissions(PERMISSIONS.GRC_ADMIN)
  @HttpCode(204)
  async removeRequirement(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.grc.remove(id, 'REQUIREMENT', user, meta);
  }

  // ---------- Timeline, comments, process view ----------

  @Get('items/:id/timeline')
  @RequirePermissions(READ)
  timeline(@Param('id', UuidPipe()) id: string) {
    return this.grc.timeline(id);
  }

  @Post('items/:id/comments')
  @RequirePermissions(READ, PERMISSIONS.COMMENTS_WRITE)
  comment(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(grcCommentSchema)) body: GrcCommentInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.grc.comment(id, body.body, user, meta);
  }

  /** Linked risks / controls / requirements per step of a process (modeler side panel, badges). */
  @Get('processes/:id')
  @RequirePermissions(READ, PERMISSIONS.PROCESSES_READ)
  forProcess(@Param('id', UuidPipe()) id: string) {
    return this.grc.forProcess(id);
  }
}
