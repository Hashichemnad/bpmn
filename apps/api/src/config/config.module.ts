import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, getConfig } from './config';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: getConfig }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
