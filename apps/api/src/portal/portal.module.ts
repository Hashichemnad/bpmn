import { Module } from '@nestjs/common';
import { GovernanceModule } from '../governance/governance.module';
import { GrcModule } from '../grc/grc.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
  imports: [GovernanceModule, GrcModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
