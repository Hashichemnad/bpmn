import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { getConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { DepartmentsModule } from './departments/departments.module';
import { SettingsModule } from './settings/settings.module';
import { ProcessesModule } from './processes/processes.module';
import { ModelsModule } from './models/models.module';
import { ObjectsModule } from './objects/objects.module';
import { EventsModule } from './events/domain-events';
import { DocsModule } from './docs/docs.module';
import { SearchModule } from './search/search.module';
import { IntegrationsModule } from './integrations/integrations.module';
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
    AuthModule,
    StorageModule,
    UsersModule,
    RolesModule,
    DepartmentsModule,
    SettingsModule,
    ProcessesModule,
    ModelsModule,
    ObjectsModule,
    DocsModule,
    SearchModule,
    IntegrationsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate limit → authenticate → CSRF → authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
