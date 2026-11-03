import { JwtVerifier } from '@election/auth';
import { LocalPubSubAdapter, PubSubPort, RedisPubSubAdapter } from '@election/pubsub';
import { RealtimeServer } from './server';

async function bootstrap() {
  const jwksUrl = process.env.IDENTITY_JWKS_URL ?? 'http://localhost:3001/.well-known/jwks.json';
  const verifier = new JwtVerifier({ jwksUrl });

  // NOTE: LocalPubSubAdapter only bridges publisher and subscriber within the
  // same process -- it will NOT connect this process to a separate
  // mqtt-ingestion/command-api process. Set REDIS_URL (see docker-compose.yml)
  // for real cross-process delivery; this fallback exists only so the process
  // starts cleanly without Redis, not as a working substitute for it.
  const pubsub: PubSubPort = process.env.REDIS_URL
    ? new RedisPubSubAdapter(process.env.REDIS_URL)
    : new LocalPubSubAdapter();

  const server = new RealtimeServer({ verifier, pubsub });
  const port = await server.listen(process.env.PORT ? Number(process.env.PORT) : 3002);
  // eslint-disable-next-line no-console
  console.log(`realtime-service listening on :${port}`);
}

void bootstrap();
