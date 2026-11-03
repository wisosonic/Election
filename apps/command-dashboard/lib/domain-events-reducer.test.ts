import { addEvent } from './domain-events-reducer';
import type { DomainEvent } from '@election/shared-types';

function event(occurredAt: string): DomainEvent {
  return { tenantId: 't1', kind: 'turnout', payload: {}, occurredAt };
}

describe('addEvent', () => {
  it('prepends the new event (newest first)', () => {
    const state = addEvent([event('2026-05-15T10:00:00Z')], event('2026-05-15T10:01:00Z'));
    expect(state.map((e) => e.occurredAt)).toEqual(['2026-05-15T10:01:00Z', '2026-05-15T10:00:00Z']);
  });

  it('caps the list at `max`, dropping the oldest', () => {
    const state = [event('a'), event('b'), event('c')];
    const result = addEvent(state, event('d'), 3);
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.occurredAt)).toEqual(['d', 'a', 'b']);
  });

  it('does not mutate the original array', () => {
    const state = [event('a')];
    const result = addEvent(state, event('b'));
    expect(state).toHaveLength(1);
    expect(result).not.toBe(state);
  });
});
