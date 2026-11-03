import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { Db, schema, withTenant } from '@election/db';
import {
  IngestionEnvelope,
  IrregularityPayload,
  MessageOutPayload,
  TallyPayload,
  TurnoutPayload,
  VoterCheckinPayload,
} from '@election/shared-types';

/** Persists one already-validated envelope. Idempotent: each table's unique
 * (tenant_id, client_uuid) constraint means a QoS-1 redelivery or a
 * reconnect-triggered resend (§4.2) is a silent no-op here, never a duplicate row. */
export async function persistEnvelope(db: Db, envelope: IngestionEnvelope): Promise<void> {
  await withTenant(db, envelope.tenantId, async (tx) => {
    switch (envelope.kind) {
      case 'turnout': {
        const p = envelope.payload as TurnoutPayload;
        await tx
          .insert(schema.turnoutEntries)
          .values({
            id: randomUUID(),
            tenantId: envelope.tenantId,
            roomId: envelope.roomId,
            occurredAt: new Date(p.occurredAt),
            count: p.count,
            submittedBy: envelope.delegateId,
            clientUuid: p.clientUuid,
          })
          .onConflictDoNothing({ target: [schema.turnoutEntries.tenantId, schema.turnoutEntries.clientUuid] });
        return;
      }
      case 'tally': {
        const p = envelope.payload as TallyPayload;
        await tx
          .insert(schema.tallyEntries)
          .values({
            id: randomUUID(),
            tenantId: envelope.tenantId,
            roomId: envelope.roomId,
            candidateListId: p.candidateListId,
            count: p.count,
            submittedBy: envelope.delegateId,
            coConfirmedBy: p.coConfirmedBy ?? null,
            officialTallyPhotoRef: p.officialTallyPhotoRef ?? null,
            clientUuid: p.clientUuid,
          })
          .onConflictDoNothing({ target: [schema.tallyEntries.tenantId, schema.tallyEntries.clientUuid] });
        return;
      }
      case 'irregularity': {
        const p = envelope.payload as IrregularityPayload;
        await tx
          .insert(schema.irregularities)
          .values({
            id: randomUUID(),
            tenantId: envelope.tenantId,
            roomId: envelope.roomId,
            category: p.category,
            severity: p.severity,
            description: p.description ?? null,
            mediaRefs: p.mediaRefs ?? null,
            clientUuid: p.clientUuid,
          })
          .onConflictDoNothing({ target: [schema.irregularities.tenantId, schema.irregularities.clientUuid] });
        return;
      }
      case 'voter-checkin': {
        const p = envelope.payload as VoterCheckinPayload;
        await tx
          .insert(schema.voterCheckins)
          .values({
            id: randomUUID(),
            tenantId: envelope.tenantId,
            voterRecordId: p.voterRecordId,
            roomId: envelope.roomId,
            checkedInBy: envelope.delegateId,
            occurredAt: new Date(p.occurredAt),
            clientUuid: p.clientUuid,
            reverted: p.reverted,
          })
          .onConflictDoNothing({ target: [schema.voterCheckins.tenantId, schema.voterCheckins.clientUuid] });
        return;
      }
      case 'messages/out': {
        const p = envelope.payload as MessageOutPayload;
        await tx
          .insert(schema.messages)
          .values({
            id: randomUUID(),
            tenantId: envelope.tenantId,
            threadId: p.threadId,
            fromUserId: envelope.delegateId,
            toType: 'user',
            toRef: 'hq',
            body: p.body,
            clientUuid: p.clientUuid ?? null,
          })
          .onConflictDoNothing({ target: [schema.messages.tenantId, schema.messages.clientUuid] });
      }
    }
  });
}

/** §9 presence: broker connection state, updated on connect/disconnect. Not
 * routed through the durable queue -- it's an operational signal, not
 * append-only election data. */
export async function markDeviceConnected(db: Db, tenantId: string, deviceId: string): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    tx
      .update(schema.deviceCredentials)
      .set({ connected: true, lastSeenAt: new Date() })
      .where(and(eq(schema.deviceCredentials.tenantId, tenantId), eq(schema.deviceCredentials.deviceId, deviceId))),
  );
}

export async function markDeviceDisconnected(db: Db, tenantId: string, deviceId: string): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    tx
      .update(schema.deviceCredentials)
      .set({ connected: false, lastSeenAt: new Date() })
      .where(and(eq(schema.deviceCredentials.tenantId, tenantId), eq(schema.deviceCredentials.deviceId, deviceId))),
  );
}
