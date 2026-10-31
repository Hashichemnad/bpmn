import { GrcModule } from '../grc/grc.module';
import { Module } from '@nestjs/common';
import { ProcessesModule } from '../processes/processes.module';
import { GovernanceModule } from '../governance/governance.module';
import { DocsModule } from '../docs/docs.module';
import { AiAdminController, AiController } from './ai.controller';
import { AiSettingsService } from './ai-settings.service';
import { AiGatewayService } from './ai-gateway.service';
import { AiUsageService } from './ai-usage.service';
import { AiProviders } from './ai-providers';
import { AiLibraryService } from './ai-library.service';
import { ProcessAiService } from './features/process-ai.service';
import { TranslateService } from './features/translate.service';
import { DocAiService } from './features/doc-ai.service';
import { SummaryService } from './features/summary.service';
import { AiContextService } from './ai-context.service';
import { AnalyseService } from './features/analyse.service';
import { ControlGapsService } from './features/control-gaps.service';
import { PortalQaService } from './features/portal-qa.service';

/** M16 AI Assistant: provider-agnostic gateway, settings, usage and the features. */
@Module({
  imports: [ProcessesModule, GovernanceModule, DocsModule, GrcModule],
  controllers: [AiAdminController, AiController],
  providers: [
    AiSettingsService,
    AiGatewayService,
    AiUsageService,
    AiProviders,
    AiLibraryService,
    ProcessAiService,
    TranslateService,
    AiContextService,
    DocAiService,
    SummaryService,
    AnalyseService,
    ControlGapsService,
    PortalQaService,
  ],
  exports: [AiGatewayService, AiLibraryService, AiContextService],
})
export class AiModule {}
