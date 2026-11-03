import mqtt, { MqttClient } from 'mqtt';
import { AedesBrokerAdapter } from '../src/aedes-adapter';
import { DeviceIdentity } from '../src/port';

const IDENTITIES: Record<string, DeviceIdentity> = {
  'delegate-1': { deviceId: 'device-1', delegateId: 'delegate-1', tenantId: 'tenant-a', roomIds: ['room-1'], qadaId: 'qada-1' },
  'delegate-2': { deviceId: 'device-2', delegateId: 'delegate-2', tenantId: 'tenant-a', roomIds: ['room-2'], qadaId: 'qada-1' },
};

function connectAs(port: number, username: string): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      username,
      password: 'irrelevant-in-this-test',
      reconnectPeriod: 0, // don't let a denied/dropped connection auto-reconnect and leak timers past the test
    });
    client.once('connect', () => resolve(client));
    client.once('error', reject);
  });
}

describe('AedesBrokerAdapter', () => {
  let adapter: AedesBrokerAdapter;
  let port: number;

  beforeEach(async () => {
    adapter = new AedesBrokerAdapter(0);
    adapter.setAuthenticate(async (_clientId, username) => (username ? IDENTITIES[username] ?? null : null));
    adapter.setAuthorizePublish((identity, topic) => topic === `room/${identity.roomIds[0]}/data`);
    adapter.setAuthorizeSubscribe((identity, topic) => topic === `room/${identity.roomIds[0]}/broadcast`);
    await adapter.start();
    port = adapter.boundPort;
  });

  afterEach(async () => {
    await adapter.stop();
  });

  it('rejects a connection with an unknown credential', async () => {
    await expect(connectAs(port, 'nobody')).rejects.toBeDefined();
  });

  it('lets an authenticated device publish to its own room topic', async () => {
    const client = await connectAs(port, 'delegate-1');
    const received: string[] = [];
    adapter.onPublish((topic) => {
      received.push(topic);
    });

    await new Promise<void>((resolve, reject) => {
      client.publish('room/room-1/data', 'hello', { qos: 1 }, (err) => (err ? reject(err) : resolve()));
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toContain('room/room-1/data');
    client.end(true);
  });

  it('rejects a publish to a room the device is not assigned to (topic ACL)', async () => {
    // Aedes has no "denied" PUBACK -- an authorizePublish rejection makes it
    // close the connection outright (see aedes/lib/client.js:onError), so the
    // observable effect of a denied publish is the connection dropping rather
    // than an application-level error being handed back to the publisher.
    const client = await connectAs(port, 'delegate-1'); // assigned to room-1 only
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    client.publish('room/room-2/data', 'hello', { qos: 1 });
    await closed;
  });

  it('rejects a subscribe to another room\'s broadcast topic', async () => {
    const client = await connectAs(port, 'delegate-1');
    // mqtt.js treats a granted qos of 128 (0x80, "failure") as a subscribe error
    // rather than a successful grant, so a denied ACL surfaces as a rejection.
    await expect(
      new Promise((resolve, reject) => {
        client.subscribe('room/room-2/broadcast', { qos: 1 }, (err, granted) => (err ? reject(err) : resolve(granted)));
      }),
    ).rejects.toThrow();
    client.end(true);
  });

  it('allows a subscribe to the device\'s own broadcast topic', async () => {
    const client = await connectAs(port, 'delegate-1');
    const granted = await new Promise<number>((resolve, reject) => {
      client.subscribe('room/room-1/broadcast', { qos: 1 }, (err, granted) => {
        if (err) return reject(err);
        resolve(granted?.[0]?.qos ?? 128);
      });
    });
    expect(granted).toBe(1);
    client.end(true);
  });

  it('fires onClientConnect right after successful authentication', async () => {
    const connected = new Promise<string>((resolve) => {
      adapter.onClientConnect((identity) => resolve(identity.deviceId));
    });
    const client = await connectAs(port, 'delegate-1');
    await expect(connected).resolves.toBe('device-1');
    client.end(true);
  });

  it('fires onClientDisconnect when a client disconnects', async () => {
    const client = await connectAs(port, 'delegate-2');
    const disconnected = new Promise<string | undefined>((resolve) => {
      adapter.onClientDisconnect((identity) => resolve(identity?.deviceId));
    });
    client.end(true);
    await expect(disconnected).resolves.toBe('device-2');
  });
});
