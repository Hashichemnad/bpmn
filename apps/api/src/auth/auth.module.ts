import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getConfig } from '../config/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthUserLoader } from './auth-user.loader';
import { PasswordService } from './password.service';
import { AuthSettingsController } from './auth-settings.controller';
import { AuthSettingsService } from './auth-settings.service';
import { MfaService } from './mfa.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: getConfig().JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController, AuthSettingsController],
  providers: [AuthService, AuthUserLoader, PasswordService, AuthSettingsService, MfaService],
  exports: [AuthUserLoader, PasswordService, JwtModule, AuthSettingsService, MfaService],
})
export class AuthModule {}
