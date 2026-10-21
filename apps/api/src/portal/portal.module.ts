import { Module } from '@nestjs/common';
import { GovernanceModule } from '../governance/governance.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
  imports: [GovernanceModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
