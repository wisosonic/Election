import Redis from 'ioredis';
import { PubSubPort } from './port';

/**
 * Structurally complete Redis pub/sub seam -- the real cross-process
 * mechanism connecting mqtt-ingestion/command-api to realtime-service in
 * production (or local dev via docker-compose.yml). NOT exercised against a
 * real Redis in this environment (none available), same treatment as
 * SqsAdapter/SqsAdapter's siblings in Phase 1.
 *
 * Two separate ioredis clients are required by convention: a connection used
 * for SUBSCRIBE can no longer issue other commands, so PUBLISH needs its own.
 */
export class RedisPubSubAdapter implements PubSubPort {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly handlers = new Map<string, Array<(message: unknown) => void>>();

  constructor(url: string) {
    this.publisher = new Redis(url);
    this.subscriber = new Redis(url);
    this.subscriber.on('message', (channel: string, raw: string) => {
      for (const handler of this.handlers.get(channel) ?? []) {
        handler(JSON.parse(raw));
      }
    });
  }

  async publish(channel: string, message: unknown): Promise<void> {
    await this.publisher.publish(channel, JSON.stringify(message));
  }

  subscribe(channel: string, handler: (message: unknown) => void): void {
    const existing = this.handlers.get(channel);
    if (existing) {
      existing.push(handler);
      return;
    }
    this.handlers.set(channel, [handler]);
    void this.subscriber.subscribe(channel);
  }

  async close(): Promise<void> {
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }
}
