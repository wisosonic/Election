import { randomUUID } from 'crypto';
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  jwtVerify,
  createLocalJWKSet,
  createRemoteJWKSet,
  JWTVerifyGetKey,
  KeyLike,
  JWK,
} from 'jose';

export type Role = 'super_admin' | 'campaign_admin' | 'coordinator' | 'analyst' | 'delegate';

/** Claims embedded in an access token -- §6.1/§6.2 of ARCHITECTURE.md. For a
 * delegate, roomIds/qadaId/deviceId scope exactly what that token may touch;
 * for HQ staff, tenantId + role is what RBAC (§6.2) checks against. */
export interface AccessTokenClaims {
  sub: string; // user id
  tenantId: string;
  role: Role;
  roomIds?: string[];
  qadaId?: string | null;
  deviceId?: string;
}

export interface SigningKeys {
  publicKey: KeyLike;
  privateKey: KeyLike;
  publicJwk: JWK;
  kid: string;
}

/** Generates a fresh RS256 keypair -- identity-service does this once at
 * startup and exposes publicJwk via /.well-known/jwks.json (§6.1). */
export async function generateSigningKeys(): Promise<SigningKeys> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const kid = randomUUID();
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  return { publicKey, privateKey, publicJwk, kid };
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  privateKey: KeyLike,
  kid: string,
  expiresIn = '15m',
): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}

/**
 * Verifies an access token against either a static JWKS (tests, or any
 * process that already holds identity-service's public key) or a live JWKS
 * URL (command-api / mqtt-ingestion in a real deployment) -- either way, this
 * is a local, cached verification with no per-request call to identity-service
 * (§6.1: "no synchronous dependency on Identity Service for every request").
 */
export class JwtVerifier {
  private readonly getKey: JWTVerifyGetKey;

  constructor(source: { jwks: { keys: JWK[] } } | { jwksUrl: string }) {
    this.getKey =
      'jwks' in source ? createLocalJWKSet(source.jwks) : createRemoteJWKSet(new URL(source.jwksUrl));
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    const { payload } = await jwtVerify(token, this.getKey);
    return payload as unknown as AccessTokenClaims;
  }
}
