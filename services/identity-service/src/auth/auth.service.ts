import { randomUUID } from 'crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { and, eq, isNull } from 'drizzle-orm';
import { Db, schema, withTenant } from '@election/db';
import { AccessTokenClaims, signAccessToken, SigningKeys } from '@election/auth';
import { DB } from '../db.provider';
import { SIGNING_KEYS } from '../keys.provider';
import { OtpService } from '../otp/otp.service';

interface PendingHqLogin {
  tenantId: string;
  userId: string;
  expiresAt: number;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly pendingHqLogins = new Map<string, PendingHqLogin>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SIGNING_KEYS) private readonly keys: SigningKeys,
    private readonly otp: OtpService,
  ) {}

  // ---- Delegate: phone + OTP ----

  async requestDelegateOtp(tenantId: string, phone: string): Promise<void> {
    const [user] = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.phone, phone), eq(schema.users.role, 'delegate'))),
    );
    if (!user) throw new UnauthorizedException('unknown delegate phone number');
    await this.otp.requestOtp(tenantId, phone);
  }

  async verifyDelegateOtp(tenantId: string, phone: string, code: string, deviceId: string): Promise<IssuedTokens> {
    if (!this.otp.verify(tenantId, phone, code)) {
      throw new UnauthorizedException('invalid or expired code');
    }

    return withTenant(this.db, tenantId, async (tx) => {
      const [user] = await tx
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.phone, phone), eq(schema.users.role, 'delegate')));
      if (!user) throw new UnauthorizedException('unknown delegate phone number');

      const assignments = await tx
        .select({ roomId: schema.delegateAssignments.roomId })
        .from(schema.delegateAssignments)
        .where(
          and(
            eq(schema.delegateAssignments.tenantId, tenantId),
            eq(schema.delegateAssignments.delegateId, user.id),
            isNull(schema.delegateAssignments.unassignedAt),
          ),
        );
      const roomIds = assignments.map((a) => a.roomId);

      let qadaId: string | null = null;
      if (roomIds.length > 0) {
        const [row] = await tx
          .select({ qadaId: schema.qadas.id })
          .from(schema.rooms)
          .innerJoin(schema.votingCenters, eq(schema.votingCenters.id, schema.rooms.votingCenterId))
          .innerJoin(schema.qadas, eq(schema.qadas.id, schema.votingCenters.qadaId))
          .where(eq(schema.rooms.id, roomIds[0]));
        qadaId = row?.qadaId ?? null;
      }

      // Upsert this device's credential -- a new device gets a fresh row (this
      // whole flow required a fresh OTP), an existing one is just re-issued.
      const [existing] = await tx
        .select()
        .from(schema.deviceCredentials)
        .where(
          and(
            eq(schema.deviceCredentials.tenantId, tenantId),
            eq(schema.deviceCredentials.delegateId, user.id),
            eq(schema.deviceCredentials.deviceId, deviceId),
          ),
        );
      if (existing) {
        await tx
          .update(schema.deviceCredentials)
          .set({ issuedAt: new Date(), revokedAt: null })
          .where(eq(schema.deviceCredentials.id, existing.id));
      } else {
        await tx.insert(schema.deviceCredentials).values({
          id: randomUUID(),
          tenantId,
          delegateId: user.id,
          deviceId,
          credentialType: 'token',
        });
      }

      const claims: AccessTokenClaims = {
        sub: user.id,
        tenantId,
        role: 'delegate',
        roomIds,
        qadaId,
        deviceId,
      };
      const accessToken = await signAccessToken(claims, this.keys.privateKey, this.keys.kid, '15m');
      const refreshToken = await signAccessToken(claims, this.keys.privateKey, this.keys.kid, '30d');
      return { accessToken, refreshToken };
    });
  }

  // ---- HQ staff: email + password, then TOTP ----

  async hqLogin(tenantId: string, email: string, password: string): Promise<{ pendingId: string }> {
    const [user] = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.email, email), eq(schema.users.authMethod, 'password_totp'))),
    );
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('invalid email or password');
    }

    const pendingId = randomUUID();
    this.pendingHqLogins.set(pendingId, { tenantId, userId: user.id, expiresAt: Date.now() + 2 * 60_000 });
    return { pendingId };
  }

  async hqVerifyTotp(pendingId: string, code: string): Promise<IssuedTokens> {
    const pending = this.pendingHqLogins.get(pendingId);
    if (!pending || pending.expiresAt < Date.now()) {
      throw new UnauthorizedException('login session expired, please sign in again');
    }

    return withTenant(this.db, pending.tenantId, async (tx) => {
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, pending.userId));
      if (!user?.totpSecret || !authenticator.check(code, user.totpSecret)) {
        throw new UnauthorizedException('invalid authentication code');
      }
      this.pendingHqLogins.delete(pendingId); // single-use

      const claims: AccessTokenClaims = { sub: user.id, tenantId: pending.tenantId, role: user.role as AccessTokenClaims['role'] };
      const accessToken = await signAccessToken(claims, this.keys.privateKey, this.keys.kid, '15m');
      const refreshToken = await signAccessToken(claims, this.keys.privateKey, this.keys.kid, '7d');
      return { accessToken, refreshToken };
    });
  }
}
