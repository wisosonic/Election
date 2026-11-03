import { createDb } from '@election/db';
import { AedesBrokerAdapter } from '@election/mqtt-broker';
import { LocalQueueAdapter } from '@election/queue';
import { LocalPubSubAdapter, PubSubPort, RedisPubSubAdapter } from '@election/pubsub';
import { JwtVerifier } from '@election/auth';
import { IngestionEnvelope } from '@election/shared-types';
import { buildAuthenticate, authorizePublish, authorizeSubscribe } from './acl';
import { IngestionService } from './ingestion.service';

async function bootstrap() {
  const { db } = await createDb(process.env.DATABASE_URL);

  const jwksUrl = process.env.IDENTITY_JWKS_URL ?? 'http://localhost:3001/.well-known/jwks.json';
  const verifier = new JwtVerifier({ jwksUrl });

  const serviceCredential =
    process.env.MQTT_SERVICE_USERNAME && process.env.MQTT_SERVICE_PASSWORD
      ? { username: process.env.MQTT_SERVICE_USERNAME, password: process.env.MQTT_SERVICE_PASSWORD }
      : null;

  const broker = new AedesBrokerAdapter(process.env.MQTT_PORT ? Number(process.env.MQTT_PORT) : 1883);
  broker.setAuthenticate(buildAuthenticate(verifier, serviceCredential));
  broker.setAuthorizePublish(authorizePublish);
  broker.setAuthorizeSubscribe(authorizeSubscribe);

  // Local, in-process queue -- the production seam is @election/queue's SqsAdapter,
  // fed by AWS IoT Core's Rule Engine (§5.1/§10); not wired to a real AWS account here.
  const queue = new LocalQueueAdapter<IngestionEnvelope>({ maxAttempts: 5 });

  // NOTE: same caveat as realtime-service's main.ts -- LocalPubSubAdapter only
  // bridges a same-process publisher/subscriber, so it does NOT actually reach
  // a separately-run realtime-service process. Set REDIS_URL for that.
  const pubsub: PubSubPort = process.env.REDIS_URL ? new RedisPubSubAdapter(process.env.REDIS_URL) : new LocalPubSubAdapter();

  const ingestion = new IngestionService(broker, queue, db, pubsub);
  ingestion.onDeadLetter((dl) => {
    // eslint-disable-next-line no-console
    console.warn('[dead-letter]', dl);
  });
  ingestion.start();

  await broker.start();
  // eslint-disable-next-line no-console
  console.log(`mqtt-ingestion broker listening on :${broker.boundPort}`);
}

void bootstrap();
