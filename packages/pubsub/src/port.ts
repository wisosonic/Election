/** Domain event fan-out from mqtt-ingestion/command-api to realtime-service --
 * ARCHITECTURE.md §5.3. LocalPubSubAdapter is the in-process implementation
 * (used by tests, and meaningful only when publisher and subscriber share a
 * process); RedisPubSubAdapter is the real cross-process seam for production
 * (or local dev via docker-compose.yml's redis service), not exercised in
 * this environment (no Redis available). */
export interface PubSubPort {
  publish(channel: string, message: unknown): Promise<void>;
  subscribe(channel: string, handler: (message: unknown) => void): void;
}
