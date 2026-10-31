import { Module } from '@nestjs/common';
import { ProcessesModule } from '../processes/processes.module';
import { ModelsModule } from '../models/models.module';
import { AiModule } from '../ai/ai.module';
import { SimulationService } from './simulation.service';
import { MiningPortalService } from './mining-portal.service';
import { MiningReportService } from './mining-report.service';
import { SimulationController } from './simulation.controller';
import { MiningAnalysisService } from './analysis.service';
import { ConformanceService } from './conformance.service';
import { MiningKpiService } from './mining-kpi.service';
import { MiningController } from './mining.controller';
import { EventLogsService } from './event-logs.service';
import { LogImportService } from './log-import.service';
import { MiningJobsService } from './jobs/mining-jobs.service';
import { MiningSettingsService } from './mining-settings.service';
import { MiningScheduler } from './mining-scheduler.service';
import { SnapshotService } from './snapshot.service';

/** Process mining and simulation (Phase 5.1, module M13 — D-128 – ). */
@Module({
  imports: [ProcessesModule, ModelsModule, AiModule],
  controllers: [MiningController, SimulationController],
  providers: [
    EventLogsService,
    LogImportService,
    MiningAnalysisService,
    ConformanceService,
    MiningKpiService,
    SimulationService,
    MiningPortalService,
    MiningReportService,
    MiningJobsService,
    MiningSettingsService,
    MiningScheduler,
    SnapshotService,
  ],
  exports: [
    MiningReportService,
    MiningAnalysisService,
    ConformanceService,
    EventLogsService,
    MiningJobsService,
    MiningSettingsService,
    SnapshotService,
    MiningScheduler,
  ],
})
export class MiningModule {}
