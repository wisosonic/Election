import { Inject, Injectable } from '@nestjs/common';
import { SMS_PORT, SmsPort } from '../sms/sms.port';

interface OtpEntry {
  code: string;
  expiresAt: number;
}

/**
 * In-memory OTP store -- sufficient for a single identity-service instance;
 * a horizontally-scaled deployment would back this with Redis instead, but
 * the interface wouldn't change. TTL-bound and single-use (deleted on success).
 */
@Injectable()
export class OtpService {
  private readonly store = new Map<string, OtpEntry>();
  private readonly ttlMs = 5 * 60_000;

  constructor(@Inject(SMS_PORT) private readonly sms: SmsPort) {}

  private key(tenantId: string, phone: string): string {
    return `${tenantId}:${phone}`;
  }

  async requestOtp(tenantId: string, phone: string): Promise<void> {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.store.set(this.key(tenantId, phone), { code, expiresAt: Date.now() + this.ttlMs });
    await this.sms.send(phone, `Your verification code is ${code}`);
  }

  verify(tenantId: string, phone: string, code: string): boolean {
    const k = this.key(tenantId, phone);
    const entry = this.store.get(k);
    if (!entry || entry.expiresAt < Date.now()) return false;
    const ok = entry.code === code;
    if (ok) this.store.delete(k); // single-use
    return ok;
  }
}
