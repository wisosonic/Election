import { Module } from '@nestjs/common';
import { dbProvider } from './db.provider';
import { signingKeysProvider } from './keys.provider';
import { SMS_PORT } from './sms/sms.port';
import { ConsoleSmsAdapter } from './sms/console-sms.adapter';
import { OtpService } from './otp/otp.service';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { JwksController } from './jwks/jwks.controller';
import { DevicesController } from './devices/devices.controller';

@Module({
  controllers: [AuthController, JwksController, DevicesController],
  providers: [
    dbProvider,
    signingKeysProvider,
    { provide: SMS_PORT, useClass: ConsoleSmsAdapter },
    OtpService,
    AuthService,
  ],
})
export class AppModule {}
