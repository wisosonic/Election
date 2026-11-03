export interface QueueMessage<T = unknown> {
  id: string;
  body: T;
  attempt: number;
}

export type MessageHandler<T> = (msg: QueueMessage<T>) => Promise<void>;

/**
 * Port every consumer of "the durable queue between the MQTT broker and the
 * ingestion workers" (ARCHITECTURE.md §5.1) codes against. LocalQueueAdapter is
 * the in-process implementation used in dev/test; SqsAdapter is the production
 * seam (not exercised here -- no AWS account/credentials in this environment).
 */
export interface QueuePort<T = unknown> {
  publish(body: T): Promise<void>;
  consume(handler: MessageHandler<T>): void;
  onDeadLetter(handler: (msg: QueueMessage<T>, error: Error) => void): void;
  close(): Promise<void>;
}
