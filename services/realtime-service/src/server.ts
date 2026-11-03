import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { Server as SocketIOServer } from 'socket.io';
import { JwtVerifier } from '@election/auth';
import { PubSubPort } from '@election/pubsub';
import { DOMAIN_EVENTS_CHANNEL, DomainEvent } from '@election/shared-types';

export { DOMAIN_EVENTS_CHANNEL };

export interface RealtimeServerOptions {
  verifier: JwtVerifier;
  pubsub: PubSubPort;
}

/**
 * ARCHITECTURE.md §5.3: fans out domain events (published by mqtt-ingestion
 * and command-api after persisting) to HQ dashboards over Socket.IO, scoped
 * per-tenant. Delegates never connect here -- they only ever talk to the MQTT
 * broker. Constructible with injected dependencies so tests exercise the real
 * auth/relay logic without any network dependency beyond the sockets
 * themselves (a static JWKS stands in for a running identity-service; a
 * LocalPubSubAdapter stands in for Redis).
 */
export class RealtimeServer {
  readonly http: HttpServer;
  readonly io: SocketIOServer;

  constructor(private readonly opts: RealtimeServerOptions) {
    this.http = createServer();
    this.io = new SocketIOServer(this.http, { cors: { origin: '*' } });
    this.wireAuth();
    this.wireRelay();
  }

  private wireAuth(): void {
    this.io.use((socket, next) => {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) {
        next(new Error('missing token'));
        return;
      }
      this.opts.verifier
        .verify(token)
        .then((claims) => {
          if (claims.role === 'delegate') {
            next(new Error('delegates do not connect to realtime-service'));
            return;
          }
          socket.data.claims = claims;
          next();
        })
        .catch(() => next(new Error('invalid or expired token')));
    });

    this.io.on('connection', (socket) => {
      const claims = socket.data.claims as { tenantId: string };
      void socket.join(tenantRoom(claims.tenantId));
    });
  }

  private wireRelay(): void {
    this.opts.pubsub.subscribe(DOMAIN_EVENTS_CHANNEL, (message) => {
      const event = message as DomainEvent;
      this.io.to(tenantRoom(event.tenantId)).emit('domain-event', event);
    });
  }

  /** Starts listening; resolves with the actual bound port (useful for `listen(0)` in tests). */
  listen(port: number): Promise<number> {
    return new Promise((resolve) => {
      this.http.listen(port, () => resolve((this.http.address() as AddressInfo).port));
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.io.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}
