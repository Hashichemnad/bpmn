import { Module } from '@nestjs/common';
import { ExportsModule } from '../exports/exports.module';
import { MiningModule } from '../mining/mining.module';
import { ReportsModule } from '../reports/reports.module';
import { ReportBuilders } from './report-builders';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

/** Scheduled report e-mails (Phase 4.4, D-179). */
@Module({
  imports: [ExportsModule, MiningModule, ReportsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, ReportBuilders],
  exports: [SubscriptionsService],
})
export class ScheduledReportsModule {}
