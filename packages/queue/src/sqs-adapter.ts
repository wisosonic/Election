import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { MessageHandler, QueueMessage, QueuePort } from './port';

/**
 * Structurally complete seam for AWS SQS, fed by IoT Core's Rule Engine in
 * production (ARCHITECTURE.md §5.1 / §10). NOT exercised against a real AWS
 * account in this environment -- no credentials available. Swap
 * LocalQueueAdapter for this once the queue is actually provisioned.
 * Dead-lettering is configured at the SQS queue level (a redrive policy
 * pointing at a DLQ), not reimplemented client-side here.
 */
export class SqsAdapter<T = unknown> implements QueuePort<T> {
  private readonly client: SQSClient;
  private polling = false;

  constructor(private readonly queueUrl: string, region?: string) {
    this.client = new SQSClient({ region });
  }

  async publish(body: T): Promise<void> {
    await this.client.send(new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify(body) }));
  }

  consume(handler: MessageHandler<T>): void {
    if (this.polling) return;
    this.polling = true;
    void this.pollLoop(handler);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onDeadLetter(): void {}

  async close(): Promise<void> {
    this.polling = false;
  }

  private async pollLoop(handler: MessageHandler<T>): Promise<void> {
    while (this.polling) {
      const { Messages } = await this.client.send(
        new ReceiveMessageCommand({ QueueUrl: this.queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20 }),
      );
      for (const m of Messages ?? []) {
        const body = JSON.parse(m.Body ?? '{}') as T;
        const msg: QueueMessage<T> = { id: m.MessageId ?? '', body, attempt: 1 };
        await handler(msg);
        if (m.ReceiptHandle) {
          await this.client.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: m.ReceiptHandle }));
        }
      }
    }
  }
}
