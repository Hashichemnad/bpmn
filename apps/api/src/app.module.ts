import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { getConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { StorageModule } from './storage/storage.module';
import { RendererModule } from './renderer/renderer.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { DepartmentsModule } from './departments/departments.module';
import { SettingsModule } from './settings/settings.module';
import { ProcessesModule } from './processes/processes.module';
import { ModelsModule } from './models/models.module';
import { DiagramsModule } from './diagrams/diagrams.module';
import { ObjectsModule } from './objects/objects.module';
import { DictionaryModule } from './dictionary/dictionary.module';
import { ReportsModule } from './reports/reports.module';
import { ConventionsModule } from './conventions/conventions.module';
import { GrcModule } from './grc/grc.module';
import { EventsModule } from './events/domain-events';
import { DocsModule } from './docs/docs.module';
import { SearchModule } from './search/search.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { GovernanceModule } from './governance/governance.module';
import { CommentsModule } from './comments/comments.module';
import { PortalModule } from './portal/portal.module';
import { AiModule } from './ai/ai.module';
import { AssuranceModule } from './assurance/assurance.module';
import { EaModule } from './ea/ea.module';
import { KpiModule } from './kpi/kpi.module';
import { SalesforceModule } from './salesforce/salesforce.module';
import { MiningModule } from './mining/mining.module';
import { WorkflowModule } from './workflow/workflow.module';
import { ImportsModule } from './imports/imports.module';
import { ApiKeysModule, PublicApiModule } from './public-api/public-api.module';
import { ApiKeyGuard } from './public-api/api-key.guard';
import { HealthController } from './health/health.controller';
import { CsrfGuard, JwtAuthGuard, PermissionsGuard } from './common/guards';
import { AllExceptionsFilter } from './common/http-exception.filter';

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRootAsync({
      useFactory: () => [
        {
          name: 'default',
          ttl: getConfig().RATE_LIMIT_TTL_SECONDS * 1000,
          limit: getConfig().RATE_LIMIT_MAX,
        },
      ],
    }),
    PrismaModule,
    EventsModule,
    AuditModule,
    NotificationsModule,
    AuthModule,
    StorageModule,
    RendererModule,
    UsersModule,
    RolesModule,
    DepartmentsModule,
    SettingsModule,
    ProcessesModule,
    ModelsModule,
    DiagramsModule,
    ObjectsModule,
    DictionaryModule,
    ReportsModule,
    ConventionsModule,
    GrcModule,
    AssuranceModule,
    EaModule,
    KpiModule,
    SalesforceModule,
    MiningModule,
    WorkflowModule,
    ImportsModule,
    ApiKeysModule,
    PublicApiModule,
    DocsModule,
    SearchModule,
    IntegrationsModule,
    GovernanceModule,
    CommentsModule,
    PortalModule,
    AiModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate limit → authenticate (session cookie or, on /api/public, API key) →
    // CSRF → authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
