import { LocalQueueAdapter } from '../src/local-adapter';

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('LocalQueueAdapter', () => {
  it('delivers a published message to the consumer', async () => {
    const queue = new LocalQueueAdapter<{ n: number }>();
    const received: number[] = [];
    queue.consume(async (msg) => {
      received.push(msg.body.n);
    });
    await queue.publish({ n: 1 });
    await flush();
    expect(received).toEqual([1]);
  });

  it('absorbs a burst of publishes and processes them all (decoupling ingestion from downstream rate)', async () => {
    const queue = new LocalQueueAdapter<{ n: number }>();
    const received: number[] = [];
    queue.consume(async (msg) => {
      received.push(msg.body.n);
    });
    await Promise.all(Array.from({ length: 50 }, (_, i) => queue.publish({ n: i })));
    await flush();
    await flush();
    expect(received).toHaveLength(50);
    expect(new Set(received).size).toBe(50); // no duplicates, none dropped
  });

  it('retries a failing message up to maxAttempts before succeeding', async () => {
    const queue = new LocalQueueAdapter<{ n: number }>({ maxAttempts: 3 });
    let attempts = 0;
    const deadLettered: unknown[] = [];
    queue.onDeadLetter((msg) => deadLettered.push(msg));
    queue.consume(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('transient failure');
    });
    await queue.publish({ n: 1 });
    await flush();
    await flush();
    await flush();
    expect(attempts).toBe(3);
    expect(deadLettered).toHaveLength(0);
  });

  it('dead-letters a message that keeps failing past maxAttempts', async () => {
    const queue = new LocalQueueAdapter<{ n: number }>({ maxAttempts: 2 });
    const deadLettered: Array<{ body: { n: number } }> = [];
    queue.onDeadLetter((msg) => deadLettered.push(msg as { body: { n: number } }));
    queue.consume(async () => {
      throw new Error('permanent failure');
    });
    await queue.publish({ n: 42 });
    await flush();
    await flush();
    await flush();
    expect(deadLettered).toHaveLength(1);
    expect(deadLettered[0].body.n).toBe(42);
    expect(queue.pending).toBe(0);
  });
});
