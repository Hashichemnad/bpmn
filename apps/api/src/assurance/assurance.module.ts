import { Module } from '@nestjs/common';
import { GrcModule } from '../grc/grc.module';
import { GovernanceModule } from '../governance/governance.module';
import { GrcChangesService } from './grc-changes.service';
import { GrcChangesController } from './grc-changes.controller';
import { AssuranceController } from './assurance.controller';
import { AssuranceTasksService } from './assurance-tasks.service';

/**
 * Assurance (Phase 4.2, module M10): approval of GRC changes, control testing, issues and
 * actions, audit management, questionnaires and the assurance dashboard.
 */
@Module({
  imports: [GrcModule, GovernanceModule],
  controllers: [GrcChangesController, AssuranceController],
  providers: [GrcChangesService, AssuranceTasksService],
  exports: [GrcChangesService],
})
export class AssuranceModule {}
