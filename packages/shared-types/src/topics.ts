export type RoomTopicKind = 'turnout' | 'tally' | 'irregularity' | 'voter-checkin' | 'messages/out' | 'broadcast';

export function roomTopic(tenantId: string, roomId: string, kind: RoomTopicKind): string {
  return `tenants/${tenantId}/rooms/${roomId}/${kind}`;
}

export function qadaBroadcastTopic(tenantId: string, qadaId: string): string {
  return `tenants/${tenantId}/qadas/${qadaId}/broadcast`;
}

const ROOM_TOPIC_RE = /^tenants\/([^/]+)\/rooms\/([^/]+)\/(turnout|tally|irregularity|voter-checkin|messages\/out|broadcast)$/;
const QADA_BROADCAST_RE = /^tenants\/([^/]+)\/qadas\/([^/]+)\/broadcast$/;

export interface ParsedRoomTopic {
  scope: 'room';
  tenantId: string;
  roomId: string;
  kind: RoomTopicKind;
}

export interface ParsedQadaTopic {
  scope: 'qada';
  tenantId: string;
  qadaId: string;
}

/** Parses a topic string, returning null if it doesn't match either known shape.
 * Used by mqtt-ingestion's ACL check -- it must be able to tell what a device is
 * trying to touch before deciding whether that device is allowed to. */
export function parseTopic(topic: string): ParsedRoomTopic | ParsedQadaTopic | null {
  const roomMatch = topic.match(ROOM_TOPIC_RE);
  if (roomMatch) {
    return { scope: 'room', tenantId: roomMatch[1], roomId: roomMatch[2], kind: roomMatch[3] as RoomTopicKind };
  }
  const qadaMatch = topic.match(QADA_BROADCAST_RE);
  if (qadaMatch) {
    return { scope: 'qada', tenantId: qadaMatch[1], qadaId: qadaMatch[2] };
  }
  return null;
}
