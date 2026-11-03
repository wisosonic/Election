import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { createDb, Db, schema, withTenant } from '@election/db';
import { generateSigningKeys, JwtVerifier, SigningKeys } from '@election/auth';
import { SmsPort } from '../src/sms/sms.port';
import { OtpService } from '../src/otp/otp.service';
import { AuthService } from '../src/auth/auth.service';

class CapturingSms implements SmsPort {
  messages: { phone: string; message: string }[] = [];
  async send(phone: string, message: string): Promise<void> {
    this.messages.push({ phone, message });
  }
  lastCode(): string {
    const msg = this.messages[this.messages.length - 1]?.message ?? '';
    const match = msg.match(/\d{6}/);
    if (!match) throw new Error('no code found in last SMS');
    return match[0];
  }
}

describe('AuthService', () => {
  let db: Db;
  let close: () => Promise<void>;
  let keys: SigningKeys;
  let sms: CapturingSms;
  let auth: AuthService;
  let tenantId: string;
  let roomId: string;
  const delegatePhone = '+96170123456';
  const hqEmail = 'manager@campaign.example';
  const hqPassword = 'correct horse battery staple';
  let totpSecret: string;

  beforeAll(async () => {
    ({ db, close } = await createDb());
    keys = await generateSigningKeys();
    sms = new CapturingSms();
    auth = new AuthService(db, keys, new OtpService(sms));

    tenantId = randomUUID();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Test Campaign' });

    const electionId = randomUUID();
    const mohafazatId = randomUUID();
    const qadaId = randomUUID();
    const centerId = randomUUID();
    roomId = randomUUID();
    const delegateId = randomUUID();
    const hqUserId = randomUUID();
    totpSecret = authenticator.generateSecret();

    await withTenant(db, tenantId, async (tx) => {
      await tx.insert(schema.elections).values({ id: electionId, tenantId, electionDate: '2026-05-15' });
      await tx.insert(schema.mohafazats).values({ id: mohafazatId, tenantId, electionId, name: 'Mount Lebanon' });
      await tx.insert(schema.qadas).values({ id: qadaId, tenantId, mohafazatId, name: 'Baabda' });
      await tx.insert(schema.votingCenters).values({ id: centerId, tenantId, qadaId, name: 'Baabda School' });
      await tx.insert(schema.rooms).values({ id: roomId, tenantId, votingCenterId: centerId, label: 'Room 1' });
      await tx.insert(schema.users).values({
        id: delegateId,
        tenantId,
        role: 'delegate',
        phone: delegatePhone,
        authMethod: 'otp',
      });
      await tx.insert(schema.delegateAssignments).values({ id: randomUUID(), tenantId, delegateId, roomId });
      await tx.insert(schema.users).values({
        id: hqUserId,
        tenantId,
        role: 'campaign_admin',
        email: hqEmail,
        authMethod: 'password_totp',
        passwordHash: await bcrypt.hash(hqPassword, 10),
        totpSecret,
      });
    });
  });

  afterAll(async () => {
    await close();
  });

  it('rejects an OTP request for an unknown phone number', async () => {
    await expect(auth.requestDelegateOtp(tenantId, '+96170000999')).rejects.toThrow();
  });

  it('issues a scoped token after a correct delegate OTP', async () => {
    await auth.requestDelegateOtp(tenantId, delegatePhone);
    const code = sms.lastCode();

    const tokens = await auth.verifyDelegateOtp(tenantId, delegatePhone, code, 'device-abc');
    expect(tokens.accessToken).toEqual(expect.any(String));

    const verifier = new JwtVerifier({ jwks: { keys: [keys.publicJwk] } });
    const claims = await verifier.verify(tokens.accessToken);
    expect(claims.tenantId).toBe(tenantId);
    expect(claims.role).toBe('delegate');
    expect(claims.roomIds).toEqual([roomId]);
    expect(claims.deviceId).toBe('device-abc');
  });

  it('rejects a reused OTP code (single-use)', async () => {
    await auth.requestDelegateOtp(tenantId, delegatePhone);
    const code = sms.lastCode();
    await auth.verifyDelegateOtp(tenantId, delegatePhone, code, 'device-xyz');
    await expect(auth.verifyDelegateOtp(tenantId, delegatePhone, code, 'device-xyz')).rejects.toThrow();
  });

  it('rejects a wrong OTP code', async () => {
    await auth.requestDelegateOtp(tenantId, delegatePhone);
    await expect(auth.verifyDelegateOtp(tenantId, delegatePhone, '000000', 'device-abc')).rejects.toThrow();
  });

  it('rejects HQ login with a wrong password', async () => {
    await expect(auth.hqLogin(tenantId, hqEmail, 'wrong password')).rejects.toThrow();
  });

  it('completes HQ login: password then TOTP', async () => {
    const { pendingId } = await auth.hqLogin(tenantId, hqEmail, hqPassword);
    const code = authenticator.generate(totpSecret);
    const tokens = await auth.hqVerifyTotp(pendingId, code);

    const verifier = new JwtVerifier({ jwks: { keys: [keys.publicJwk] } });
    const claims = await verifier.verify(tokens.accessToken);
    expect(claims.role).toBe('campaign_admin');
    expect(claims.tenantId).toBe(tenantId);
  });

  it('rejects a wrong TOTP code', async () => {
    const { pendingId } = await auth.hqLogin(tenantId, hqEmail, hqPassword);
    await expect(auth.hqVerifyTotp(pendingId, '000000')).rejects.toThrow();
  });

  it('rejects a TOTP attempt against an unknown/expired pendingId', async () => {
    await expect(auth.hqVerifyTotp(randomUUID(), authenticator.generate(totpSecret))).rejects.toThrow();
  });
});
