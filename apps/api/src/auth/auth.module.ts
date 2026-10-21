import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getConfig } from '../config/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthUserLoader } from './auth-user.loader';
import { PasswordService } from './password.service';

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
  controllers: [AuthController],
  providers: [AuthService, AuthUserLoader, PasswordService],
  exports: [AuthUserLoader, PasswordService, JwtModule],
})
export class AuthModule {}
