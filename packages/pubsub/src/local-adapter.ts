import { EventEmitter } from 'events';
import { PubSubPort } from './port';

/** In-process pub/sub. Only bridges publisher and subscriber when they share
 * a process (true in tests; NOT true for separate `mqtt-ingestion` and
 * `realtime-service` OS processes in a real multi-process run -- that needs
 * RedisPubSubAdapter). */
export class LocalPubSubAdapter implements PubSubPort {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0); // many rooms/tests may subscribe to the same channel
  }

  async publish(channel: string, message: unknown): Promise<void> {
    this.emitter.emit(channel, message);
  }

  subscribe(channel: string, handler: (message: unknown) => void): void {
    this.emitter.on(channel, handler);
  }
}
