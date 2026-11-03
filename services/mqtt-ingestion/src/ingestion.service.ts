import { MqttBrokerPort } from '@election/mqtt-broker';
import { QueuePort } from '@election/queue';
import { PubSubPort } from '@election/pubsub';
import { Db } from '@election/db';
import { DOMAIN_EVENTS_CHANNEL, DomainEvent, IngestionEnvelope, PAYLOAD_SCHEMAS, PublishableTopicKind, parseTopic } from '@election/shared-types';
import { markDeviceConnected, markDeviceDisconnected, persistEnvelope } from './persist';
import { isServiceIdentity } from './acl';

export interface DeadLetter {
  reason: string;
  topic?: string;
  raw?: string;
}

/**
 * Wires the MQTT broker to the durable queue to the database -- the
 * "ingestion" of ARCHITECTURE.md §5.1. Deliberately plain TypeScript, not a
 * NestJS module: there's no HTTP surface here, and the DI ceremony would add
 * nothing a worker process needs.
 */
export class IngestionService {
  private readonly deadLetterHandlers: Array<(dl: DeadLetter) => void> = [];

  constructor(
    private readonly broker: MqttBrokerPort,
    private readonly queue: QueuePort<IngestionEnvelope>,
    private readonly db: Db,
    private readonly pubsub: PubSubPort,
  ) {}

  onDeadLetter(handler: (dl: DeadLetter) => void): void {
    this.deadLetterHandlers.push(handler);
  }

  private deadLetter(dl: DeadLetter): void {
    for (const handler of this.deadLetterHandlers) handler(dl);
  }

  start(): void {
    this.broker.onPublish((topic, payload, identity) => {
      if (isServiceIdentity(identity)) return; // the broadcast publisher's own publishes aren't ingestable data

      const parsed = parseTopic(topic);
      if (!parsed || parsed.scope !== 'room' || parsed.kind === 'broadcast') {
        this.deadLetter({ reason: 'unexpected topic shape reached ingestion', topic });
        return;
      }

      const kind = parsed.kind as PublishableTopicKind;
      const payloadSchema = PAYLOAD_SCHEMAS[kind];
      let json: unknown;
      try {
        json = JSON.parse(payload.toString('utf8'));
      } catch {
        this.deadLetter({ reason: 'invalid JSON payload', topic, raw: payload.toString('utf8') });
        return;
      }

      const result = payloadSchema.safeParse(json);
      if (!result.success) {
        this.deadLetter({ reason: `schema validation failed: ${result.error.message}`, topic });
        return;
      }

      const envelope: IngestionEnvelope = {
        tenantId: parsed.tenantId,
        roomId: parsed.roomId,
        kind,
        deviceId: identity.deviceId,
        delegateId: identity.delegateId,
        payload: result.data,
        receivedAt: new Date().toISOString(),
      };
      void this.queue.publish(envelope);
    });

    this.broker.onClientConnect((identity) => {
      if (isServiceIdentity(identity)) return;
      void markDeviceConnected(this.db, identity.tenantId, identity.deviceId);
      void this.publishDomainEvent(identity.tenantId, 'presence', { deviceId: identity.deviceId, delegateId: identity.delegateId, connected: true });
    });

    this.broker.onClientDisconnect((identity) => {
      if (!identity || isServiceIdentity(identity)) return;
      void markDeviceDisconnected(this.db, identity.tenantId, identity.deviceId);
      void this.publishDomainEvent(identity.tenantId, 'presence', { deviceId: identity.deviceId, delegateId: identity.delegateId, connected: false });
    });

    this.queue.onDeadLetter((msg, error) => {
      this.deadLetter({ reason: `persist failed after retries: ${error.message}` });
    });

    this.queue.consume(async (msg) => {
      await persistEnvelope(this.db, msg.body);
      await this.publishDomainEvent(msg.body.tenantId, msg.body.kind, msg.body.payload);
    });
  }

  /** ARCHITECTURE.md §5.3: fed to realtime-service, which relays to dashboards
   * scoped to this tenantId. Best-effort -- a pub/sub failure shouldn't roll
   * back or block persistence, which has already succeeded by this point. */
  private async publishDomainEvent(tenantId: string, kind: DomainEvent['kind'], payload: unknown): Promise<void> {
    const event: DomainEvent = { tenantId, kind, payload, occurredAt: new Date().toISOString() };
    await this.pubsub.publish(DOMAIN_EVENTS_CHANNEL, event).catch(() => undefined);
  }
}
