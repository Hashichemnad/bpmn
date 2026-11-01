import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { DemoStatusService } from './demo-status.service';

@Module({ controllers: [SettingsController], providers: [SettingsService, DemoStatusService] })
export class SettingsModule {}
