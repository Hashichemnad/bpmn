import { Module } from '@nestjs/common';
import { MiningController } from './mining.controller';
import { EventLogsService } from './event-logs.service';
import { LogImportService } from './log-import.service';
import { MiningJobsService } from './jobs/mining-jobs.service';
import { MiningSettingsService } from './mining-settings.service';
import { MiningScheduler } from './mining-scheduler.service';
import { SnapshotService } from './snapshot.service';

/** Process mining and simulation (Phase 5.1, module M13 — D-128 – ). */
@Module({
  controllers: [MiningController],
  providers: [
    EventLogsService,
    LogImportService,
    MiningJobsService,
    MiningSettingsService,
    MiningScheduler,
    SnapshotService,
  ],
  exports: [
    EventLogsService,
    MiningJobsService,
    MiningSettingsService,
    SnapshotService,
    MiningScheduler,
  ],
})
export class MiningModule {}
