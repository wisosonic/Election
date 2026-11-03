export interface SmsPort {
  send(phone: string, message: string): Promise<void>;
}

export const SMS_PORT = Symbol('SMS_PORT');
