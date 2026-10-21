import { Module } from '@nestjs/common';
import { ProcessesModule } from '../processes/processes.module';
import { AiAdminController, AiController } from './ai.controller';
import { AiSettingsService } from './ai-settings.service';
import { AiGatewayService } from './ai-gateway.service';
import { AiUsageService } from './ai-usage.service';
import { AiProviders } from './ai-providers';
import { AiLibraryService } from './ai-library.service';
import { ProcessAiService } from './features/process-ai.service';
import { TranslateService } from './features/translate.service';

/** M16 AI Assistant: provider-agnostic gateway, settings, usage and the features. */
@Module({
  imports: [ProcessesModule],
  controllers: [AiAdminController, AiController],
  providers: [
    AiSettingsService,
    AiGatewayService,
    AiUsageService,
    AiProviders,
    AiLibraryService,
    ProcessAiService,
    TranslateService,
  ],
})
export class AiModule {}
