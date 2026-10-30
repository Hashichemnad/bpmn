import { Module } from '@nestjs/common';
import { GrcModule } from '../grc/grc.module';
import { GovernanceModule } from '../governance/governance.module';
import { ReportsModule } from '../reports/reports.module';
import { AuditsService } from './audits.service';
import { AuditsController } from './audits.controller';
import { AuditReportService } from './audit-report.service';
import { SurveysService } from './surveys.service';
import { SurveysController } from './surveys.controller';
import { AssuranceDashboardService } from './assurance-dashboard.service';
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
  imports: [GrcModule, GovernanceModule, ReportsModule],
  controllers: [
    GrcChangesController,
    AssuranceController,
    ControlTestsController,
    AssuranceSettingsController,
    IssuesController,
    AuditsController,
    SurveysController,
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
    AuditsService,
    AuditReportService,
    SurveysService,
    AssuranceDashboardService,
  ],
  exports: [GrcChangesService, ControlTestsService, AssuranceScheduler, IssuesService],
})
export class AssuranceModule {}
