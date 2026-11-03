import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DOMAIN_EVENTS_CHANNEL, qadaBroadcastTopic, roomTopic } from '@election/shared-types';
import { Db, schema, withTenant } from '@election/db';
import { PubSubPort } from '@election/pubsub';
import { DB } from '../db.provider';
import { PUBSUB } from '../pubsub.provider';
import { BROADCAST_PUBLISHER, BroadcastPublisherPort } from './broadcast-publisher.port';

@Injectable()
export class MessagesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(BROADCAST_PUBLISHER) private readonly publisher: BroadcastPublisherPort,
    @Inject(PUBSUB) private readonly pubsub: PubSubPort,
  ) {}

  /** Broadcasts to every delegate in one room, or every delegate in a qada
   * (§5.2/§9) -- published as a retained MQTT message so a delegate who's
   * offline right now still gets it the moment they reconnect (§4.2). */
  async broadcast(
    tenantId: string,
    fromUserId: string,
    scope: { roomId: string } | { qadaId: string },
    body: string,
  ): Promise<{ id: string }> {
    const id = randomUUID();
    const threadId = randomUUID();
    const toRef = 'roomId' in scope ? scope.roomId : scope.qadaId;
    const toType = 'roomId' in scope ? 'broadcast_room' : 'broadcast_qada';

    await withTenant(this.db, tenantId, (tx) =>
      tx.insert(schema.messages).values({ id, tenantId, threadId, fromUserId, toType, toRef, body }),
    );

    const topic = 'roomId' in scope ? roomTopic(tenantId, scope.roomId, 'broadcast') : qadaBroadcastTopic(tenantId, scope.qadaId);
    await this.publisher.publish(topic, Buffer.from(JSON.stringify({ id, threadId, body })));

    // So HQ's own live dashboard feed shows a broadcast the moment it's sent,
    // not just the delegates on the receiving end (§5.3).
    await this.pubsub
      .publish(DOMAIN_EVENTS_CHANNEL, { tenantId, kind: 'broadcast', payload: { id, threadId, scope, body }, occurredAt: new Date().toISOString() })
      .catch(() => undefined);

    return { id };
  }

  threadForRoom(tenantId: string, roomId: string) {
    return withTenant(this.db, tenantId, (tx) => tx.select().from(schema.messages).where(eq(schema.messages.toRef, roomId)));
  }
}
