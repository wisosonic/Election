import { DeviceIdentity } from '@election/mqtt-broker';
import { AccessTokenClaims, JwtVerifier } from '@election/auth';
import { parseTopic } from '@election/shared-types';

/** A trusted service credential (e.g. command-api's broadcast publisher) --
 * not tied to a single tenant/room, used only to publish HQ broadcasts down
 * onto delegate-facing topics. In production this would instead be a
 * distinct AWS IoT policy/principal; here it's a shared-secret check. */
const SERVICE_TENANT_MARKER = '*';

export function isServiceIdentity(identity: DeviceIdentity): boolean {
  return identity.tenantId === SERVICE_TENANT_MARKER;
}

export function buildAuthenticate(
  verifier: JwtVerifier,
  serviceCredential: { username: string; password: string } | null,
) {
  return async (
    clientId: string,
    username: string | undefined,
    password: Buffer | undefined,
  ): Promise<DeviceIdentity | null> => {
    if (serviceCredential && username === serviceCredential.username && password?.toString() === serviceCredential.password) {
      return { deviceId: `service:${clientId}`, delegateId: 'service', tenantId: SERVICE_TENANT_MARKER, roomIds: [], qadaId: null };
    }
    try {
      const claims: AccessTokenClaims = await verifier.verify(password?.toString() ?? '');
      if (claims.role !== 'delegate') return null; // only delegate devices connect to the broker directly
      return {
        deviceId: claims.deviceId ?? clientId,
        delegateId: claims.sub,
        tenantId: claims.tenantId,
        roomIds: claims.roomIds ?? [],
        qadaId: claims.qadaId ?? null,
      };
    } catch {
      return null;
    }
  };
}

/** A delegate device may only publish its own kind-topics for a room it's
 * assigned to -- never a broadcast topic (that's HQ -> delegate only). The
 * service credential may publish to any broadcast topic (§9). */
export function authorizePublish(identity: DeviceIdentity, topic: string): boolean {
  if (isServiceIdentity(identity)) {
    const parsed = parseTopic(topic);
    return !!parsed && (parsed.scope === 'qada' || (parsed.scope === 'room' && parsed.kind === 'broadcast'));
  }
  const parsed = parseTopic(topic);
  if (!parsed || parsed.tenantId !== identity.tenantId) return false;
  if (parsed.scope !== 'room' || parsed.kind === 'broadcast') return false;
  return identity.roomIds.includes(parsed.roomId);
}

/** A delegate device may only subscribe to its own room's/qada's broadcast
 * topic -- never anything else, and never another room's. */
export function authorizeSubscribe(identity: DeviceIdentity, topic: string): boolean {
  if (isServiceIdentity(identity)) return false; // the service publisher never needs to subscribe
  const parsed = parseTopic(topic);
  if (!parsed || parsed.tenantId !== identity.tenantId) return false;
  if (parsed.scope === 'room') return parsed.kind === 'broadcast' && identity.roomIds.includes(parsed.roomId);
  if (parsed.scope === 'qada') return parsed.qadaId === identity.qadaId;
  return false;
}
