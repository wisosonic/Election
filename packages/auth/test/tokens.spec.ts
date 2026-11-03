import { generateSigningKeys, signAccessToken, JwtVerifier, AccessTokenClaims } from '../src';

describe('token signing & verification', () => {
  it('signs a token and verifies it against a static JWKS built from the same keypair', async () => {
    const keys = await generateSigningKeys();
    const claims: AccessTokenClaims = {
      sub: 'user-1',
      tenantId: 'tenant-1',
      role: 'delegate',
      roomIds: ['room-1'],
      qadaId: 'qada-1',
      deviceId: 'device-1',
    };
    const token = await signAccessToken(claims, keys.privateKey, keys.kid, '5m');

    const verifier = new JwtVerifier({ jwks: { keys: [keys.publicJwk] } });
    const verified = await verifier.verify(token);

    expect(verified.sub).toBe('user-1');
    expect(verified.tenantId).toBe('tenant-1');
    expect(verified.roomIds).toEqual(['room-1']);
  });

  it('rejects a token signed by a different, unrelated keypair', async () => {
    const keysA = await generateSigningKeys();
    const keysB = await generateSigningKeys();

    const token = await signAccessToken(
      { sub: 'user-1', tenantId: 'tenant-1', role: 'delegate' },
      keysA.privateKey,
      keysA.kid,
    );

    const verifier = new JwtVerifier({ jwks: { keys: [keysB.publicJwk] } });
    await expect(verifier.verify(token)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const keys = await generateSigningKeys();
    const token = await signAccessToken(
      { sub: 'user-1', tenantId: 'tenant-1', role: 'delegate' },
      keys.privateKey,
      keys.kid,
      '1sec',
    );
    await new Promise((r) => setTimeout(r, 1200));

    const verifier = new JwtVerifier({ jwks: { keys: [keys.publicJwk] } });
    await expect(verifier.verify(token)).rejects.toThrow();
  });
});
