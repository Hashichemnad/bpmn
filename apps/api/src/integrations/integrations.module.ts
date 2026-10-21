import { Module } from '@nestjs/common';
import { GitHttp } from './providers/git-http';
import { GitProviders } from './git-providers';
import { GitSettingsService } from './git-settings.service';
import { GitExportService } from './git-export.service';
import { GitSyncService } from './git-sync.service';
import { IntegrationsController } from './integrations.controller';

@Module({
  controllers: [IntegrationsController],
  providers: [GitHttp, GitProviders, GitSettingsService, GitExportService, GitSyncService],
})
export class IntegrationsModule {}
