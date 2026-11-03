import { createServer, Server } from 'net';
import Aedes, { Client } from 'aedes';
import {
  AuthenticateFn,
  AuthorizeFn,
  ConnectHandler,
  DeviceIdentity,
  DisconnectHandler,
  MqttBrokerPort,
  PublishHandler,
} from './port';

interface ClientWithIdentity extends Client {
  electionIdentity?: DeviceIdentity;
}

export class AedesBrokerAdapter implements MqttBrokerPort {
  private aedes: Aedes;
  private server: Server;
  private authenticateFn: AuthenticateFn = async () => null;
  private authorizePublishFn: AuthorizeFn = () => false;
  private authorizeSubscribeFn: AuthorizeFn = () => false;
  private publishHandlers: PublishHandler[] = [];
  private connectHandlers: ConnectHandler[] = [];
  private disconnectHandlers: DisconnectHandler[] = [];

  constructor(private readonly port: number) {
    this.aedes = new Aedes();
    this.server = createServer(this.aedes.handle);
    this.wireHooks();
  }

  private wireHooks() {
    this.aedes.authenticate = (client, username, password, callback) => {
      this.authenticateFn(client.id, username, password ?? undefined)
        .then((identity) => {
          if (!identity) return callback(null, false);
          (client as ClientWithIdentity).electionIdentity = identity;
          callback(null, true);
          for (const handler of this.connectHandlers) void handler(identity);
        })
        .catch(() => callback(null, false));
    };

    this.aedes.authorizePublish = (client, packet, callback) => {
      const identity = (client as ClientWithIdentity | null)?.electionIdentity;
      if (!identity) return callback(new Error('unauthenticated'));
      Promise.resolve(this.authorizePublishFn(identity, packet.topic))
        .then((allowed) => callback(allowed ? null : new Error(`publish denied: ${packet.topic}`)))
        .catch((err) => callback(err as Error));
    };

    this.aedes.authorizeSubscribe = (client, sub, callback) => {
      const identity = (client as ClientWithIdentity | null)?.electionIdentity;
      if (!identity) return callback(new Error('unauthenticated'), null);
      Promise.resolve(this.authorizeSubscribeFn(identity, sub.topic))
        .then((allowed) => callback(null, allowed ? sub : null))
        .catch((err) => callback(err as Error, null));
    };

    this.aedes.on('publish', (packet, client) => {
      if (!client) return; // broker-internal publishes (e.g. our own `publish()` calls) aren't re-dispatched
      const identity = (client as ClientWithIdentity).electionIdentity;
      if (!identity) return;
      for (const handler of this.publishHandlers) {
        void handler(packet.topic, packet.payload as Buffer, identity);
      }
    });

    this.aedes.on('clientDisconnect', (client) => {
      const identity = (client as ClientWithIdentity).electionIdentity ?? null;
      for (const handler of this.disconnectHandlers) {
        void handler(identity);
      }
    });
  }

  setAuthenticate(fn: AuthenticateFn): void {
    this.authenticateFn = fn;
  }

  setAuthorizePublish(fn: AuthorizeFn): void {
    this.authorizePublishFn = fn;
  }

  setAuthorizeSubscribe(fn: AuthorizeFn): void {
    this.authorizeSubscribeFn = fn;
  }

  onPublish(handler: PublishHandler): void {
    this.publishHandlers.push(handler);
  }

  onClientConnect(handler: ConnectHandler): void {
    this.connectHandlers.push(handler);
  }

  onClientDisconnect(handler: DisconnectHandler): void {
    this.disconnectHandlers.push(handler);
  }

  start(): Promise<void> {
    return new Promise((resolve) => this.server.listen(this.port, () => resolve()));
  }

  /** The actual bound port -- useful when constructed with port 0 (OS-assigned), as tests do. */
  get boundPort(): number {
    const addr = this.server.address();
    if (addr && typeof addr === 'object') return addr.port;
    return this.port;
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
      this.aedes.close();
    });
  }

  publish(topic: string, payload: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.aedes.publish({ topic, payload, qos: 1, retain: true, cmd: 'publish', dup: false }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }
}
