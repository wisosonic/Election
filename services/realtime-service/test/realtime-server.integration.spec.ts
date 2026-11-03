import { randomUUID } from 'crypto';
import { io as ioClient, Socket } from 'socket.io-client';
import { generateSigningKeys, JwtVerifier, signAccessToken, SigningKeys } from '@election/auth';
import { LocalPubSubAdapter } from '@election/pubsub';
import { DomainEvent } from '@election/shared-types';
import { DOMAIN_EVENTS_CHANNEL, RealtimeServer } from '../src/server';

function waitForEvent(socket: Socket, event: string, timeoutMs = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (arg) => {
      clearTimeout(timer);
      resolve(arg);
    });
  });
}

describe('RealtimeServer', () => {
  let keys: SigningKeys;
  let pubsub: LocalPubSubAdapter;
  let server: RealtimeServer;
  let port: number;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    keys = await generateSigningKeys();
    pubsub = new LocalPubSubAdapter();
    const verifier = new JwtVerifier({ jwks: { keys: [keys.publicJwk] } });
    server = new RealtimeServer({ verifier, pubsub });
    port = await server.listen(0);
  });

  afterAll(async () => {
    await server.close();
  });

  afterEach(() => {
    for (const s of sockets.splice(0)) s.disconnect();
  });

  function connect(token?: string): Socket {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      auth: token ? { token } : {},
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  }

  async function hqToken(tenantId: string, role: 'campaign_admin' | 'coordinator' | 'analyst' = 'campaign_admin'): Promise<string> {
    return signAccessToken({ sub: randomUUID(), tenantId, role }, keys.privateKey, keys.kid);
  }

  it('rejects a connection with no token', async () => {
    const socket = connect();
    const err = await waitForEvent(socket, 'connect_error');
    expect(err).toBeInstanceOf(Error);
  });

  it('rejects a connection with a garbage token', async () => {
    const socket = connect('not-a-real-jwt');
    await expect(waitForEvent(socket, 'connect_error')).resolves.toBeInstanceOf(Error);
  });

  it('rejects a delegate-role token -- delegates never use realtime-service', async () => {
    const token = await signAccessToken(
      { sub: 'delegate-1', tenantId: randomUUID(), role: 'delegate', roomIds: ['room-1'] },
      keys.privateKey,
      keys.kid,
    );
    const socket = connect(token);
    const err = (await waitForEvent(socket, 'connect_error')) as Error;
    expect(err.message).toMatch(/delegates/);
  });

  it('accepts a valid HQ token and relays a domain event for that tenant', async () => {
    const tenantId = randomUUID();
    const socket = connect(await hqToken(tenantId));
    await waitForEvent(socket, 'connect');

    const eventPromise = waitForEvent(socket, 'domain-event');
    const event: DomainEvent = { tenantId, kind: 'turnout', payload: { count: 5 }, occurredAt: new Date().toISOString() };
    await pubsub.publish(DOMAIN_EVENTS_CHANNEL, event);

    await expect(eventPromise).resolves.toEqual(event);
  });

  it("never relays another tenant's event -- tenant isolation for the realtime feed", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const socketA = connect(await hqToken(tenantA));
    const socketB = connect(await hqToken(tenantB));
    await Promise.all([waitForEvent(socketA, 'connect'), waitForEvent(socketB, 'connect')]);

    const receivedByA: unknown[] = [];
    const receivedByB: unknown[] = [];
    socketA.on('domain-event', (e) => receivedByA.push(e));
    socketB.on('domain-event', (e) => receivedByB.push(e));

    const eventForA: DomainEvent = { tenantId: tenantA, kind: 'irregularity', payload: {}, occurredAt: new Date().toISOString() };
    await pubsub.publish(DOMAIN_EVENTS_CHANNEL, eventForA);

    await new Promise((r) => setTimeout(r, 150)); // give a hypothetical (wrong) cross-tenant delivery time to arrive
    expect(receivedByA).toEqual([eventForA]);
    expect(receivedByB).toEqual([]);
  });

  it('a coordinator and an analyst (both HQ roles) can also connect', async () => {
    const tenantId = randomUUID();
    const coordinatorSocket = connect(await hqToken(tenantId, 'coordinator'));
    const analystSocket = connect(await hqToken(tenantId, 'analyst'));
    await Promise.all([waitForEvent(coordinatorSocket, 'connect'), waitForEvent(analystSocket, 'connect')]);
    expect(coordinatorSocket.connected).toBe(true);
    expect(analystSocket.connected).toBe(true);
  });
});
