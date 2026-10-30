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
import { AssuranceSettingsService } from './assurance-settings.service';
import { IssuesService } from './issues.service';
import { AssuranceSettingsController, IssuesController } from './issues.controller';

/**
 * Assurance (Phase 4.2, module M10): approval of GRC changes, control testing, issues and
 * actions, audit management, questionnaires and the assurance dashboard.
 */
@Module({
  imports: [GrcModule, GovernanceModule],
  controllers: [
    GrcChangesController,
    AssuranceController,
    ControlTestsController,
    AssuranceSettingsController,
    IssuesController,
  ],
  providers: [
    GrcChangesService,
    AssuranceTasksService,
    AssuranceFilesService,
    AssuranceEventsService,
    AssigneeResolver,
    ControlTestsService,
    AssuranceScheduler,
    AssuranceSettingsService,
    IssuesService,
  ],
  exports: [GrcChangesService, ControlTestsService, AssuranceScheduler, IssuesService],
})
export class AssuranceModule {}
