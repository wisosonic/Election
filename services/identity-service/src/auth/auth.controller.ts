import { Body, Controller, Post } from '@nestjs/common';
import { AuthService, IssuedTokens } from './auth.service';

interface RequestOtpBody {
  tenantId: string;
  phone: string;
}

interface VerifyOtpBody {
  tenantId: string;
  phone: string;
  code: string;
  deviceId: string;
}

interface HqLoginBody {
  tenantId: string;
  email: string;
  password: string;
}

interface HqVerifyTotpBody {
  pendingId: string;
  code: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('delegate/request-otp')
  async requestOtp(@Body() body: RequestOtpBody): Promise<{ ok: true }> {
    await this.auth.requestDelegateOtp(body.tenantId, body.phone);
    return { ok: true };
  }

  @Post('delegate/verify-otp')
  async verifyOtp(@Body() body: VerifyOtpBody): Promise<IssuedTokens> {
    return this.auth.verifyDelegateOtp(body.tenantId, body.phone, body.code, body.deviceId);
  }

  @Post('hq/login')
  async hqLogin(@Body() body: HqLoginBody): Promise<{ pendingId: string }> {
    return this.auth.hqLogin(body.tenantId, body.email, body.password);
  }

  @Post('hq/verify-totp')
  async hqVerifyTotp(@Body() body: HqVerifyTotpBody): Promise<IssuedTokens> {
    return this.auth.hqVerifyTotp(body.pendingId, body.code);
  }
}
