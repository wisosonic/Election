import { randomUUID } from 'crypto';
import { roomTopic, qadaBroadcastTopic, parseTopic } from '../src/topics';
import { turnoutPayloadSchema, tallyPayloadSchema, irregularityPayloadSchema } from '../src/payloads';

describe('topic scheme', () => {
  it('round-trips a room topic', () => {
    const tenantId = randomUUID();
    const roomId = randomUUID();
    const topic = roomTopic(tenantId, roomId, 'turnout');
    expect(parseTopic(topic)).toEqual({ scope: 'room', tenantId, roomId, kind: 'turnout' });
  });

  it('round-trips a qada broadcast topic', () => {
    const tenantId = randomUUID();
    const qadaId = randomUUID();
    const topic = qadaBroadcastTopic(tenantId, qadaId);
    expect(parseTopic(topic)).toEqual({ scope: 'qada', tenantId, qadaId });
  });

  it('rejects a malformed topic', () => {
    expect(parseTopic('not/a/known/shape')).toBeNull();
  });

  it('handles the messages/out topic (kind itself contains a slash)', () => {
    const tenantId = randomUUID();
    const roomId = randomUUID();
    const topic = roomTopic(tenantId, roomId, 'messages/out');
    expect(parseTopic(topic)).toEqual({ scope: 'room', tenantId, roomId, kind: 'messages/out' });
  });
});

describe('payload schemas', () => {
  it('accepts a valid turnout payload', () => {
    const result = turnoutPayloadSchema.safeParse({
      clientUuid: randomUUID(),
      roomId: randomUUID(),
      occurredAt: new Date().toISOString(),
      count: 120,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative count', () => {
    const result = turnoutPayloadSchema.safeParse({
      clientUuid: randomUUID(),
      roomId: randomUUID(),
      occurredAt: new Date().toISOString(),
      count: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a tally payload with an invalid severity-like extra field but requires candidateListId', () => {
    const result = tallyPayloadSchema.safeParse({
      clientUuid: randomUUID(),
      roomId: randomUUID(),
      count: 10,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an irregularity with an unknown severity', () => {
    const result = irregularityPayloadSchema.safeParse({
      clientUuid: randomUUID(),
      roomId: randomUUID(),
      category: 'ballot_box',
      severity: 'catastrophic',
    });
    expect(result.success).toBe(false);
  });
});
