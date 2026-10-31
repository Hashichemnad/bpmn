import { Module } from '@nestjs/common';
import { GovernanceModule } from '../governance/governance.module';
import { GrcModule } from '../grc/grc.module';
import { KpiModule } from '../kpi/kpi.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
  imports: [GovernanceModule, GrcModule, KpiModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
