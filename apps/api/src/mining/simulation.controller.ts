import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  createSimulationSchema,
  runSimulationSchema,
  scenarioInputSchema,
  updateSimulationSchema,
  uuidSchema,
  type CreateSimulationInput,
  type RunSimulationInput,
  type ScenarioInput,
  type UpdateSimulationInput,
} from '@processhub/shared';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { UuidPipe, ZodPipe } from '../common/zod.pipe';
import { download } from '../ea/ea.controller';
import { SimulationService } from './simulation.service';

const READ = PERMISSIONS.MINING_READ;
const MANAGE = PERMISSIONS.MINING_MANAGE;
const listQuery = z.object({ processId: uuidSchema.optional() });
const defaultsQuery = z.object({ processId: uuidSchema, logId: uuidSchema.optional() });

/** Simulation (Phase 5.1): simulations, scenarios, runs, comparison, AI proposals. */
@ApiTags('simulations')
@Controller('simulations')
export class SimulationController {
  constructor(private readonly sims: SimulationService) {}

  @Get()
  @RequirePermissions(READ)
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>, @CurrentUser() user: AuthUser) {
    return this.sims.list(q.processId, user);
  }

  @Get('defaults')
  @RequirePermissions(READ)
  defaults(
    @Query(new ZodPipe(defaultsQuery)) q: z.infer<typeof defaultsQuery>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sims.defaults(q.processId, user, q.logId);
  }

  @Post()
  @RequirePermissions(MANAGE)
  create(
    @Body(new ZodPipe(createSimulationSchema)) body: CreateSimulationInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.sims.create(body, user, meta);
  }

  @Get(':id')
  @RequirePermissions(READ)
  detail(@Param('id', UuidPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.sims.detail(id, user);
  }

  @Patch(':id')
  @RequirePermissions(MANAGE)
  update(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(updateSimulationSchema)) body: UpdateSimulationInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sims.update(id, body, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(MANAGE)
  remove(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.sims.remove(id, user, meta);
  }

  @Post(':id/scenarios')
  @RequirePermissions(MANAGE)
  addScenario(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(scenarioInputSchema)) body: ScenarioInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sims.addScenario(id, body, user);
  }

  @Patch(':id/scenarios/:scenarioId')
  @RequirePermissions(MANAGE)
  updateScenario(
    @Param('id', UuidPipe()) id: string,
    @Param('scenarioId', UuidPipe()) scenarioId: string,
    @Body(new ZodPipe(scenarioInputSchema)) body: ScenarioInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sims.updateScenario(id, scenarioId, body, user);
  }

  @Delete(':id/scenarios/:scenarioId')
  @RequirePermissions(MANAGE)
  removeScenario(
    @Param('id', UuidPipe()) id: string,
    @Param('scenarioId', UuidPipe()) scenarioId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sims.removeScenario(id, scenarioId, user);
  }

  /** Runs the scenarios (all, or the given ones) as jobs; validation errors block the run. */
  @Post(':id/run')
  @RequirePermissions(MANAGE)
  run(
    @Param('id', UuidPipe()) id: string,
    @Body(new ZodPipe(runSimulationSchema)) body: RunSimulationInput,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.sims.start(id, body.scenarioIds, user, meta);
  }

  @Get(':id/export')
  @RequirePermissions(READ)
  async export(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.sims.export(id, user, meta));
  }

  /** AI: explanation of the results (text, nothing is changed). */
  @Post(':id/ai/explain')
  @HttpCode(200)
  @RequirePermissions(READ)
  explain(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.sims.explain(id, user, meta);
  }

  /** AI: improvement scenarios as proposals; the user creates a scenario from one if wanted. */
  @Post(':id/ai/suggest')
  @HttpCode(200)
  @RequirePermissions(READ)
  suggest(
    @Param('id', UuidPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.sims.suggest(id, user, meta);
  }
}
