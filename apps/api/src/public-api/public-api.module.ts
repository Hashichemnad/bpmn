import { Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { PublicApiController } from './public-api.controller';
import { PublicApiService } from './public-api.service';
import { ReportingService } from './reporting.service';

/** API key management (Settings → Integrations) and the key guard's service (Phase 4.4, D-173). */
@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}

/**
 * Public REST API (`/api/public/v1`). Only this module's controllers go into the public OpenAPI
 * document. The key guard is global (app.module).
 */
@Module({
  imports: [ApiKeysModule],
  controllers: [PublicApiController],
  providers: [PublicApiService, ReportingService],
})
export class PublicApiModule {}
