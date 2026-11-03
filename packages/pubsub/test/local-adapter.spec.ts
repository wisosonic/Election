import { LocalPubSubAdapter } from '../src/local-adapter';

describe('LocalPubSubAdapter', () => {
  it('delivers a published message to a subscriber on the same channel', async () => {
    const bus = new LocalPubSubAdapter();
    const received: unknown[] = [];
    bus.subscribe('domain-events', (msg) => received.push(msg));
    await bus.publish('domain-events', { hello: 'world' });
    expect(received).toEqual([{ hello: 'world' }]);
  });

  it('delivers to every subscriber on the channel, not just the first', async () => {
    const bus = new LocalPubSubAdapter();
    const a: unknown[] = [];
    const b: unknown[] = [];
    bus.subscribe('domain-events', (msg) => a.push(msg));
    bus.subscribe('domain-events', (msg) => b.push(msg));
    await bus.publish('domain-events', { n: 1 });
    expect(a).toEqual([{ n: 1 }]);
    expect(b).toEqual([{ n: 1 }]);
  });

  it('never delivers to a subscriber on a different channel', async () => {
    const bus = new LocalPubSubAdapter();
    const received: unknown[] = [];
    bus.subscribe('other-channel', (msg) => received.push(msg));
    await bus.publish('domain-events', { n: 1 });
    expect(received).toEqual([]);
  });

  it('is silent when nothing has subscribed yet', async () => {
    const bus = new LocalPubSubAdapter();
    await expect(bus.publish('domain-events', { n: 1 })).resolves.toBeUndefined();
  });
});
