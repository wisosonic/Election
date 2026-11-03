import { Provider } from '@nestjs/common';
import { LocalPubSubAdapter, PubSubPort, RedisPubSubAdapter } from '@election/pubsub';

export const PUBSUB = Symbol('PUBSUB');

/** Same caveat as mqtt-ingestion's and realtime-service's main.ts: the
 * LocalPubSubAdapter fallback only bridges a same-process subscriber, so it
 * cannot actually reach a separately-run realtime-service in this
 * environment. Set REDIS_URL for real cross-process delivery. */
export const pubsubProvider: Provider = {
  provide: PUBSUB,
  useFactory: (): PubSubPort => (process.env.REDIS_URL ? new RedisPubSubAdapter(process.env.REDIS_URL) : new LocalPubSubAdapter()),
};
