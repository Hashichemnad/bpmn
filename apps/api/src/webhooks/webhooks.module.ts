import { Module } from '@nestjs/common';
import { WebhookDispatcher } from './webhook-dispatcher.service';
import { WebhookHttp } from './webhook-http';
import { WebhookSettingsService } from './webhook-settings.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/** Outbound webhooks and Microsoft Teams channel notifications (Phase 4.4, D-174, D-176). */
@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatcher, WebhookHttp, WebhookSettingsService],
  exports: [WebhookDispatcher],
})
export class WebhooksModule {}
