import { Module } from '@nestjs/common';
import { GrcModule } from '../grc/grc.module';
import { GovernanceModule } from '../governance/governance.module';
import { GrcChangesService } from './grc-changes.service';
import { GrcChangesController } from './grc-changes.controller';
import { AssuranceController } from './assurance.controller';
import { AssuranceTasksService } from './assurance-tasks.service';
import { AssuranceFilesService } from './assurance-files.service';
import { AssuranceEventsService } from './assurance-events.service';
import { AssigneeResolver } from './assignees';
import { ControlTestsService } from './control-tests.service';
import { ControlTestsController } from './control-tests.controller';
import { AssuranceScheduler } from './assurance-scheduler.service';

/**
 * Assurance (Phase 4.2, module M10): approval of GRC changes, control testing, issues and
 * actions, audit management, questionnaires and the assurance dashboard.
 */
@Module({
  imports: [GrcModule, GovernanceModule],
  controllers: [GrcChangesController, AssuranceController, ControlTestsController],
  providers: [
    GrcChangesService,
    AssuranceTasksService,
    AssuranceFilesService,
    AssuranceEventsService,
    AssigneeResolver,
    ControlTestsService,
    AssuranceScheduler,
  ],
  exports: [GrcChangesService, ControlTestsService, AssuranceScheduler],
})
export class AssuranceModule {}
