import { randomUUID } from 'crypto';
import { generateSigningKeys, JwtVerifier, signAccessToken } from '@election/auth';
import { roomTopic, qadaBroadcastTopic } from '@election/shared-types';
import { authorizePublish, authorizeSubscribe, buildAuthenticate, isServiceIdentity } from '../src/acl';

describe('ACL', () => {
  it('authenticates a valid delegate token into a scoped DeviceIdentity', async () => {
    const keys = await generateSigningKeys();
    const verifier = new JwtVerifier({ jwks: { keys: [keys.publicJwk] } });
    const authenticate = buildAuthenticate(verifier, null);

    const tenantId = randomUUID();
    const roomId = randomUUID();
    const token = await signAccessToken(
      { sub: 'delegate-1', tenantId, role: 'delegate', roomIds: [roomId], qadaId: 'qada-1', deviceId: 'device-1' },
      keys.privateKey,
      keys.kid,
    );

    const identity = await authenticate('client-1', 'ignored', Buffer.from(token));
    expect(identity).toEqual({ deviceId: 'device-1', delegateId: 'delegate-1', tenantId, roomIds: [roomId], qadaId: 'qada-1' });
  });

  it('rejects a token whose role is not delegate (HQ tokens never connect to the broker directly)', async () => {
    const keys = await generateSigningKeys();
    const verifier = new JwtVerifier({ jwks: { keys: [keys.publicJwk] } });
    const authenticate = buildAuthenticate(verifier, null);
    const token = await signAccessToken({ sub: 'u1', tenantId: 't1', role: 'campaign_admin' }, keys.privateKey, keys.kid);
    await expect(authenticate('client-1', 'x', Buffer.from(token))).resolves.toBeNull();
  });

  it('rejects garbage credentials', async () => {
    const keys = await generateSigningKeys();
    const verifier = new JwtVerifier({ jwks: { keys: [keys.publicJwk] } });
    const authenticate = buildAuthenticate(verifier, null);
    await expect(authenticate('client-1', 'x', Buffer.from('not-a-jwt'))).resolves.toBeNull();
  });

  it('authenticates the service credential when configured, independent of any tenant', async () => {
    const keys = await generateSigningKeys();
    const verifier = new JwtVerifier({ jwks: { keys: [keys.publicJwk] } });
    const authenticate = buildAuthenticate(verifier, { username: 'command-api', password: 'secret' });
    const identity = await authenticate('client-1', 'command-api', Buffer.from('secret'));
    expect(identity && isServiceIdentity(identity)).toBe(true);
  });

  it('lets a delegate publish only to its own room, never a broadcast topic', () => {
    const tenantId = randomUUID();
    const roomId = randomUUID();
    const identity = { deviceId: 'd', delegateId: 'del', tenantId, roomIds: [roomId], qadaId: 'q' };
    expect(authorizePublish(identity, roomTopic(tenantId, roomId, 'turnout'))).toBe(true);
    expect(authorizePublish(identity, roomTopic(tenantId, randomUUID(), 'turnout'))).toBe(false);
    expect(authorizePublish(identity, roomTopic(tenantId, roomId, 'broadcast'))).toBe(false);
    expect(authorizePublish(identity, roomTopic(randomUUID(), roomId, 'turnout'))).toBe(false); // wrong tenant
  });

  it('lets the service identity publish only to broadcast topics', () => {
    const service = { deviceId: 's', delegateId: 'service', tenantId: '*', roomIds: [], qadaId: null };
    const tenantId = randomUUID();
    const roomId = randomUUID();
    expect(authorizePublish(service, roomTopic(tenantId, roomId, 'broadcast'))).toBe(true);
    expect(authorizePublish(service, qadaBroadcastTopic(tenantId, randomUUID()))).toBe(true);
    expect(authorizePublish(service, roomTopic(tenantId, roomId, 'turnout'))).toBe(false);
  });

  it("lets a delegate subscribe only to its own room's or qada's broadcast topic", () => {
    const tenantId = randomUUID();
    const roomId = randomUUID();
    const identity = { deviceId: 'd', delegateId: 'del', tenantId, roomIds: [roomId], qadaId: 'qada-1' };
    expect(authorizeSubscribe(identity, roomTopic(tenantId, roomId, 'broadcast'))).toBe(true);
    expect(authorizeSubscribe(identity, qadaBroadcastTopic(tenantId, 'qada-1'))).toBe(true);
    expect(authorizeSubscribe(identity, qadaBroadcastTopic(tenantId, 'qada-2'))).toBe(false);
    expect(authorizeSubscribe(identity, roomTopic(tenantId, roomId, 'turnout'))).toBe(false); // never subscribable
  });
});
