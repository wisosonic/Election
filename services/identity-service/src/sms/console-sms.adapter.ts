import { Injectable, Logger } from '@nestjs/common';
import { SmsPort } from './sms.port';

/**
 * Dev/test stand-in for a real SMS provider (Twilio, etc.) -- logs the OTP
 * instead of sending it. A real provider is a future adapter behind the same
 * SmsPort, mirroring the queue/broker port pattern used elsewhere.
 */
@Injectable()
export class ConsoleSmsAdapter implements SmsPort {
  private readonly logger = new Logger(ConsoleSmsAdapter.name);

  async send(phone: string, message: string): Promise<void> {
    this.logger.log(`[SMS to ${phone}] ${message}`);
  }
}
