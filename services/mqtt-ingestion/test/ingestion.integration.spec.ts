import { randomUUID } from 'crypto';
import mqtt, { MqttClient } from 'mqtt';
import { eq, and } from 'drizzle-orm';
import { createDb, Db, schema, withTenant } from '@election/db';
import { AedesBrokerAdapter } from '@election/mqtt-broker';
import { LocalQueueAdapter } from '@election/queue';
import { LocalPubSubAdapter } from '@election/pubsub';
import { generateSigningKeys, JwtVerifier, signAccessToken, SigningKeys } from '@election/auth';
import { DOMAIN_EVENTS_CHANNEL, DomainEvent, IngestionEnvelope, roomTopic } from '@election/shared-types';
import { buildAuthenticate, authorizePublish, authorizeSubscribe } from '../src/acl';
import { IngestionService, DeadLetter } from '../src/ingestion.service';

function waitUntil(check: () => Promise<boolean>, timeoutMs = 3000, intervalMs = 25): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await check()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitUntil timed out'));
      setTimeout(tick, intervalMs);
    };
    void tick();
  });
}

function connectAsDelegate(port: number, token: string): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      username: 'device',
      password: token,
      reconnectPeriod: 0,
    });
    client.once('connect', () => resolve(client));
    client.once('error', reject);
  });
}

describe('mqtt-ingestion (integration: Aedes + LocalQueueAdapter + PGlite)', () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  let broker: AedesBrokerAdapter;
  let port: number;
  let keys: SigningKeys;
  let deadLetters: DeadLetter[];
  let pubsub: LocalPubSubAdapter;
  let domainEvents: DomainEvent[];

  let tenantId: string;
  let roomA: string;
  let roomB: string;
  let delegateId: string;
  const deviceId = 'device-under-test';

  beforeAll(async () => {
    ({ db, close: closeDb } = await createDb());
    keys = await generateSigningKeys();

    tenantId = randomUUID();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Test Campaign' });

    const electionId = randomUUID();
    const mohafazatId = randomUUID();
    const qadaId = randomUUID();
    const centerId = randomUUID();
    roomA = randomUUID();
    roomB = randomUUID();
    delegateId = randomUUID();

    await withTenant(db, tenantId, async (tx) => {
      await tx.insert(schema.elections).values({ id: electionId, tenantId, electionDate: '2026-05-15' });
      await tx.insert(schema.mohafazats).values({ id: mohafazatId, tenantId, electionId, name: 'M' });
      await tx.insert(schema.qadas).values({ id: qadaId, tenantId, mohafazatId, name: 'Q' });
      await tx.insert(schema.votingCenters).values({ id: centerId, tenantId, qadaId, name: 'Center' });
      await tx.insert(schema.rooms).values([
        { id: roomA, tenantId, votingCenterId: centerId, label: 'Room A' },
        { id: roomB, tenantId, votingCenterId: centerId, label: 'Room B' },
      ]);
      await tx.insert(schema.users).values({ id: delegateId, tenantId, role: 'delegate', phone: '+96170000000', authMethod: 'otp' });
      await tx.insert(schema.delegateAssignments).values({ id: randomUUID(), tenantId, delegateId, roomId: roomA });
      await tx.insert(schema.deviceCredentials).values({ id: randomUUID(), tenantId, delegateId, deviceId, credentialType: 'token' });
    });

    const verifier = new JwtVerifier({ jwks: { keys: [keys.publicJwk] } });
    broker = new AedesBrokerAdapter(0);
    broker.setAuthenticate(buildAuthenticate(verifier, null));
    broker.setAuthorizePublish(authorizePublish);
    broker.setAuthorizeSubscribe(authorizeSubscribe);

    const queue = new LocalQueueAdapter<IngestionEnvelope>({ maxAttempts: 2 });
    pubsub = new LocalPubSubAdapter();
    domainEvents = [];
    pubsub.subscribe(DOMAIN_EVENTS_CHANNEL, (msg) => domainEvents.push(msg as DomainEvent));

    const ingestion = new IngestionService(broker, queue, db, pubsub);
    deadLetters = [];
    ingestion.onDeadLetter((dl) => deadLetters.push(dl));
    ingestion.start();

    await broker.start();
    port = broker.boundPort;
  });

  afterAll(async () => {
    await broker.stop();
    await closeDb();
  });

  async function tokenFor(roomIds: string[]): Promise<string> {
    return signAccessToken(
      { sub: delegateId, tenantId, role: 'delegate', roomIds, qadaId: null, deviceId },
      keys.privateKey,
      keys.kid,
    );
  }

  it('persists a valid turnout publish end-to-end (broker -> queue -> DB)', async () => {
    const token = await tokenFor([roomA]);
    const client = await connectAsDelegate(port, token);
    const clientUuid = randomUUID();

    const payload = { clientUuid, roomId: roomA, occurredAt: new Date().toISOString(), count: 150 };
    await new Promise<void>((resolve, reject) =>
      client.publish(roomTopic(tenantId, roomA, 'turnout'), JSON.stringify(payload), { qos: 1 }, (err) =>
        err ? reject(err) : resolve(),
      ),
    );

    await waitUntil(async () => {
      const rows = await withTenant(db, tenantId, (tx) => tx.select().from(schema.turnoutEntries).where(eq(schema.turnoutEntries.clientUuid, clientUuid)));
      return rows.length === 1;
    });

    const rows = await withTenant(db, tenantId, (tx) => tx.select().from(schema.turnoutEntries).where(eq(schema.turnoutEntries.clientUuid, clientUuid)));
    expect(rows[0].count).toBe(150);
    expect(rows[0].roomId).toBe(roomA);

    await waitUntil(async () => domainEvents.some((e) => e.kind === 'turnout' && (e.payload as { clientUuid: string }).clientUuid === clientUuid));
    const published = domainEvents.find((e) => e.kind === 'turnout' && (e.payload as { clientUuid: string }).clientUuid === clientUuid)!;
    expect(published.tenantId).toBe(tenantId);

    client.end(true);
  });

  it('publishes a presence domain event on connect and on disconnect', async () => {
    const before = domainEvents.length;
    const token = await tokenFor([roomA]);
    const client = await connectAsDelegate(port, token);

    await waitUntil(async () => domainEvents.slice(before).some((e) => e.kind === 'presence' && (e.payload as { connected: boolean }).connected === true));

    client.end(true);
    await waitUntil(async () => domainEvents.slice(before).some((e) => e.kind === 'presence' && (e.payload as { connected: boolean }).connected === false));
  });

  it('does not create a duplicate row when the same client_uuid is republished (idempotency)', async () => {
    const token = await tokenFor([roomA]);
    const client = await connectAsDelegate(port, token);
    const clientUuid = randomUUID();
    const payload = { clientUuid, roomId: roomA, occurredAt: new Date().toISOString(), count: 10 };

    const publish = () =>
      new Promise<void>((resolve, reject) =>
        client.publish(roomTopic(tenantId, roomA, 'turnout'), JSON.stringify(payload), { qos: 1 }, (err) => (err ? reject(err) : resolve())),
      );

    await publish();
    await waitUntil(async () => {
      const rows = await withTenant(db, tenantId, (tx) => tx.select().from(schema.turnoutEntries).where(eq(schema.turnoutEntries.clientUuid, clientUuid)));
      return rows.length === 1;
    });
    await publish(); // resend -- simulates a QoS-1 redelivery or reconnect resend
    await new Promise((r) => setTimeout(r, 200)); // give a hypothetical (wrong) second insert time to land

    const rows = await withTenant(db, tenantId, (tx) => tx.select().from(schema.turnoutEntries).where(eq(schema.turnoutEntries.clientUuid, clientUuid)));
    expect(rows).toHaveLength(1);
    client.end(true);
  });

  it("rejects a publish to a room the device isn't assigned to (topic ACL enforced at the broker)", async () => {
    const token = await tokenFor([roomA]); // not assigned to roomB
    const client = await connectAsDelegate(port, token);
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));

    const clientUuid = randomUUID();
    client.publish(
      roomTopic(tenantId, roomB, 'turnout'),
      JSON.stringify({ clientUuid, roomId: roomB, occurredAt: new Date().toISOString(), count: 1 }),
      { qos: 1 },
    );
    await closed;

    const rows = await withTenant(db, tenantId, (tx) => tx.select().from(schema.turnoutEntries).where(eq(schema.turnoutEntries.clientUuid, clientUuid)));
    expect(rows).toHaveLength(0);
  });

  it('dead-letters a malformed (non-JSON) payload without persisting anything', async () => {
    const token = await tokenFor([roomA]);
    const client = await connectAsDelegate(port, token);
    const before = deadLetters.length;

    await new Promise<void>((resolve, reject) =>
      client.publish(roomTopic(tenantId, roomA, 'turnout'), 'not valid json{{{', { qos: 1 }, (err) => (err ? reject(err) : resolve())),
    );
    await waitUntil(async () => deadLetters.length > before);

    expect(deadLetters[deadLetters.length - 1].reason).toMatch(/invalid JSON/);
    client.end(true);
  });

  it('dead-letters a payload that fails schema validation (e.g. negative count)', async () => {
    const token = await tokenFor([roomA]);
    const client = await connectAsDelegate(port, token);
    const before = deadLetters.length;
    const clientUuid = randomUUID();

    await new Promise<void>((resolve, reject) =>
      client.publish(
        roomTopic(tenantId, roomA, 'turnout'),
        JSON.stringify({ clientUuid, roomId: roomA, occurredAt: new Date().toISOString(), count: -5 }),
        { qos: 1 },
        (err) => (err ? reject(err) : resolve()),
      ),
    );
    await waitUntil(async () => deadLetters.length > before);

    expect(deadLetters[deadLetters.length - 1].reason).toMatch(/schema validation failed/);
    const rows = await withTenant(db, tenantId, (tx) => tx.select().from(schema.turnoutEntries).where(eq(schema.turnoutEntries.clientUuid, clientUuid)));
    expect(rows).toHaveLength(0);
    client.end(true);
  });

  it('marks the device as connected on connect and disconnected on disconnect (presence, §9)', async () => {
    const token = await tokenFor([roomA]);
    const client = await connectAsDelegate(port, token);

    await waitUntil(async () => {
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx.select().from(schema.deviceCredentials).where(and(eq(schema.deviceCredentials.tenantId, tenantId), eq(schema.deviceCredentials.deviceId, deviceId))),
      );
      return row?.connected === true;
    });

    client.end(true);

    await waitUntil(async () => {
      const [row] = await withTenant(db, tenantId, (tx) =>
        tx.select().from(schema.deviceCredentials).where(and(eq(schema.deviceCredentials.tenantId, tenantId), eq(schema.deviceCredentials.deviceId, deviceId))),
      );
      return row?.connected === false;
    });
  });
});
