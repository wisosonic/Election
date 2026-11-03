import { z } from 'zod';

const base = {
  clientUuid: z.string().uuid(),
  roomId: z.string().uuid(),
};

export const turnoutPayloadSchema = z.object({
  ...base,
  occurredAt: z.string().datetime(),
  count: z.number().int().nonnegative(),
});
export type TurnoutPayload = z.infer<typeof turnoutPayloadSchema>;

export const tallyPayloadSchema = z.object({
  ...base,
  candidateListId: z.string().min(1),
  count: z.number().int().nonnegative(),
  coConfirmedBy: z.string().uuid().nullish(),
  officialTallyPhotoRef: z.string().nullish(),
});
export type TallyPayload = z.infer<typeof tallyPayloadSchema>;

export const irregularityPayloadSchema = z.object({
  ...base,
  category: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
  description: z.string().nullish(),
  mediaRefs: z.array(z.string()).nullish(),
});
export type IrregularityPayload = z.infer<typeof irregularityPayloadSchema>;

export const voterCheckinPayloadSchema = z.object({
  ...base,
  voterRecordId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  reverted: z.boolean().optional().default(false),
});
export type VoterCheckinPayload = z.infer<typeof voterCheckinPayloadSchema>;

export const messageOutPayloadSchema = z.object({
  clientUuid: z.string().uuid().nullish(),
  roomId: z.string().uuid(),
  threadId: z.string().uuid(),
  body: z.string().min(1),
});
export type MessageOutPayload = z.infer<typeof messageOutPayloadSchema>;

export const PAYLOAD_SCHEMAS = {
  turnout: turnoutPayloadSchema,
  tally: tallyPayloadSchema,
  irregularity: irregularityPayloadSchema,
  'voter-checkin': voterCheckinPayloadSchema,
  'messages/out': messageOutPayloadSchema,
} as const;

export type PublishableTopicKind = keyof typeof PAYLOAD_SCHEMAS;

/** The envelope mqtt-ingestion pushes onto the queue -- identifies who/what/where
 * a raw MQTT publish was, alongside its already-validated payload. */
export interface IngestionEnvelope {
  tenantId: string;
  roomId: string;
  kind: PublishableTopicKind;
  deviceId: string;
  delegateId: string;
  payload: unknown;
  receivedAt: string;
}

/** The single pub/sub channel mqtt-ingestion/command-api publish domain events
 * on, and realtime-service subscribes to (§5.3). One shared constant so every
 * process agrees on the name without depending on each other's packages. */
export const DOMAIN_EVENTS_CHANNEL = 'domain-events';

export type DomainEventKind = PublishableTopicKind | 'presence' | 'broadcast';

/** What mqtt-ingestion/command-api publish on the `domain-events` pub/sub
 * channel (ARCHITECTURE.md §5.3) after persisting -- realtime-service relays
 * these to dashboards scoped to `tenantId`, never across tenants. */
export interface DomainEvent {
  tenantId: string;
  kind: DomainEventKind;
  payload: unknown;
  occurredAt: string;
}
