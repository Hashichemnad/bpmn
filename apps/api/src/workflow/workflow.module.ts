import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowConfigService } from './workflow-config.service';
import { WorkflowSettingsService } from './workflow-settings.service';
import { WorkflowTimersService } from './workflow-timers.service';
import { WorkflowEventLogService } from './workflow-event-log.service';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import { WorkflowRunnerService } from './workflow-runner.service';
import { WorkflowCasesService } from './workflow-cases.service';
import { WorkflowTasksService } from './workflow-tasks.service';
import { WorkflowJobsService } from './workflow-jobs.service';
import { WorkflowMonitorService } from './workflow-monitor.service';

/** Workflow execution (Phase 5.2, module M14 — D-144 – ). */
@Module({
  controllers: [WorkflowController],
  providers: [
    WorkflowSettingsService,
    WorkflowTimersService,
    WorkflowEventLogService,
    WorkflowConfigService,
    WorkflowAssignmentService,
    WorkflowRunnerService,
    WorkflowCasesService,
    WorkflowTasksService,
    WorkflowJobsService,
    WorkflowMonitorService,
  ],
  exports: [WorkflowTasksService, WorkflowCasesService, WorkflowJobsService, WorkflowConfigService],
})
export class WorkflowModule {}
