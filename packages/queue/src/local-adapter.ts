import { randomUUID } from 'crypto';
import { MessageHandler, QueueMessage, QueuePort } from './port';

/**
 * In-process, EventLoop-driven queue -- durable enough for dev/test to prove
 * the "broker -> queue -> workers" decoupling behavior (burst absorption,
 * retry, dead-lettering) without needing a real SQS/Kafka broker running.
 */
export class LocalQueueAdapter<T = unknown> implements QueuePort<T> {
  private handler: MessageHandler<T> | null = null;
  private deadLetterHandlers: Array<(msg: QueueMessage<T>, error: Error) => void> = [];
  private queue: QueueMessage<T>[] = [];
  private draining = false;
  private readonly maxAttempts: number;

  constructor(opts: { maxAttempts?: number } = {}) {
    this.maxAttempts = opts.maxAttempts ?? 3;
  }

  async publish(body: T): Promise<void> {
    this.queue.push({ id: randomUUID(), body, attempt: 0 });
    this.drain();
  }

  consume(handler: MessageHandler<T>): void {
    this.handler = handler;
    this.drain();
  }

  onDeadLetter(handler: (msg: QueueMessage<T>, error: Error) => void): void {
    this.deadLetterHandlers.push(handler);
  }

  async close(): Promise<void> {
    this.handler = null;
    this.queue = [];
  }

  /** Exposed for tests that need to know the queue has drained before asserting. */
  get pending(): number {
    return this.queue.length;
  }

  private drain(): void {
    if (this.draining || !this.handler) return;
    this.draining = true;
    void this.loop();
  }

  private async loop(): Promise<void> {
    while (this.queue.length > 0 && this.handler) {
      const msg = this.queue.shift() as QueueMessage<T>;
      msg.attempt += 1;
      try {
        await this.handler(msg);
      } catch (err) {
        if (msg.attempt < this.maxAttempts) {
          this.queue.push(msg); // retry -- goes to the back of the queue
        } else {
          for (const dl of this.deadLetterHandlers) dl(msg, err as Error);
        }
      }
    }
    this.draining = false;
  }
}
