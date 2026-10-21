import { Global, Module } from '@nestjs/common';
import { MailTransport } from './mail-transport';
import { EmailSettingsService } from './email-settings.service';
import { NotificationsService } from './notifications.service';
import { EmailSettingsController, NotificationsController } from './notifications.controller';

@Global()
@Module({
  controllers: [NotificationsController, EmailSettingsController],
  providers: [MailTransport, EmailSettingsService, NotificationsService],
  exports: [NotificationsService, EmailSettingsService],
})
export class NotificationsModule {}
