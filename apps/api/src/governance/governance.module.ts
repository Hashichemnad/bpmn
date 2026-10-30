import { GrcModule } from '../grc/grc.module';
import { Module } from '@nestjs/common';
import { DocsModule } from '../docs/docs.module';
import { ConventionsModule } from '../conventions/conventions.module';
import { ContentService } from './content.service';
import { WorkflowsService } from './workflows.service';
import { ReviewsService } from './reviews.service';
import { TasksService } from './tasks.service';
import { FeedbackService } from './feedback.service';
import { PortalAccessService } from './portal-access.service';
import { GovernanceScheduler } from './scheduler.service';
import {
  FeedbackController,
  GovernanceController,
  ReviewsController,
  TasksController,
  WorkflowsController,
} from './governance.controller';

@Module({
  imports: [DocsModule, ConventionsModule, GrcModule],
  controllers: [
    GovernanceController,
    WorkflowsController,
    ReviewsController,
    TasksController,
    FeedbackController,
  ],
  providers: [
    ContentService,
    WorkflowsService,
    ReviewsService,
    TasksService,
    FeedbackService,
    PortalAccessService,
    GovernanceScheduler,
  ],
  exports: [ContentService, ReviewsService, PortalAccessService, FeedbackService, WorkflowsService],
})
export class GovernanceModule {}
