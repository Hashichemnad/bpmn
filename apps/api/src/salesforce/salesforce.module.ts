import { Module } from '@nestjs/common';
import { KpiModule } from '../kpi/kpi.module';
import { SalesforceController } from './salesforce.controller';
import { SalesforceHttp } from './salesforce-http';
import { SalesforceSettingsService } from './salesforce-settings.service';
import { SalesforceSyncService } from './salesforce-sync.service';

@Module({
  imports: [KpiModule],
  controllers: [SalesforceController],
  providers: [SalesforceHttp, SalesforceSettingsService, SalesforceSyncService],
  exports: [SalesforceSyncService],
})
export class SalesforceModule {}
