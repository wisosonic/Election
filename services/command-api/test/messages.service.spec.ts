import { randomUUID } from 'crypto';
import { createDb, Db, schema, withTenant } from '@election/db';
import { LocalPubSubAdapter } from '@election/pubsub';
import { DOMAIN_EVENTS_CHANNEL, DomainEvent } from '@election/shared-types';
import { MessagesService } from '../src/messages/messages.service';
import { BroadcastPublisherPort } from '../src/messages/broadcast-publisher.port';

class CapturingPublisher implements BroadcastPublisherPort {
  published: { topic: string; payload: Buffer }[] = [];
  async publish(topic: string, payload: Buffer): Promise<void> {
    this.published.push({ topic, payload });
  }
}

describe('MessagesService', () => {
  let db: Db;
  let close: () => Promise<void>;
  let tenantId: string;
  let roomId: string;
  let userId: string;
  let mqttPublisher: CapturingPublisher;
  let pubsub: LocalPubSubAdapter;
  let messages: MessagesService;
  let domainEvents: DomainEvent[];

  beforeAll(async () => {
    ({ db, close } = await createDb());
    tenantId = randomUUID();
    roomId = randomUUID();
    userId = randomUUID();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Test Campaign' });

    const electionId = randomUUID();
    const mohafazatId = randomUUID();
    const qadaId = randomUUID();
    const centerId = randomUUID();
    await withTenant(db, tenantId, async (tx) => {
      await tx.insert(schema.elections).values({ id: electionId, tenantId, electionDate: '2026-05-15' });
      await tx.insert(schema.mohafazats).values({ id: mohafazatId, tenantId, electionId, name: 'M' });
      await tx.insert(schema.qadas).values({ id: qadaId, tenantId, mohafazatId, name: 'Q' });
      await tx.insert(schema.votingCenters).values({ id: centerId, tenantId, qadaId, name: 'Center' });
      await tx.insert(schema.rooms).values({ id: roomId, tenantId, votingCenterId: centerId, label: 'Room 1' });
      await tx.insert(schema.users).values({ id: userId, tenantId, role: 'campaign_admin', email: 'a@test.example', authMethod: 'password_totp' });
    });

    mqttPublisher = new CapturingPublisher();
    pubsub = new LocalPubSubAdapter();
    domainEvents = [];
    pubsub.subscribe(DOMAIN_EVENTS_CHANNEL, (msg) => domainEvents.push(msg as DomainEvent));
    messages = new MessagesService(db, mqttPublisher, pubsub);
  });

  afterAll(async () => {
    await close();
  });

  it('persists the message, publishes it over MQTT, and emits a domain event for the live dashboard feed', async () => {
    await messages.broadcast(tenantId, userId, { roomId }, 'Polls open in 10 minutes');

    const rows = await withTenant(db, tenantId, (tx) => tx.select().from(schema.messages));
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe('Polls open in 10 minutes');

    expect(mqttPublisher.published).toHaveLength(1);
    expect(mqttPublisher.published[0].topic).toContain(roomId);

    expect(domainEvents).toHaveLength(1);
    expect(domainEvents[0].tenantId).toBe(tenantId);
    expect(domainEvents[0].kind).toBe('broadcast');
  });
});
